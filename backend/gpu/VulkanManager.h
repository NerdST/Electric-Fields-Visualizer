#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

// Forward declarations - avoiding full Vulkan includes in header
struct VulkanContext;

class VulkanManager {
public:
  VulkanManager();
  ~VulkanManager();

  bool initialize();
  void cleanup();

  // Memory management
  void allocateBuffer(void **ptr, size_t size);
  void freeBuffer(void *ptr);
  void copyToDevice(void *dst, const void *src, size_t size);
  void copyFromDevice(void *dst, const void *src, size_t size);

  // Compute shader dispatches (matching CUDA interface)
  void updateAlphaBeta(void *materialField, void *alphaBetaField,
                       const float *params, int w, int h, int d);
  void updateElectricField(void *electricField, void *electricFieldNext,
                           void *magneticField, void *alphaBetaField, int w,
                           int h, int d);
  void updateMagneticField(void *electricField, void *magneticField,
                           void *magneticFieldNext, void *alphaBetaField, int w,
                           int h, int d);
  void injectSource(void *sourceField, void *field, void *output, float dt,
                    int w, int h, int d);
  void decaySource(void *sourceField, void *output, float dt, int w, int h,
                   int d);
  void drawEllipse(void *input, void *output, int x, int y, int z, int rx,
                   int ry, int rz, float value, int w, int h, int d);

private:
  VulkanContext *context_;
  bool initialized_;

  // Helper methods
  void createComputePipeline(const char *shaderName,
                             const std::vector<uint32_t> &spirv);
  void dispatchCompute(const char *pipelineName, void **buffers,
                       const void *uniforms, size_t uniformSize, int w, int h,
                       int d);
};
