#!/usr/bin/env bash
# Fetches the latest version. Recipes and photos are never touched.
set -e
cd "$(dirname "$0")"
exec node scripts/update.js "$@"
