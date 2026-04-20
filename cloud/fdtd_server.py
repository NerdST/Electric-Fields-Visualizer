"""
FastAPI WebSocket server for the FDTD simulation.

Protocol (JSON over WebSocket):

Client → Server:
  {"type": "set_charges",      "charges": [{"x":0,"y":0,"z":0,"magnitude":1e-6,"id":"..."}]}
  {"type": "sample",           "requestId": 1, "positions": [[nx,ny,nz], ...]}
  {"type": "set_paused",       "paused": true}
  {"type": "set_steps_per_second", "value": 240}
  {"type": "ping"}

Server → Client:
  {"type": "field_sample",     "requestId": 1, "fields": [[Ex,Ey,Ez,mag], ...]}
  {"type": "stats",            "stepsPerSecond": 240, "time": 0.001, ...}
  {"type": "pong"}

Run locally:
  pip install fastapi uvicorn numpy
  uvicorn fdtd_server:app --port 8765 --reload
"""

import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from fdtd_engine import FDTDEngine, _USING_GPU

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="FDTD Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Single shared thread pool for FDTD compute (CPU-bound work off the event loop)
_executor = ThreadPoolExecutor(max_workers=1)

# ---------------------------------------------------------------------------
# Session state (one engine per connected client)
# ---------------------------------------------------------------------------

# 256×256 is 4× faster than 512×512 and still looks great.
# Bump to 512 if running on a GPU (CuPy).
_GRID_SIZE = 512 if _USING_GPU else 256
# 30 steps/sec is smooth on CPU; GPU can handle much more.
_DEFAULT_SPS = 120 if _USING_GPU else 30

class SimSession:
    def __init__(self):
        self.engine = FDTDEngine(size=_GRID_SIZE, cell_size=0.01)
        self._lock = threading.Lock()
        self.paused = False
        self.target_sps: int = _DEFAULT_SPS
        self._steps_this_window: int = 0
        self._window_start: float = time.monotonic()
        self._measured_sps: float = 0.0
        self._total_steps: int = 0
        # Accumulates fractional elapsed time so sub-tick fractions aren't lost.
        # Without this, int(0.016s / (1/30s)) = 0 every tick → simulation never advances.
        self._accumulator: float = 0.0

    def tick_sync(self, elapsed_s: float) -> int:
        """Blocking FDTD step — called from the thread executor."""
        if self.paused:
            return 0
        self._accumulator += elapsed_s
        target_dt = 1.0 / max(1, self.target_sps)
        steps_to_run = int(self._accumulator / target_dt)
        # Cap to 1 second of steps to prevent runaway bursts after lag or SPS changes.
        steps_to_run = min(steps_to_run, self.target_sps)
        if steps_to_run > 0:
            self._accumulator -= steps_to_run * target_dt
            with self._lock:
                self.engine.step(steps_to_run)
            self._steps_this_window += steps_to_run
            self._total_steps += steps_to_run
        return steps_to_run

    def sample_sync(self, positions: list) -> list:
        """Blocking sample — called from the thread executor."""
        with self._lock:
            return self.engine.sample_at(positions)

    def set_charges_sync(self, charges: list) -> None:
        with self._lock:
            self.engine.set_charges(charges)

    def update_rate(self) -> float:
        now = time.monotonic()
        elapsed = now - self._window_start
        if elapsed >= 1.0:
            self._measured_sps = self._steps_this_window / elapsed
            self._steps_this_window = 0
            self._window_start = now
        return self._measured_sps


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    session = SimSession()
    loop = asyncio.get_event_loop()

    async def run_in_thread(fn, *args):
        return await loop.run_in_executor(_executor, fn, *args)

    # Background sim loop — runs FDTD in thread, never blocks WebSocket messages
    async def sim_loop():
        last_tick = time.monotonic()
        last_stats = time.monotonic()
        while True:
            await asyncio.sleep(0.016)  # ~60Hz tick rate
            now = time.monotonic()
            elapsed = now - last_tick
            last_tick = now

            await run_in_thread(session.tick_sync, elapsed)

            if now - last_stats >= 0.1:
                last_stats = now
                sps = session.update_rate()
                stats = session.engine.get_stats()
                try:
                    await ws.send_text(json.dumps({
                        "type": "stats",
                        "stepsPerSecond": round(sps, 1),
                        "totalSteps": session._total_steps,
                        "time": stats["time"],
                        "dt": stats["dt"],
                        "usingGpu": stats["usingGpu"],
                        "paused": session.paused,
                        "targetSps": session.target_sps,
                        "gridSize": stats["size"],
                    }))
                except Exception:
                    break

    sim_task = asyncio.create_task(sim_loop())

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            await _handle_message(msg, session, ws, run_in_thread)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Session error: {e}")
    finally:
        sim_task.cancel()


async def _handle_message(msg: dict, session: SimSession, ws: WebSocket, run_in_thread):
    t = msg.get("type")

    if t == "set_charges":
        await run_in_thread(session.set_charges_sync, msg.get("charges", []))

    elif t == "sample":
        request_id = msg.get("requestId", 0)
        positions = msg.get("positions", [])
        fields = await run_in_thread(session.sample_sync, positions)
        await ws.send_text(json.dumps({
            "type": "field_sample",
            "requestId": request_id,
            "fields": fields,
        }))

    elif t == "set_paused":
        session.paused = bool(msg.get("paused", False))

    elif t == "set_steps_per_second":
        session.target_sps = max(1, min(2000, int(msg.get("value", _DEFAULT_SPS))))

    elif t == "ping":
        await ws.send_text(json.dumps({"type": "pong"}))


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "gridSize": _GRID_SIZE, "usingGpu": _USING_GPU, "defaultSps": _DEFAULT_SPS}
