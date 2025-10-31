#pragma once

#include <memory>
#include <vector>

class VulkanManager;

class FDTD3D {
public:
  FDTD3D(int width, int height, int depth);
  ~FDTD3D();

  void initialize();
  void step();
  void cleanup();

  void addSource(float x, float y, float z, float value);

  void getElectricField(std::vector<float> &buffer);
  void getMagneticField(std::vector<float> &buffer);

  double getTime() const { return time_; }
  int getWidth() const { return width_; }
  int getHeight() const { return height_; }
  int getDepth() const { return depth_; }

private:
  int width_, height_, depth_;
  double time_;
  double dt_;
  double cellSize_;

  std::unique_ptr<VulkanManager> vulkanManager_;

  // GPU buffers
  void *electricField_d_; // Device pointer
  void *electricFieldNext_d_;
  void *magneticField_d_;
  void *magneticFieldNext_d_;
  void *sourceField_d_;
  void *sourceFieldNext_d_;
  void *materialField_d_;
  void *alphaBetaField_d_;

  void initializeMaterialField();
  void initializeAlphaBeta();
  void swapBuffers();
};
