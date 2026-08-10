"""
Shared Cook-It logic: request a recipe (LLM + RAG against local recipes) and
step through it using session memory. Used by both the CLI scripts
(assistant_poc.py, next_step.py) and the web API (api.py), so the logic isn't
duplicated in two places.

Recipe/session content (names, steps, summaries...) stays in Spanish -- that's
what gets read aloud to a Spanish-speaking user. Identifiers, comments and the
JSON schema itself are in English, as code should be.
"""
import difflib
import json
import os
import re
import time
from pathlib import Path

import requests

from common import load_state, save_state, clear_state

BASE_DIR = Path(__file__).parent
RECIPES_DIR = BASE_DIR / "recipes"
CACHE_DIR = BASE_DIR / "cache_llm"
CACHE_DIR.mkdir(exist_ok=True)
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"

# NOTE: the instructions below are written in Spanish on purpose -- they tell
# the LLM how to write Spanish output for a Spanish-speaking user, and models
# generally follow domain-language instructions best. The JSON keys the LLM
# must emit are English, matching the rest of the codebase's schema.
SYSTEM_PROMPT = """Eres Cook-It, un asistente de cocina que habla por voz mientras el usuario \
cocina con las manos ocupadas. Responde SIEMPRE en español y ÚNICAMENTE con un objeto JSON \
válido (nada de texto antes ni después, nada de markdown), con exactamente estas claves:

{
  "summary": "un único párrafo breve y fluido, al estilo de un buen libro de cocina, que \
resuma EL PLATO QUE TE HAN PEDIDO A TI combinando su técnica e ingredientes clave -- NO una \
lista, una narración corta. A continuación tienes un ejemplo de TONO Y ESTRUCTURA para un plato \
cualquiera (una receta de castañas glaseadas) -- es solo para que veas cómo de largo y cómo de \
fluido debe sonar, NO copies estas palabras ni estos ingredientes, escribe sobre el plato real \
que se te pide: 'Cuece las castañas en agua hasta que estén tiernas, escúrrelas y glaséalas a \
fuego lento con el azúcar moreno, la miel, el ron y la vainilla hasta obtener una salsa espesa, \
incorporando la canela al final si se desea.'",
  "ingredients": [{"item": "...", "amount": "...", "unit": "..."}],
  "steps": ["paso 1, imperativo y claro, uno por elemento de la lista", "paso 2", "..."],
  "tip": "un truco o consejo especial de cocina relacionado con esta receta, algo útil y no obvio"
}

Si el mensaje del usuario incluye una sección "RECETA LOCAL" con ingredientes y pasos ya \
definidos: esa es la fuente autorizada y el programa que te llama la va a usar directamente, \
así que en "ingredients" y "steps" devuelve listas VACÍAS ([]) -- no las repitas, no hace \
falta, céntrate solo en escribir bien el "summary" y el "tip".

Si NO hay ninguna "RECETA LOCAL" para lo que pide el usuario, genera tú los ingredientes y \
pasos completos con tu propio conocimiento de cocina, sin dejar ninguno fuera."""

SYSTEM_PROMPT_QUESTION = """Eres Cook-It, un asistente de cocina que habla por voz mientras el \
usuario cocina con las manos ocupadas. Te está haciendo una pregunta puntual sobre la receta \
que tiene activa ahora mismo (te paso su nombre y en qué paso va). Responde en español, en 1-3 \
frases breves y naturales, sin markdown, listas para ser leídas en voz alta. Ve directo al \
grano, no repitas la receta entera ni la lista de pasos, solo contesta la pregunta."""


def load_recipes():
    recipes = {}
    for f in sorted(RECIPES_DIR.glob("*.json")):
        r = json.loads(f.read_text())
        recipes[r["name"]] = r
    return recipes


# Common filler words that shouldn't count when matching a recipe name against
# free-form speech (e.g. "dame la receta de ragú de ternera" vs "Ragú de
# ternera tradicional" should still match on "ragú"/"ternera").
_STOPWORDS = {
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "con",
    "para", "del", "al", "que", "como", "se", "dame", "hazme", "quiero",
    "hacer", "receta", "recetas", "cómo", "como", "se hace", "haces",
}


def find_local_recipe(user_text, recipes):
    """Matches free-form speech against a local recipe name. Exact substring
    containment wins outright; otherwise falls back to word overlap (not raw
    string similarity -- comparing whole sentences character-by-character with
    difflib is unreliable and can match completely unrelated recipes)."""
    text_l = user_text.lower()
    text_words = set(re.findall(r"\w+", text_l))

    for name, recipe in recipes.items():
        if name.lower() in text_l:
            return recipe

    best_recipe, best_score = None, 0.0
    for name, recipe in recipes.items():
        name_words = set(re.findall(r"\w+", name.lower())) - _STOPWORDS
        if not name_words:
            continue
        overlap = len(name_words & text_words) / len(name_words)
        if overlap > best_score:
            best_recipe, best_score = recipe, overlap

    return best_recipe if best_score >= 0.6 else None


