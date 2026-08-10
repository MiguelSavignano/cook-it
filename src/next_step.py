#!/usr/bin/env python3
"""
"Next step" button: does NOT record, does NOT call the LLM. Just uses
recipe_engine.next_step() (session memory) and speaks it out loud.
"""
import sys

from common import speak
from recipe_engine import next_step


def main():
    data = next_step()
    if not data["ok"]:
        print("No hay ninguna receta activa en memoria. Pide una receta primero con run_assistant.sh.")
        speak("No tengo ninguna receta activa todavía. Pídeme una receta primero.")
        sys.exit(1)

    if data["finished"]:
        print(f"Has terminado {data['name']}. (tip: {data.get('tip', '')})")
        text = f"Ese era el último paso. Ya has terminado {data['name']}. ¡Buen provecho!"
    else:
        text = f"Paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
        print(f"▶ {text}")

    synth_time, total_time = speak(text)
    print(f"(TTS: {total_time:.2f}s, síntesis: {synth_time:.2f}s)")


if __name__ == "__main__":
    main()
