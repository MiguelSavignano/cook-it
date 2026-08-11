#!/usr/bin/env python3
"""
Cook-It web API (FastAPI). Voice-first interface plus a couple of buttons for
what doesn't need to be said out loud:

  - Microphone ("question"): ALWAYS calls the LLM -- either requests a new
    recipe, or answers a follow-up question about the active one. The browser
    only records and uploads the audio; transcription is local (whisper),
    never cloud speech recognition.
  - "◀ Previous" / "Next ▶" buttons: step navigation, WITHOUT recording audio
    and WITHOUT calling the LLM -- just session memory, near-instant.

Every response's audio is synthesized here (Piper) and sent back to the
CALLER as base64 WAV, which plays it locally -- NOT played through this
machine's speakers. That matters once more than one device can be the
caller (e.g. a phone on the same network): the device that asked is the one
that should hear the answer, not whichever machine happens to run the API.
(The CLI scripts are different: there, this same machine IS the device the
user is standing next to, so they use common.speak() to play locally instead.)

Frontend: a React SPA (src/frontend/, Picker "/" + Cook "/cook", one
react-router app) built by Vite into src/static_dist/ -- see
src/frontend/vite.config.ts. This file serves that build (mounts below +
the catch-all route at the bottom) alongside the /api/* endpoints; it does
NOT run the frontend's dev server (that's `npm run dev` in src/frontend/,
which proxies /api/* back to this server -- see vite.config.ts).

Usage: ./run_web.sh   (builds the frontend if needed, starts uvicorn on
                        https://0.0.0.0:3000)
"""
import base64
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from pydantic import BaseModel

from common import load_state, clear_state, synthesize
from recipe_engine import load_recipes, next_step, previous_step, process_question, request_recipe

BASE_DIR = Path(__file__).parent
# npm run build's output (src/frontend/vite.config.ts's outDir) -- doesn't
# exist until that's been run at least once, hence check_dir=False on the
# mounts below (a fresh checkout should still boot and serve /api/*
# instead of crashing at import time; see the catch-all route for the
# "not built yet" message a browser would actually hit).
STATIC_DIST_DIR = BASE_DIR / "static_dist"

# NOTE: no auth on this app by design (removed per user request) -- it's
# being sent to a real person to test over the public internet and a
# username/password step was unwanted friction for that. The user has
# explicitly accepted the resource-abuse risk that comes with that (anyone
# with the URL can trigger whisper/LLM/piper calls on this machine).

app = FastAPI(title="Cook-It")
# Vite's public/ passthrough (face SVGs -- see
# frontend/public/assets/README.md, favicon) and its hashed JS/CSS bundle
# (build.assetsDir: 'bundle' in vite.config.ts, kept separate from
# public/assets/ on purpose so the two don't share a directory).
app.mount("/assets", StaticFiles(directory=STATIC_DIST_DIR / "assets", check_dir=False), name="face-assets")
app.mount("/bundle", StaticFiles(directory=STATIC_DIST_DIR / "bundle", check_dir=False), name="bundle")

_whisper_model = None  # loaded once at server startup, not per-request


@app.on_event("startup")
def load_whisper_model():
    global _whisper_model
    print("Loading Whisper model (small, int8)...")
    t0 = time.time()
    _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    print(f"  Whisper ready in {time.time() - t0:.1f}s")


@app.get("/favicon.svg")
def favicon():
    return FileResponse(STATIC_DIST_DIR / "favicon.svg")


@app.get("/api/state")
def get_state():
    return load_state() or {"active": False}


@app.post("/api/reset")
def reset():
    clear_state()
    return {"ok": True}


@app.get("/api/recipes")
def list_recipes():
    """All local recipes, for the "pick one with a tap" home screen -- no
    voice/LLM needed to see what's available."""
    recipes = load_recipes()
    return [
        {"name": r["name"], "servings": r.get("servings"), "tip": r.get("tip", "")}
        for r in recipes.values()
    ]


class SelectRecipeRequest(BaseModel):
    name: str


@app.post("/api/recipes/select")
def select_recipe(body: SelectRecipeRequest):
    """Tapping a recipe card: starts that recipe directly, same result shape
    as asking for it by voice, but skips STT entirely. Since local recipes
    always have their summary/tip cached (see request_recipe), this is just
    as close to instant as "Next"/"Previous" -- no LLM call either."""
    try:
        data = request_recipe(body.name)
    except ValueError as e:
        error_text = "No he encontrado esa receta, prueba con otra."
        audio_b64, _synth_time = _synthesize_b64(error_text)
        return JSONResponse(
            {"ok": False, "reason": "recipe_not_found", "error": str(e),
             "spoken_text": error_text, "audio_base64": audio_b64, "audio_mime": "audio/wav"},
            status_code=404,
        )
    spoken_text = f"{data['summary']} Empecemos. Paso 1 de {data['total_steps']}: {data['step_text']}"
    return _respond_with_audio({"type": "new_recipe", "data": data, "spoken_text": spoken_text})


