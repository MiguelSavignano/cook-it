# Cook-It

Asistente de voz local para cocinar guiado paso a paso — 100% offline, sin llamadas a APIs
externas ni coste de tokens. Inspirado en [BMO local AI agent](https://www.youtube.com/watch?v=l5ggH-YhuAw).

- [`docs/spec.md`](docs/spec.md) — spec del proyecto, arquitectura, roadmap.
- [`docs/feasibility.md`](docs/feasibility.md) — análisis de viabilidad y benchmarks reales de latencia.
- [`docs/voz.md`](docs/voz.md) — detalle del subsistema de voz (STT/TTS).

Este repo es el **proof of concept**: vive en [`src/`](src/) — API web (FastAPI) + interfaz por
voz en el navegador, más un par de scripts de CLI para probar el pipeline sin navegador.

## Requisitos

Para que esto funcione, la máquina donde corre necesita:

1. **[Ollama](https://ollama.com)**, corriendo y con el modelo `gemma3` ya descargado
   (`ollama pull gemma3`). Es el LLM que narra las recetas y responde preguntas de seguimiento —
   ver `docs/feasibility.md` para por qué este modelo concretamente y qué RAM hace falta.
2. **[Piper](https://github.com/rhasspy/piper)** (TTS) — sintetiza la voz de las respuestas. La app
   usa el paquete `piper-tts` (Python) y necesita el modelo de voz `es_ES-davefx-medium` descargado.
3. **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** (STT) — transcribe lo que dice
   el usuario. Corre el modelo `small` de Whisper localmente, sin llamadas a la API de OpenAI.

Los tres son 100% locales — nada de esto llama a un servicio en la nube. Ver `docs/voz.md` para el
detalle de STT/TTS y `docs/feasibility.md` para los números reales de latencia/RAM medidos.

## Variables de entorno

Ninguna es obligatoria si todo corre en la misma máquina con la configuración por defecto — solo
hacen falta para adaptar la app a otra máquina/mic. Ver [`.env.example`](.env.example) para la
lista completa con sus valores por defecto:

| Variable | Para qué | Por defecto |
|---|---|---|
| `OLLAMA_BASE_URL` | Dónde está Ollama — solo hace falta si no corre en `localhost` | `http://localhost:11434` |
| `OLLAMA_MODEL` | Qué modelo pedirle a Ollama | `gemma3` |
| `COOKIT_VOICE` | Qué voz de Piper usar (nombre de [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)) | `es_ES-davefx-medium` |
| `COOKIT_MIC_DEVICE` | Dispositivo ALSA del micro (solo scripts de CLI, no la web) | `plughw:1,0` |
| `COOKIT_RECORD_SECONDS` | Segundos de grabación por turno (solo CLI) | `7` |

## Estructura

```
src/
  api.py            API web (FastAPI) -- backend de la interfaz por voz del navegador
  recipe_engine.py  Lógica compartida: pedir receta (LLM+RAG), navegación de pasos, router,
                     dictado de recetas propias (structure_dictated_recipe/save_dictated_recipe)
  common.py         Estado de sesión + síntesis/reproducción de voz
  assistant_poc.py  CLI push-to-talk (sin navegador)
  next_step.py      CLI "botón" de siguiente paso, sin voz ni LLM
  static/           Frontend (HTML/CSS/JS, sin frameworks)
    index.html/js      Pantalla principal (voz + recetas)
    cargar-receta.*     "Cargar mi receta": dicta una receta propia por voz desde cualquier
                        dispositivo (móvil incluido, vía el QR de la pantalla principal) y el
                        LLM local la estructura para guardarla como receta local
  recipes/          Base de recetas locales (JSON), fuente de verdad para RAG -- incluye tanto
                     las curadas a mano como las que los usuarios dictan por voz
```

### Cargar tu propia receta por voz

Además de las recetas curadas en `src/recipes/`, cualquiera puede dictar una receta propia:
en la pantalla principal, "📋 Cargar mi receta" (o el código QR, para hacerlo desde el móvil sin
teclear nada) abre una página donde se graba la receta de viva voz sin límite de tiempo. El
mismo pipeline local (whisper + LLM vía Ollama) la transcribe y estructura en el mismo esquema
que las recetas curadas -- el usuario revisa/corrige el resultado antes de guardarla, y desde ese
momento se puede pedir por voz o elegir en la pantalla principal igual que cualquier otra.
