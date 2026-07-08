#!/usr/bin/env bash
# Build the MyProject operator package, then launch TiXL under Wine with the correct prefix + .NET.
# Fixes the two gotchas hit while developing the voxeled operator:
#   1. TiXL loads a package's *prebuilt* DLL and doesn't rebuild on startup — so build first.
#   2. TiXL + the .NET runtime live in the ~/.wine-tixl prefix; a bare `wine TiXL.exe` uses the
#      default ~/.wine prefix (no .NET) → "You must install .NET". Set WINEPREFIX + DOTNET_ROOT.
#
# Usage:  ./run-tixl.sh            (rebuild operators, then launch)
#         ./run-tixl.sh --no-build (just launch)
set -uo pipefail

PREFIX="${WINEPREFIX:-$HOME/.wine-tixl}"
INSTALL_WIN='C:\Program Files\TiXL\TiXL 4.1.0.9-alpha'
INSTALL_DIR="$PREFIX/drive_c/Program Files/TiXL/TiXL 4.1.0.9-alpha"
DOTNET_WIN='C:\Program Files\dotnet\dotnet.exe'
PROJECT_DIR="$HOME/Documents/TiXL/MyProject"
CSPROJ_WIN="Z:$(printf '%s' "$PROJECT_DIR/MyProject.csproj" | sed 's:/:\\:g')"

if [ "${1:-}" != "--no-build" ]; then
  echo "→ building operator package: $PROJECT_DIR"
  WINEPREFIX="$PREFIX" WINEDEBUG=-all T3_ASSEMBLY_PATH="$INSTALL_WIN" \
    wine "$DOTNET_WIN" build "$CSPROJ_WIN" -c Debug 2>&1 \
    | grep -E "error|Build succeeded|Build FAILED|Warning\(s\)|Error\(s\)" || true
fi

echo "→ launching TiXL (prefix: $PREFIX)"
cd "$INSTALL_DIR" || { echo "TiXL install not found at $INSTALL_DIR"; exit 1; }
exec env WINEPREFIX="$PREFIX" DOTNET_ROOT='C:\Program Files\dotnet' WINEDEBUG=-all wine TiXL.exe
