#!/usr/bin/env bash
# Brings recipes and photos from every other copy of Recipe Studio on this
# computer into this one. Nothing is fetched and nothing is deleted.
set -e
cd "$(dirname "$0")/.."
exec node scripts/update.js --gather "$@"
