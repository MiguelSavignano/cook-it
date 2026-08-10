#!/bin/bash
# One-time setup: venv + Python deps + the Piper voice model (not committed,
# see .gitignore). Doesn't touch Ollama -- that's a separate, system-level
# install, see the root README's Requirements section.
set -e
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q piper-tts faster-whisper requests fastapi "uvicorn[standard]" python-multipart

mkdir -p voices
if [ ! -f voices/es_ES-davefx-medium.onnx ]; then
  echo "Downloading Piper voice model (es_ES-davefx-medium, ~63MB)..."
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium"
  curl -sL -o voices/es_ES-davefx-medium.onnx "$BASE/es_ES-davefx-medium.onnx"
  curl -sL -o voices/es_ES-davefx-medium.onnx.json "$BASE/es_ES-davefx-medium.onnx.json"
fi

echo "Done. Next: pull the Ollama model (ollama pull gemma3) if you haven't, then ./run_web.sh"
