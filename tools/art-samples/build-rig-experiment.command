#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
experiment_root="$PWD/.local/rig-experiment/creator-build"
overlay_root="$PWD/.local/rig-experiment/source-overlay"
python3 tools/art-samples/rig-build-overlay.py --output "$overlay_root"
P0_BUILD_ROOT="$experiment_root" P0_SOURCE_OVERLAY="$overlay_root" P0_RECORD_BUILD_LOCATION=0 bash cocos-client/tools/build-p0.sh
python3 tools/art-samples/stage-local.py --build-root "$experiment_root" --source-overlay "$overlay_root" --output .local/rig-experiment/web --diagnostics
