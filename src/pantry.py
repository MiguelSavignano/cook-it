"""
"Cook with what I have": photo -> ingredients -> recipe ideas -> a draft the
user negotiates down to something they can actually cook tonight.

The flow (docs/spec.md's picker page, "📷 Con lo que tengo"):

  1. The phone takes a picture.
  2. VISION identifies the ingredients in it -> a plain list of NAMES.
  3. Those names (not the image) go to the text LLM, which proposes 2-3
     recipe ideas and, for each, what ELSE would be needed.
  4. Picking one builds the full recipe against the user's ingredients.
  5. "no tengo huevos" re-renders that draft without eggs.
  6. Repeat 5 until the user confirms they have everything; then the draft
     becomes a normal cooking session (common.save_state) and the existing
     Cook page takes over.

Why the split at step 3: the image only ever touches ONE call. Everything
after it reasons over ~10 words, which the small local models handle fine,
and it means the detected list can be shown and CORRECTED in the UI before
a mistake propagates into the recipe. Vision is the step where models differ
most, so it's the one with a swappable backend (see VISION_BACKEND).

Spanish for anything the user hears, English for identifiers/schema -- same
split as recipe_engine.py.
"""
import base64
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests

import recipe_store
from common import load_pantry, save_pantry, clear_pantry

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"

# Text model for steps 3-6. Short reasoning over a name list -- the same
# model recipe_engine.py uses for generation is plenty.
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3")

# --- Vision backend ----------------------------------------------------
# "ollama"    -> OLLAMA_VISION_MODEL (a multimodal Ollama model), prompted
#                in Spanish for JSON directly. gemma3's default tag is the
#                4b, which is multimodal -- but it needs ~4 GB resident,
#                which does NOT fit a Pi 5 alongside STT/TTS/the text model
#                (see docs/feasibility.md §11).
# "moondream" -> the same Ollama transport, but prompted in ENGLISH for a
#                plain comma-separated list, then translated. moondream is
#                a 1.8B English-tuned VQA model: asked in Spanish for JSON
#                it just parrots the prompt, asked in English in its own
#                idiom it actually looks at the picture. 1.2 GB resident,
#                so it's the only local option that fits the Pi budget.
# "claude"    -> shells out to the Claude Code CLI (`claude -p`). Best
#                accuracy by a distance, but needs the network, so it is
#                not the default: the kitchen keeps working when the router
#                reboots.
VISION_BACKEND = os.environ.get("COOKIT_VISION_BACKEND", "ollama")
OLLAMA_VISION_MODEL = os.environ.get("COOKIT_VISION_MODEL", "gemma3")
MOONDREAM_MODEL = os.environ.get("COOKIT_MOONDREAM_MODEL", "moondream")
CLAUDE_VISION_MODEL = os.environ.get("COOKIT_CLAUDE_MODEL", "sonnet")

# Vision cold-start is brutal on CPU -- measured ~180s to load moondream vs
# ~0.4s per call once resident. Whatever the flow costs, it should not be
# paying that on every photo, so the vision model is asked to stay loaded.
VISION_KEEP_ALIVE = os.environ.get("COOKIT_VISION_KEEP_ALIVE", "30m")

MAX_SUGGESTIONS = 3


# --- Prompts -----------------------------------------------------------
# Spanish on purpose (same reasoning as recipe_engine.SYSTEM_PROMPT): the
# output is read aloud to a Spanish speaker, and models follow
# domain-language instructions best. JSON keys stay English.

