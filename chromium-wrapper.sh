#!/bin/bash
# Chromium wrapper to ensure proper file descriptor limits

# Set file descriptor limits for this process and all children
prlimit --pid=$$ --nofile=65536:65536 2>/dev/null || {
  ulimit -n 65536 2>/dev/null || true
}

# Execute Chromium with all arguments passed through
exec /usr/lib/chromium/chromium "$@"
