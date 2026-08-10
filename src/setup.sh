#!/bin/bash
# One-time setup: venv + Python deps + the Piper voice model (not committed,
# see .gitignore). Doesn't touch Ollama -- that's a separate, system-level
# install, see the root README's Requirements section.
#
# Voice: set COOKIT_VOICE to pick a different Piper voice than the default
# (must be a name from https://huggingface.co/rhasspy/piper-voices, e.g.
# "es_MX-claude-high") -- see also the COOKIT_VOICE var read by common.py.
set -e
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q piper-tts faster-whisper requests fastapi "uvicorn[standard]" python-multipart

VOICE="${COOKIT_VOICE:-es_ES-davefx-medium}"
# Piper voice names are "<locale>-<name>-<quality>", e.g. "es_ES-davefx-medium"
# -> locale=es_ES, name=davefx, quality=medium, lang=es (locale's prefix).
# That's also the HF repo's directory layout: <lang>/<locale>/<name>/<quality>/
LOCALE="${VOICE%%-*}"
REST="${VOICE#*-}"
NAME="${REST%-*}"
QUALITY="${REST##*-}"
LANG="${LOCALE%%_*}"

mkdir -p voices
if [ ! -f "voices/${VOICE}.onnx" ]; then
  echo "Downloading Piper voice model (${VOICE})..."
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/${LANG}/${LOCALE}/${NAME}/${QUALITY}"
  curl -sL -o "voices/${VOICE}.onnx" "$BASE/${VOICE}.onnx"
  curl -sL -o "voices/${VOICE}.onnx.json" "$BASE/${VOICE}.onnx.json"
fi

echo "Done. Next: pull the Ollama model (ollama pull gemma3) if you haven't, then ./run_web.sh"
