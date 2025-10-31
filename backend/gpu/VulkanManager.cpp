#include "VulkanManager.h"
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <vulkan/vulkan.h>

// Simple Vulkan context wrapper
struct VulkanContext {
  VkInstance instance;
  VkPhysicalDevice physicalDevice;
  VkDevice device;
  VkQueue computeQueue;
  VkCommandPool commandPool;
  uint32_t queueFamilyIndex;

  // Compute pipelines
  std::vector<VkPipeline> pipelines;
  std::vector<VkPipelineLayout> pipelineLayouts;

  ~VulkanContext() {
    if (commandPool != VK_NULL_HANDLE) {
      vkDestroyCommandPool(device, commandPool, nullptr);
    }
    for (auto pipeline : pipelines) {
      vkDestroyPipeline(device, pipeline, nullptr);
    }
    for (auto layout : pipelineLayouts) {
      vkDestroyPipelineLayout(device, layout, nullptr);
    }
    if (device != VK_NULL_HANDLE) {
      vkDestroyDevice(device, nullptr);
    }
    if (instance != VK_NULL_HANDLE) {
      vkDestroyInstance(instance, nullptr);
    }
  }
};

VulkanManager::VulkanManager() : context_(nullptr), initialized_(false) {}

VulkanManager::~VulkanManager() { cleanup(); }

bool VulkanManager::initialize() {
  if (initialized_) {
    return true;
  }

  try {
    context_ = new VulkanContext();
    memset(context_, 0, sizeof(VulkanContext));

    // Create Vulkan instance
    VkApplicationInfo appInfo{};
    appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    appInfo.pApplicationName = "FDTD Backend";
    appInfo.apiVersion = VK_API_VERSION_1_2;

    VkInstanceCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    createInfo.pApplicationInfo = &appInfo;

    if (vkCreateInstance(&createInfo, nullptr, &context_->instance) !=
        VK_SUCCESS) {
      throw std::runtime_error("Failed to create Vulkan instance");
    }

    // Select physical device (prefer integrated graphics)
    uint32_t deviceCount = 0;
    vkEnumeratePhysicalDevices(context_->instance, &deviceCount, nullptr);
    if (deviceCount == 0) {
      throw std::runtime_error("No Vulkan devices found");
    }

    std::vector<VkPhysicalDevice> devices(deviceCount);
    vkEnumeratePhysicalDevices(context_->instance, &deviceCount,
                               devices.data());

    // Prefer integrated graphics
    for (const auto &device : devices) {
      VkPhysicalDeviceProperties props;
      vkGetPhysicalDeviceProperties(device, &props);
      if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) {
        context_->physicalDevice = device;
        break;
      }
    }
    if (context_->physicalDevice == VK_NULL_HANDLE) {
      context_->physicalDevice = devices[0]; // Fallback to first device
    }

    // Find compute queue family
    uint32_t queueFamilyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(context_->physicalDevice,
                                             &queueFamilyCount, nullptr);
    std::vector<VkQueueFamilyProperties> queueFamilies(queueFamilyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(
        context_->physicalDevice, &queueFamilyCount, queueFamilies.data());

    context_->queueFamilyIndex = UINT32_MAX;
    for (uint32_t i = 0; i < queueFamilyCount; ++i) {
      if (queueFamilies[i].queueFlags & VK_QUEUE_COMPUTE_BIT) {
        context_->queueFamilyIndex = i;
        break;
      }
    }

    if (context_->queueFamilyIndex == UINT32_MAX) {
      throw std::runtime_error("No compute queue family found");
    }

    // Create logical device
    float queuePriority = 1.0f;
    VkDeviceQueueCreateInfo queueCreateInfo{};
    queueCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    queueCreateInfo.queueFamilyIndex = context_->queueFamilyIndex;
    queueCreateInfo.queueCount = 1;
    queueCreateInfo.pQueuePriorities = &queuePriority;

    VkDeviceCreateInfo deviceCreateInfo{};
    deviceCreateInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    deviceCreateInfo.queueCreateInfoCount = 1;
    deviceCreateInfo.pQueueCreateInfos = &queueCreateInfo;

    if (vkCreateDevice(context_->physicalDevice, &deviceCreateInfo, nullptr,
                       &context_->device) != VK_SUCCESS) {
      throw std::runtime_error("Failed to create Vulkan device");
    }

    vkGetDeviceQueue(context_->device, context_->queueFamilyIndex, 0,
                     &context_->computeQueue);

    // Create command pool
    VkCommandPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    poolInfo.queueFamilyIndex = context_->queueFamilyIndex;
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;

    if (vkCreateCommandPool(context_->device, &poolInfo, nullptr,
                            &context_->commandPool) != VK_SUCCESS) {
      throw std::runtime_error("Failed to create command pool");
    }

    initialized_ = true;
    std::cout << "Vulkan initialized successfully" << std::endl;
    return true;

  } catch (const std::exception &e) {
    std::cerr << "Vulkan initialization error: " << e.what() << std::endl;
    cleanup();
    return false;
  }
}

