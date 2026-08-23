"""Google Drive: your recipes as Markdown files in a folder you own.

This is the one part of Cook-It that talks to the internet, and it is OFF
until you turn it on (settings.yml, `drive.enabled`). Nothing else in the
app changes when it's off, and nothing else depends on it: the kitchen keeps
working with the router unplugged.

Why Markdown rather than the JSON the app actually reads: a recipe in Drive
is something you open on your phone to fix "500 g" to "600 g". See
recipe_markdown.py -- the translation is lossless in both directions, which
is the whole reason this module can sync in both directions safely.

## What you have to do once (the part no program can do for you)

1. console.cloud.google.com -> a project (any name) -> enable the "Google
   Drive API".
2. "Credentials" -> "Create credentials" -> "OAuth client ID" -> type
   **Web application**, and add this exact redirect URI:
       https://localhost:3000/api/drive/callback
   (or whatever host/port you reach Cook-It on -- it must match exactly).
3. Download the JSON and save it as `src/drive_client.json` (gitignored).
4. In the app, press "Conectar Google Drive" and approve the consent screen.

The token that comes back is written to `src/drive_token.json` (gitignored,
and a real secret -- it is a key to your Drive).

## Scope

`drive.file` only: Cook-It can see and touch THE FILES IT CREATES ITSELF and
nothing else in your Drive. It cannot read your documents, and it cannot
delete anything it didn't put there. That is deliberate and it is the
narrowest scope that can do this job.
"""

import json
import re
import time
import unicodedata
from pathlib import Path

import requests

import recipe_markdown
import recipe_store
import settings

BASE_DIR = Path(__file__).parent
TOKEN_FILE = BASE_DIR / "drive_token.json"

# Where the OAuth client JSON may be. Google names the download
# `client_secret_<client-id>.apps.googleusercontent.com.json`, and people
# drop it wherever they happen to be, so look for it rather than demanding
# one exact path -- but keep drive_client.json first as the documented name.
CLIENT_FILE = BASE_DIR / "drive_client.json"
_CLIENT_SEARCH = (
    BASE_DIR / "drive_client.json",
    BASE_DIR / "client_secret.json",
    BASE_DIR.parent / "drive_client.json",
    BASE_DIR.parent / "client_secret.json",
)


def client_file():
    """The client JSON in use, or None. Checked on every call rather than
    cached: dropping the file in is what the setup instructions tell you to
    do, and it shouldn't need a restart to be noticed."""
    for path in _CLIENT_SEARCH:
        if path.exists():
            return path
    for directory in (BASE_DIR, BASE_DIR.parent):
        for path in sorted(directory.glob("client_secret*.json")):
            return path
    return None

SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files"
UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"
TIMEOUT = 30


class DriveError(RuntimeError):
    """Anything that should reach the user as a sentence, not a stack trace."""


# --- credentials -----------------------------------------------------------

def _client_config():
    path = client_file()
    if path is None:
        raise DriveError(
            f"Falta {CLIENT_FILE.name}: crea un OAuth client ID en Google Cloud "
            "y guarda el JSON ahí (ver el docstring de drive.py)."
        )
    raw = json.loads(path.read_text())
    # Google hands the file out wrapped in "web" or "installed" depending on
    # the client type; the fields inside are the same.
    config = raw.get("web") or raw.get("installed") or raw
    missing = [k for k in ("client_id", "client_secret") if not config.get(k)]
    if missing:
        raise DriveError(f"{path.name} no tiene {', '.join(missing)}.")
    if "installed" in raw:
        raise DriveError(
            f'{path.name} es un cliente de tipo "Desktop app"; Cook-It necesita '
            'uno de tipo "Aplicación web", porque Google devuelve el callback a '
            "este servidor y no a un puerto loopback."
        )
    return config


def _read_token():
    if not TOKEN_FILE.exists():
        return None
    return json.loads(TOKEN_FILE.read_text())


def _write_token(token):
    TOKEN_FILE.write_text(json.dumps(token, indent=2))
    # It is a key to someone's Drive: not world-readable.
    TOKEN_FILE.chmod(0o600)


def is_configured():
    return client_file() is not None


def is_connected():
    return TOKEN_FILE.exists()


