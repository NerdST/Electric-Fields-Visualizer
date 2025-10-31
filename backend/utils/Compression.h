#pragma once

#include <cstdint>
#include <vector>

namespace Compression {
// Compress data using simple compression (placeholder for now)
// TODO: Implement lz4 or zstd compression
std::vector<uint8_t> compress(const uint8_t *data, size_t size);

// Decompress data
// TODO: Implement decompression
std::vector<uint8_t> decompress(const uint8_t *data, size_t size);
} // namespace Compression
