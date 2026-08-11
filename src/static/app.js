const micBtn = document.getElementById('micBtn');
const statusText = document.getElementById('statusText');
const userText = document.getElementById('userText');
const card = document.getElementById('card');

const RECORD_MS = 6000;
let mediaRecorder = null;
let chunks = [];
let recording = false;

function setStatus(html, btnClass) {
  statusText.innerHTML = html;
  micBtn.classList.remove('listening', 'thinking');
  if (btnClass) micBtn.classList.add(btnClass);
}

function resetToIdle() {
  setStatus('Toca el micrófono y pide una receta', null);
}

// Plays audio on THIS device (the one the user is holding/looking at), not
// on the server -- the API sends back base64 WAV instead of playing it
// itself, precisely so a phone gets the answer in its own hand, not through
// whatever PC happens to be running the backend.
function playAudioB64(base64, mime) {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const blob = new Blob([buf], { type: mime || 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const player = new Audio(url);
  player.addEventListener('ended', () => URL.revokeObjectURL(url));
  player.play().catch((err) => console.error('No se pudo reproducir el audio:', err));
}

async function startRecording() {
  if (recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      sendAudio(new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' }));
    };
    mediaRecorder.start();
    recording = true;
    userText.textContent = '';
    setStatus('🎙️ Escuchando… habla ahora', 'listening');
    setTimeout(() => { if (recording) stopRecording(); }, RECORD_MS);
  } catch (err) {
    setStatus('No pude acceder al micrófono 😕', null);
    console.error(err);
  }
}

function stopRecording() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  micBtn.disabled = true;
  mediaRecorder.stop();
}

const COOKING_LOADER_HTML = `
  <span class="cooking-loader">
    <span class="pot">🍲</span>
    <span class="steam"><span></span><span></span><span></span></span>
    Creando tu receta…
  </span>`;

// Hands off to the dedicated cooking route (cook.html/cook.js) once a
// recipe is active -- this page only ever picks/creates a recipe, never
// steps through one. The response's spoken greeting (summary + step 1) is
// stashed in sessionStorage instead of played here, because playing it now
// and then navigating away would kill it mid-sentence; cook.js picks it up
// and plays it once the cooking view has loaded, one beat later.
function goToCook(data) {
  if (data.audio_base64) {
    sessionStorage.setItem(
      'cookit_pending_audio',
      JSON.stringify({ audio_base64: data.audio_base64, audio_mime: data.audio_mime }),
    );
  }
  window.location.href = 'cook';
}

async function sendAudio(blob) {
  // On THIS page a recipe is never already active (see fetchAndRenderState()
  // below -- an active one redirects away immediately), so the mic here
  // always means "create/find a recipe", never a follow-up question about
  // one already on screen. That's a slower, gemma3-backed call, hence the
  // "creando tu receta" loader instead of a plain "pensando".
  setStatus(COOKING_LOADER_HTML, 'thinking');
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  try {
    const res = await fetch('api/question', { method: 'POST', body: form });
    const data = await res.json();
    micBtn.disabled = false;

    if (!data.ok) {
      if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
      setStatus(data.spoken_text || 'No te he entendido, prueba otra vez', null);
      return;
    }

    userText.textContent = data.user_text ? `"${data.user_text}"` : '';
    goToCook(data);
  } catch (err) {
    micBtn.disabled = false;
    setStatus('Error hablando con el servidor 😕', null);
    console.error(err);
  }
}

// Local recipes list, for the "tap to pick one" home screen. Fetched once
// and cached -- it's static for the lifetime of the page (the backend's
// recipe files don't change while the server is running).
let availableRecipesCache = null;

async function getAvailableRecipes() {
  if (availableRecipesCache) return availableRecipesCache;
  const res = await fetch('api/recipes');
  availableRecipesCache = await res.json();
  return availableRecipesCache;
}

async function selectRecipe(name) {
  setStatus('🤔 Pensando…', 'thinking');
  try {
    const res = await fetch('api/recipes/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();

    if (!data.ok) {
      if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
      setStatus(data.spoken_text || 'No he encontrado esa receta, prueba con otra.', null);
      return;
    }

    goToCook(data);
  } catch (err) {
    setStatus('Error hablando con el servidor 😕', null);
    console.error(err);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderPlaceholder() {
  card.className = 'card placeholder';
  card.innerHTML = `
    <div class="placeholder-title">👨‍🍳 ¿Qué cocinamos hoy?</div>
    <div class="recipe-list" id="recipeList"><div class="loading-hint">Cargando recetas…</div></div>
    <div class="examples">
      <span>O pide cualquier otra por voz: "Cómo se hace una paella"</span>
    </div>`;
  resetToIdle();
  getAvailableRecipes().then((recipes) => {
    const listEl = document.getElementById('recipeList');
    if (!listEl) return; // the user already navigated away from this screen
    if (!recipes.length) {
      listEl.innerHTML = '<div class="loading-hint">No hay recetas locales todavía.</div>';
      return;
    }
    // data-* attribute + event delegation instead of inline onclick, so
    // recipe names never need to be quote-escaped into a JS call string.
    listEl.innerHTML = recipes.map((r) => `
      <button class="recipe-card" data-recipe-name="${escapeHtml(r.name)}">
        <span class="recipe-card-name">${escapeHtml(r.name)}</span>
        ${r.servings ? `<span class="recipe-card-servings">${escapeHtml(String(r.servings))}</span>` : ''}
      </button>
    `).join('');
    listEl.querySelectorAll('.recipe-card').forEach((btn) => {
      btn.addEventListener('click', () => selectRecipe(btn.dataset.recipeName));
    });
  });
}

// On load: if a recipe is already active (session memory from a previous
// visit), skip straight to the cooking route instead of showing the picker.
async function fetchAndRenderState() {
  const res = await fetch('api/state');
  const state = await res.json();
  if (state && state.active !== false) {
    window.location.href = 'cook';
    return;
  }
  renderPlaceholder();
}

micBtn.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});

fetchAndRenderState();
