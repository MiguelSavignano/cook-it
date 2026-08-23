"""Cook-It's configuration: settings.yml, and how to override it.

Everything the app can be configured with lives in settings.yml next to this
file, which is COMMITTED -- none of it is secret (Cook-It talks to nothing
but this machine), and which model or voice the project uses is part of how
it's built. Two escape hatches keep that from being rigid, in order of
precedence:

    environment variable  >  settings.local.yml  >  settings.yml

settings.local.yml (gitignored, same shape, partial) is for what genuinely
differs per machine -- your mic device, an Ollama on another box. The
environment variables are for one-off runs (OLLAMA_MODEL=llama3 ./run_web.sh)
and are the names this project has always used, kept working on purpose.

Reading a value:

    from settings import get
    get("ollama.model")          # -> "gemma3"

An unknown path raises: a typo should fail loudly at import time, not turn
into a silent None halfway through a recipe.
"""

import os
from pathlib import Path

import yaml

SETTINGS_FILE = Path(__file__).with_name("settings.yml")
LOCAL_SETTINGS_FILE = Path(__file__).with_name("settings.local.yml")

# Dotted path -> the environment variable that overrides it. Explicit rather
# than derived from the path, because these names came first (they're in the
# README, and OLLAMA_BASE_URL/OLLAMA_MODEL are Ollama's own names) and
# breaking them to gain a naming scheme would be a bad trade.
ENV_OVERRIDES = {
    "ollama.base_url": "OLLAMA_BASE_URL",
    "ollama.model": "OLLAMA_MODEL",
    "ollama.question_model": "OLLAMA_QUESTION_MODEL",
    "voice.piper": "COOKIT_VOICE",
    "vision.backend": "COOKIT_VISION_BACKEND",
    "vision.ollama_model": "COOKIT_VISION_MODEL",
    "vision.moondream_model": "COOKIT_MOONDREAM_MODEL",
    "vision.claude_model": "COOKIT_CLAUDE_MODEL",
    "vision.keep_alive": "COOKIT_VISION_KEEP_ALIVE",
    "cli.mic_device": "COOKIT_MIC_DEVICE",
    "cli.record_seconds": "COOKIT_RECORD_SECONDS",
}


def _merge(base, override):
    """Deep merge, so settings.local.yml can override one key of a section
    without having to restate the rest of it."""
    merged = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _load():
    settings = yaml.safe_load(SETTINGS_FILE.read_text()) or {}
    if LOCAL_SETTINGS_FILE.exists():
        settings = _merge(settings, yaml.safe_load(LOCAL_SETTINGS_FILE.read_text()))
    return settings


_SETTINGS = _load()


def _coerce(raw, like):
    """An environment variable is always a string; the YAML value it's
    standing in for may not be (record_seconds is an int). Follow the file's
    type so callers never have to care where the value came from."""
    if isinstance(like, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(like, int):
        return int(raw)
    if isinstance(like, float):
        return float(raw)
    return raw


def get(path):
    """The value at a dotted path ("ollama.model"), with any override applied."""
    value = _SETTINGS
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            raise KeyError(f"No such setting: {path!r} (see {SETTINGS_FILE.name})")
        value = value[part]

    env_name = ENV_OVERRIDES.get(path)
    if env_name:
        raw = os.environ.get(env_name)
        if raw not in (None, ""):
            return _coerce(raw, value)
    return value
