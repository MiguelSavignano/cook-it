"""Cooking the same recipe for a different number of people.

Asking for "hazlo para seis" does NOT create a second recipe: it adjusts the
ACTIVE COOKING SESSION (see recipe_engine.begin_recipe -- the session carries
its own copy of the ingredients). Your library is untouched, no new uuid is
minted, and the link you already shared still points at the recipe as
written. Start the recipe again and you get the original amounts back.

Two things are deliberately NOT scaled:

  - Ingredients with no number (`{"amount": null, "unit": "al gusto"}`,
    "1 pizca"). Twice the salt "to taste" is not a quantity, it's a mistake.
  - The wording of the steps. A step that says "añade los 600 g de ternera"
    keeps saying that. Rewriting prose is the LLM's job, it is slow, and it
    gets it wrong in ways nobody notices until the dish is ruined -- the
    ingredient list is the one place quantities are authoritative, and it is
    the place that changes. `scale_state` says so out loud when it answers.
"""

import re

# Whisper writes small numbers as words at least as often as digits.
NUMBER_WORDS = {
    "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11,
    "doce": 12, "quince": 15, "veinte": 20,
}
# Words that mean "servings" -- used to tell "para 6 personas" apart from
# "para 6 minutos".
SERVING_WORDS = r"personas?|comensales?|raciones?|porciones?|unidades?|bollos?|gente"
TIME_WORDS = r"minutos?|mins?|horas?|h|segundos?|seg"

_NUMBER = r"(?P<n>\d{1,3}|" + "|".join(NUMBER_WORDS) + r")"


def _to_number(token):
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return NUMBER_WORDS.get(token)


def parse_servings(value):
    """The number of servings a recipe is written for, plus whatever text
    followed it, or (None, "") when there's no number to work from.

    A range takes its UPPER bound ("3-4 personas" -> 4): scaling from the
    larger base gives the smaller factor, so nobody ends up with half a
    dinner because the recipe hedged.
    """
    if isinstance(value, (int, float)):
        return float(value), ""
    if not isinstance(value, str):
        return None, ""
    text = value.strip()
    # "3-4 personas", "3 a 4 personas"
    m = re.match(r"~?\s*(\d+(?:[.,]\d+)?)\s*(?:-|–|a|o)\s*(\d+(?:[.,]\d+)?)\s*(.*)", text, re.I)
    if m:
        return float(m.group(2).replace(",", ".")), m.group(3).strip()
    m = re.match(r"~?\s*(\d+(?:[.,]\d+)?)\s*(.*)", text)
    if m:
        return float(m.group(1).replace(",", ".")), m.group(2).strip()
    return None, text


def parse_scale_request(text):
    """What the user asked for, as ("servings", n) or ("factor", f), or None
    when this isn't a scaling request at all.

    Deterministic on purpose: no LLM call for something a regex settles, in
    a flow where the user is waiting with their hands full.
    """
    t = " " + re.sub(r"\s+", " ", text.strip().lower()) + " "

    if re.search(r"\b(el doble|dobla|doblalo|dóblalo|x\s?2)\b", t):
        return ("factor", 2.0)
    if re.search(r"\b(el triple|triplica|tríplica|x\s?3)\b", t):
        return ("factor", 3.0)
    if re.search(r"\b(la mitad|mitad de|reduce a la mitad)\b", t):
        return ("factor", 0.5)

    # "para 6 personas" / "para seis" / "para 6"
    m = re.search(rf"\bpara\s+{_NUMBER}\s*(?P<tail>\w+)?", t)
    if m:
        tail = (m.group("tail") or "").strip()
        if re.fullmatch(TIME_WORDS, tail):
            return None  # "cocina para 20 minutos" is not a serving count
        number = _to_number(m.group("n"))
        if number and (not tail or re.fullmatch(SERVING_WORDS, tail) or _is_scaling_context(t)):
            return ("servings", float(number))

    # "cámbialo a 8 raciones", "ajusta a 8 personas"
    m = re.search(rf"\b(?:cambia|cámbialo|ajusta|ajústalo|hazlo|calcula)\D{{0,12}}{_NUMBER}\s*(?P<tail>{SERVING_WORDS})?", t)
    if m:
        number = _to_number(m.group("n"))
        if number:
            return ("servings", float(number))
    return None


def _is_scaling_context(text):
    """A bare "para 6" only means servings if the sentence is about the
    recipe's size, not about a step."""
    return bool(re.search(r"\b(hazlo|haz|quiero|necesito|somos|seremos|cocina|prepara|receta|cantidad(es)?)\b", text))