void VulkanManager::cleanup() {
  if (context_) {
    delete context_;
    context_ = nullptr;
  }
  initialized_ = false;
}

// Stub implementations - full implementation requires SPIR-V shader loading
void VulkanManager::allocateBuffer(void **ptr, size_t size) {
  // TODO: Implement Vulkan buffer allocation
  // For now, use host-visible memory as fallback
  *ptr = malloc(size);
  if (!*ptr) {
    throw std::runtime_error("Failed to allocate buffer");
  }
}

void VulkanManager::freeBuffer(void *ptr) {
  if (ptr) {
    free(ptr);
  }
}

void VulkanManager::copyToDevice(void *dst, const void *src, size_t size) {
  // TODO: Use Vulkan memory transfer
  memcpy(dst, src, size);
}

void VulkanManager::copyFromDevice(void *dst, const void *src, size_t size) {
  // TODO: Use Vulkan memory transfer
  memcpy(dst, src, size);
}

void VulkanManager::updateAlphaBeta(void *materialField, void *alphaBetaField,
                                    const float *params, int w, int h, int d) {
  // TODO: Dispatch compute shader
  // For now, CPU fallback
  std::cerr << "Warning: updateAlphaBeta using CPU fallback - Vulkan compute "
               "not yet implemented"
            << std::endl;
}

void VulkanManager::updateElectricField(void *electricField,
                                        void *electricFieldNext,
                                        void *magneticField,
                                        void *alphaBetaField, int w, int h,
                                        int d) {
  // TODO: Dispatch compute shader
  std::cerr << "Warning: updateElectricField using CPU fallback" << std::endl;
}

void VulkanManager::updateMagneticField(void *electricField,
                                        void *magneticField,
                                        void *magneticFieldNext,
                                        void *alphaBetaField, int w, int h,
                                        int d) {
  // TODO: Dispatch compute shader
  std::cerr << "Warning: updateMagneticField using CPU fallback" << std::endl;
}

void VulkanManager::injectSource(void *sourceField, void *field, void *output,
                                 float dt, int w, int h, int d) {
  // TODO: Dispatch compute shader
  std::cerr << "Warning: injectSource using CPU fallback" << std::endl;
}

void VulkanManager::decaySource(void *sourceField, void *output, float dt,
                                int w, int h, int d) {
  // TODO: Dispatch compute shader
  std::cerr << "Warning: decaySource using CPU fallback" << std::endl;
}

void VulkanManager::drawEllipse(void *input, void *output, int x, int y, int z,
                                int rx, int ry, int rz, float value, int w,
                                int h, int d) {
  // TODO: Dispatch compute shader
  std::cerr << "Warning: drawEllipse using CPU fallback" << std::endl;
}
