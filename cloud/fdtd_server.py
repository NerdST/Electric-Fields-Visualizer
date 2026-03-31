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
import time
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from fdtd_engine import FDTDEngine

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


# ---------------------------------------------------------------------------
# Session state (one engine per connected client)
# ---------------------------------------------------------------------------

class SimSession:
    def __init__(self):
        self.engine = FDTDEngine(size=512, cell_size=0.01)
        self.paused = False
        self.target_sps: int = 240
        self._steps_this_window: int = 0
        self._window_start: float = time.monotonic()
        self._measured_sps: float = 0.0
        self._total_steps: int = 0

    def tick(self, elapsed_s: float) -> int:
        """Run as many steps as needed to keep up with target_sps. Returns steps executed."""
        if self.paused:
            return 0
        target_dt = 1.0 / max(1, self.target_sps)
        steps_to_run = max(0, int(elapsed_s / target_dt))
        steps_to_run = min(steps_to_run, self.target_sps)  # cap per tick
        if steps_to_run > 0:
            self.engine.step(steps_to_run)
            self._steps_this_window += steps_to_run
            self._total_steps += steps_to_run
        return steps_to_run

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
    last_tick = time.monotonic()
    last_stats = time.monotonic()

    try:
        while True:
            # Process incoming messages (non-blocking, short timeout)
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=0.005)
                msg = json.loads(raw)
                await _handle_message(msg, session, ws)
            except asyncio.TimeoutError:
                pass

            # Run simulation steps
            now = time.monotonic()
            elapsed = now - last_tick
            last_tick = now
            session.tick(elapsed)

            # Periodic stats push (~10Hz)
            if now - last_stats >= 0.1:
                last_stats = now
                sps = session.update_rate()
                stats = session.engine.get_stats()
                await ws.send_text(json.dumps({
                    "type": "stats",
                    "stepsPerSecond": round(sps, 1),
                    "totalSteps": session._total_steps,
                    "time": stats["time"],
                    "dt": stats["dt"],
                    "usingGpu": stats["usingGpu"],
                    "paused": session.paused,
                    "targetSps": session.target_sps,
                }))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Session error: {e}")
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


async def _handle_message(msg: dict, session: SimSession, ws: WebSocket):
    t = msg.get("type")

    if t == "set_charges":
        session.engine.set_charges(msg.get("charges", []))

    elif t == "sample":
        request_id = msg.get("requestId", 0)
        positions = msg.get("positions", [])
        fields = session.engine.sample_at(positions)
        await ws.send_text(json.dumps({
            "type": "field_sample",
            "requestId": request_id,
            "fields": fields,
        }))

    elif t == "set_paused":
        session.paused = bool(msg.get("paused", False))

    elif t == "set_steps_per_second":
        session.target_sps = max(1, min(2000, int(msg.get("value", 240))))

    elif t == "ping":
        await ws.send_text(json.dumps({"type": "pong"}))


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}
