#!/bin/bash
# Wrapper script to ensure proper resource limits for Chromium

# Set file descriptor limits using prlimit (more reliable than ulimit)
prlimit --pid=$$ --nofile=65536:65536 2>/dev/null || {
  # Fallback to ulimit if prlimit fails
  ulimit -n 65536 2>/dev/null || true
  ulimit -Hn 65536 2>/dev/null || true
}

# Log the limits for debugging
echo "[WRAPPER] File descriptor limit: $(ulimit -n)"
echo "[WRAPPER] PID: $$"
echo "[WRAPPER] DISPLAY: ${DISPLAY:-NOT SET}"

# Execute the Node.js server
exec /home/chuck/.local/bin/node /home/chuck/git/puppeteer-paywall/server-optimus.js
