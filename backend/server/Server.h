#pragma once

#include "../common/CommonTypes.h"
#include "App.h"
#include <atomic>
#include <memory>
#include <string>
#include <thread>
#include <unordered_map>

class SessionManager;

class Server {
public:
  Server(uint16_t port = 8080);
  ~Server();

  void run();
  void stop();

private:
  void setupRoutes();
  void handleWebSocket(WebSocketType *ws, std::string_view message,
                       uWS::OpCode opCode);
  void handleDisconnect(WebSocketType *ws, int code, std::string_view message);

  uWS::App app_;
  uint16_t port_;
  std::unique_ptr<SessionManager> sessionManager_;
  std::atomic<bool> running_;

  // Thread pool for simulation workers
  std::vector<std::thread> simulationThreads_;
};
