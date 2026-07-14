#!/bin/bash

# Vibes Dashboard — Stop production server
cd "$(dirname "$0")"

PID_FILE="server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping Vibes Dashboard (PID: $PID)..."
        kill "$PID"
        for i in {1..10}; do
            kill -0 "$PID" 2>/dev/null || break
            sleep 1
        done
        if kill -0 "$PID" 2>/dev/null; then
            echo "Still running — force killing..."
            kill -9 "$PID"
        fi
        echo "Stopped."
    else
        echo "Process $PID is not running."
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found."
fi

# Kill anything lingering on the port
PORT="${PORT:-19003}"
if command -v fuser >/dev/null 2>&1; then
    fuser -k -n tcp "$PORT" 2>/dev/null && echo "Killed lingering process on port $PORT." || true
fi