def format_local_recipe(recipe):
    ingredients_txt = "\n".join(
        f"- {ing['item']}: {ing.get('amount') or ''} {ing.get('unit') or ''}".strip()
        for ing in recipe["ingredients"]
    )
    steps_txt = "\n".join(f"{i+1}. {s}" for i, s in enumerate(recipe["steps"]))
    return f"""RECETA LOCAL: {recipe['name']} ({recipe.get('servings', '')})

Ingredientes:
{ingredients_txt}

Pasos:
{steps_txt}"""


def build_messages(user_text, local_recipe):
    if local_recipe:
        context = format_local_recipe(local_recipe) + f"\n\nEl usuario ha dicho:\n\"{user_text}\""
    else:
        context = f"El usuario ha dicho:\n\"{user_text}\""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": context},
    ]


def _slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _read_general_cache(user_text):
    """Disk cache for recipes WITHOUT a local match (general LLM knowledge):
    if something similar was asked before, no need to call the LLM again."""
    keys = [f.stem for f in CACHE_DIR.glob("*.json")]
    slug = _slugify(user_text)
    if slug in keys:
        return json.loads((CACHE_DIR / f"{slug}.json").read_text())
    match = difflib.get_close_matches(slug, keys, n=1, cutoff=0.6)
    if match:
        return json.loads((CACHE_DIR / f"{match[0]}.json").read_text())
    return None


def _save_general_cache(user_text, llm_recipe):
    slug = _slugify(user_text) or "recipe"
    (CACHE_DIR / f"{slug}.json").write_text(
        json.dumps(llm_recipe, ensure_ascii=False, indent=2)
    )


def ask_llm_json(messages):
    t0 = time.time()
    r = requests.post(
        OLLAMA_CHAT_URL,
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "format": "json",
        },
        timeout=180,
    )
    r.raise_for_status()
    content = r.json()["message"]["content"].strip()
    dt = time.time() - t0
    try:
        recipe = json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            raise
        recipe = json.loads(m.group(0))
    return recipe, dt


def request_recipe(user_text):
    """Main entry point: processes a recipe request by voice/text and saves the
    session state. Only calls the LLM when it's actually needed:

    1. Local recipe WITH summary/tip already cached in its JSON -> 0 LLM calls.
    2. Recipe that isn't local but was already asked before (cache in
       cache_llm/) -> 0 LLM calls.
    3. Anything else -> the LLM is called (and if not local, the result is
       cached for next time).

    This is what makes "next step"/known recipes answer almost instantly
    instead of waiting ~15-60s of generation every time -- see docs/spec.md.
    """
    recipes = load_recipes()
    local_recipe = find_local_recipe(user_text, recipes)
    llm_time = 0.0
    generated = None  # whatever the LLM or the general cache returns, if any

    if local_recipe and local_recipe.get("summary") and local_recipe.get("tip"):
        summary = local_recipe["summary"]
        tip = local_recipe["tip"]
    else:
        generated = None if local_recipe else _read_general_cache(user_text)
        if generated is None:
            messages = build_messages(user_text, local_recipe)
            generated, llm_time = ask_llm_json(messages)
            if not local_recipe:
                # Ingredients/steps generated by the LLM (no local match) are
                # cached too, so next time it's instant.
                _save_general_cache(user_text, generated)
        summary = generated.get("summary", "").strip()
        tip = generated.get("tip", "").strip()

    # Source of truth for ingredients/steps: if there's a local recipe, use it
    # AS-IS (deterministic); otherwise use the general cache or whatever the
    # LLM just generated -- the LLM's "copy" of a local recipe is never
    # trusted, see docs/feasibility.md.
    if local_recipe:
        steps = local_recipe["steps"]
        ingredients = local_recipe["ingredients"]
        verified_source = True
        name = local_recipe["name"]
        servings = local_recipe.get("servings")
    else:
        steps = generated.get("steps", [])
        ingredients = generated.get("ingredients", [])
        verified_source = False
        name = user_text
        servings = None

    if not steps:
        raise ValueError(f"Could not get steps for: {user_text!r}")

    state = {
        "name": name,
        "servings": servings,
        "summary": summary,
        "ingredients": ingredients,
        "steps": steps,
        "tip": tip,
        "verified_source": verified_source,
        "current_step": 0,  # 0-based; 0 = first step already shown/spoken
    }
    save_state(state)

    return {
        **state,
        "total_steps": len(steps),
        "step_text": steps[0],
        "llm_time": llm_time,
    }


def next_step():
    """Advances the step pointer of the active recipe. Never calls the LLM:
    this is the logic behind the "next step" button, near-instant."""
    state = load_state()
    if state is None:
        return {"ok": False, "reason": "no_active_recipe"}

    steps = state["steps"]
    current = state["current_step"]

    if current + 1 >= len(steps):
        result = {
            "ok": True,
            "finished": True,
            "name": state["name"],
            "tip": state.get("tip", ""),
        }
        clear_state()
        return result

    state["current_step"] = current + 1
    save_state(state)

    return {
        "ok": True,
        "finished": False,
        "current_step": state["current_step"],
        "total_steps": len(steps),
        "step_text": steps[state["current_step"]],
        "name": state["name"],
    }


