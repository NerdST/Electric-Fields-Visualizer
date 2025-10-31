#include "SessionManager.h"
#include "../protocol/Protocol.h"
#include "App.h"
#include "Session.h"
#include <iomanip>
#include <random>
#include <sstream>
#include <stdexcept>

SessionManager::SessionManager() {}

SessionManager::~SessionManager() {
  std::lock_guard<std::mutex> lock(mutex_);
  sessions_.clear();
  connectionToSession_.clear();
  sessionToConnection_.clear();
}

std::string SessionManager::generateSessionId() const {
  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<> dis(0, 15);

  std::ostringstream oss;
  oss << std::hex;
  for (int i = 0; i < 32; ++i) {
    oss << dis(gen);
  }
  return oss.str();
}

std::string SessionManager::createSession(WebSocketType *ws) {
  std::lock_guard<std::mutex> lock(mutex_);

  std::string sessionId = generateSessionId();
  auto session = std::make_unique<Session>(sessionId);
  session->initialize(128, 128, 128); // Default 3D grid

  sessions_[sessionId] = std::move(session);
  connectionToSession_[ws] = sessionId;
  sessionToConnection_[sessionId] = ws;

  return sessionId;
}

void SessionManager::removeSession(WebSocketType *ws) {
  std::lock_guard<std::mutex> lock(mutex_);

  auto it = connectionToSession_.find(ws);
  if (it != connectionToSession_.end()) {
    std::string sessionId = it->second;
    sessions_.erase(sessionId);
    sessionToConnection_.erase(sessionId);
    connectionToSession_.erase(it);
  }
}

std::optional<std::string>
SessionManager::getSessionId(WebSocketType *ws) const {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = connectionToSession_.find(ws);
  if (it != connectionToSession_.end()) {
    return it->second;
  }
  return std::nullopt;
}

void SessionManager::handleInput(const std::string &sessionId,
                                 const ClientInputMessage &input) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = sessions_.find(sessionId);
  if (it != sessions_.end()) {
    it->second->handleInput(input.x, input.y, input.z, input.value);
  }
}

void SessionManager::handleControl(const std::string &sessionId,
                                   const ClientControlMessage &control) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = sessions_.find(sessionId);
  if (it != sessions_.end()) {
    // Handle control messages (pause, reset, etc.)
    // Implementation depends on control message types
  }
}

void SessionManager::updateAll() {
  std::lock_guard<std::mutex> lock(mutex_);

  for (auto &[sessionId, session] : sessions_) {
    session->update();
  }

  cleanupExpiredSessions();
}

void SessionManager::broadcastFrames() {
  std::lock_guard<std::mutex> lock(mutex_);

  for (auto &[sessionId, session] : sessions_) {
    if (!session->hasNewFrame()) {
      continue;
    }

    auto connIt = sessionToConnection_.find(sessionId);
    if (connIt == sessionToConnection_.end()) {
      continue;
    }

    WebSocketType *ws = connIt->second;

    // Get frame data
    std::vector<uint8_t> frameData;
    session->getFrameData(frameData);

    if (!frameData.empty()) {
      // Encode frame message
      ProtocolEncoder encoder;
      encoder.encodeFrame(sessionId, frameData, session->getSimulationTime());

      auto bufferPair = encoder.getBuffer();
      std::string_view messageView(
          reinterpret_cast<const char *>(bufferPair.first), bufferPair.second);
      ws->send(messageView, uWS::BINARY);

      session->markFrameSent();
    }
  }
}

void SessionManager::cleanupExpiredSessions() {
  auto it = sessions_.begin();
  while (it != sessions_.end()) {
    if (it->second->isExpired()) {
      std::string sessionId = it->first;
      sessions_.erase(it++);
      sessionToConnection_.erase(sessionId);

      // Remove from connection map
      for (auto connIt = connectionToSession_.begin();
           connIt != connectionToSession_.end();) {
        if (connIt->second == sessionId) {
          connectionToSession_.erase(connIt++);
        } else {
          ++connIt;
        }
      }
    } else {
      ++it;
    }
  }
}