# NOTE: the schema example below uses PLACEHOLDERS, not real ingredient
# names, and says so in the prompt itself. An earlier version showed
# `["huevos", "tomate", "cebolla"]` and both gemma3 and moondream copied
# those three back verbatim for images containing none of them -- the same
# verbatim-copying failure docs/feasibility.md §11.2 hit with llama3.2:3b
# and fixed the same way in §11.3. It reads as confident hallucination,
# which is far worse here than a short list: a wrong ingredient propagates
# into the recipe and every step after it.
VISION_PROMPT = """Mira esta foto de ingredientes de cocina y dime QUÉ INGREDIENTES ves.

Responde ÚNICAMENTE con un objeto JSON válido (nada de texto antes ni después, nada de \
markdown), con exactamente esta clave:

{"ingredients": ["<nombre de un ingrediente que veas>", "<otro que veas>"]}

Lo que hay entre <> es solo un HUECO para que veas el formato, NO son respuestas: no los \
copies. Escribe únicamente los ingredientes que aparecen de verdad en ESTA foto.

Reglas:
- Nombres de ingrediente en español, en singular o plural natural, en minúsculas.
- SOLO lo que veas con seguridad. Si dudas de algo, NO lo pongas: es mucho peor \
inventar un ingrediente que se te escape uno.
- Nada de cantidades, marcas ni descripciones: solo el nombre del ingrediente.
- Ignora lo que no sea comida (platos, cubiertos, trapos, muebles).
- Si no ves ningún ingrediente, devuelve la lista vacía: {"ingredients": []}"""

SUGGEST_PROMPT = """Eres Cook-It, un asistente de cocina. El usuario te dice qué ingredientes \
tiene en casa y tú le propones qué puede cocinar.

Responde ÚNICAMENTE con un objeto JSON válido (nada de texto antes ni después, nada de \
markdown), con exactamente esta clave:

{
  "suggestions": [
    {
      "name": "nombre del plato, corto y reconocible",
      "why": "una sola frase breve diciendo por qué encaja con lo que tiene",
      "missing": ["ingrediente que le falta", "otro que le falta"]
    }
  ]
}

Reglas:
- Propón exactamente 3 platos, del más al menos aprovechable con lo que ya tiene.
- "missing" son los ingredientes IMPORTANTES que el plato necesita y que NO están en su \
lista. Da por hecho que tiene sal, pimienta, agua y aceite: nunca los pongas en "missing".
- Prioriza platos que usen MUCHOS de sus ingredientes y necesiten POCOS que le falten.
- Platos reales y caseros, nada de invenciones raras."""

DRAFT_PROMPT = """Eres Cook-It, un asistente de cocina que habla por voz mientras el usuario \
cocina con las manos ocupadas. Escribe la receta completa del plato que te piden, adaptada a \
los ingredientes que el usuario tiene.

Responde ÚNICAMENTE con un objeto JSON válido (nada de texto antes ni después, nada de \
markdown), con exactamente estas claves:

{
  "name": "nombre del plato",
  "servings": "para cuántas personas o cuántas unidades salen",
  "summary": "un único párrafo breve y fluido, al estilo de un buen libro de cocina, que \
resuma el plato combinando su técnica e ingredientes clave -- NO una lista, una narración corta",
  "ingredients": [{"item": "...", "amount": "...", "unit": "..."}],
  "steps": ["paso 1, imperativo y claro, uno por elemento de la lista", "paso 2", "..."],
  "tip": "un truco de cocina útil y no obvio relacionado con esta receta"
}

Reglas:
- Apóyate todo lo que puedas en los ingredientes que el usuario YA TIENE.
- Si la receta necesita algo que él no ha mencionado, inclúyelo igualmente en "ingredients": \
el programa ya le va a preguntar si lo tiene.
- Si te dicen que NO tiene algún ingrediente, NO lo uses: ni en "ingredients" ni en "steps". \
Sustitúyelo por algo equivalente o replantea la receta para que funcione sin él, y no lo \
menciones en ninguna parte.
- Pasos completos, sin saltarte ninguno."""


# --- Small helpers -----------------------------------------------------

def _parse_json(content):
    """Ollama's format:"json" and Claude both *usually* return bare JSON, but
    neither guarantees it -- same tolerant parse recipe_engine.ask_llm_json
    uses, kept here so the pantry path doesn't depend on its internals."""
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            raise
        return json.loads(m.group(0))


