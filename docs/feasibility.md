# Feasibility analysis — local voice assistant (base for Cook-It)

Date: 2026-08-09
Test machine: the project author's desktop PC (Ubuntu 24.04, specs below)
Reference idea: [I made a real BMO local AI agent with a Raspberry Pi and Ollama](https://www.youtube.com/watch?v=l5ggH-YhuAw) — project [brenpoly/be-more-agent](https://github.com/brenpoly/be-more-agent) (Raspberry Pi 5 + Ollama + Whisper.cpp + Piper + OpenWakeWord).

## TL;DR

**Yes, it's feasible to run the full pipeline (wake word → STT → LLM → TTS) on this PC**, but with important caveats:

- The bottleneck **isn't the CPU, it's available RAM**. 14 GiB physical, and with Chrome + VSCode + Claude Code sessions open, typically only **~7-8 GiB free** remain, already under swap pressure.
- No usable GPU: the GT 730 (2 GB VRAM, no modern CUDA support in Ollama) and the Vega iGPU (no ROCm installed) accelerate nothing. **Everything runs on CPU.**
- `gemma3` (the one already downloaded) **doesn't support `tools` natively in Ollama** — confirmed via the API, it gives an explicit error. Native function calling needs a different model.
- `gemma4` (8B, already downloaded, with `tools` + `audio` + `thinking` capabilities) is the ideal candidate long-term, but **failed to load in the real test** because it requested 9.8 GiB while only 8.4 GiB were free with the rest of the apps open.
- `llama3.1:8b` (already downloaded) **does support `tools` natively and works** — tested with a real tool call — but is slower (~3.5 tok/s on CPU) and takes up 5.2 GiB of RAM while loaded.
- The audio infrastructure (USB mic detected, `arecord`/`aplay`/`ffmpeg`/Python) is already in place. Still needed: Whisper.cpp/faster-whisper and Piper TTS (not installed yet at this point).

**Recommendation:** for the development MVP, use `gemma3:4b` for narration/responses (fast, fits comfortably) combined with a rule-based intent router in Python (not dependent on Ollama's `tools`) for control commands (next step, timer, conversion). Reserve `llama3.1:8b` or `gemma4:8b` for a phase 2 with native tool-calling, closing heavy apps or on a dedicated machine/Pi.

---

## 1. Detected hardware and software

| Component | Value |
|---|---|
| CPU | AMD Ryzen 7 5700G, 16 threads |
| Total RAM | 14 GiB (≈15 GB) |
| Typical free RAM (with Chrome+VSCode+Claude open) | ~7-8 GiB available, swap (2 GiB) already mostly used |
| GPU | NVIDIA GT 730 (2 GB VRAM, Kepler architecture, not supported by modern Ollama/CUDA builds) + AMD Vega iGPU (no ROCm installed) |
| Disk | 268 GB free out of 468 GB |
| OS | Ubuntu 24.04.4 LTS |
| Ollama | v0.24.0, installed and running as a systemd service |
| Microphones | USB TONOR TC-777, Logitech C920 webcam (both detected by ALSA) |
| Audio/infra | `arecord`, `aplay`, `pactl`, `ffmpeg` present; Python 3.11.15 (pyenv) + pip present |
| STT/TTS installed | None yet at this point (neither whisper.cpp/faster-whisper nor Piper) |

Ollama models already downloaded:

| Model | Params | Disk size | Capabilities (`ollama show`) |
|---|---|---|---|
| `gemma3:latest` | 4.3B, Q4_K_M | 3.3 GB | completion, vision |
| `gemma4:latest` | 8.0B, Q4_K_M | 9.6 GB | completion, vision, **audio, tools, thinking** |
| `llama3.1:latest` | 8B, Q4_K_M | 4.9 GB | completion + **tools** (native, confirmed) |

## 2. Tests performed (reproducible)

### 2.1 Text generation — `gemma3:4b`

```
echo "Give me a short tortilla de patatas recipe in 3 steps." | ollama run gemma3 --verbose
```

Result:
- `load duration`: 4.8 s
- `prompt eval rate`: 61.2 tok/s
- `eval rate`: **6.53 tok/s** (287 tokens generated in ~44 s)
- Coherent response, correct Spanish.

### 2.2 Loading `gemma4:8b`

```
ollama run gemma4 ...
```

Result: **failed** —
```
Error: 500 Internal Server Error: model requires more system memory (9.8 GiB) than is available (8.4 GiB)
```
With Chrome/VSCode/3 Claude Code sessions open, there was no headroom. Closing those apps would probably let it load, but that's not a reliable baseline for an assistant that has to coexist with normal PC use.

### 2.3 `tools` support via the Ollama API

`gemma3` — explicitly rejected:
```json
{"error":"registry.ollama.ai/library/gemma3:latest does not support tools"}
```

`llama3.1` — works, a real tool call correctly returned:
```json
{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_weather","arguments":{"city":"Madrid"}}}]}}
```

This confirms what third parties report: Gemma 3 uses "pythonic function calling" and doesn't expose OpenAI-style native tool-calling in Ollama; third-party patches exist to force it — hence the project [IllFil/gemma3-ollama-tools](https://github.com/IllFil/gemma3-ollama-tools) (which literally adjusts Gemma 3's Modelfile/prompt to simulate tool-calling). There are also pre-packaged variants in Ollama's registry: [`antony66/gemma3-tools`](https://ollama.com/antony66/gemma3-tools) and [`orieg/gemma3-tools`](https://ollama.com/orieg/gemma3-tools).

### 2.4 `llama3.1:8b` performance with tools active

- RAM resident while loaded: **5.2 GB**, 100% CPU (`ollama ps`)
- `eval rate`: **~3.5 tok/s** (slower than gemma3, expected since it's almost double the parameters)
- Time for a short response (~110 tokens): ~31 s of generation + initial load (~7-15 s if not cached)

## 3. Key findings

1. **RAM is the real limit, not CPU.** With normal desktop use, ~7-8 GiB are free. A 4-5 GB model (gemma3:4b or llama3.1:8b) fits; a ~10 GB model (gemma4:8b) is risky unless apps are closed or the machine is dedicated to the assistant.
2. **No GPU acceleration available.** All inference is CPU-only. At 3.5-6.5 tok/s, a 1-2 sentence response (what a talking cooking assistant needs) takes between 5 and 30 seconds — acceptable for a hands-free assistant while cooking, noticeably slow if you expect instant chat-like responses.
3. **Gemma 3 has no native tool-calling in Ollama.** For real `tools` (structured function calling), the options are: (a) `llama3.1:8b` (already available, native, confirmed), (b) a third-party patched `gemma3-tools` variant, or (c) `gemma4:8b` (native, but heavy for this RAM).
4. **`gemma4:8b` is the most promising model mid-term**: supports `tools` AND `audio` natively (could reduce the need for separate STT in the future), but today doesn't reliably load on this machine shared with normal work use.
5. **The voice side (STT/TTS) is the cheapest in RAM** and isn't the problem: Whisper.cpp (`small` model, ~500 MB) and Piper TTS (ONNX voice, ~60-120 MB, CPU, near real-time) are lightweight compared to the LLM.
6. **The mic and system audio tools are already ready** — no "hardware" work pending, just software to install.

## 4. Estimated RAM budget for the full pipeline

| Component | Approx. RAM | Resident the whole time? |
|---|---|---|
| Wake word (OpenWakeWord, ONNX) | ~150-250 MB | Yes (always listening) |
| STT (whisper.cpp `small`, quantized) | ~500 MB-1 GB during inference | No, only while processing audio |
| LLM (gemma3:4b) | ~3.5-4 GB resident | Configurable via `keep_alive` |
| LLM (llama3.1:8b, if using tools) | ~5.2 GB resident | Configurable via `keep_alive` |
| TTS (Piper, medium voice) | ~150-300 MB during synthesis | No |
| Orchestrator app (Python) | ~150-300 MB | Yes |

**Estimated peak with gemma3:4b:** ~4.5-5.5 GB → fits comfortably in the ~7-8 GiB free.
**Estimated peak with llama3.1:8b/gemma4:8b:** ~6-7 GiB for the assistant alone → **very tight** if Chrome/VSCode stay open; recommended to close them during voice testing or use `OLLAMA_KEEP_ALIVE=0`/`5m` to unload the model between turns.

## 5. Architecture recommendation for the MVP

**Track A — recommended to start with (this week):**
- LLM: `gemma3:4b` — fast, fits comfortably, already downloaded.
- Tool-calling: **don't use Ollama's `tools`** (gemma3 doesn't support it). Instead, an intent router in the app itself (rules/regex for control commands like "next step", "repeat", "set a 5-minute timer", "how many grams are 2 cups") + gemma3 only for narrating/answering open questions about the recipe (RAG against the local recipe database, not the model's memory, to avoid hallucinated quantities).
- STT: whisper.cpp, `small` model (or `base` if more speed is needed), Spanish.
- TTS: Piper, `es_ES-davefx-medium` voice (generic Spanish voice, good quality/speed balance on CPU) — enough for "a generic voice" as requested. Alternative: `es_MX-claude-high` (heavier, better quality) or `es_ES-sharvard-medium`.
- Wake word: OpenWakeWord (or start without one, with a "push to talk" button/key to simplify the MVP).

**Track B — phase 2 (native tool-calling / more flexible agent):**
- LLM: `llama3.1:8b` (already validated) or `gemma4:8b` (better if it fits: native audio+tools+thinking).
- Requires closing heavy apps during use, a short `OLLAMA_KEEP_ALIVE`, and optionally moving the assistant to dedicated hardware (a Pi 5 with 8 GB, or a mini PC) for an "always on" BMO-style experience.

## 6. Risks / things to watch

- **Swap already nearly full (1.9/2 GiB used)** at test time — indicates the system already lives close to its memory limit under normal workload. Worth monitoring with `free -h` while testing the full pipeline.
- **Perceived latency**: CPU-only means 5-15 s of "thinking" before it speaks. The voice/UI feedback (a "listening"/"thinking" sound) needs to be designed so it doesn't feel stuck, the way BMO does with its face states.
- **Gemma 3 4B's tool-calling quality**: even if patched with `gemma3-tools`, third-party reports say 4B "gets suboptimal results" reasoning about which tool to use — another reason to prefer the rule-based router in the MVP instead of relying on the model to decide critical actions (timers, quantities).

## 7. Next technical steps (to validate the full pipeline, not just the LLM)

1. ~~Install Piper TTS + download the `es_ES-davefx-medium` voice, test synthesis and latency.~~ ✅ done, see §8.
2. ~~Install whisper.cpp (or `faster-whisper` via pip), `small` model, test transcription with the TONOR mic.~~ ✅ done (with `faster-whisper`, not whisper.cpp — see note in §8), still need to test with real mic voice instead of synthesized audio.
3. Build a "push to talk" prototype (no wake word) chaining: record → whisper → gemma3 (with a sample recipe as context) → Piper → play.
4. Measure real end-to-end latency and decide whether model/size adjustments are needed.

## 8. Real TTS + STT test (2026-08-10)

Environment: venv in `src/.venv`, packages `piper-tts`, `faster-whisper` (instead of whisper.cpp — see note). Voice downloaded: [`es_ES-davefx-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/davefx/medium) (63 MB).

**Note on STT:** `faster-whisper` (CTranslate2) was used instead of whisper.cpp because `cmake` wasn't installed and this avoids compiling C++. It's functionally equivalent (same OpenAI Whisper models, different backend, also CPU-only and int8). If real whisper.cpp is preferred later, it only takes `sudo apt install cmake` and compiling.

### 8.1 Piper TTS — synthesis

Test sentence (~5.4 s of audio, a real recipe instruction):

- Synthesis time: **1.19 s** → generates audio ~4.5x faster than real time (RTF ≈ 0.22).
- Played back successfully via `aplay` (speaker output).
- No GPU used (expected onnxruntime warning when no GPU is found, falls back to CPU automatically).

### 8.2 faster-whisper (`small` model, `int8`, CPU) — transcription

Round-trip: the audio Piper itself generated was transcribed back (same text, to measure accuracy + latency without depending on recording live):

- Model load (first time, with download): 48.6 s.
- Model load (already cached in `~/.cache/huggingface`, 464 MB): **1.02 s**.
- Transcription of 5.4 s of audio: **2.3-2.4 s** (RTF ≈ 0.43, faster than real time).
- Language auto-detected: Spanish, 100% confidence.
- Recognized text (Spanish original, this is a literal transcript so it's kept as spoken, not translated): **"Vale, siguiente paso, pelay corta las patatas en láminas finas y ponlas a freír a fuego medio."** — matches the original except one word merge ("pela y" → "pelay"), expected and with no impact on an intent router using fuzzy matching.

### 8.3 Conclusion of this test

STT + TTS combined add only ~3.5 s of latency (1.2 s TTS + 2.3 s STT) on top of the LLM's generation time, and their RAM footprint is marginal (a few hundred MB) compared to the LLM (several GB). **This confirms the estimate in §4: they are not the bottleneck — the LLM remains the component that dominates both RAM and perceived latency.** With the free memory available at test time (12 GiB, after closing heavy apps), there's a comfortable margin.

### 8.4 Test with real speech (TONOR mic, live)

First attempt failed: a recording triggered directly by the agent came out silent (max amplitude 0.024/1.0) — not a hardware/mixer issue (the TONOR was at 100% and active), but a timing one: `arecord` ran before the user had time to react to the message. Solved with a script (`src/mic_test_record.sh`) launched by the user themselves via `!` in their terminal, so the recording is synced to the actual moment of speaking.

Result with real speech, normal room conditions (no noise isolation) — kept in the original Spanish, since it's a literal transcript of what was said and recognized, not documentation prose:

```
[0.0-3.0]  Hola, ¿cómo estás?
[3.0-6.0]  Estoy haciendo una prueba de cómo se escucha mi voz.
```
(English: "Hi, how are you? I'm testing what my voice sounds like.")

**Perfect** transcription, no errors, language correctly detected (es, 100%). Confirms that whisper `small` via faster-whisper is good enough for the use case, even without optimizing capture (default mixer, no noise cancellation).

**Voice phase conclusion: STT and TTS are validated and ready to integrate.** The next bottleneck to solve is wiring them up to the LLM (Phase 1 of the roadmap in `spec.md`).

## 9. End-to-end test of the full pipeline (2026-08-10)

Prototype: [`src/assistant_poc.py`](../src/assistant_poc.py) (launched via `src/run_assistant.sh`). Real flow: record (TONOR mic) → `faster-whisper` (STT) → `gemma3` via Ollama, with the tortilla de patatas recipe (`src/recipes/tortilla-patatas.json`) injected as context and tracking the "current step" → `piper` (TTS) → `aplay`.

**Real interaction tested** (kept in the original Spanish — a literal transcript of what was said/spoken, not documentation prose):

- User (speech, transcribed): *"voy a usar aceite de girosal en vez de aceite de oliva que tengo que cambiar"* ("I'm going to use girosal oil instead of olive oil, what do I need to change") — note the STT error ("girasol" [sunflower] → "girosal"), expected and with no impact on the result.
- Assistant's response (gemma3, read aloud by Piper): *"Entiendo, puedes sustituir el aceite de oliva por aceite de girasol. ¡Asegúrate de usar la misma cantidad de 200 ml!"* ("Got it, you can substitute olive oil for sunflower oil. Make sure to use the same amount, 200 ml!")
- **Correct and no hallucination**: it understood the intent despite the transcription error, and cited the recipe's exact quantity (200 ml) instead of making up a number — confirms the RAG strategy (injecting the real recipe as context instead of trusting the LLM's memory) works as designed in `spec.md` §4.

**Latency breakdown:**

| Stage | Time |
|---|---|
| Recording (fixed, for the test) | 6.02 s |
| STT (whisper `small`) | 2.10 s |
| LLM (`gemma3`, generation) | 12.29 s |
| TTS — synthesis (Piper) | 1.32 s |
| TTS — playback (real duration of the spoken audio) | ~7 s |

**Real perceived latency** (silence between the user finishing speaking and the response starting to play) = STT + LLM + TTS synthesis ≈ **15.7 s**. The ~7 s of playback don't count as "waiting" — that's the natural duration of the spoken sentence, time during which the user is already listening, not waiting.

This result **meets the latency goal defined in `spec.md` §9** (<20 s for open questions to the LLM) and confirms that, as predicted in §5-§8, the LLM (12.3 s of the 15.7 s total, ~78%) remains by far the component that dominates latency — STT and TTS combined are <25% of the total time.

**Suggested next step:** implement the deterministic intent router (Phase 2 of `spec.md`) so simple control commands ("next step", "repeat", "set a timer") don't go through the LLM at all and respond almost instantly, reserving the LLM's ~15 s only for genuinely open questions.
