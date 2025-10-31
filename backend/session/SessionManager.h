#pragma once

#include "../common/CommonTypes.h"
#include "App.h"
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

class Session;

// Forward declarations from Protocol
struct ClientInputMessage;
struct ClientControlMessage;
class ProtocolEncoder;

class SessionManager {
public:
  SessionManager();
  ~SessionManager();

  // Connection management
  std::string createSession(WebSocketType *ws);
  void removeSession(WebSocketType *ws);
  std::optional<std::string> getSessionId(WebSocketType *ws) const;

  // Session operations
  void handleInput(const std::string &sessionId,
                   const ClientInputMessage &input);
  void handleControl(const std::string &sessionId,
                     const ClientControlMessage &control);
  void updateAll();

  // Frame broadcasting
  void broadcastFrames();

private:
  std::unordered_map<WebSocketType *, std::string> connectionToSession_;
  std::unordered_map<std::string, std::unique_ptr<Session>> sessions_;
  std::unordered_map<std::string, WebSocketType *> sessionToConnection_;
  mutable std::mutex mutex_;

  std::string generateSessionId() const;
  void cleanupExpiredSessions();
};
