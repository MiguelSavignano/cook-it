// Cook-It "cooking" route: the animated face + step navigation shown once a
// recipe is active. Split out from index.html/app.js (the recipe picker/
// creator) on purpose -- different layout (landscape-mobile, buttons pinned
// to the screen edges), different job (step through a recipe hands-free,
// not pick/create one). See api.py's "/cook" route and app.js's goToCook().

const RECORD_MS = 6000;

const face = document.getElementById('face');
const pupilLeft = document.getElementById('pupilLeft');
const pupilRight = document.getElementById('pupilRight');
const faceWrap = document.getElementById('faceWrap');
const faceHint = document.getElementById('faceHint');
const backBtn = document.getElementById('backBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const recipeTitle = document.getElementById('recipeTitle');
const dotsEl = document.getElementById('dots');
const progressLabel = document.getElementById('progressLabel');
const currentStepEl = document.getElementById('currentStep');
const userTextEl = document.getElementById('userText');
const answerBox = document.getElementById('answerBox');
const tipBox = document.getElementById('tipBox');
const homeBtn = document.getElementById('homeBtn');

let mediaRecorder = null;
let chunks = [];
let recording = false;

// ---------- Face expression state machine ----------
// One state at a time: idle (default -- wandering eyes, occasional blink,
// as if thinking about the recipe), listening (recording), thinking
// (waiting for the LLM), speaking (an answer's audio is playing), happy
// (recipe finished), confused (something went wrong).

const FACE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'confused'];
const DEFAULT_HINTS = {
  idle: 'Toca la cara para preguntar',
  listening: '🎙️ Escuchando…',
  thinking: '🤔 Pensando…',
  speaking: '',
  happy: 'Toca la cara para pedir otra receta',
  confused: '',
};
let eyeTimer = null;
let blinkTimer = null;

function lookAt(x, y) {
  const t = `translate(${x}px, ${y}px)`;
  pupilLeft.style.transform = t;
  pupilRight.style.transform = t;
}

// Small random look within the eye socket. Biased slightly upward so idle
// reads as "thinking about it" rather than a blank stare -- the "expresión
// de pensar" that was asked for.
function randomLook(spreadX, spreadY) {
  const x = (Math.random() - 0.5) * spreadX * 2;
  const y = (Math.random() - 0.5) * spreadY * 2 - Math.random() * 1.5;
  lookAt(x.toFixed(1), y.toFixed(1));
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    face.classList.add('blink');
    setTimeout(() => face.classList.remove('blink'), 140);
    scheduleBlink();
  }, 3000 + Math.random() * 3500);
}

// `hint` overrides the state's default caption (e.g. a specific error
// message); omit it to fall back to DEFAULT_HINTS[state].
function setFaceState(state, hint) {
  face.className = `face state-${state}`;
  faceHint.textContent = hint !== undefined ? hint : (DEFAULT_HINTS[state] || '');
  clearInterval(eyeTimer);
  eyeTimer = null;
  if (state === 'idle') {
    // Slow wander "de vez en cuando": a fresh look every few seconds.
    randomLook(4, 3);
    eyeTimer = setInterval(() => randomLook(4, 3), 2800 + Math.random() * 2400);
  } else if (state === 'thinking') {
    // Faster darting while it's actively working something out.
    randomLook(6, 5);
    eyeTimer = setInterval(() => randomLook(6, 5), 450 + Math.random() * 350);
  } else if (state === 'listening') {
    lookAt(0, -1); // attentive, looking straight at you
  } else {
    lookAt(0, 0);
  }
}

// ---------- Recording (tap the face to ask a question) ----------

function playAudioB64(base64, mime) {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const blob = new Blob([buf], { type: mime || 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const player = new Audio(url);
  setFaceState('speaking');
  const backToIdle = () => setFaceState('idle');
  player.addEventListener('ended', () => { URL.revokeObjectURL(url); backToIdle(); });
  player.addEventListener('error', backToIdle);
  player.play().catch((err) => {
    console.error('No se pudo reproducir el audio:', err);
    backToIdle();
  });
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
    userTextEl.textContent = '';
    hideAnswer();
    setFaceState('listening');
    setTimeout(() => { if (recording) stopRecording(); }, RECORD_MS);
  } catch (err) {
    setFaceState('confused', 'No pude acceder al micrófono 😕');
    console.error(err);
  }
}

function stopRecording() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  mediaRecorder.stop();
}

async function sendAudio(blob) {
  setFaceState('thinking');
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  try {
    const res = await fetch('api/question', { method: 'POST', body: form });
    const data = await res.json();

    if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
    else setFaceState('idle');

    if (!data.ok) {
      setFaceState('confused', data.spoken_text || 'No te he entendido, prueba otra vez');
      return;
    }

    userTextEl.textContent = data.user_text ? `"${data.user_text}"` : '';
    handleVoiceResult(data);
  } catch (err) {
    setFaceState('confused', 'Error hablando con el servidor 😕');
    console.error(err);
  }
}

