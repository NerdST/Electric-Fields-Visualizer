#pragma once

#include "../simulation/FDTD3D.h"
#include <atomic>
#include <chrono>
#include <memory>
#include <string>

class Session {
public:
  Session(const std::string &sessionId);
  ~Session();

  std::string getId() const { return sessionId_; }

  // Simulation control
  void initialize(int width = 128, int height = 128, int depth = 128);
  void step();
  void handleInput(float x, float y, float z, float value);

  // Frame data
  bool hasNewFrame() const { return hasNewFrame_; }
  void getFrameData(std::vector<uint8_t> &buffer);
  void markFrameSent();
  double getSimulationTime() const;

  // Lifetime
  void update();
  bool isExpired() const;

private:
  std::string sessionId_;
  std::unique_ptr<FDTD3D> simulation_;
  std::atomic<bool> hasNewFrame_;
  std::atomic<bool> needsUpdate_;
  std::chrono::steady_clock::time_point lastActivity_;
  static constexpr auto SESSION_TIMEOUT = std::chrono::minutes(30);

  // Frame buffer for compression
  std::vector<float> electricFieldBuffer_;
  std::vector<float> magneticFieldBuffer_;
};
