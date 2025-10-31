#include "Compression.h"
#include <cstring>

namespace Compression {
std::vector<uint8_t> compress(const uint8_t *data, size_t size) {
  // TODO: Implement actual compression (lz4/zstd)
  // For now, just copy the data
  std::vector<uint8_t> result(size);
  std::memcpy(result.data(), data, size);
  return result;
}

std::vector<uint8_t> decompress(const uint8_t *data, size_t size) {
  // TODO: Implement actual decompression
  // For now, just copy the data
  std::vector<uint8_t> result(size);
  std::memcpy(result.data(), data, size);
  return result;
}
} // namespace Compression
