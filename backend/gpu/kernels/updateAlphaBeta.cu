#include <cuda_runtime.h>
#include <device_launch_parameters.h>

__global__ void updateAlphaBetaKernel(uint8_t *materialField,
                                      float *alphaBetaField, float dt,
                                      float cellSize, int width, int height,
                                      int depth) {
  int x = blockIdx.x * blockDim.x + threadIdx.x;
  int y = blockIdx.y * blockDim.y + threadIdx.y;
  int z = blockIdx.z * blockDim.z + threadIdx.z;

  if (x >= width || y >= height || z >= depth)
    return;

  int idx = (z * height + y) * width + x;
  int matIdx = idx * 4;

  // Material properties (normalized [0,1])
  float permeability = materialField[matIdx] / 255.0f;
  float permittivity = materialField[matIdx + 1] / 255.0f;
  float conductivity = materialField[matIdx + 2] / 255.0f;

  // Calculate alpha and beta for electric field
  float cEl = conductivity * dt / (2.0f * permeability);
  float dEl = 1.0f / (1.0f + cEl);
  float alphaEl = (1.0f - cEl) * dEl;
  float betaEl = dt / (permeability * cellSize) * dEl;

  // Calculate alpha and beta for magnetic field
  float cMag = conductivity * dt / (2.0f * permittivity);
  float dMag = 1.0f / (1.0f + cMag);
  float alphaMag = (1.0f - cMag) * dMag;
  float betaMag = dt / (permittivity * cellSize) * dMag;

  int outIdx = idx * 4;
  alphaBetaField[outIdx] = alphaEl;
  alphaBetaField[outIdx + 1] = betaEl;
  alphaBetaField[outIdx + 2] = alphaMag;
  alphaBetaField[outIdx + 3] = betaMag;
}

extern "C" void launchUpdateAlphaBeta(void *materialField, void *alphaBetaField,
                                      const float *params, int w, int h,
                                      int d) {
  float dt = params[0];
  float cellSize = params[1];

  dim3 blockSize(8, 8, 8);
  dim3 gridSize((w + blockSize.x - 1) / blockSize.x,
                (h + blockSize.y - 1) / blockSize.y,
                (d + blockSize.z - 1) / blockSize.z);

  updateAlphaBetaKernel<<<gridSize, blockSize>>>(
      (uint8_t *)materialField, (float *)alphaBetaField, dt, cellSize, w, h, d);

  cudaDeviceSynchronize();
}
