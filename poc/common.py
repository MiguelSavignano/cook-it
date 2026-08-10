"""Shared helpers for Cook-It: session state (memory while cooking) and
text-to-speech. Used by both the CLI scripts and the web API."""
import json
import subprocess
import time
from pathlib import Path

POC_DIR = Path(__file__).parent
VOICE_PATH = POC_DIR / "voices" / "es_ES-davefx-medium.onnx"
OUT_WAV = POC_DIR / "assistant_out.wav"
STATE_PATH = POC_DIR / "session_state.json"


def load_state():
    """Returns the active cooking session's state, or None if there isn't one."""
    if not STATE_PATH.exists():
        return None
    return json.loads(STATE_PATH.read_text())


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def clear_state():
    if STATE_PATH.exists():
        STATE_PATH.unlink()


def synthesize(text):
    """Synthesizes `text` with Piper. Returns (wav_bytes, synth_time). Does NOT
    play anything -- for the web API, where the caller (browser) is the one
    that should play it, not this machine (see speak() for that case)."""
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
