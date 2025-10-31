#include "FDTD3D.h"
#include "../gpu/VulkanManager.h"
#include <cmath>
#include <cstring>
#include <stdexcept>

FDTD3D::FDTD3D(int width, int height, int depth)
    : width_(width), height_(height), depth_(depth), time_(0.0), dt_(0.001),
      cellSize_(0.01) {
  vulkanManager_ = std::make_unique<VulkanManager>();
}

FDTD3D::~FDTD3D() { cleanup(); }

void FDTD3D::initialize() {
  if (!vulkanManager_->initialize()) {
    throw std::runtime_error("Failed to initialize Vulkan");
  }

  size_t textureSize = width_ * height_ * depth_ * 3; // RGB components
  size_t bufferSize = textureSize * sizeof(float);

  // Allocate GPU memory
  vulkanManager_->allocateBuffer(&electricField_d_, bufferSize);
  vulkanManager_->allocateBuffer(&electricFieldNext_d_, bufferSize);
  vulkanManager_->allocateBuffer(&magneticField_d_, bufferSize);
  vulkanManager_->allocateBuffer(&magneticFieldNext_d_, bufferSize);
  vulkanManager_->allocateBuffer(&sourceField_d_, bufferSize);
  vulkanManager_->allocateBuffer(&sourceFieldNext_d_, bufferSize);
  vulkanManager_->allocateBuffer(&materialField_d_, width_ * height_ * depth_ *
                                                        4 * sizeof(uint8_t));
  vulkanManager_->allocateBuffer(&alphaBetaField_d_,
                                 width_ * height_ * depth_ * 4 * sizeof(float));

  initializeMaterialField();
  initializeAlphaBeta();
}

void FDTD3D::initializeMaterialField() {
  // Initialize with vacuum properties (permeability=1, permittivity=1,
  // conductivity=0)
  std::vector<uint8_t> materialData(width_ * height_ * depth_ * 4);
  for (size_t i = 0; i < materialData.size(); i += 4) {
    materialData[i] = 255;     // permeability
    materialData[i + 1] = 255; // permittivity
    materialData[i + 2] = 0;   // conductivity
    materialData[i + 3] = 255; // alpha
  }

  vulkanManager_->copyToDevice(materialField_d_, materialData.data(),
                               materialData.size() * sizeof(uint8_t));
}

void FDTD3D::initializeAlphaBeta() {
  // Calculate alpha-beta coefficients
  float simParams[4] = {static_cast<float>(dt_), static_cast<float>(cellSize_),
                        0.0f, 0.0f};
  vulkanManager_->updateAlphaBeta(materialField_d_, alphaBetaField_d_,
                                  simParams, width_, height_, depth_);
}

void FDTD3D::step() {
  // Update alpha-beta if needed (currently static)

  // Inject sources
  vulkanManager_->injectSource(sourceField_d_, electricField_d_,
                               electricFieldNext_d_, dt_, width_, height_,
                               depth_);

  // Decay sources
  vulkanManager_->decaySource(sourceField_d_, sourceFieldNext_d_, dt_, width_,
                              height_, depth_);

  // Update electric field
  vulkanManager_->updateElectricField(electricField_d_, electricFieldNext_d_,
                                      magneticField_d_, alphaBetaField_d_,
                                      width_, height_, depth_);

  // Update magnetic field
  vulkanManager_->updateMagneticField(electricField_d_, magneticField_d_,
                                      magneticFieldNext_d_, alphaBetaField_d_,
                                      width_, height_, depth_);

  swapBuffers();
  time_ += dt_;
}

void FDTD3D::swapBuffers() {
  std::swap(electricField_d_, electricFieldNext_d_);
  std::swap(magneticField_d_, magneticFieldNext_d_);
  std::swap(sourceField_d_, sourceFieldNext_d_);
}

void FDTD3D::addSource(float x, float y, float z, float value) {
  // Convert normalized [0,1] to grid coordinates
  int gx = static_cast<int>(x * width_);
  int gy = static_cast<int>(y * height_);
  int gz = static_cast<int>(z * depth_);

  vulkanManager_->drawEllipse(sourceField_d_, sourceFieldNext_d_, gx, gy, gz, 2,
                              2, 2, // Small radius
                              value, width_, height_, depth_);

  swapBuffers();
}

void FDTD3D::getElectricField(std::vector<float> &buffer) {
  size_t size = width_ * height_ * depth_ * 3;
  buffer.resize(size);
  vulkanManager_->copyFromDevice(buffer.data(), electricField_d_,
                                 size * sizeof(float));
}

void FDTD3D::getMagneticField(std::vector<float> &buffer) {
  size_t size = width_ * height_ * depth_ * 3;
  buffer.resize(size);
  vulkanManager_->copyFromDevice(buffer.data(), magneticField_d_,
                                 size * sizeof(float));
}

void FDTD3D::cleanup() {
  if (vulkanManager_) {
    vulkanManager_->freeBuffer(electricField_d_);
    vulkanManager_->freeBuffer(electricFieldNext_d_);
    vulkanManager_->freeBuffer(magneticField_d_);
    vulkanManager_->freeBuffer(magneticFieldNext_d_);
    vulkanManager_->freeBuffer(sourceField_d_);
    vulkanManager_->freeBuffer(sourceFieldNext_d_);
    vulkanManager_->freeBuffer(materialField_d_);
    vulkanManager_->freeBuffer(alphaBetaField_d_);
  }
}
