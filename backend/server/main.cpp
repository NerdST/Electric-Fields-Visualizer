#include "Server.h"
#include <iostream>
#include <signal.h>

std::unique_ptr<Server> g_server;

void signalHandler(int signal) {
  std::cout << "\nShutting down server..." << std::endl;
  if (g_server) {
    g_server->stop();
  }
  exit(0);
}

int main(int argc, char *argv[]) {
  // Handle signals
  signal(SIGINT, signalHandler);
  signal(SIGTERM, signalHandler);

  uint16_t port = 8080;
  if (argc > 1) {
    port = static_cast<uint16_t>(std::stoi(argv[1]));
  }

  std::cout << "Starting FDTD Backend Server on port " << port << std::endl;

  g_server = std::make_unique<Server>(port);
  g_server->run();

  return 0;
}
