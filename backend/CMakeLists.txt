cmake_minimum_required(VERSION 3.20)
project(FDTD_Backend VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find Vulkan
find_package(Vulkan REQUIRED)

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${Vulkan_INCLUDE_DIRS})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/uWebSockets/src)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/uWebSockets/uSockets/src)

# Add executable
add_executable(fdtd_server
    server/main.cpp
    server/Server.cpp
    server/Server.h
    session/SessionManager.cpp
    session/SessionManager.h
    session/Session.cpp
    session/Session.h
    simulation/FDTD3D.cpp
    simulation/FDTD3D.h
    gpu/VulkanManager.cpp
    gpu/VulkanManager.h
    protocol/Protocol.cpp
    protocol/Protocol.h
    utils/Compression.cpp
    utils/Compression.h
)

# Link libraries
target_link_libraries(fdtd_server
    ${Vulkan_LIBRARIES}
    pthread
    z
)

# Add uSockets object files (already built by uWebSockets makefile)
file(GLOB USOCKETS_OBJECTS "${CMAKE_CURRENT_SOURCE_DIR}/uWebSockets/uSockets/*.o")
if(USOCKETS_OBJECTS)
    target_link_libraries(fdtd_server ${USOCKETS_OBJECTS})
else()
    message(WARNING "uSockets object files not found. Run 'make' in uWebSockets directory first.")
endif()
