#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

pip install -q "fastapi[standard]" "uvicorn[standard]" numpy

echo ""
echo "Starting FDTD server on ws://localhost:8765/ws"
echo "Set 'Remote Server URL' in the browser to: ws://localhost:8765/ws"
echo ""

uvicorn fdtd_server:app --port 8765 --reload
