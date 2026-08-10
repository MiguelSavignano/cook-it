#!/usr/bin/env python3
"""
CLI prototype (push-to-talk voice in the terminal): record -> whisper (STT) ->
recipe_engine.process_command (LLM/router) -> piper (TTS) -> play.

Business logic (recipes, LLM, session memory, command router) lives in
recipe_engine.py / common.py, shared with the web API (api.py).

Usage: run via poc/run_assistant.sh (which activates the venv).
"""
import os
import subprocess
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

from common import speak
from recipe_engine import process_command

POC_DIR = Path(__file__).parent
RECORD_SECONDS = int(os.environ.get("COOKIT_RECORD_SECONDS", "7"))
# `arecord -l` lists your devices, e.g. "plughw:1,0" -- machine-specific, so
# this is NOT meant to work out of the box, override it via env var.
MIC_DEVICE = os.environ.get("COOKIT_MIC_DEVICE", "plughw:1,0")
REC_WAV = POC_DIR / "assistant_in.wav"


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