def _ask_ollama_text(messages, model, images=None, timeout=300, keep_alive=None):
    """Plain (unconstrained) Ollama chat -> the raw reply string. For models
    that answer better in their own idiom than under a JSON grammar."""
    message = dict(messages[-1])
    if images:
        message["images"] = images
    payload = {
        "model": model,
        "messages": [*messages[:-1], message],
        "stream": False,
    }
    if keep_alive:
        payload["keep_alive"] = keep_alive
    t0 = time.time()
    r = requests.post(OLLAMA_CHAT_URL, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()["message"]["content"].strip(), time.time() - t0


def _ask_ollama_json(messages, model, images=None, timeout=180, require=None):
    """Ollama chat -> parsed JSON dict, with a fallback that matters.

    Ollama's format:"json" constrains decoding to valid JSON, which is
    usually what you want -- but on the bigger schemas here gemma3 satisfies
    that constraint the lazy way and returns a bare `{}` after two tokens.
    It is not reliably reproducible (the same prompt succeeds sometimes),
    so it can't be prompt-engineered away.

    Hence: ask in JSON mode, and if the answer comes back without the key
    the caller needs, ask again UNCONSTRAINED. Free-running, the model
    writes the full object happily -- usually inside a ```json fence, which
    _parse_json already strips. Costs one wasted fast call in the rare bad
    case and nothing at all in the common one.
    """
    message = dict(messages[-1])
    if images:
        # Ollama takes images on the message as bare base64 (no data: prefix).
        message["images"] = images
    payload = {
        "model": model,
        "messages": [*messages[:-1], message],
        "stream": False,
        "format": "json",
    }

    t0 = time.time()
    r = requests.post(OLLAMA_CHAT_URL, json=payload, timeout=timeout)
    r.raise_for_status()
    data = _parse_json(r.json()["message"]["content"])

    if require and not data.get(require):
        print(f"[pantry] json mode returned no {require!r}; retrying unconstrained")
        payload.pop("format")
        r = requests.post(OLLAMA_CHAT_URL, json=payload, timeout=timeout)
        r.raise_for_status()
        data = _parse_json(r.json()["message"]["content"])

    return data, time.time() - t0


def _clean_names(raw):
    """Normalizes whatever the model called an ingredient list into unique,
    lowercase, non-empty names. Models occasionally return [{"item": ...}]
    despite being asked for plain strings, so both shapes are accepted."""
    names = []
    for entry in raw or []:
        if isinstance(entry, dict):
            entry = entry.get("item") or entry.get("name") or ""
        name = str(entry).strip().lower()
        if name and name not in names:
            names.append(name)
    return names


# --- Step 2: vision ----------------------------------------------------

def _identify_with_ollama(image_bytes):
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data, dt = _ask_ollama_json(
        [{"role": "user", "content": VISION_PROMPT}],
        model=OLLAMA_VISION_MODEL,
        images=[b64],
        require="ingredients",
    )
    return _clean_names(data.get("ingredients")), dt


# Deliberately English, deliberately not JSON, deliberately no example
# list. moondream is a small English-tuned VQA model: asked in Spanish for
# a JSON schema it copies whatever tokens the prompt showed it and never
# looks at the picture. Asked this way it answers from the image.
MOONDREAM_PROMPT = (
    "List only the food ingredients you can see. Answer with a comma-separated "
    "list of ingredient names, nothing else. If there is no food, answer: none"
)

# Translating the English names back to Spanish is a separate, tiny call on
# the text model. Kept separate from recognition so a bad translation can
# never silently change WHICH ingredients were detected -- and so the
# recognition step stays swappable without touching the Spanish side.
TRANSLATE_PROMPT = """Traduce al español estos nombres de ingredientes de cocina.

Responde ÚNICAMENTE con un objeto JSON válido (nada de texto antes ni después, nada de \
markdown) con una única clave "ingredients", cuyo valor sea la lista de nombres traducidos.

Reglas:
- Un nombre traducido por cada nombre que te den, en el MISMO orden y la misma cantidad.
- Solo el nombre del ingrediente en español, en minúsculas, sin cantidades ni artículos.
- Si un nombre ya está en español, o no sabes traducirlo, déjalo tal cual."""


def _translate_ingredients(names):
    """English ingredient names -> Spanish, for display in the UI.

    Falls back to the original names on any failure: showing "eggs" instead
    of "huevos" is a cosmetic problem, losing the detection is not.
    """
    if not names:
        return names
    try:
        data, _dt = _ask_ollama_json(
            [
                {"role": "system", "content": TRANSLATE_PROMPT},
                {"role": "user", "content": ", ".join(names)},
            ],
            model=OLLAMA_MODEL,
            require="ingredients",
        )
        translated = _clean_names(data.get("ingredients"))
        # Only trust a 1:1 translation. A model that drops or invents
        # entries has misunderstood the task, and a mismatched list would
        # silently rename ingredients the user never had.
        return translated if len(translated) == len(names) else names
    except Exception as e:
        print(f"[pantry] translation failed, keeping English names: {e}")
        return names


def _identify_with_moondream(image_bytes):
    b64 = base64.b64encode(image_bytes).decode("ascii")
    reply, dt = _ask_ollama_text(
        [{"role": "user", "content": MOONDREAM_PROMPT}],
        model=MOONDREAM_MODEL,
        images=[b64],
        keep_alive=VISION_KEEP_ALIVE,
    )
    if reply.strip().lower().startswith("none"):
        return [], dt
    names = _clean_names(reply.replace("\n", ",").split(","))
    return _translate_ingredients(names), dt


def _identify_with_claude(image_bytes):
    """Shells out to the Claude Code CLI. The image goes to a temp file and
    the prompt points at it, because `claude -p` reads images through its
    Read tool rather than stdin -- hence --allowed-tools Read, which is also
    the whole toolset it gets (no Bash, no Edit: this is untrusted-ish input
    from a camera and it has no business touching anything else)."""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(image_bytes)
        image_path = tmp.name
    try:
        t0 = time.time()
        proc = subprocess.run(
            [
                "claude", "-p", f"{VISION_PROMPT}\n\nLa foto está en: {image_path}",
                "--output-format", "json",
                "--model", CLAUDE_VISION_MODEL,
                "--allowed-tools", "Read",
                "--no-session-persistence",
            ],
            capture_output=True, text=True, timeout=180,
        )
        dt = time.time() - t0
        if proc.returncode != 0:
            raise RuntimeError(f"claude -p failed ({proc.returncode}): {proc.stderr.strip()[:300]}")
        # --output-format json wraps the reply in a metadata envelope; the
        # model's actual text is .result, and it is NOT schema-enforced --
        # so it still goes through the tolerant parse.
        result = json.loads(proc.stdout)["result"]
        return _clean_names(_parse_json(result).get("ingredients")), dt
    finally:
        Path(image_path).unlink(missing_ok=True)


_VISION_BACKENDS = {
    "ollama": _identify_with_ollama,
    "moondream": _identify_with_moondream,
    "claude": _identify_with_claude,
}


def identify_ingredients(image_bytes):
    """Photo -> ingredient names. Returns (names, seconds, backend_used).

    A failing backend falls back to plain ollama rather than killing the
    flow: a worse ingredient list the user can edit beats an error screen
    when someone is standing in the kitchen holding a phone. (Nothing to
    fall back to when ollama IS the backend -- that one propagates.)
    """
    backend = VISION_BACKEND if VISION_BACKEND in _VISION_BACKENDS else "ollama"
    if backend != "ollama":
        try:
            names, dt = _VISION_BACKENDS[backend](image_bytes)
            return names, dt, backend
        except Exception as e:  # network down, model not pulled, CLI missing...
            print(f"[pantry] {backend} vision failed, falling back to ollama: {e}")
    names, dt = _identify_with_ollama(image_bytes)
    return names, dt, "ollama"


# --- Steps 3-6: text ---------------------------------------------------

def _ingredients_line(names):
    return ", ".join(names) if names else "(ninguno)"


def suggest_recipes(ingredients, excluded=()):
    """Ingredient names -> 2-3 ideas, each with what else it would need."""
    context = f"El usuario tiene estos ingredientes: {_ingredients_line(ingredients)}."
    if excluded:
        context += f"\nNO tiene, y no puedes usar: {_ingredients_line(list(excluded))}."
    data, dt = _ask_ollama_json(
        [
            {"role": "system", "content": SUGGEST_PROMPT},
            {"role": "user", "content": context},
        ],
        model=OLLAMA_MODEL,
        require="suggestions",
    )
    suggestions = []
    for s in (data.get("suggestions") or [])[:MAX_SUGGESTIONS]:
        if not isinstance(s, dict) or not s.get("name"):
            continue
        suggestions.append({
            "name": str(s["name"]).strip(),
            "why": str(s.get("why", "")).strip(),
            "missing": _clean_names(s.get("missing")),
        })
    return suggestions, dt


def build_draft(recipe_name, ingredients, excluded=()):
    """Chosen idea -> full recipe, written against what the user has.

    Also returns the checklist of ingredients the user never said they had,
    which is what step 6 walks through. That list is computed HERE rather
    than trusted from the model's own "missing": the recipe's ingredient
    list is the authoritative one, and a model that forgets to repeat an
    item under "missing" shouldn't silently drop it from the checklist.
    """
    context = (
        f"Plato: {recipe_name}.\n"
        f"Ingredientes que el usuario tiene: {_ingredients_line(ingredients)}."
    )
    if excluded:
        context += f"\nEl usuario NO tiene, y no puedes usarlos: {_ingredients_line(list(excluded))}."
    data, dt = _ask_ollama_json(
        [
            {"role": "system", "content": DRAFT_PROMPT},
            {"role": "user", "content": context},
        ],
        model=OLLAMA_MODEL,
        require="steps",
    )

    steps = data.get("steps") or []
    if not steps:
        raise ValueError(f"Could not get steps for: {recipe_name!r}")

    draft = {
        "name": str(data.get("name") or recipe_name).strip(),
        "servings": data.get("servings"),
        "summary": str(data.get("summary", "")).strip(),
        "ingredients": data.get("ingredients") or [],
        "steps": steps,
        "tip": str(data.get("tip", "")).strip(),
    }
    draft["missing"] = _checklist(draft["ingredients"], ingredients)
    return draft, dt


# Assumed to be in every kitchen -- asking "¿tienes agua?" is noise, and
# the suggest prompt is told the same thing. Matched as substrings, not
# exact names: the LLM writes "Aceite de Oliva Virgen Extra", not "aceite".
_PANTRY_STAPLES = ("sal", "pimienta", "agua", "aceite")


def _checklist(recipe_ingredients, have):
    """Which of the recipe's ingredients the user hasn't already told us
    about. Substring matching both ways, because the photo gives "tomate"
    and the recipe asks for "tomates maduros"."""
    have_l = [h.lower() for h in have]
    missing = []
    for ing in recipe_ingredients:
        item = (ing.get("item") if isinstance(ing, dict) else str(ing)) or ""
        item = item.strip()
        if not item:
            continue
        item_l = item.lower()
        if any(staple in item_l for staple in _PANTRY_STAPLES):
            continue
        if any(h in item_l or item_l in h for h in have_l):
            continue
        if item not in missing:
            missing.append(item)
    return missing


# --- Session ------------------------------------------------------------
# Kept in its own state file, separate from the cooking session: this is a
# recipe being NEGOTIATED, not one being cooked. Only confirm() promotes a
# draft into common.save_state, which is what /api/state and the Cook page
# read -- so an abandoned pantry session can never look like an active recipe.

def start(ingredients, vision_time=0.0, backend=None):
    state = {
        "phase": "ingredients",
        "ingredients": ingredients,
        "excluded": [],
        "suggestions": [],
        "draft": None,
        "vision_time": round(vision_time, 2),
        "vision_backend": backend,
    }
    save_pantry(state)
    return state


def get():
    return load_pantry()


def reset():
    clear_pantry()


def _require():
    state = load_pantry()
    if state is None:
        raise ValueError("no_pantry_session")
    return state


def set_ingredients(ingredients):
    """The user corrected the detected list (steps 2->3). Any previous
    suggestions/draft are stale the moment the inputs change."""
    state = _require()
    state["ingredients"] = _clean_names(ingredients)
    state["suggestions"] = []
    state["draft"] = None
    state["phase"] = "ingredients"
    save_pantry(state)
    return state


def suggest():
    state = _require()
    suggestions, dt = suggest_recipes(state["ingredients"], state["excluded"])
    state["suggestions"] = suggestions
    state["phase"] = "suggestions"
    state["llm_time"] = round(dt, 2)
    save_pantry(state)
    return state


def choose(recipe_name):
    state = _require()
    draft, dt = build_draft(recipe_name, state["ingredients"], state["excluded"])
    state["draft"] = draft
    state["phase"] = "draft"
    state["llm_time"] = round(dt, 2)
    save_pantry(state)
    return state


def exclude(missing_items):
    """Step 5: "no tengo huevos". Adds to the exclusion set and rebuilds the
    draft without them, keeping the same dish. Rebuilds rather than patches
    because dropping an ingredient usually invalidates several steps, not
    just the line that named it.

    Excluding a DEFINING ingredient (eggs from a tortilla) legitimately has
    no answer -- the model comes back with no steps because there is no such
    dish. That's a normal outcome of the negotiation, not a crash: the
    previous draft is left untouched and "impossible_without" tells the
    caller to offer other ideas instead. Nothing is committed until the
    rebuild succeeds, so a failed exclusion can't strand the session with an
    exclusion applied and no recipe to show for it.
    """
    state = _require()
    if state.get("draft") is None:
        raise ValueError("no_draft")

    excluded = list(state["excluded"])
    for item in _clean_names(missing_items):
        if item not in excluded:
            excluded.append(item)
    # Anything excluded can't also be something they have.
    ingredients = [i for i in state["ingredients"] if i not in excluded]

    try:
        draft, dt = build_draft(state["draft"]["name"], ingredients, excluded)
    except ValueError:
        raise ValueError("impossible_without")

    state["excluded"] = excluded
    state["ingredients"] = ingredients
    state["draft"] = draft
    state["llm_time"] = round(dt, 2)
    save_pantry(state)
    return state


def confirm():
    """Step 6 answered "yes": the draft becomes the active cooking session
    and the pantry session is done. Shaped exactly like request_recipe's
    state so Cook.tsx/next_step/previous_step need no special case.

    verified_source is False: this recipe was generated, not one of the
    curated src/recipes/*.json.
    """
    state = _require()
    draft = state.get("draft")
    if draft is None:
        raise ValueError("no_draft")

    # Stored before it's cooked, not after: a dish negotiated down to what
    # the user actually had in the fridge is exactly the kind you want to
    # send someone, and it only has a shareable URL once it has a uuid.
    recipe = recipe_store.remember_generated({
        "name": draft["name"],
        "servings": draft.get("servings"),
        "summary": draft.get("summary", ""),
        "ingredients": draft.get("ingredients", []),
        "steps": draft["steps"],
        "tip": draft.get("tip", ""),
    })

    from recipe_engine import begin_recipe  # local: avoids an import cycle
    data = begin_recipe(recipe)
    clear_pantry()
    return data