# Things you count rather than measure. Half of one of these does not
# exist in a kitchen: 7.5 eggs is not a quantity, it's a bug on screen.
COUNTABLE_UNITS = {
    "", "unidad", "unidades", "ud", "uds", "diente", "dientes", "hoja", "hojas",
    "rama", "ramas", "sobre", "sobres", "lata", "latas", "bote", "botes",
    "molde", "moldes", "huevo", "huevos", "pieza", "piezas",
}


def _round_half_up(value):
    """Python's round() is banker's rounding -- round(6.5) is 6. In a recipe
    that reads as losing an egg, so round halves up explicitly."""
    import math

    return math.floor(value + 0.5)


def _round_amount(value, unit=None):
    """Kitchen rounding: nobody weighs 233.33 g."""
    if unit is not None and str(unit).strip().lower() in COUNTABLE_UNITS:
        return max(1, _round_half_up(value))
    if value >= 100:
        return _round_half_up(value)
    if value >= 10:
        return _round_half_up(value * 2) / 2  # nearest half
    if value >= 1:
        return round(value, 1)
    return round(value, 2)


def scale_ingredients(ingredients, factor):
    """Ingredients with their numbers multiplied. Anything without a number
    is passed through untouched -- see the module docstring."""
    scaled = []
    for ingredient in ingredients:
        amount = ingredient.get("amount")
        if isinstance(amount, (int, float)) and not isinstance(amount, bool):
            new_amount = _round_amount(amount * factor, ingredient.get("unit"))
            if float(new_amount).is_integer():
                new_amount = int(new_amount)
            scaled.append({**ingredient, "amount": new_amount})
        else:
            scaled.append(dict(ingredient))
    return scaled


# Spanish plurals aren't a suffix rule ("raciones" -> "ración"), so the
# handful of words that actually appear in a servings line are listed.
SINGULARS = {
    "personas": "persona", "raciones": "ración", "porciones": "porción",
    "comensales": "comensal", "unidades": "unidad", "bollos": "bollo",
    "moldes": "molde", "piezas": "pieza", "tartas": "tarta",
}


def format_servings(number, tail):
    """Rebuild the servings line, keeping whatever wording it had."""
    n = int(number) if float(number).is_integer() else round(number, 1)
    if not tail:
        return n
    word = tail.split()[0]
    # Pluralise "molde" -> "moldes", but never a unit abbreviation: "2 kgs de
    # pollo" is not Spanish. Anything short or with a digit in it is left be.
    pluralisable = (
        n != 1
        and len(word) > 3
        and word.isalpha()
        and not word.endswith("s")
    )
    if pluralisable:
        tail = tail.replace(word, word + "s", 1)
    elif n == 1 and word.lower() in SINGULARS:
        tail = tail.replace(word, SINGULARS[word.lower()], 1)
    return f"{n} {tail}"


def scale_state(state, request):
    """Applies a parsed scale request to a cooking session.

    Returns (new_state, spoken_text). The state is a copy: the caller decides
    whether to save it. Raises ValueError when the recipe gives nothing to
    scale from.
    """
    base, tail = parse_servings(state.get("servings"))
    kind, value = request

    if kind == "factor":
        factor = value
        target = base * factor if base else None
    else:
        if not base:
            raise ValueError(
                "Esta receta no dice para cuántos es, así que no puedo "
                "recalcular las cantidades."
            )
        target = value
        factor = target / base

    if factor <= 0:
        raise ValueError("No puedo calcular esa cantidad.")

    scaled = dict(state)
    scaled["ingredients"] = scale_ingredients(state.get("ingredients", []), factor)
    if target:
        scaled["servings"] = format_servings(target, tail)
    # What the session was written for, kept so a second adjustment scales
    # from the ORIGINAL rather than compounding rounding errors.
    scaled.setdefault("original_servings", state.get("servings"))
    scaled.setdefault("original_ingredients", state.get("ingredients", []))

    if target:
        spoken = f"Ajustado para {format_servings(target, tail or 'personas')}."
    else:
        spoken = f"Cantidades multiplicadas por {factor:g}."
    spoken += " Tienes la lista de ingredientes actualizada; los pasos siguen diciendo las cantidades originales."
    return scaled, spoken


def rescale_from_original(state, request):
    """Like scale_state, but measuring from the amounts the recipe was
    written with -- so asking for 6 and then for 8 gives the same result as
    asking for 8 straight away, instead of scaling the already-scaled."""
    base_state = dict(state)
    if "original_ingredients" in state:
        base_state["ingredients"] = state["original_ingredients"]
        base_state["servings"] = state.get("original_servings")
    new_state, spoken = scale_state(base_state, request)
    new_state["original_servings"] = state.get("original_servings", state.get("servings"))
    new_state["original_ingredients"] = state.get("original_ingredients", state.get("ingredients", []))
    new_state["current_step"] = state.get("current_step", 0)
    return new_state, spoken
