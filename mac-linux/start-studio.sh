#!/usr/bin/env bash
# Starts Recipe Studio. Press Ctrl+C to stop it.
set -e
cd "$(dirname "$0")/.."

if ! command -v node > /dev/null; then
  echo "Node.js is not installed yet. Get it from https://nodejs.org (the LTS version)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Setting things up for the first time. This takes a minute..."
  npm install
fi

exec node studio/server.js --open
