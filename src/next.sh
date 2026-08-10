#!/bin/bash
# The "next step" button: doesn't record or think, just advances the active
# recipe (session memory in session_state.json) and speaks it out loud.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "No .venv found -- run ./setup.sh first." >&2
  exit 1
fi
source .venv/bin/activate
python3 next_step.py