def _synthesize_b64(text):
    audio_bytes, synth_time = synthesize(text)
    return base64.b64encode(audio_bytes).decode("ascii"), synth_time


def _respond_with_audio(result):
    """Speaks a router result (dict with 'type'/'data'/'spoken_text') as
    base64 audio for the caller's own device to play, and packages it as a
    JSON response for the frontend."""
    audio_b64, synth_time = _synthesize_b64(result["spoken_text"])
    return {
        "ok": True,
        "type": result["type"],
        "data": result["data"],
        "spoken_text": result["spoken_text"],
        "audio_base64": audio_b64,
        "audio_mime": "audio/wav",
        "latency": {"tts_synth": round(synth_time, 2)},
    }


def _no_active_recipe_response(attempted):
    text = "No tengo ninguna receta activa todavía. Pídeme una receta primero."
    audio_b64, _synth_time = _synthesize_b64(text)
    return JSONResponse(
        {
            "ok": False,
            "reason": "no_active_recipe",
            "attempted": attempted,
            "spoken_text": text,
            "audio_base64": audio_b64,
            "audio_mime": "audio/wav",
        }
    )


@app.post("/api/next")
def api_next():
    """'Next ▶' button: no recording, no LLM -- just session memory."""
    data = next_step()
    if not data["ok"]:
        return _no_active_recipe_response("next")
    if data["finished"]:
        spoken_text = f"Ese era el último paso. Has terminado {data['name']}. ¡Buen provecho!"
        if data.get("tip"):
            spoken_text += f" Un último consejo: {data['tip']}"
    else:
        spoken_text = f"Paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
    return _respond_with_audio({"type": "next", "data": data, "spoken_text": spoken_text})


@app.post("/api/previous")
def api_previous():
    """'◀ Previous' button: no recording, no LLM -- just session memory."""
    data = previous_step()
    if not data["ok"]:
        return _no_active_recipe_response("previous")
    spoken_text = f"Volvemos al paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
    return _respond_with_audio({"type": "previous", "data": data, "spoken_text": spoken_text})


@app.post("/api/question")
async def api_question(audio: UploadFile):
    """Microphone button: transcribes locally with whisper and ALWAYS calls
    the LLM (new recipe, or follow-up question about the active one)."""
    t0 = time.time()
    content = await audio.read()
    suffix = Path(audio.filename or "clip.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(content)
        tmp.flush()
        segments, _info = _whisper_model.transcribe(tmp.name, language="es")
        user_text = " ".join(s.text.strip() for s in segments).strip()
    stt_time = time.time() - t0

    if not user_text:
        text = "No te he escuchado bien, inténtalo otra vez."
        audio_b64, _synth_time = _synthesize_b64(text)
        return JSONResponse(
            {
                "ok": False,
                "reason": "no_speech_detected",
                "spoken_text": text,
                "audio_base64": audio_b64,
                "audio_mime": "audio/wav",
            }
        )

    try:
        t1 = time.time()
        result = process_question(user_text)
        process_time = time.time() - t1
    except Exception as e:
        error_text = "He tenido un problema pensando la respuesta, prueba otra vez."
        audio_b64, _synth_time = _synthesize_b64(error_text)
        return JSONResponse(
            {
                "ok": False,
                "reason": "llm_error",
                "error": str(e),
                "spoken_text": error_text,
                "audio_base64": audio_b64,
                "audio_mime": "audio/wav",
            },
            status_code=500,
        )

    audio_b64, synth_time = _synthesize_b64(result["spoken_text"])

    return {
        "ok": True,
        "user_text": user_text,
        "type": result["type"],
        "data": result["data"],
        "spoken_text": result["spoken_text"],
        "audio_base64": audio_b64,
        "audio_mime": "audio/wav",
        "latency": {
            "stt": round(stt_time, 2),
            "process": round(process_time, 2),
            "tts_synth": round(synth_time, 2),
        },
    }


# --- SPA catch-all -----------------------------------------------------
# MUST be the last route registered: FastAPI/Starlette matches routes in
# registration order, so every /api/* route and the two mounts above only
# take effect at all because they were added first. This one matches
# anything else -- "/", "/cook", and any client-side route react-router
# adds later -- and always serves the same built index.html; react-router
# reads the URL client-side and renders Picker or Cook accordingly.
@app.get("/{full_path:path}")
def spa_catch_all(full_path: str):
    index_path = STATIC_DIST_DIR / "index.html"
    if not index_path.exists():
        return JSONResponse(
            {
                "error": "Frontend not built yet -- run 'npm run build' in src/frontend/ "
                         "(see src/frontend/vite.config.ts for the output path)."
            },
            status_code=503,
        )
    return FileResponse(index_path)
