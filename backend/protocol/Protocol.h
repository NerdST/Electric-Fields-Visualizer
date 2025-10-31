#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

enum class MessageType : uint8_t {
  CLIENT_INPUT = 0x01,
  CLIENT_CONTROL = 0x02,
  SERVER_FRAME = 0x10,
  SERVER_STATE = 0x11,
  SERVER_ERROR = 0x12
};

struct ClientInputMessage {
  float x, y, z; // Position in [0,1] normalized space
  float value;   // Source value
  uint32_t timestamp;
};

struct ClientControlMessage {
  enum Type : uint8_t {
    PAUSE = 0x01,
    RESUME = 0x02,
    RESET = 0x03,
    SET_SPEED = 0x04
  };
  Type type;
  float parameter; // For speed, etc.
};

class ProtocolEncoder {
public:
  ProtocolEncoder();

  void encodeFrame(const std::string &sessionId,
                   const std::vector<uint8_t> &textureData,
                   double simulationTime);
  void encodeState(const std::string &sessionId, float time, int width,
                   int height, int depth);
  void encodeError(const std::string &sessionId, const std::string &error);

  std::pair<const uint8_t *, size_t> getBuffer() const {
    return {buffer_.data(), buffer_.size()};
  }

  void clear() { buffer_.clear(); }

private:
  std::vector<uint8_t> buffer_;
  void writeHeader(MessageType type);
  void writeString(const std::string &str);
  void writeFloat(float value);
  void writeDouble(double value);
  void writeInt32(int32_t value);
  void writeUInt32(uint32_t value);
};

class ProtocolDecoder {
public:
  ProtocolDecoder(const uint8_t *data, size_t size);

  MessageType decodeHeader();
  void decodeClientInput(ClientInputMessage &msg);
  void decodeClientControl(ClientControlMessage &msg);

private:
  const uint8_t *data_;
  size_t size_;
  size_t offset_;

  std::string readString();
  float readFloat();
  double readDouble();
  int32_t readInt32();
  uint32_t readUInt32();
};
