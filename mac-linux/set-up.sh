#!/usr/bin/env bash
# First-time setup on a Mac: run this once from the unzipped download.
# Installs Recipe Studio in Documents, brings in recipes from any earlier
# copy, installs what it needs, and asks for the two keys. Nothing is deleted.
set -e
cd "$(dirname "$0")/.."
if ! command -v node > /dev/null; then
  echo "Node.js is not installed yet. Get it from https://nodejs.org (the LTS version)."
  exit 1
fi
exec node scripts/update.js --setup "$@"
