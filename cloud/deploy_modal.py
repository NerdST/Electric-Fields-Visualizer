"""
Modal.com deployment for the FDTD server.

Usage:
  pip install modal
  modal setup          # authenticate once
  modal deploy deploy_modal.py

This spins up a persistent HTTPS WebSocket endpoint on Modal's free T4 GPU tier.
The URL printed after deploy looks like: https://your-username--fdtd-server-app.modal.run/ws

Paste that URL (change https:// → wss://) into the "Remote Server URL" field in the browser.
"""

import modal

# ---------------------------------------------------------------------------
# Image: Python + deps + our code
# ---------------------------------------------------------------------------

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "uvicorn[standard]",
        "numpy",
        # Uncomment for GPU acceleration (requires gpu= below):
        # "cupy-cuda12x",
    )
    .add_local_file("fdtd_engine.py", "/app/fdtd_engine.py")
    .add_local_file("fdtd_server.py", "/app/fdtd_server.py")
)

app = modal.App("fdtd-server", image=image)

# ---------------------------------------------------------------------------
# Web endpoint (ASGI — supports WebSockets natively)
# ---------------------------------------------------------------------------

@app.function(
    # Use gpu=modal.gpu.T4() to enable CUDA / CuPy. Free-tier includes T4 access.
    # Leave unset for CPU-only (still fast for 512² with NumPy).
    # gpu=modal.gpu.T4(),
    cpu=2,
    memory=2048,
    timeout=3600,          # 1h session timeout
    allow_concurrent_inputs=10,
)
@modal.asgi_app()
def fastapi_app():
    import sys
    sys.path.insert(0, "/app")
    from fdtd_server import app as _app  # noqa: PLC0415
    return _app
