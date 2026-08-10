# Análisis de viabilidad — asistente de voz local (base para Cook-It)

Fecha: 2026-08-09
Máquina de pruebas: PC de escritorio del usuario (Ubuntu 24.04, ver specs abajo)
Idea de referencia: [I made a real BMO local AI agent with a Raspberry Pi and Ollama](https://www.youtube.com/watch?v=l5ggH-YhuAw) — proyecto [brenpoly/be-more-agent](https://github.com/brenpoly/be-more-agent) (Raspberry Pi 5 + Ollama + Whisper.cpp + Piper + OpenWakeWord).

## TL;DR

**Sí, es viable montar el pipeline completo (wake word → STT → LLM → TTS) en tu ordenador**, pero con matices importantes:

- El cuello de botella **no es la CPU, es la RAM disponible**. Tienes 14 GiB físicos, y con Chrome + VSCode + sesiones de Claude Code abiertas normalmente solo quedan **~7–8 GiB libres**, ya bajo presión de swap.
- No hay GPU aprovechable: la GT 730 (2 GB VRAM, sin CUDA moderno soportado por Ollama) y la iGPU Vega (sin ROCm instalado) no aceleran nada. **Todo corre por CPU.**
- `gemma3` (el que tienes bajado) **no soporta `tools` nativamente en Ollama** — lo confirmé por API, da error explícito. Para function calling nativo necesitas otro modelo.
- `gemma4` (8B, ya lo tienes bajado, con capacidades `tools` + `audio` + `thinking`) es el candidato ideal a futuro, pero **no cargó en la prueba real** porque pedía 9.8 GiB y solo había 8.4 GiB libres con el resto de apps abiertas.
- `llama3.1:8b` (ya lo tienes bajado) **sí soporta `tools` nativamente y funciona** — probado con una tool call real — pero es más lento (~3.5 tok/s por CPU) y ocupa 5.2 GiB en RAM mientras está cargado.
- La infraestructura de audio (micro USB detectado, `arecord`/`aplay`/`ffmpeg`/Python) ya está lista. Falta instalar Whisper.cpp/faster-whisper y Piper TTS (no lo tienes aún).

**Recomendación:** para el MVP de desarrollo, usar `gemma3:4b` para narrar/responder (rápido, cabe holgado) combinado con un router de intents por reglas en Python (no dependiente de `tools` de Ollama) para los comandos de control (siguiente paso, temporizador, conversión). Reservar `llama3.1:8b` o `gemma4:8b` para una fase 2 con tool-calling nativo, cerrando apps pesadas o en una máquina/Pi dedicada.

---

## 1. Hardware y software detectado

| Componente | Valor |
|---|---|
| CPU | AMD Ryzen 7 5700G, 16 hilos |
| RAM total | 14 GiB (≈15 GB) |
| RAM libre típica (con Chrome+VSCode+Claude abiertos) | ~7–8 GiB disponibles, swap (2 GiB) ya usado en gran parte |
| GPU | NVIDIA GT 730 (2 GB VRAM, arquitectura Kepler, no soportada por builds modernos de Ollama/CUDA) + iGPU AMD Vega (sin ROCm instalado) |
| Disco | 268 GB libres de 468 GB |
| SO | Ubuntu 24.04.4 LTS |
| Ollama | v0.24.0, instalado y corriendo como servicio systemd |
| Micrófonos | USB TONOR TC-777, webcam Logitech C920 (ambos detectados por ALSA) |
| Audio/infra | `arecord`, `aplay`, `pactl`, `ffmpeg` presentes; Python 3.11.15 (pyenv) + pip presentes |
| STT/TTS instalados | Ninguno todavía (ni whisper.cpp/faster-whisper ni Piper) |

Modelos Ollama ya descargados:

| Modelo | Params | Tamaño disco | Capacidades (`ollama show`) |
|---|---|---|---|
| `gemma3:latest` | 4.3B, Q4_K_M | 3.3 GB | completion, vision |
| `gemma4:latest` | 8.0B, Q4_K_M | 9.6 GB | completion, vision, **audio, tools, thinking** |
| `llama3.1:latest` | 8B, Q4_K_M | 4.9 GB | completion + **tools** (nativo y confirmado) |

## 2. Pruebas realizadas (reproducibles)

### 2.1 Generación de texto — `gemma3:4b`

```
echo "Dame una receta corta de tortilla de patatas en 3 pasos." | ollama run gemma3 --verbose
```

Resultado:
- `load duration`: 4.8 s
- `prompt eval rate`: 61.2 tok/s
- `eval rate`: **6.53 tok/s** (287 tokens generados en ~44 s)
- Respuesta coherente y en español correcto.

### 2.2 Carga de `gemma4:8b`

```
ollama run gemma4 ...
```

Resultado: **falló** —
```
Error: 500 Internal Server Error: model requires more system memory (9.8 GiB) than is available (8.4 GiB)
```
Con Chrome/VSCode/3 sesiones de Claude Code abiertas, no había margen. Cerrando esas apps probablemente cargaría, pero no es una base fiable para un asistente que debe convivir con tu uso normal del PC.

### 2.3 Soporte de `tools` vía API de Ollama

`gemma3` — rechazado explícitamente:
```json
{"error":"registry.ollama.ai/library/gemma3:latest does not support tools"}
```

`llama3.1` — funciona, tool call real devuelto correctamente:
```json
{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_weather","arguments":{"city":"Madrid"}}}]}}
```

Esto confirma lo que reportan terceros: Gemma 3 usa "pythonic function calling" y no expone tool-calling nativo tipo OpenAI en Ollama; existen parches de terceros para forzarlo — de ahí el proyecto que citaste, [IllFil/gemma3-ollama-tools](https://github.com/IllFil/gemma3-ollama-tools) (que literalmente ajusta el Modelfile/prompt de Gemma 3 para simular tool-calling). También hay variantes ya empaquetadas en el registro de Ollama: [`antony66/gemma3-tools`](https://ollama.com/antony66/gemma3-tools) y [`orieg/gemma3-tools`](https://ollama.com/orieg/gemma3-tools).

### 2.4 Rendimiento de `llama3.1:8b` con tools activo

- RAM residente mientras está cargado: **5.2 GB**, 100% CPU (`ollama ps`)
- `eval rate`: **~3.5 tok/s** (más lento que gemma3, esperable por ser casi el doble de parámetros)
- Tiempo de una respuesta corta (~110 tokens): ~31 s de generación + carga inicial (~7–15 s si no está cacheado)

## 3. Hallazgos clave

1. **RAM es el límite real, no CPU.** Con tu uso normal del escritorio, tienes ~7–8 GiB libres. Un modelo de 4–5 GB (gemma3:4b o llama3.1:8b) cabe; un modelo de ~10 GB (gemma4:8b) es arriesgado salvo que cierres aplicaciones o dediques la máquina al asistente.
2. **No hay aceleración GPU disponible.** Toda la inferencia es CPU-only. A 3.5–6.5 tok/s, una respuesta de 1–2 frases (los que necesita un asistente de cocina hablando) tarda entre 5 y 30 segundos — aceptable para un asistente hands-free mientras cocinas, notablemente lento si esperas respuestas tipo chat instantáneo.
3. **Gemma 3 no tiene tool-calling nativo en Ollama.** Si quieres `tools` de verdad (function calling estructurado), las opciones son: (a) `llama3.1:8b` (ya lo tienes, nativo, confirmado), (b) una variante parcheada `gemma3-tools` de terceros, o (c) `gemma4:8b` (nativo, pero pesado para esta RAM).
4. **`gemma4:8b` es el modelo más prometedor a medio plazo**: soporta `tools` Y `audio` de forma nativa (podría reducir la necesidad de un STT separado en el futuro), pero hoy no carga de forma fiable en esta máquina compartida con tu entorno de trabajo.
5. **La parte de voz (STT/TTS) es la más barata en RAM** y no es el problema: Whisper.cpp (modelo `small`, ~500 MB) y Piper TTS (voz ONNX, ~60–120 MB, CPU, casi tiempo real) son ligeros comparados con el LLM.
6. **El micro y las herramientas de audio del sistema ya están listas** — no hay trabajo de "hardware" pendiente, solo instalar software.

## 4. Presupuesto de RAM estimado del pipeline completo

| Componente | RAM aprox. | ¿Residente todo el tiempo? |
|---|---|---|
| Wake word (OpenWakeWord, ONNX) | ~150–250 MB | Sí (siempre escuchando) |
| STT (whisper.cpp `small`, cuantizado) | ~500 MB–1 GB durante inferencia | No, solo al procesar audio |
| LLM (gemma3:4b) | ~3.5–4 GB residente | Configurable con `keep_alive` |
| LLM (llama3.1:8b, si se usa tools) | ~5.2 GB residente | Configurable con `keep_alive` |
| TTS (Piper, voz medium) | ~150–300 MB durante síntesis | No |
| App orquestadora (Python) | ~150–300 MB | Sí |

**Pico estimado con gemma3:4b:** ~4.5–5.5 GB → cabe cómodo en tus ~7–8 GiB libres.
**Pico estimado con llama3.1:8b/gemma4:8b:** ~6–7 GiB solo del asistente → **muy justo** si Chrome/VSCode siguen abiertos; recomendable cerrarlos durante las pruebas de voz o usar `OLLAMA_KEEP_ALIVE=0`/`5m` para descargar el modelo entre turnos.

## 5. Recomendación de arquitectura para el MVP

**Track A — recomendado para empezar (esta semana):**
- LLM: `gemma3:4b` — rápido, cabe holgado, ya lo tienes.
- Tool-calling: **no usar el `tools` de Ollama** (gemma3 no lo soporta). En su lugar, un router de intents en la propia app (reglas/regex para comandos de control como "siguiente paso", "repite", "pon un temporizador de 5 minutos", "cuántos gramos son 2 tazas") + gemma3 solo para narrar/responder preguntas abiertas sobre la receta (RAG contra tu base de recetas local, no memoria del modelo, para evitar alucinar cantidades).
- STT: whisper.cpp, modelo `small` (o `base` si hace falta más velocidad), idioma español.
- TTS: Piper, voz `es_ES-davefx-medium` (voz genérica española, buen equilibrio calidad/velocidad en CPU) — suficiente para "una voz genérica" tal como pediste. Alternativa: `es_MX-claude-high` (más pesada, mejor calidad) o `es_ES-sharvard-medium`.
- Wake word: OpenWakeWord (o empezar sin wake word, con botón/tecla de "empujar para hablar" para simplificar el MVP).

**Track B — fase 2 (tool-calling nativo / agente más flexible):**
- LLM: `llama3.1:8b` (ya validado) o `gemma4:8b` (mejor si cabe: audio+tools+thinking nativos).
- Requiere cerrar apps pesadas durante uso, `OLLAMA_KEEP_ALIVE` corto, y opcionalmente mover el asistente a hardware dedicado (Pi 5 con 8 GB, o un mini PC) para la experiencia "siempre encendida" tipo BMO.

## 6. Riesgos / cosas a vigilar

- **Swap ya casi lleno (1.9/2 GiB usado)** en el momento de la prueba — indica que el sistema ya vive cerca del límite de memoria con tu carga de trabajo habitual. Vale la pena monitorizar con `free -h` mientras se prueba el pipeline completo.
- **Latencia percibida**: con CPU-only, cuenta con 5–15 s de "pensando" antes de que hable. Hay que diseñar el feedback de voz/UI (sonido de "escuchando"/"pensando") para que no parezca colgado, tal como hace BMO con sus estados de cara.
- **Calidad de tool-calling con Gemma 3 4B**: aunque se parcheara con `gemma3-tools`, reportes de terceros indican que 4B "tiene resultados subóptimos" razonando sobre qué tool usar — otro motivo para preferir el router por reglas en el MVP en vez de depender del modelo para decidir acciones críticas (temporizadores, cantidades).

## 7. Próximos pasos técnicos (para validar el pipeline completo, no solo el LLM)

1. ~~Instalar Piper TTS + descargar voz `es_ES-davefx-medium`, probar síntesis y latencia.~~ ✅ hecho, ver §8.
2. ~~Instalar whisper.cpp (o `faster-whisper` vía pip), modelo `small`, probar transcripción con el micro TONOR.~~ ✅ hecho (con `faster-whisper`, no whisper.cpp — ver nota en §8), pendiente probar con voz real por micro en vez de audio sintetizado.
3. Montar un prototipo de "empujar para hablar" (sin wake word) que encadene: grabar → whisper → gemma3 (con contexto de una receta de ejemplo) → Piper → reproducir.
4. Medir latencia extremo a extremo real y decidir si hace falta ajustar modelo/tamaños.

## 8. Prueba real de TTS + STT (2026-08-10)

Entorno: venv en `poc/.venv`, paquetes `piper-tts`, `faster-whisper` (en vez de whisper.cpp — ver nota). Voz descargada: [`es_ES-davefx-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/davefx/medium) (63 MB).

**Nota sobre STT:** se usó `faster-whisper` (CTranslate2) en vez de whisper.cpp porque no había `cmake` instalado y evita compilar C++. Es funcionalmente equivalente (mismos modelos Whisper de OpenAI, backend distinto, también CPU-only e int8). Si más adelante se prefiere whisper.cpp real, solo hace falta `sudo apt install cmake` y compilar.

### 8.1 Piper TTS — síntesis

Frase de prueba (~5.4 s de audio, una instrucción de receta real):

- Tiempo de síntesis: **1.19 s** → genera audio ~4.5× más rápido que el tiempo real (RTF ≈ 0.22).
- Reproducido con éxito por `aplay` (salida por altavoces).
- Sin uso de GPU (warning esperado de onnxruntime al no encontrar GPU, cae a CPU automáticamente).

### 8.2 faster-whisper (modelo `small`, `int8`, CPU) — transcripción

Round-trip: se transcribió el propio audio generado por Piper (mismo texto, para medir precisión + latencia sin depender de grabar en el momento):

- Carga del modelo (primera vez, con descarga): 48.6 s.
- Carga del modelo (ya cacheado en `~/.cache/huggingface`, 464 MB): **1.02 s**.
- Transcripción de 5.4 s de audio: **2.3–2.4 s** (RTF ≈ 0.43, más rápido que tiempo real).
- Idioma detectado automáticamente: español, confianza 100%.
- Texto reconocido: **"Vale, siguiente paso, pelay corta las patatas en láminas finas y ponlas a freír a fuego medio."** — coincide con el original salvo una unión de palabras ("pela y" → "pelay"), esperable y sin impacto en un router de intents con fuzzy matching.

### 8.3 Conclusión de esta prueba

STT + TTS combinados añaden solo ~3.5 s de latencia (1.2 s TTS + 2.3 s STT) sobre el tiempo de generación del LLM, y su huella en RAM es marginal (cientos de MB) comparada con el LLM (varios GB). **Confirman lo estimado en §4: no son el cuello de botella — el LLM sigue siendo el componente que domina tanto la RAM como la latencia percibida.** Con memoria libre en el momento de la prueba (12 GiB disponibles, tras cerrar aplicaciones pesadas), el margen es cómodo.

### 8.4 Prueba con voz real (micro TONOR, en vivo)

Primer intento fallido: grabación disparada directamente por el agente salió en silencio (amplitud máxima 0.024/1.0) — no era problema de hardware/mixer (el TONOR estaba al 100% y activo), sino de sincronización: el `arecord` se ejecutaba antes de que el usuario tuviera tiempo de reaccionar al mensaje. Se resolvió con un script (`poc/mic_test_record.sh`) lanzado por el propio usuario vía `!` en su terminal, para que la grabación esté sincronizada con el momento real de hablar.

Resultado con voz real, condiciones normales de habitación (sin aislar ruido):

```
[0.0-3.0]  Hola, ¿cómo estás?
[3.0-6.0]  Estoy haciendo una prueba de cómo se escucha mi voz.
```

Transcripción **perfecta**, sin errores, idioma detectado correctamente (es, 100%). Confirma que whisper `small` vía faster-whisper es suficiente para el caso de uso, incluso sin optimizar la captura (mixer por defecto, sin cancelación de ruido).

**Conclusión de la fase de voz: STT y TTS están validados y listos para integrarse.** El siguiente cuello de botella a resolver es enlazarlos con el LLM (Fase 1 del roadmap en `spec.md`).

## 9. Prueba end-to-end del pipeline completo (2026-08-10)

Prototipo: [`poc/assistant_poc.py`](../poc/assistant_poc.py) (lanzado vía `poc/run_assistant.sh`). Flujo real: grabar (micro TONOR) → `faster-whisper` (STT) → `gemma3` vía Ollama, con la receta de tortilla de patatas (`poc/recipes/tortilla-patatas.json`) inyectada como contexto y marcando "paso actual" → `piper` (TTS) → `aplay`.

**Interacción real probada:**

- Usuario (voz, transcrita): *"voy a usar aceite de girosal en vez de aceite de oliva que tengo que cambiar"* — nótese el error de STT ("girasol" → "girosal"), esperable y sin impacto en el resultado.
- Respuesta del asistente (gemma3, leída en voz alta por Piper): *"Entiendo, puedes sustituir el aceite de oliva por aceite de girasol. ¡Asegúrate de usar la misma cantidad de 200 ml!"*
- **Correcto y sin alucinar**: entendió la intención pese al error de transcripción, y citó la cantidad exacta de la receta (200 ml) en vez de inventar un número — confirma que la estrategia RAG (inyectar la receta real como contexto en vez de fiarse de la memoria del LLM) funciona como se diseñó en `spec.md` §4.

**Desglose de latencia:**

| Etapa | Tiempo |
|---|---|
| Grabación (fija, de prueba) | 6.02 s |
| STT (whisper `small`) | 2.10 s |
| LLM (`gemma3`, generación) | 12.29 s |
| TTS — síntesis (Piper) | 1.32 s |
| TTS — reproducción (duración real del audio hablado) | ~7 s |

**Latencia percibida real** (silencio entre que el usuario termina de hablar y empieza a sonar la respuesta) = STT + LLM + síntesis TTS ≈ **15.7 s**. Los ~7 s de reproducción no cuentan como "espera" — es la duración natural de la frase hablada, tiempo en el que el usuario ya está escuchando, no esperando.

Este resultado **cumple el objetivo de latencia definido en `spec.md` §9** (<20 s para preguntas abiertas al LLM) y confirma que, tal como se predijo en §5–§8, el LLM (12.3 s de los 15.7 s totales, ~78%) sigue siendo con diferencia el componente que domina la latencia — STT y TTS combinados son <25% del tiempo total.

**Siguiente paso sugerido:** implementar el router de intents determinista (Fase 2 de `spec.md`) para que comandos de control simples ("siguiente paso", "repite", "pon un temporizador") no pasen por el LLM en absoluto y respondan casi al instante, reservando los ~15 s del LLM solo para preguntas realmente abiertas.
