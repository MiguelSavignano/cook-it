# Cook-It's voice — what we use and what it costs

> Focused summary of just the voice subsystem (STT + TTS). For the assistant's full architecture see [`spec.md`](./spec.md) §4-5; for the performance/latency tests that validated these choices, see [`feasibility.md`](./feasibility.md) §8.

## The two components of "voice"

| | What it does | Engine | Where it runs |
|---|---|---|---|
| **STT** (speech → text) | Transcribes what the user says | [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper), `small` model, `int8` | 100% local, CPU, on your own machine |
| **TTS** (text → speech) | Synthesizes the spoken response | [Piper](https://github.com/rhasspy/piper), `es_ES-davefx-medium` voice | 100% local, CPU, on your own machine |

Both run as a local process/library — no network call to any external service anywhere in the voice pipeline.

**Where it lives in the code:**
- STT: the Whisper model (`WhisperModel("small", device="cpu", compute_type="int8")`) is loaded once, and transcription happens in [`assistant_poc.py`](../src/assistant_poc.py) (CLI) and [`api.py`](../src/api.py) (web, `/api/question` endpoint).
- TTS: [`synthesize()`/`speak()`](../src/common.py) functions — they run `python3 -m piper` as a subprocess. `speak()` also plays it with `aplay` (only used by the CLI scripts, where the machine running the process is the same one the user is standing next to); `api.py` uses `synthesize()` and returns the audio as base64 so the calling device itself plays it (the browser, not the server — this matters since requests can come from a phone).
- On the web, the browser (`app.js`) **only records** audio with `MediaRecorder` and uploads it — it never transcribes or synthesizes anything client-side, so as not to break "100% local".

## Do we spend tokens on voice?

**No, zero tokens and zero API cost, neither for transcription nor for generating speech.**

- **Processing speech (STT):** `faster-whisper` is an OpenAI Whisper model running locally via CTranslate2, not the OpenAI API. There's no HTTP call to any provider — it's inference on your own CPU with a model downloaded once (~464 MB, cached in `~/.cache/huggingface`).
- **Generating speech (TTS):** Piper synthesizes with an ONNX model downloaded to disk (`src/voices/es_ES-davefx-medium.onnx`, 63 MB). No cloud service involved here either (no ElevenLabs, Amazon Polly, Google TTS, etc.).

And as a bonus: the LLM that generates recipes/responses doesn't spend paid tokens either — it uses Ollama + `gemma3` running locally (`OLLAMA_BASE_URL`, defaults to `localhost:11434`), not the Anthropic/OpenAI API. See `recipe_engine.py` and the root `README.md` for the environment variables.

So the whole pipeline (STT → router/LLM → TTS) is **$0 in tokens/API for any interaction**, by design (see `spec.md` §1: "not dependent on cloud services... no API cost"). The only real "cost" is your own PC's CPU/RAM and the latency that implies (see benchmarks in `feasibility.md` §8-9).

## Measured performance (quick reference)

From `feasibility.md` §8, with the real TONOR mic:

| Stage | Typical time |
|---|---|
| STT (whisper `small`, ~5-6s of audio) | ~2.1-2.4 s |
| TTS — synthesis (Piper) | ~1.2 s |

STT + TTS combined add up to ~3.5 s, a small fraction next to the ~12 s the LLM takes to generate a response — voice itself is not the system's bottleneck.
