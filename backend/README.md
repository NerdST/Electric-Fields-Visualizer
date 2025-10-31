# FDTD Backend Server

C++ backend server for FDTD (Finite Difference Time Domain) electromagnetic field simulation using Vulkan compute shaders.

## Important Notes

**Current Status**: The backend architecture is implemented, but Vulkan compute shaders are using CPU fallback. The shaders need to be compiled to SPIR-V and loaded. This means:
- ✅ Backend server infrastructure works
- ✅ WebSocket communication works
- ✅ Session management works
- ⚠️ GPU compute currently uses CPU fallback (will work but slower)
- ❌ Full GPU acceleration requires SPIR-V shader compilation

**For Your Use Case**: Since you're running this on the same machine (ThinkPad X1 Carbon), the backend won't provide performance benefits yet - it's still using your integrated graphics (or CPU fallback). The main benefit is:
1. Architecture ready for scaling to a more powerful server later
2. Multiple users can connect simultaneously
3. Once shaders are compiled, it will use integrated GPU

## Requirements

- C++17 compiler (GCC 9+, Clang 10+, MSVC 2019+)
- CMake 3.20+
- Vulkan SDK 1.2+ ([Download here](https://vulkan.lunarg.com/sdk/home))
- uWebSockets (header-only, see setup below)

## Building

### 1. Install Vulkan SDK

Download and install from [lunarg.com](https://vulkan.lunarg.com/sdk/home)

```bash
# Verify installation
vulkaninfo  # Should show your integrated graphics
```

### 2. Get uWebSockets

```bash
cd backend
git submodule add https://github.com/uNetworking/uWebSockets.git
# OR download manually and place in backend/uWebSockets/
```

### 3. Build

```bash
cd backend
mkdir build
cd build
cmake ..
make
```

### 4. Run

```bash
./fdtd_server [port]
# Default port is 8080
```

## Architecture

- **server/**: WebSocket server using uWebSockets
- **session/**: User session management
- **simulation/**: FDTD simulation engine
- **gpu/**: Vulkan compute shader manager
- **protocol/**: Binary protocol for efficient data transfer

## Next Steps (To Get GPU Working)

1. **Compile WGSL shaders to SPIR-V**: Use `glslc` (from Vulkan SDK) or convert WGSL→GLSL→SPIR-V
2. **Load SPIR-V in VulkanManager**: Implement shader loading from binary files
3. **Create compute pipelines**: Set up proper Vulkan compute pipeline creation
4. **Implement buffer management**: Use proper Vulkan buffers instead of malloc

## Testing Frontend Connection

1. Start backend: `./fdtd_server 8080`
2. In frontend, use `ChargeImplementationRemote.tsx`
3. Should connect via WebSocket and receive frames

## Current Limitations

- CPU fallback mode (slow but functional)
- No shader compilation pipeline yet
- Memory transfers are host-side (not GPU-optimized)

The good news: The architecture is correct, you just need to complete the Vulkan shader pipeline!