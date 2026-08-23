"""Recipe JSON <-> Markdown.

Recipes live as JSON (src/recipes/*.json) because that's what the app reads,
but JSON is a poor thing to hand a person: the point of keeping recipes in
Drive is that you can open one on your phone, fix "500 g" to "600 g", and
have the app pick it up. So this module is the translation layer, and it has
exactly one hard requirement: JSON -> Markdown -> JSON must give back what it
was given. Anything else silently eats somebody's recipe.

The format is plain CommonMark that renders correctly in Drive, GitHub and
any preview pane:

    ---
    uuid: af60ef76-9147-4c74-b46b-8c0b0b97e7ea
    id: tortilla-patatas
    servings: 4
    ---

    # Tortilla de patatas

    Para elaborar una auténtica tortilla española...

    > 💡 **Truco:** el consejo general del plato (optional)

    ## Ingredientes

    | Ingrediente | Cantidad | Unidad |
    | --- | --- | --- |
    | patatas | 500 | g |
    | sal |  | al gusto |

    ## Pasos

    1. Pela y corta las patatas en láminas finas.
    2. Fríe las patatas a fuego medio... ⏱️ **20 min**
       > 💡 El truco de ESE paso (optional)

Two shape decisions worth keeping:

- Ingredients are a TABLE, not "- 500 g patatas". An ingredient is three
  fields (item, amount, unit) and `unit` is free text that can itself start
  with a number -- {"item": "sal", "amount": null, "unit": "1 pizca"} is real
  data in this repo. One line can't be split back into those three fields
  without guessing; three cells can.
- Durations are written in whole units ("20 min", "48 h") and parsed back to
  seconds exactly. Every timer in the repo is a whole number of minutes, and
  a person editing "20 min" understands what they're changing.
"""

import json
import re

import yaml

# Order the curated files are written in, so a round-trip through Markdown
# doesn't reshuffle a file that someone also reads as JSON.
FIELD_ORDER = ("uuid", "id", "name", "servings", "ingredients", "steps", "summary", "tip")
# Front matter carries what isn't prose: identity and the serving line.
FRONT_MATTER_FIELDS = ("uuid", "id", "servings")

TIP_PREFIX = "> 💡 "
RECIPE_TIP_PREFIX = f"{TIP_PREFIX}**Truco:** "
# The clock emoji is two code points (U+23F1 + the variation selector), so
# both have to be optional to accept a step someone retyped without it.
TIMER_SUFFIX_RE = re.compile(r"\s*(?:\u23f1\ufe0f?)?\s*\*\*(?P<value>[^*]+)\*\*\s*$")
DURATION_RE = re.compile(r"(?P<number>\d+(?:[.,]\d+)?)\s*(?P<unit>h|min|s)\b")
STEP_RE = re.compile(r"^\d+\.\s+(?P<text>.*)$")
# A tip line under a step is indented; the recipe's own tip is not.
STEP_TIP_RE = re.compile(r"^\s+> 💡\s*(?P<tip>.*)$")


# --- durations -------------------------------------------------------------

def format_duration(seconds):
    """Seconds -> the largest whole unit that divides them exactly."""
    seconds = int(seconds)
    if seconds >= 3600 and seconds % 3600 == 0:
        return f"{seconds // 3600} h"
    if seconds >= 60 and seconds % 60 == 0:
        return f"{seconds // 60} min"
    return f"{seconds} s"


def parse_duration(text):
    """"20 min" / "48 h" / "1 h 30 min" / "90 s" -> seconds, or None."""
    factors = {"h": 3600, "min": 60, "s": 1}
    total = 0
    found = False
    for match in DURATION_RE.finditer(text):
        total += float(match.group("number").replace(",", ".")) * factors[match.group("unit")]
        found = True
    return int(round(total)) if found else None


# --- numbers ---------------------------------------------------------------

