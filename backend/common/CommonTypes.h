#pragma once

#include "App.h"

// Common type definitions
struct EmptyUserData {};
using WebSocketType = uWS::WebSocket<false, true, EmptyUserData>;
