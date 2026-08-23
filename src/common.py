"""Shared helpers for Cook-It: session state (memory while cooking) and
text-to-speech. Used by both the CLI scripts and the web API."""
import json
import subprocess
import time
from pathlib import Path

import settings

BASE_DIR = Path(__file__).parent

# Which Piper voice to speak with -- a Piper voice name (not a path), e.g.
# "es_ES-davefx-medium" or "es_MX-claude-high". Must already be downloaded to
# voices/<name>.onnx (+ .onnx.json) -- see setup.sh, which fetches whichever
# voice this is set to. Full list: https://huggingface.co/rhasspy/piper-voices
COOKIT_VOICE = settings.get("voice.piper")
VOICE_PATH = BASE_DIR / "voices" / f"{COOKIT_VOICE}.onnx"

OUT_WAV = BASE_DIR / "assistant_out.wav"
STATE_PATH = BASE_DIR / "session_state.json"
# The "cook with what I have" flow (pantry.py) -- a recipe being NEGOTIATED
# (photo -> ingredients -> ideas -> draft), which is a different thing from
# one being COOKED. Deliberately a separate file: only pantry.confirm()
# promotes a draft into STATE_PATH, so an abandoned pantry session can never
# make /api/state look like there's an active recipe.
PANTRY_STATE_PATH = BASE_DIR / "pantry_state.json"


def _load_json(path):
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def _clear(path):
    if path.exists():
        path.unlink()


def load_state():
    """Returns the active cooking session's state, or None if there isn't one."""
    return _load_json(STATE_PATH)


def save_state(state):
    _save_json(STATE_PATH, state)


def clear_state():
    _clear(STATE_PATH)


def load_pantry():
    """Returns the in-progress pantry session, or None if there isn't one."""
    return _load_json(PANTRY_STATE_PATH)


def save_pantry(state):
    _save_json(PANTRY_STATE_PATH, state)


def clear_pantry():
    _clear(PANTRY_STATE_PATH)


def synthesize(text):
    """Synthesizes `text` with Piper. Returns (wav_bytes, synth_time). Does NOT
    play anything -- for the web API, where the caller (browser) is the one
    that should play it, not this machine (see speak() for that case)."""
    if not VOICE_PATH.exists():
        raise FileNotFoundError(
            f"Voice model not found: {VOICE_PATH}. Set COOKIT_VOICE to a voice "
            f"you've downloaded to voices/, or run setup.sh to fetch the default."
        )
    t0 = time.time()
    subprocess.run(
        ["python3", "-m", "piper", "-m", str(VOICE_PATH), "-f", str(OUT_WAV)],
        input=text, text=True, check=True, capture_output=True,
    )
    synth_time = time.time() - t0
    return OUT_WAV.read_bytes(), synth_time


def play(path=OUT_WAV):
    subprocess.run(["aplay", str(path)], check=True, capture_output=True)


def speak(text):
    """Synthesizes `text` with Piper and plays it THROUGH THIS MACHINE's own
    speakers. Only correct when this process is running on the device the
    user is actually standing next to -- i.e. the CLI scripts (push-to-talk
    on this PC). The web API must NOT use this: a phone hitting the API over
    the network wants the audio played on the phone, not on the server --
    see synthesize() + the browser-side playback in api.py/app.js instead.
    Returns (synth_time, total_time)."""
    audio, synth_time = synthesize(text)
    t0 = time.time()
    play()
    total_time = synth_time + (time.time() - t0)
    return synth_time, total_time
