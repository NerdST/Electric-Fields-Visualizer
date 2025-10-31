#include "Protocol.h"
#include <algorithm>
#include <cstring>
#include <stdexcept>

ProtocolEncoder::ProtocolEncoder() {
  buffer_.reserve(1024 * 1024); // Reserve 1MB
}

void ProtocolEncoder::writeHeader(MessageType type) {
  buffer_.push_back(static_cast<uint8_t>(type));
}

void ProtocolEncoder::writeString(const std::string &str) {
  writeUInt32(static_cast<uint32_t>(str.length()));
  buffer_.insert(buffer_.end(), str.begin(), str.end());
}

void ProtocolEncoder::writeFloat(float value) {
  uint32_t bits;
  std::memcpy(&bits, &value, sizeof(float));
  buffer_.push_back(static_cast<uint8_t>(bits));
  buffer_.push_back(static_cast<uint8_t>(bits >> 8));
  buffer_.push_back(static_cast<uint8_t>(bits >> 16));
  buffer_.push_back(static_cast<uint8_t>(bits >> 24));
}

void ProtocolEncoder::writeDouble(double value) {
  uint64_t bits;
  std::memcpy(&bits, &value, sizeof(double));
  for (int i = 0; i < 8; ++i) {
    buffer_.push_back(static_cast<uint8_t>(bits >> (i * 8)));
  }
}

void ProtocolEncoder::writeInt32(int32_t value) {
  buffer_.push_back(static_cast<uint8_t>(value));
  buffer_.push_back(static_cast<uint8_t>(value >> 8));
  buffer_.push_back(static_cast<uint8_t>(value >> 16));
  buffer_.push_back(static_cast<uint8_t>(value >> 24));
}

void ProtocolEncoder::writeUInt32(uint32_t value) {
  buffer_.push_back(static_cast<uint8_t>(value));
  buffer_.push_back(static_cast<uint8_t>(value >> 8));
  buffer_.push_back(static_cast<uint8_t>(value >> 16));
  buffer_.push_back(static_cast<uint8_t>(value >> 24));
}

void ProtocolEncoder::encodeFrame(const std::string &sessionId,
                                  const std::vector<uint8_t> &textureData,
                                  double simulationTime) {
  buffer_.clear();
  writeHeader(MessageType::SERVER_FRAME);
  writeString(sessionId);
  writeDouble(simulationTime);
  writeUInt32(static_cast<uint32_t>(textureData.size()));
  buffer_.insert(buffer_.end(), textureData.begin(), textureData.end());
}

void ProtocolEncoder::encodeState(const std::string &sessionId, float time,
                                  int width, int height, int depth) {
  buffer_.clear();
  writeHeader(MessageType::SERVER_STATE);
  writeString(sessionId);
  writeFloat(time);
  writeInt32(width);
  writeInt32(height);
  writeInt32(depth);
}

void ProtocolEncoder::encodeError(const std::string &sessionId,
                                  const std::string &error) {
  buffer_.clear();
  writeHeader(MessageType::SERVER_ERROR);
  writeString(sessionId);
  writeString(error);
}

ProtocolDecoder::ProtocolDecoder(const uint8_t *data, size_t size)
    : data_(data), size_(size), offset_(0) {}

MessageType ProtocolDecoder::decodeHeader() {
  if (offset_ >= size_) {
    throw std::runtime_error("Invalid message: not enough data");
  }
  MessageType type = static_cast<MessageType>(data_[offset_++]);
  return type;
}

std::string ProtocolDecoder::readString() {
  uint32_t len = readUInt32();
  if (offset_ + len > size_) {
    throw std::runtime_error("Invalid message: string length exceeds buffer");
  }
  std::string result(reinterpret_cast<const char *>(data_ + offset_), len);
  offset_ += len;
  return result;
}

float ProtocolDecoder::readFloat() {
  if (offset_ + 4 > size_) {
    throw std::runtime_error("Invalid message: not enough data for float");
  }
  uint32_t bits = static_cast<uint32_t>(data_[offset_]) |
                  (static_cast<uint32_t>(data_[offset_ + 1]) << 8) |
                  (static_cast<uint32_t>(data_[offset_ + 2]) << 16) |
                  (static_cast<uint32_t>(data_[offset_ + 3]) << 24);
  offset_ += 4;
  float result;
  std::memcpy(&result, &bits, sizeof(float));
  return result;
}

double ProtocolDecoder::readDouble() {
  if (offset_ + 8 > size_) {
    throw std::runtime_error("Invalid message: not enough data for double");
  }
  uint64_t bits = 0;
  for (int i = 0; i < 8; ++i) {
    bits |= static_cast<uint64_t>(data_[offset_ + i]) << (i * 8);
  }
  offset_ += 8;
  double result;
  std::memcpy(&result, &bits, sizeof(double));
  return result;
}

int32_t ProtocolDecoder::readInt32() {
  if (offset_ + 4 > size_) {
    throw std::runtime_error("Invalid message: not enough data for int32");
  }
  int32_t result = static_cast<int32_t>(data_[offset_]) |
                   (static_cast<int32_t>(data_[offset_ + 1]) << 8) |
                   (static_cast<int32_t>(data_[offset_ + 2]) << 16) |
                   (static_cast<int32_t>(data_[offset_ + 3]) << 24);
  offset_ += 4;
  return result;
}

uint32_t ProtocolDecoder::readUInt32() {
  if (offset_ + 4 > size_) {
    throw std::runtime_error("Invalid message: not enough data for uint32");
  }
  uint32_t result = static_cast<uint32_t>(data_[offset_]) |
                    (static_cast<uint32_t>(data_[offset_ + 1]) << 8) |
                    (static_cast<uint32_t>(data_[offset_ + 2]) << 16) |
                    (static_cast<uint32_t>(data_[offset_ + 3]) << 24);
  offset_ += 4;
  return result;
}

void ProtocolDecoder::decodeClientInput(ClientInputMessage &msg) {
  msg.x = readFloat();
  msg.y = readFloat();
  msg.z = readFloat();
  msg.value = readFloat();
  msg.timestamp = readUInt32();
}

void ProtocolDecoder::decodeClientControl(ClientControlMessage &msg) {
  if (offset_ >= size_) {
    throw std::runtime_error("Invalid message: not enough data for control");
  }
  msg.type = static_cast<ClientControlMessage::Type>(data_[offset_++]);
  msg.parameter = readFloat();
}
