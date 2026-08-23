#!/bin/bash
# Push-to-talk CLI: record -> whisper -> LLM/router -> piper -> play, all on
# this machine's own speakers/mic. See docs/spec.md's roadmap, Phase 1.
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No .venv found -- run ./setup.sh first." >&2
  exit 1
fi
source .venv/bin/activate

python3 assistant_poc.py
