#!/usr/bin/env bash
# Compiles the native temperature helper (src/native/thermo.swift) to bin/thermo.
# Apple Silicon die temps aren't available via powermetrics, so this small IOKit
# reader supplies them. Requires the Swift toolchain (Xcode Command Line Tools).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/bin"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "WARNING: swiftc not found — skipping temp helper. Install Xcode CLT:" >&2
  echo "  xcode-select --install" >&2
  exit 0
fi

swiftc -O "$ROOT/src/native/thermo.swift" -o "$ROOT/bin/thermo" \
  -framework IOKit -framework CoreFoundation
echo "built $ROOT/bin/thermo"
