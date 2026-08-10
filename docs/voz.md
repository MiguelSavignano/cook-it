# La voz de Cook-It — qué usamos y qué cuesta

> Resumen enfocado solo en el subsistema de voz (STT + TTS). Para la arquitectura completa del asistente ver [`spec.md`](./spec.md) §4-5; para las pruebas de rendimiento/latencia que validaron estas elecciones, ver [`feasibility.md`](./feasibility.md) §8.

## Los dos componentes de "la voz"

| | Qué hace | Motor | Dónde corre |
|---|---|---|---|
| **STT** (voz → texto) | Transcribe lo que dice el usuario | [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper), modelo `small`, `int8` | 100% local, CPU, en tu propia máquina |
| **TTS** (texto → voz) | Sintetiza la respuesta hablada | [Piper](https://github.com/rhasspy/piper), voz `es_ES-davefx-medium` | 100% local, CPU, en tu propia máquina |

Ambos corren como proceso/librería local — no hay llamada de red a ningún servicio externo en ningún punto del pipeline de voz.

**Dónde vive en el código:**
- STT: se carga una vez el modelo Whisper (`WhisperModel("small", device="cpu", compute_type="int8")`) y se transcribe en [`assistant_poc.py`](../src/assistant_poc.py) (CLI) y [`api.py`](../src/api.py) (web, endpoint `/api/question`).
- TTS: funciones [`synthesize()`/`speak()`](../src/common.py) — lanzan `python3 -m piper` como subproceso. `speak()` además reproduce con `aplay` (solo lo usan los scripts de CLI, donde la máquina que ejecuta el proceso es la misma junto a la que está el usuario); `api.py` usa `synthesize()` y devuelve el audio en base64 para que lo reproduzca el propio dispositivo que hizo la petición (el navegador, no el servidor — importante desde que se puede pedir desde el móvil).
- En la web, el navegador (`app.js`) **solo graba** el audio con `MediaRecorder` y lo sube — nunca transcribe ni sintetiza nada en el cliente, para no romper el "100% local".

## ¿Gastamos tokens por la voz?

**No, cero tokens y cero coste de API, ni para transcribir ni para generar la voz.**

- **Procesar la voz (STT):** `faster-whisper` es un modelo Whisper de OpenAI corriendo localmente vía CTranslate2, no la API de OpenAI. No hay llamada HTTP a ningún proveedor — es inferencia en tu CPU con un modelo descargado una vez (~464 MB, cacheado en `~/.cache/huggingface`).
- **Generar la voz (TTS):** Piper sintetiza con un modelo ONNX descargado a disco (`src/voices/es_ES-davefx-medium.onnx`, 63 MB). Tampoco hay servicio cloud de por medio (nada de ElevenLabs, Amazon Polly, Google TTS, etc.).

Y de propina: tampoco el LLM que genera las recetas/respuestas gasta tokens de pago — usa Ollama + `gemma3` corriendo local (`OLLAMA_BASE_URL`, por defecto `localhost:11434`), no la API de Anthropic/OpenAI. Ver `recipe_engine.py` y el `README.md` raíz para las variables de entorno.

Así que el pipeline completo (STT → router/LLM → TTS) es **$0 en tokens/API para cualquier interacción**, por diseño (ver `spec.md` §1: "sin depender de servicios cloud... sin coste de API"). El único "coste" real es CPU/RAM de tu propio PC y la latencia que eso implica (ver benchmarks en `feasibility.md` §8-9).

## Rendimiento medido (referencia rápida)

De `feasibility.md` §8, con el micro TONOR real:

| Etapa | Tiempo típico |
|---|---|
| STT (whisper `small`, ~5-6s de audio) | ~2.1-2.4 s |
| TTS — síntesis (Piper) | ~1.2 s |

STT + TTS combinados suman ~3.5 s, una fracción pequeña frente a los ~12 s que tarda el LLM en generar una respuesta — la voz en sí no es el cuello de botella del sistema.