def disconnect():
    """Forget the token. Access itself is revoked from the Google account's
    security settings -- this only stops THIS machine from using it."""
    TOKEN_FILE.unlink(missing_ok=True)


# --- OAuth -----------------------------------------------------------------

def auth_url(redirect_uri):
    config = _client_config()
    params = {
        "client_id": config["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        # offline + consent so we actually get a refresh_token: without it
        # the connection silently dies an hour later.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return requests.Request("GET", AUTH_ENDPOINT, params=params).prepare().url


def exchange_code(code, redirect_uri):
    config = _client_config()
    response = requests.post(TOKEN_ENDPOINT, timeout=TIMEOUT, data={
        "code": code,
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    })
    if not response.ok:
        raise DriveError(f"Google rechazó el código: {response.text[:200]}")
    token = response.json()
    if "refresh_token" not in token:
        raise DriveError(
            "Google no devolvió refresh_token. Revoca el acceso de Cook-It en "
            "https://myaccount.google.com/permissions y vuelve a conectar."
        )
    token["expires_at"] = time.time() + token.get("expires_in", 3600)
    _write_token(token)
    return token


def _refresh(token):
    config = _client_config()
    response = requests.post(TOKEN_ENDPOINT, timeout=TIMEOUT, data={
        "refresh_token": token["refresh_token"],
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "grant_type": "refresh_token",
    })
    if not response.ok:
        raise DriveError(
            "La conexión con Drive ha caducado o fue revocada; vuelve a conectar."
        )
    refreshed = response.json()
    token["access_token"] = refreshed["access_token"]
    token["expires_at"] = time.time() + refreshed.get("expires_in", 3600)
    _write_token(token)
    return token


def _access_token():
    token = _read_token()
    if not token:
        # Distinguish "you haven't done the Google Cloud setup" from "you
        # have, but haven't pressed Connect" -- they need different actions.
        _client_config()
        raise DriveError("Google Drive no está conectado todavía.")
    # A minute of slack, so a call never starts with a token that expires
    # while it's in flight.
    if token.get("expires_at", 0) - 60 < time.time():
        token = _refresh(token)
    return token["access_token"]


def _headers():
    return {"Authorization": f"Bearer {_access_token()}"}


def _check(response, what):
    if not response.ok:
        raise DriveError(f"Drive falló al {what}: {response.status_code} {response.text[:200]}")
    return response


# --- the folder ------------------------------------------------------------

def _folder_id():
    """The app's folder, created on first use. Found by name among the files
    this app itself created (drive.file scope), so it never picks up a
    folder of yours that happens to share the name."""
    name = settings.get("drive.folder")
    query = f"mimeType='{FOLDER_MIME}' and name='{name}' and trashed=false"
    response = _check(requests.get(FILES_ENDPOINT, headers=_headers(), timeout=TIMEOUT, params={
        "q": query, "fields": "files(id,name)", "spaces": "drive",
    }), "buscar la carpeta")
    files = response.json().get("files", [])
    if files:
        return files[0]["id"]

    created = _check(requests.post(FILES_ENDPOINT, headers=_headers(), timeout=TIMEOUT,
                                   json={"name": name, "mimeType": FOLDER_MIME}),
                     "crear la carpeta")
    return created.json()["id"]


def _list_markdown(folder_id):
    """Every .md this app has put in the folder, by filename."""
    files = {}
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed=false",
            "fields": "nextPageToken, files(id,name,modifiedTime)",
            "pageSize": 200,
        }
        if page_token:
            params["pageToken"] = page_token
        payload = _check(requests.get(FILES_ENDPOINT, headers=_headers(), timeout=TIMEOUT,
                                      params=params), "listar la carpeta").json()
        for f in payload.get("files", []):
            if f["name"].endswith(".md"):
                files[f["name"]] = f
        page_token = payload.get("nextPageToken")
        if not page_token:
            return files


# --- files -----------------------------------------------------------------

def _upload(folder_id, filename, content, file_id=None):
    metadata = {"name": filename}
    if file_id is None:
        metadata["parents"] = [folder_id]
    files = {
        "metadata": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
        "file": (filename, content.encode("utf-8"), "text/markdown"),
    }
    if file_id:
        response = requests.patch(f"{UPLOAD_ENDPOINT}/{file_id}", headers=_headers(),
                                  params={"uploadType": "multipart"}, files=files, timeout=TIMEOUT)
    else:
        response = requests.post(UPLOAD_ENDPOINT, headers=_headers(),
                                 params={"uploadType": "multipart"}, files=files, timeout=TIMEOUT)
    return _check(response, f"subir {filename}").json()


def _download(file_id):
    response = _check(requests.get(f"{FILES_ENDPOINT}/{file_id}", headers=_headers(),
                                   params={"alt": "media"}, timeout=TIMEOUT), "descargar un fichero")
    response.encoding = "utf-8"
    return response.text


# --- sync ------------------------------------------------------------------

def _filename(recipe):
    """Named after the dish, because you're going to read this list on a
    phone. The uuid inside the file is what actually identifies it.

    Not recipe_store.slugify(): that one drops non-ASCII, which is fine for
    a lookup key but turns "Ragú" into "rag" on screen. Here the accents are
    folded to their base letters instead.
    """
    folded = unicodedata.normalize("NFKD", recipe.get("name") or "")
    ascii_name = "".join(c for c in folded if not unicodedata.combining(c))
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return f"{slug or recipe['uuid']}.md"


def _local_recipes():
    """Everything cookable, curated and generated alike. (load_curated is
    keyed by name, load_shared is already a list -- see recipe_store.)"""
    return list(recipe_store.load_curated().values()) + recipe_store.load_shared()


def push():
    """Local recipes -> Drive. Overwrites the Drive copy of each recipe:
    push is "publish what I have", and pull is the other direction."""
    folder_id = _folder_id()
    remote = _list_markdown(folder_id)
    written, updated = [], []
    for recipe in _local_recipes():
        filename = _filename(recipe)
        markdown = recipe_markdown.to_markdown(recipe)
        existing = remote.get(filename)
        _upload(folder_id, filename, markdown, file_id=existing["id"] if existing else None)
        (updated if existing else written).append(filename)
    return {"created": written, "updated": updated, "folder": settings.get("drive.folder")}


def pull():
    """Drive -> local. A file whose uuid we already know updates that recipe;
    an unknown one arrives as a new (generated-side) recipe.

    Curated recipes are git-tracked source, so a pull that would rewrite one
    is REPORTED rather than done -- that edit belongs in a commit, not in a
    background sync. Everything else is applied.
    """
    folder_id = _folder_id()
    remote = _list_markdown(folder_id)
    curated = {r["uuid"]: r for r in recipe_store.load_curated().values()}

    applied, added, skipped, failed, recipes = [], [], [], [], []
    for filename, meta in sorted(remote.items()):
        try:
            recipe = recipe_markdown.from_markdown(_download(meta["id"]))
        except Exception as e:
            failed.append({"file": filename, "error": str(e)[:200]})
            continue
        if not recipe.get("name") or not recipe.get("steps"):
            failed.append({"file": filename, "error": "sin nombre o sin pasos"})
            continue

        recipe_uuid = recipe.get("uuid")
        if recipe_uuid and recipe_uuid in curated:
            skipped.append({"file": filename, "reason": "receta curada (edítala en el repo)"})
            continue

        # "Updated" means we already had this recipe; a file carrying a uuid
        # we've never seen is still NEW here, however old it is in Drive.
        known = recipe_uuid is not None and recipe_store.find(recipe_uuid) is not None
        stored = recipe_store.remember_generated(recipe)
        (applied if known else added).append({"file": filename, "uuid": stored["uuid"]})
        recipes.append(recipe_store.public_recipe(stored))

    # The recipes themselves ride along: the browser owns the library (see
    # recipe_store's docstring), so what comes down from Drive has to reach
    # IndexedDB, not just this machine's mirror.
    return {"updated": applied, "added": added, "skipped": skipped, "failed": failed,
            "recipes": recipes, "folder": settings.get("drive.folder")}


def status():
    """What the UI needs to decide which button to show."""
    found = client_file()
    return {
        "enabled": settings.get("drive.enabled"),
        "configured": found is not None,
        "client_file": found.name if found else None,
        "connected": is_connected(),
        "folder": settings.get("drive.folder"),
        "local_recipes": len(_local_recipes()),
    }
