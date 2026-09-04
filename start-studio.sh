#!/usr/bin/env bash
# Opens Recipe Studio. Run with:  ./start-studio.sh
set -e
cd "$(dirname "$0")"

if ! command -v node > /dev/null; then
  echo "Node.js is not installed yet. Get it from https://nodejs.org (the LTS version)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Setting things up for the first time. This takes a minute..."
  npm install
fi

(sleep 2 && (open http://localhost:4321 2>/dev/null || xdg-open http://localhost:4321 2>/dev/null || true)) &
exec node studio/server.js
