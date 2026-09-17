#!/usr/bin/env bash
# Sets up the key that lets this computer put the website online.
set -e
cd "$(dirname "$0")/.."
exec node scripts/setup-publish.js "$@"
