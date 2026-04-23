#!/usr/bin/env bash
set -e

# Convenience wrapper so this can be run from repo root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/scripts/deploy-gps.sh" "$@"