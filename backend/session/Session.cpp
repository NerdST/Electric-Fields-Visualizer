#include "Session.h"
#include <cstring>
#include <iostream>

Session::Session(const std::string &sessionId)
    : sessionId_(sessionId), hasNewFrame_(false), needsUpdate_(true),
      lastActivity_(std::chrono::steady_clock::now()) {}

Session::~Session() {
  if (simulation_) {
    simulation_->cleanup();
  }
}

void Session::initialize(int width, int height, int depth) {
  simulation_ = std::make_unique<FDTD3D>(width, height, depth);
  simulation_->initialize();

  // Allocate frame buffers
  size_t textureSize = width * height * depth * 3; // RGB
  electricFieldBuffer_.resize(textureSize);
  magneticFieldBuffer_.resize(textureSize);
}

void Session::step() {
  if (!simulation_)
    return;

  simulation_->step();
  hasNewFrame_ = true;
  lastActivity_ = std::chrono::steady_clock::now();
}

void Session::handleInput(float x, float y, float z, float value) {
  if (!simulation_)
    return;

  simulation_->addSource(x, y, z, value);
  lastActivity_ = std::chrono::steady_clock::now();
}

void Session::getFrameData(std::vector<uint8_t> &buffer) {
  if (!simulation_ || !hasNewFrame_) {
    buffer.clear();
    return;
  }

  // Get texture data from simulation
  simulation_->getElectricField(electricFieldBuffer_);
  simulation_->getMagneticField(magneticFieldBuffer_);

  // Copy to output buffer (will be compressed by protocol layer)
  size_t totalSize = electricFieldBuffer_.size() * sizeof(float) * 2;
  buffer.resize(totalSize);

  memcpy(buffer.data(), electricFieldBuffer_.data(),
         electricFieldBuffer_.size() * sizeof(float));
  memcpy(buffer.data() + electricFieldBuffer_.size() * sizeof(float),
         magneticFieldBuffer_.data(),
         magneticFieldBuffer_.size() * sizeof(float));
}

void Session::markFrameSent() { hasNewFrame_ = false; }

double Session::getSimulationTime() const {
  if (!simulation_)
    return 0.0;
  return simulation_->getTime();
}

void Session::update() {
  if (needsUpdate_) {
    step();
    needsUpdate_ = false;
  }
}

bool Session::isExpired() const {
  auto now = std::chrono::steady_clock::now();
  return (now - lastActivity_) > SESSION_TIMEOUT;
}
