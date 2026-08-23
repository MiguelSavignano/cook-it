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

Frontend: a React SPA (src/frontend/, Picker "/" + Cook "/cook" + a shared
recipe's page "/r/<uuid>", one react-router app) built by Vite into
src/static_dist/ -- see src/frontend/vite.config.ts. This file serves that
build (mounts below + the catch-all route at the bottom) alongside the
/api/* endpoints; it does
NOT run the frontend's dev server (that's `npm run dev` in src/frontend/,
which proxies /api/* back to this server -- see vite.config.ts).

Usage: ./run_web.sh   (builds the frontend if needed, starts uvicorn on
                        https://0.0.0.0:3000)
"""
import base64
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from pydantic import BaseModel

import drive
import pantry
import recipe_store
import settings
from common import load_state, clear_state, synthesize
from recipe_engine import (
    load_recipes, next_step, previous_step, process_question, start_recipe_by_uuid,
)

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
    voice/LLM needed to see what's available. Each one carries its uuid: the
    frontend needs it both to start the recipe and to build its share link
    (/r/<uuid>, see recipe_store.py)."""
    recipes = load_recipes()
    return [
        {"uuid": r["uuid"], "name": r["name"], "servings": r.get("servings"), "tip": r.get("tip", "")}
        for r in recipes.values()
    ]


@app.get("/api/recipes/seed")
def recipe_seed():
    """The factory recipes that ship with the project, for a browser whose
    library is empty. Declared before /api/recipes/{uuid} on purpose --
    FastAPI matches routes in order and would otherwise read "seed" as a
    uuid."""
    return [recipe_store.public_recipe(r) for r in recipe_store.load_curated().values()]


class LibraryUpload(BaseModel):
    recipes: list[dict]


@app.post("/api/library")
def save_library(body: LibraryUpload):
    """The browser mirroring its library here.

    The browser owns the recipes (see recipe_store's docstring); this copy
    exists so the server can do the two things a browser can't: match free
    speech against your recipes, and resolve a /r/<uuid> link for someone
    else's device. It replaces the mirror wholesale, so a recipe you deleted
    in the browser stops being cookable here too."""
    return {"ok": True, "stored": recipe_store.save_library(body.recipes)}


@app.get("/api/recipes/{recipe_uuid}")
def get_recipe(recipe_uuid: str):
    """The recipe behind a shared link: everything needed to render it
    WITHOUT starting to cook it (someone opening a link you sent should see
    the dish first and decide, not find themselves on step 1).

    Returns 404 for a uuid this install doesn't know -- links are only valid
    on the machine that minted them, there is no central registry."""
    recipe = recipe_store.find(recipe_uuid)
    if recipe is None:
        return JSONResponse(
            {"ok": False, "reason": "recipe_not_found",
             "error": "No conozco esa receta."},
            status_code=404,
        )
    return {"ok": True, "recipe": recipe_store.public_recipe(recipe)}


@app.post("/api/recipes/{recipe_uuid}/start")
def start_recipe(recipe_uuid: str):
    """Tapping a recipe card, or "empezar a cocinar" on a shared link:
    starts that exact recipe, same result shape as asking for it by voice
    but with no STT and no LLM -- a uuid needs no interpreting, and local
    recipes always have their summary/tip cached (see request_recipe). As
    close to instant as "Next"/"Previous"."""
    try:
        data = start_recipe_by_uuid(recipe_uuid)
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


# --- Pantry: "cook with what I have" -----------------------------------
# Photo -> ingredients -> ideas -> a draft the user negotiates down (see
# pantry.py for the flow). Unlike the mic path, these endpoints return NO
# audio except /confirm: the whole negotiation is tap-driven on screen
# (correct the list, tap an idea, tick what you're missing), so synthesizing
# speech for each round-trip would only add latency to something the user is
# looking at anyway. Once they confirm, /confirm hands off to the Cook page
# and speaks -- exactly like /api/recipes/{uuid}/start.

def _pantry_error(e, status=500):
    reason = str(e)
    messages = {
        "no_pantry_session": "No hay ninguna sesión de ingredientes activa. Haz una foto primero.",
        "no_draft": "Todavía no hay ninguna receta elegida.",
        # Excluding a defining ingredient (the eggs of a tortilla) has no
        # answer -- the draft is kept as-is and the user is pointed back at
        # the other ideas rather than shown an error.
        "impossible_without": "Sin ese ingrediente esta receta ya no sale. Prueba con otra idea.",
    }
    return JSONResponse(
        {"ok": False, "reason": reason, "error": messages.get(reason, reason)},
        status_code=409 if reason in messages else status,
    )


@app.get("/api/pantry/state")
def pantry_state():
    return pantry.get() or {"active": False}


@app.post("/api/pantry/reset")
def pantry_reset():
    pantry.reset()
    return {"ok": True}


@app.post("/api/pantry/photo")
async def pantry_photo(photo: UploadFile):
    """Step 1-2: the phone's picture in, a list of ingredient NAMES out.

    The list is deliberately returned for the user to review rather than fed
    straight into a recipe -- every vision model misreads a cluttered
    counter sometimes, and a wrong ingredient here would poison every step
    after it (see pantry.py's module docstring).
    """
    image_bytes = await photo.read()
    if not image_bytes:
        return JSONResponse(
            {"ok": False, "reason": "empty_photo", "error": "No he recibido ninguna foto."},
            status_code=400,
        )
    try:
        names, vision_time, backend = pantry.identify_ingredients(image_bytes)
    except Exception as e:
        return JSONResponse(
            {"ok": False, "reason": "vision_error", "error": str(e)},
            status_code=500,
        )
    state = pantry.start(names, vision_time, backend)
    return {"ok": True, "state": state, "latency": {"vision": round(vision_time, 2)}}


class PantryIngredientsRequest(BaseModel):
    ingredients: list[str]


@app.post("/api/pantry/ingredients")
def pantry_ingredients(body: PantryIngredientsRequest):
    """Step 3: the corrected ingredient list -> 2-3 recipe ideas. Setting the
    list and asking for ideas is one call because there's no useful state in
    between -- the user taps "buscar recetas" once and waits once."""
    try:
        pantry.set_ingredients(body.ingredients)
        return {"ok": True, "state": pantry.suggest()}
    except ValueError as e:
        return _pantry_error(e)
    except Exception as e:
        return JSONResponse({"ok": False, "reason": "llm_error", "error": str(e)}, status_code=500)


class PantryChooseRequest(BaseModel):
    name: str


@app.post("/api/pantry/choose")
def pantry_choose(body: PantryChooseRequest):
    """Step 4: picked an idea -> the full recipe against their ingredients,
    plus the checklist of what they haven't said they have."""
    try:
        return {"ok": True, "state": pantry.choose(body.name)}
    except ValueError as e:
        return _pantry_error(e)
    except Exception as e:
        return JSONResponse({"ok": False, "reason": "llm_error", "error": str(e)}, status_code=500)


class PantryExcludeRequest(BaseModel):
    items: list[str]


@app.post("/api/pantry/exclude")
def pantry_exclude(body: PantryExcludeRequest):
    """Step 5: "no tengo huevos" -> same dish, rebuilt without them."""
    try:
        return {"ok": True, "state": pantry.exclude(body.items)}
    except ValueError as e:
        return _pantry_error(e)
    except Exception as e:
        return JSONResponse({"ok": False, "reason": "llm_error", "error": str(e)}, status_code=500)


@app.post("/api/pantry/confirm")
def pantry_confirm():
    """Step 6 answered "yes": promotes the draft to the active cooking
    session and speaks the opening line, same shape as /api/recipes/{uuid}/start
    so the frontend can hand off to /cook with no special case."""
    try:
        data = pantry.confirm()
    except ValueError as e:
        return _pantry_error(e)
    spoken_text = (
        f"{data['summary']} Empecemos. Paso 1 de {data['total_steps']}: {data['step_text']}"
    )
    return _respond_with_audio({"type": "new_recipe", "data": data, "spoken_text": spoken_text})


# --- SPA catch-all -----------------------------------------------------
# MUST be the last route registered: FastAPI/Starlette matches routes in
# registration order, so every /api/* route and the two mounts above only
# take effect at all because they were added first. This one matches
# anything else -- "/", "/cook", "/r/<uuid>" (a shared recipe link, which
# is a real URL people paste into a browser, so it MUST return the app
# rather than a 404), and any client-side route react-router adds later --
# and always serves the same built index.html; react-router reads the URL
# client-side and renders Picker, Cook or Recipe accordingly.
# --- Google Drive -------------------------------------------------------
# Off unless settings.yml says otherwise, and every call says WHY it can't
# work rather than failing blank -- the setup has a Google Cloud step that
# no program can do on the user's behalf (see drive.py).

def _drive_guard():
    """None if Drive is usable, else the response explaining what's missing."""
    if not settings.get("drive.enabled"):
        return JSONResponse(
            {"ok": False, "reason": "disabled",
             "error": "Google Drive está desactivado (drive.enabled en settings.yml)."},
            status_code=409,
        )
    return None


def _drive_redirect_uri(request: Request):
    """Must match, character for character, a redirect URI registered in the
    Google Cloud client -- so it's derived from the URL the user actually
    reached us on, not hardcoded."""
    return str(request.url_for("drive_callback"))


@app.get("/api/drive/status")
def drive_status(request: Request):
    """What the settings UI needs to know which button to offer."""
    return {**drive.status(), "redirect_uri": _drive_redirect_uri(request)}


@app.post("/api/drive/connect")
def drive_connect(request: Request):
    """Returns the Google consent URL for the browser to visit. The token
    exchange happens in /api/drive/callback, below."""
    guard = _drive_guard()
    if guard:
        return guard
    try:
        return {"ok": True, "auth_url": drive.auth_url(_drive_redirect_uri(request))}
    except drive.DriveError as e:
        return JSONResponse({"ok": False, "reason": "not_configured", "error": str(e)}, status_code=400)


@app.get("/api/drive/callback", name="drive_callback")
def drive_callback(request: Request, code: str = "", error: str = ""):
    """Where Google sends the browser back. Returns a page rather than JSON:
    a person is looking at this tab."""
    def page(title, detail):
        return HTMLResponse(
            f"<!doctype html><meta charset=utf-8>"
            f"<title>Cook-It · Google Drive</title>"
            f"<body style='font-family:system-ui;padding:40px;max-width:32em;margin:auto'>"
            f"<h1>{title}</h1><p>{detail}</p>"
            f"<p><a href='/'>Volver a Cook-It</a></p>"
        )

    if error == "access_denied":
        # By far the most common failure for a self-hosted app: the consent
        # screen is in Testing and the account isn't on its test-user list.
        # Being the project's owner does NOT grant access by itself.
        return page(
            "Google bloqueó el acceso",
            "Tu cuenta no está en la lista de usuarios de prueba de la pantalla "
            "de consentimiento. Añádela en <b>Google Auth Platform &rarr; Público "
            "&rarr; Usuarios de prueba</b> y vuelve a intentarlo.<br><br>"
            "Ojo: en modo <i>Testing</i> el token caduca a los 7 días. Para uso "
            "diario, publica la app (el scope <code>drive.file</code> no es "
            "sensible, así que no necesita auditoría).",
        )
    if error:
        return page("No se conectó", f"Google devolvió: {error}")
    if not code:
        return page("No se conectó", "Google no devolvió ningún código.")
    try:
        drive.exchange_code(code, _drive_redirect_uri(request))
    except drive.DriveError as e:
        return page("No se conectó", str(e))
    return page("Google Drive conectado", "Ya puedes sincronizar tus recetas.")


@app.post("/api/drive/disconnect")
def drive_disconnect():
    """Forgets the token on this machine. Revoking the access itself is done
    from the Google account's own permissions page."""
    drive.disconnect()
    return {"ok": True}


@app.post("/api/drive/push")
def drive_push():
    """Local recipes -> Drive, as Markdown."""
    guard = _drive_guard()
    if guard:
        return guard
    try:
        return {"ok": True, "result": drive.push()}
    except drive.DriveError as e:
        return JSONResponse({"ok": False, "reason": "drive_error", "error": str(e)}, status_code=400)


@app.post("/api/drive/pull")
def drive_pull():
    """Drive -> local. Curated (git-tracked) recipes are reported, not
    overwritten -- see drive.pull()."""
    guard = _drive_guard()
    if guard:
        return guard
    try:
        return {"ok": True, "result": drive.pull()}
    except drive.DriveError as e:
        return JSONResponse({"ok": False, "reason": "drive_error", "error": str(e)}, status_code=400)


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
