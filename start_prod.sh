#!/bin/bash

# Vibes Dashboard — Start production server
set -e
cd "$(dirname "$0")"

PID_FILE="server.pid"
LOG_FILE="server.log"

# Check if already running
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Vibes Dashboard is already running (PID: $(cat "$PID_FILE"))."
    echo "Run ./stop_prod.sh first."
    exit 1
fi

# Ensure node_modules
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Source .env if present
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

PORT="${PORT:-19003}"

echo "Starting Vibes Dashboard on port $PORT..."
nohup node server/index.js > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Started with PID $(cat "$PID_FILE")"
echo "Logs: tail -f $LOG_FILE"
echo "Stop: ./stop_prod.sh"
