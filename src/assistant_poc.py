#!/usr/bin/env python3
"""
CLI prototype (push-to-talk voice in the terminal): record -> whisper (STT) ->
recipe_engine.process_command (LLM/router) -> piper (TTS) -> play.

Business logic (recipes, LLM, session memory, command router) lives in
recipe_engine.py / common.py, shared with the web API (api.py).

Usage: run via poc/run_assistant.sh (which activates the venv).
"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

from common import speak
from recipe_engine import process_command

BASE_DIR = Path(__file__).parent
RECORD_SECONDS = int(os.environ.get("COOKIT_RECORD_SECONDS", "7"))
# Fallback used only if COOKIT_MIC_DEVICE isn't set AND auto-detection below
# (via `arecord -l`) can't find any capture device -- machine-specific, so
# this is NOT meant to work out of the box.
DEFAULT_MIC_DEVICE = "plughw:1,0"
REC_WAV = BASE_DIR / "assistant_in.wav"

# `arecord -l` prints capture devices like:
#   card 1: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]
_ARECORD_DEVICE_RE = re.compile(
    r"^card (\d+): .*?\[(.*?)\], device (\d+):", re.MULTILINE
)


def detect_mic_device():
    """Auto-detect a capture (mic) device via `arecord -l`, preferring a USB one.

    Lets the assistant find a plugged-in USB mic without the user having to
    run `arecord -l` and hand-copy a "plughw:X,Y" string. Returns None if
    `arecord` isn't installed or no capture device is found, so the caller
    can fall back to DEFAULT_MIC_DEVICE.
    """
    try:
        out = subprocess.run(
            ["arecord", "-l"], capture_output=True, text=True, timeout=5
        ).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    devices = [
        (card, device, desc) for card, desc, device in _ARECORD_DEVICE_RE.findall(out)
    ]
    if not devices:
        return None

    # Prefer a device whose description names it as USB (e.g. most USB mics/
    # headsets), otherwise just take the first capture device found.
    card, device, desc = next(
        (d for d in devices if "usb" in d[2].lower()), devices[0]
    )
    print(f"  Micrófono detectado: card {card} ({desc}), device {device}")
    return f"plughw:{card},{device}"


MIC_DEVICE = os.environ.get("COOKIT_MIC_DEVICE") or detect_mic_device() or DEFAULT_MIC_DEVICE


def step(msg):
    print(f"\n\033[1;36m▶ {msg}\033[0m")


def record():
    step(f"Grabando {RECORD_SECONDS}s — ¡pide una receta o di 'siguiente paso'!")
    t0 = time.time()
    subprocess.run(
        [
            "arecord", "-D", MIC_DEVICE, "-f", "S16_LE",
            "-r", "16000", "-c", "1", "-d", str(RECORD_SECONDS), str(REC_WAV),
        ],
        check=True,
    )
    return time.time() - t0


def transcribe(model):
    step("Transcribiendo (STT)...")
    t0 = time.time()
    segments, _info = model.transcribe(str(REC_WAV), language="es")
    text = " ".join(s.text.strip() for s in segments).strip()
    dt = time.time() - t0
    if not text:
        print("  (no se detectó voz)")
    else:
        print(f"  Usuario dijo: \"{text}\"")
    return text, dt


def main():
    print("Cargando modelo Whisper (small, int8)...")
    t0 = time.time()
    model = WhisperModel("small", device="cpu", compute_type="int8")
    print(f"  ({time.time() - t0:.1f}s)")

    record_time = record()
    user_text, stt_time = transcribe(model)
    if not user_text:
        print("\nNada que procesar, prueba de nuevo.")
        sys.exit(1)

    step("Procesando (router + LLM si hace falta)...")
    t0 = time.time()
    result = process_command(user_text)
    process_time = time.time() - t0
    print(f"  Tipo: {result['type']}")
    print(f"  Va a decir: \"{result['spoken_text']}\"")

    synth_time, tts_total_time = speak(result["spoken_text"])

    print("\n\033[1;32m== Resumen de latencia ==\033[0m")
    print(f"  Grabación:          {record_time:.2f}s (fija, {RECORD_SECONDS}s configurados)")
    print(f"  STT (whisper):      {stt_time:.2f}s")
    print(f"  Router/LLM:         {process_time:.2f}s")
    print(f"  TTS (piper+aplay):  {tts_total_time:.2f}s (síntesis: {synth_time:.2f}s)")
    print(f"  ---------------------------------")
    print(f"  Latencia percibida (STT+proceso+síntesis): {stt_time + process_time + synth_time:.2f}s")


if __name__ == "__main__":
    main()
