const micBtn = document.getElementById('micBtn');
const statusText = document.getElementById('statusText');
const userText = document.getElementById('userText');
const card = document.getElementById('card');

const RECORD_MS = 6000;
let mediaRecorder = null;
let chunks = [];
let recording = false;

// Whether a recipe is currently active -- changes what the mic invites you
// to do (ask for a recipe vs. ask a question about the one you're cooking),
// see idleHintHTML()/resetToIdle() below. Kept in sync by renderState().
let recipeActive = false;

// Small chef's-toque-with-a-question-mark icon: the mic already handles both
// "ask for a recipe" and "ask a question about the current step" (same
// recording flow either way), so instead of a second button we just make
// that second purpose visible with this icon + a hint, once a recipe is
// active. Plain inline SVG, no external asset.
const CHEF_QUESTION_ICON = `
  <svg viewBox="0 0 40 40" width="22" height="22" style="vertical-align:-6px;margin-right:4px" aria-hidden="true">
    <circle cx="13" cy="15" r="8" style="fill:var(--orange-dark)"/>
    <circle cx="21" cy="10" r="9" style="fill:var(--orange-dark)"/>
    <circle cx="29" cy="15" r="7" style="fill:var(--orange-dark)"/>
    <rect x="9" y="16" width="22" height="8" rx="2" style="fill:var(--orange-dark)"/>
    <rect x="9" y="24" width="22" height="5" rx="1.5" style="fill:var(--brown)"/>
    <circle cx="30" cy="27" r="8" style="fill:var(--cream);stroke:var(--orange-dark);stroke-width:2"/>
    <text x="30" y="31" font-size="12" font-weight="700" text-anchor="middle" style="fill:var(--orange-dark)">?</text>
  </svg>`;

function idleHintHTML() {
  return recipeActive
    ? `${CHEF_QUESTION_ICON}¿Tienes alguna duda? Toca el micrófono y pregunta`
    : 'Toca el micrófono y pide una receta';
}

function setStatus(html, btnClass) {
  statusText.innerHTML = html;
  micBtn.classList.remove('listening', 'thinking');
  if (btnClass) micBtn.classList.add(btnClass);
}

function resetToIdle() {
  setStatus(idleHintHTML(), null);
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

async function sendAudio(blob) {
  setStatus('🤔 Pensando…', 'thinking');
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  try {
    const res = await fetch('api/question', { method: 'POST', body: form });
    const data = await res.json();
    micBtn.disabled = false;
    if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);

    if (!data.ok) {
      setStatus(data.spoken_text || 'No te he entendido, prueba otra vez', null);
      return;
    }

    userText.textContent = data.user_text ? `"${data.user_text}"` : '';
    resetToIdle();
    renderResponse(data);
  } catch (err) {
    micBtn.disabled = false;
    setStatus('Error hablando con el servidor 😕', null);
    console.error(err);
  }
}

function renderResponse(data) {
  const d = data.data || {};
  if (data.type === 'error') {
    card.className = 'card placeholder';
    card.innerHTML = `<div>😕 ${data.spoken_text}</div>`;
    return;
  }
  if (data.type === 'question') {
    // Follow-up question: doesn't touch the current step, just shows the
    // answer above the recipe that was already on screen.
    fetchAndRenderState(data.spoken_text);
    return;
  }
  if (d.finished) {
    recipeActive = false;
    resetToIdle();
    card.className = 'card';
    card.innerHTML = `
      <div class="finished">
        <div class="emoji">🎉</div>
        <div class="recipe-title">${d.name || ''}</div>
        <div class="summary">¡Receta terminada! Buen provecho.</div>
        ${d.tip ? `<div class="tip-box"><b>💡 Tip:</b> ${d.tip}</div>` : ''}
      </div>`;
    return;
  }
  // new_recipe carries more fields (summary, ingredients, verified_source).
  fetchAndRenderState();
}

async function buttonAction(endpoint, button) {
  button.disabled = true;
  setStatus('🤔 Pensando…', 'thinking');
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
    resetToIdle();
    userText.textContent = '';
    renderResponse(data);
  } catch (err) {
    setStatus('Error hablando con el servidor 😕', null);
    console.error(err);
  } finally {
    button.disabled = false;
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
    if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
    resetToIdle();
    userText.textContent = '';
    renderResponse(data);
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
  recipeActive = false;
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

function renderState(state, questionAnswer) {
  if (!state || state.active === false) {
    renderPlaceholder();
    return;
  }
  recipeActive = true;
  resetToIdle();

  const total = state.steps.length;
  const current = state.current_step;
  const dots = state.steps.map((_, i) => {
    const cls = i < current ? 'done' : (i === current ? 'current' : '');
    return `<div class="dot ${cls}"></div>`;
  }).join('');

  const chips = (state.ingredients || []).map((ing) => {
    const amount = [ing.amount, ing.unit].filter(Boolean).join(' ');
    return `<div class="chip">${ing.item}${amount ? ' · ' + amount : ''}</div>`;
  }).join('');

  card.className = 'card';
  card.innerHTML = `
    <div class="recipe-title">${state.name}</div>
    <span class="source-badge ${state.verified_source ? 'local' : 'general'}">
      ${state.verified_source ? '✓ receta verificada' : '⚠ receta general del LLM'}
    </span>
    ${state.summary ? `<div class="summary">${state.summary}</div>` : ''}
    ${chips ? `<div class="ingredients">${chips}</div>` : ''}
    ${questionAnswer ? `<div class="question-answer">🗣️ ${questionAnswer}</div>` : ''}
    <div class="progress">
      <div class="dots">${dots}</div>
      <div class="label">Paso ${current + 1} de ${total}</div>
    </div>
    <div class="current-step">${state.steps[current]}</div>
    ${state.tip ? `<div class="tip-box"><b>💡 Tip:</b> ${state.tip}</div>` : ''}
    <div class="step-nav">
      <button class="previous" ${current === 0 ? 'disabled' : ''} onclick="buttonAction('api/previous', this)">◀ Anterior</button>
      <button onclick="buttonAction('api/next', this)">Siguiente ▶</button>
    </div>
    <div class="secondary-actions">
      <button onclick="resetSession()">🗑️ Empezar otra receta</button>
    </div>
  `;
}

async function fetchAndRenderState(questionAnswer) {
  const res = await fetch('api/state');
  const state = await res.json();
  renderState(state, questionAnswer);
}

async function resetSession() {
  await fetch('api/reset', { method: 'POST' });
  fetchAndRenderState();
}

micBtn.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});

// On page load, restore the active recipe if there was one (session memory).
fetchAndRenderState();