function handleVoiceResult(data) {
  if (data.type === 'question') {
    // Doesn't touch the current step -- just show the answer, keep going.
    showAnswer(data.spoken_text);
    return;
  }
  // type === 'new_recipe': the user asked, mid-cooking, to switch to a
  // different recipe -- reload the full state (steps reset to step 1).
  hideAnswer();
  fetchAndRenderState();
}

function showAnswer(text) {
  answerBox.hidden = false;
  answerBox.textContent = `🗣️ ${text}`;
}

function hideAnswer() {
  answerBox.hidden = true;
  answerBox.textContent = '';
}

faceWrap.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});

// ---------- Step navigation (no recording, no LLM -- session memory) ----------

async function buttonAction(endpoint, btn) {
  btn.disabled = true;
  setFaceState('thinking');
  userTextEl.textContent = '';
  hideAnswer();
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();

    if (data.audio_base64) playAudioB64(data.audio_base64, data.audio_mime);
    else setFaceState('idle');

    if (!data.ok) {
      // No active recipe anymore (cleared elsewhere) -- nothing to step
      // through here, back to the picker.
      window.location.href = './';
      return;
    }

    if (data.data && data.data.finished) {
      renderFinished(data.data);
    } else {
      await fetchAndRenderState();
    }
  } catch (err) {
    setFaceState('confused', 'Error hablando con el servidor 😕');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

prevBtn.addEventListener('click', () => buttonAction('api/previous', prevBtn));
nextBtn.addEventListener('click', () => buttonAction('api/next', nextBtn));

// "Empezar otra receta": going back to "/" WITHOUT clearing the session
// would just bounce straight back here (app.js redirects to /cook whenever
// a recipe is active) -- so this is the one control that actually resets.
backBtn.addEventListener('click', async () => {
  try { await fetch('api/reset', { method: 'POST' }); } catch (err) { console.error(err); }
  window.location.href = './';
});
homeBtn.addEventListener('click', () => { window.location.href = './'; });

// ---------- State rendering ----------

function renderFinished(d) {
  setFaceState('happy');
  prevBtn.hidden = true;
  nextBtn.hidden = true;
  homeBtn.hidden = false;
  recipeTitle.textContent = d.name || '';
  dotsEl.innerHTML = '';
  progressLabel.textContent = '¡Terminado! 🎉';
  currentStepEl.innerHTML = '<div class="finished-msg">🎉 ¡Receta terminada! Buen provecho.</div>';
  if (d.tip) {
    tipBox.hidden = false;
    tipBox.innerHTML = `<b>💡 Tip:</b> ${d.tip}`;
  } else {
    tipBox.hidden = true;
  }
}

function renderState(state) {
  prevBtn.hidden = false;
  nextBtn.hidden = false;
  homeBtn.hidden = true;

  const total = state.steps.length;
  const current = state.current_step;

  recipeTitle.textContent = state.name;
  dotsEl.innerHTML = state.steps.map((_, i) => {
    const cls = i < current ? 'done' : (i === current ? 'current' : '');
    return `<div class="dot ${cls}"></div>`;
  }).join('');
  progressLabel.textContent = `Paso ${current + 1} de ${total}`;
  currentStepEl.textContent = state.steps[current];
  prevBtn.disabled = current === 0;

  if (state.tip) {
    tipBox.hidden = false;
    tipBox.innerHTML = `<b>💡 Tip:</b> ${state.tip}`;
  } else {
    tipBox.hidden = true;
  }
}

async function fetchAndRenderState() {
  const res = await fetch('api/state');
  const state = await res.json();
  if (!state || state.active === false) {
    // Nothing to cook here (finished and already left, reset elsewhere, or
    // this route was opened directly without picking a recipe first).
    window.location.href = './';
    return;
  }
  renderState(state);
}

// A recipe just picked/created on "/" carries a spoken greeting (summary +
// step 1) that couldn't be played there without navigation killing it
// mid-sentence -- see app.js's goToCook(). Play it here instead, once.
function playPendingAudioIfAny() {
  const raw = sessionStorage.getItem('cookit_pending_audio');
  if (!raw) return;
  sessionStorage.removeItem('cookit_pending_audio');
  try {
    const { audio_base64, audio_mime } = JSON.parse(raw);
    if (audio_base64) playAudioB64(audio_base64, audio_mime);
  } catch (err) {
    console.error(err);
  }
}

setFaceState('idle');
scheduleBlink();
playPendingAudioIfAny();
fetchAndRenderState();
