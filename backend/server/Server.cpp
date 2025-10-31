#include "Server.h"
#include "../protocol/Protocol.h"
#include "../session/SessionManager.h"
#include "App.h"
#include <chrono>
#include <iostream>
#include <sstream>
#include <thread>
#include <vector>

Server::Server(uint16_t port) : port_(port), running_(false) {
  sessionManager_ = std::make_unique<SessionManager>();
  setupRoutes();
}

Server::~Server() { stop(); }

void Server::setupRoutes() {
  // WebSocket endpoint
  app_.ws<EmptyUserData>(
      "/*",
      {.compression = uWS::SHARED_COMPRESSOR,
       .maxPayloadLength = 16 * 1024 * 1024, // 16MB
       .idleTimeout = 32,
       .maxBackpressure = 1024 * 1024, // 1MB
       .open =
           [this](auto *ws) {
             // Connection opened - create session
             std::string sessionId = sessionManager_->createSession(ws);
             std::cout << "WebSocket connection opened, session: " << sessionId
                       << std::endl;
           },
       .message =
           [this](auto *ws, std::string_view message, uWS::OpCode opCode) {
             if (opCode == uWS::BINARY) {
               handleWebSocket(ws, message, opCode);
             } else if (opCode == uWS::TEXT) {
               // Handle text messages (JSON control messages)
               std::cout << "Received text message: " << message << std::endl;
             }
           },
       .drain =
           [](auto *ws) {
             std::cout << "WebSocket backpressure drained" << std::endl;
           },
       .close =
           [this](auto *ws, int code, std::string_view message) {
             handleDisconnect(ws, code, message);
           }});

  // HTTP endpoint for health check
  app_.get("/*", [](auto *res, auto *req) {
    res->writeStatus("200 OK");
    res->writeHeader("Content-Type", "text/plain");
    res->end("FDTD Backend Server Running");
  });
}

void Server::handleWebSocket(WebSocketType *ws, std::string_view message,
                             uWS::OpCode opCode) {
  try {
    ProtocolDecoder decoder(reinterpret_cast<const uint8_t *>(message.data()),
                            message.size());
    MessageType msgType = decoder.decodeHeader();

    switch (msgType) {
    case MessageType::CLIENT_INPUT: {
      ClientInputMessage input;
      decoder.decodeClientInput(input);

      // Get session for this connection
      auto sessionId = sessionManager_->getSessionId(ws);
      if (sessionId) {
        sessionManager_->handleInput(*sessionId, input);
      }
      break;
    }
    case MessageType::CLIENT_CONTROL: {
      ClientControlMessage control;
      decoder.decodeClientControl(control);

      auto sessionId = sessionManager_->getSessionId(ws);
      if (sessionId) {
        sessionManager_->handleControl(*sessionId, control);
      }
      break;
    }
    default:
      std::cerr << "Unknown message type: " << static_cast<int>(msgType)
                << std::endl;
    }
  } catch (const std::exception &e) {
    std::cerr << "Error handling WebSocket message: " << e.what() << std::endl;
  }
}

void Server::handleDisconnect(WebSocketType *ws, int code,
                              std::string_view message) {
  std::cout << "WebSocket disconnected: code=" << code << std::endl;
  sessionManager_->removeSession(ws);
}

void Server::run() {
  running_ = true;

  // Start simulation threads
  const int numThreads = std::thread::hardware_concurrency();
  for (int i = 0; i < numThreads; ++i) {
    simulationThreads_.emplace_back([this]() {
      while (running_) {
        sessionManager_->updateAll();
        sessionManager_->broadcastFrames();
        std::this_thread::sleep_for(std::chrono::milliseconds(16)); // ~60 FPS
      }
    });
  }

  app_.listen(port_,
              [this](auto *listen_socket) {
                if (listen_socket) {
                  std::cout << "FDTD Backend Server listening on port " << port_
                            << std::endl;
                } else {
                  std::cerr << "Failed to start server on port " << port_
                            << std::endl;
                }
              })
      .run();
}

void Server::stop() {
  running_ = false;
  for (auto &thread : simulationThreads_) {
    if (thread.joinable()) {
      thread.join();
    }
  }
  sessionManager_.reset();
}