def _format_number(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _parse_number(text):
    """A quantity cell: empty means "no number", which is not the same as 0
    (that's `sal, al gusto`)."""
    text = text.strip().replace(",", ".")
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        # Someone typed "un par" where a number goes. Keep it rather than
        # dropping it: the unit column is free text, so it survives there.
        return text


# --- JSON -> Markdown ------------------------------------------------------

def _escape_cell(text):
    """A pipe inside a cell would end it."""
    return str(text).replace("|", "\\|")


def to_markdown(recipe):
    front = {k: recipe[k] for k in FRONT_MATTER_FIELDS if recipe.get(k) is not None}
    lines = [
        "---",
        yaml.safe_dump(front, allow_unicode=True, sort_keys=False).strip(),
        "---",
        "",
        f"# {recipe['name']}",
    ]

    if recipe.get("summary"):
        lines += ["", recipe["summary"]]
    if recipe.get("tip"):
        lines += ["", f"{RECIPE_TIP_PREFIX}{recipe['tip']}"]

    lines += ["", "## Ingredientes", "", "| Ingrediente | Cantidad | Unidad |", "| --- | --- | --- |"]
    for ing in recipe.get("ingredients", []):
        lines.append(
            f"| {_escape_cell(ing.get('item', ''))} "
            f"| {_escape_cell(_format_number(ing.get('amount')))} "
            f"| {_escape_cell(ing.get('unit') or '')} |"
        )

    lines += ["", "## Pasos", ""]
    for number, step in enumerate(recipe.get("steps", []), 1):
        text = step["text"] if isinstance(step, dict) else step
        seconds = step.get("timer_seconds") if isinstance(step, dict) else None
        suffix = f" ⏱️ **{format_duration(seconds)}**" if seconds else ""
        lines.append(f"{number}. {text}{suffix}")
        tip = step.get("tip") if isinstance(step, dict) else None
        if tip:
            lines.append(f"   {TIP_PREFIX}{tip}")

    return "\n".join(lines).rstrip() + "\n"


# --- Markdown -> JSON ------------------------------------------------------

def _split_front_matter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    front = yaml.safe_load(text[3:end]) or {}
    rest = text[end + 4:]
    return front, rest.lstrip("\n")


def _parse_row(line):
    cells = [c.replace("\\|", "|").strip() for c in line.strip().strip("|").split("|")]
    return cells


def from_markdown(text):
    front, body = _split_front_matter(text)
    recipe = {k: front[k] for k in FRONT_MATTER_FIELDS if k in front}

    name = ""
    summary_parts = []
    tip = ""
    ingredients = []
    steps = []
    section = "head"

    for raw in body.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("# "):
            name = stripped[2:].strip()
            continue
        if stripped.startswith("## "):
            heading = stripped[3:].strip().lower()
            section = "ingredients" if heading.startswith("ingrediente") else "steps" if heading.startswith("paso") else "other"
            continue

        if section == "head":
            if stripped.startswith(TIP_PREFIX):
                tip = stripped[len(TIP_PREFIX):].replace("**Truco:**", "").strip()
            elif stripped:
                summary_parts.append(stripped)
            continue

        if section == "ingredients":
            if not stripped.startswith("|"):
                continue
            cells = _parse_row(stripped)
            if len(cells) < 3 or cells[0].lower() in ("ingrediente", "") or set(cells[0]) <= set("- :"):
                continue  # header or the |---| separator
            ingredients.append({
                "item": cells[0],
                "amount": _parse_number(cells[1]),
                "unit": cells[2] or None,
            })
            continue

        if section == "steps":
            tip_match = STEP_TIP_RE.match(line)
            if tip_match and steps:
                last = steps[-1]
                if not isinstance(last, dict):
                    last = {"text": last}
                    steps[-1] = last
                last["tip"] = tip_match.group("tip").strip()
                continue
            step_match = STEP_RE.match(stripped)
            if not step_match:
                continue
            body_text = step_match.group("text")
            seconds = None
            timer_match = TIMER_SUFFIX_RE.search(body_text)
            if timer_match:
                seconds = parse_duration(timer_match.group("value"))
                # Only a duration is a timer. A step that merely ENDS in bold
                # ("...hasta que quede **muy firme**") keeps its words.
                if seconds is not None:
                    body_text = body_text[: timer_match.start()].rstrip()
            steps.append({"text": body_text, "timer_seconds": seconds} if seconds else body_text)

    recipe["name"] = name
    recipe["ingredients"] = ingredients
    recipe["steps"] = steps
    if summary_parts:
        recipe["summary"] = " ".join(summary_parts)
    if tip:
        recipe["tip"] = tip
    return {k: recipe[k] for k in FIELD_ORDER if k in recipe}


# --- CLI -------------------------------------------------------------------

def _check_round_trip():
    """Every curated recipe, JSON -> Markdown -> JSON, compared field by
    field. This is what the "lossless" claim in the README rests on, and
    it's a command rather than a test suite so it needs nothing installed:

        python3 recipe_markdown.py check
    """
    from pathlib import Path

    recipes = sorted((Path(__file__).parent / "recipes").glob("*.json"))
    failed = 0
    for path in recipes:
        original = json.loads(path.read_text())
        back = from_markdown(to_markdown(original))
        if back == original:
            continue
        failed += 1
        differing = sorted(k for k in set(original) | set(back) if original.get(k) != back.get(k))
        print(f"FAIL {path.name}: {', '.join(differing)}")
        for key in differing:
            print(f"     before: {original.get(key)!r}")
            print(f"     after : {back.get(key)!r}")
    print(f"{len(recipes) - failed}/{len(recipes)} recipes round-trip identical")
    return 1 if failed else 0


def _main(argv):
    usage = "usage: recipe_markdown.py (to-md <recipe.json> | to-json <recipe.md> | check)"
    if len(argv) == 2 and argv[1] == "check":
        return _check_round_trip()
    if len(argv) != 3 or argv[1] not in ("to-md", "to-json"):
        print(usage)
        return 1
    _, mode, path = argv
    if mode == "to-md":
        print(to_markdown(json.loads(open(path).read())), end="")
    else:
        print(json.dumps(from_markdown(open(path).read()), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv))