def previous_step():
    state = load_state()
    if state is None:
        return {"ok": False, "reason": "no_active_recipe"}
    state["current_step"] = max(0, state["current_step"] - 1)
    save_state(state)
    return {
        "ok": True,
        "finished": False,
        "current_step": state["current_step"],
        "total_steps": len(state["steps"]),
        "step_text": state["steps"][state["current_step"]],
        "name": state["name"],
    }


def repeat_step():
    state = load_state()
    if state is None:
        return {"ok": False, "reason": "no_active_recipe"}
    return {
        "ok": True,
        "finished": False,
        "current_step": state["current_step"],
        "total_steps": len(state["steps"]),
        "step_text": state["steps"][state["current_step"]],
        "name": state["name"],
    }


# Keywords for control commands -- these NEVER go through the LLM, per the
# architecture in docs/spec.md (§4): the LLM only narrates/answers open
# questions, it never decides step navigation.
_NEXT_WORDS = ("siguiente", "sigue", "continúa", "continua", "vale sigue", "adelante")
_REPEAT_WORDS = ("repite", "otra vez", "qué has dicho", "que has dicho", "no te he oído", "no te he oido")
_PREVIOUS_WORDS = ("anterior", "vuelve atrás", "vuelve atras", "paso de atrás", "paso de atras", "retrocede")


def process_command(user_text):
    """Deterministic intent router (used by the CLI): decides whether it's a
    control command (next/repeat/previous -> no LLM, session memory) or a new
    recipe request (-> LLM). Returns a dict with 'type', 'data' and 'spoken_text'."""
    text_l = user_text.lower()

    if any(w in text_l for w in _NEXT_WORDS):
        data = next_step()
        if not data["ok"]:
            return _no_active_recipe("next")
        if data["finished"]:
            spoken_text = f"Ese era el último paso. Has terminado {data['name']}. ¡Buen provecho!"
            if data.get("tip"):
                spoken_text += f" Un último consejo: {data['tip']}"
        else:
            spoken_text = f"Paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
        return {"type": "next", "data": data, "spoken_text": spoken_text}

    if any(w in text_l for w in _REPEAT_WORDS):
        data = repeat_step()
        if not data["ok"]:
            return _no_active_recipe("repeat")
        spoken_text = f"Repito. Paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
        return {"type": "repeat", "data": data, "spoken_text": spoken_text}

    if any(w in text_l for w in _PREVIOUS_WORDS):
        data = previous_step()
        if not data["ok"]:
            return _no_active_recipe("previous")
        spoken_text = f"Volvemos al paso {data['current_step'] + 1} de {data['total_steps']}: {data['step_text']}"
        return {"type": "previous", "data": data, "spoken_text": spoken_text}

    # Not a control command -> treated as a new recipe request (goes to the LLM).
    data = request_recipe(user_text)
    spoken_text = f"{data['summary']} Empecemos. Paso 1 de {data['total_steps']}: {data['step_text']}"
    return {"type": "new_recipe", "data": data, "spoken_text": spoken_text}


def _no_active_recipe(attempted):
    return {
        "type": "error",
        "data": {"ok": False, "reason": "no_active_recipe", "attempted": attempted},
        "spoken_text": "No tengo ninguna receta activa todavía. Pídeme una receta primero.",
    }


def process_question(user_text):
    """For the web app's microphone button: "next"/"previous" are already
    separate buttons (no voice, no LLM), so anything that reaches here is
    either a new recipe or a follow-up question about the active recipe -- in
    both cases the LLM is ALWAYS called (there's no deterministic shortcut,
    because by definition this is open-ended language).

    If the text mentions a local recipe, or there's no active session yet, it
    is treated as a recipe request (request_recipe, may reset the current
    step). If a recipe is already active and a new one isn't being requested,
    the question is answered using the current step as context WITHOUT
    touching the state (asking something doesn't lose your progress)."""
    recipes = load_recipes()
    local_recipe = find_local_recipe(user_text, recipes)
    state = load_state()

    if local_recipe or state is None:
        data = request_recipe(user_text)
        spoken_text = f"{data['summary']} Empecemos. Paso 1 de {data['total_steps']}: {data['step_text']}"
        return {"type": "new_recipe", "data": data, "spoken_text": spoken_text}

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_QUESTION},
        {
            "role": "user",
            "content": (
                f"Receta activa: {state['name']}. Va por el paso "
                f"{state['current_step'] + 1} de {len(state['steps'])}: "
                f"\"{state['steps'][state['current_step']]}\".\n\n"
                f"Pregunta del usuario: \"{user_text}\""
            ),
        },
    ]
    t0 = time.time()
    r = requests.post(
        OLLAMA_CHAT_URL,
        json={"model": OLLAMA_MODEL, "messages": messages, "stream": False},
        timeout=120,
    )
    r.raise_for_status()
    answer = r.json()["message"]["content"].strip()
    llm_time = time.time() - t0

    return {
        "type": "question",
        "data": {"answer": answer, "llm_time": llm_time, "name": state["name"]},
        "spoken_text": answer,
    }
