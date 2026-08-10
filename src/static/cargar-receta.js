// "Cargar mi receta": dicta una receta entera de viva voz (sin límite de
// tiempo, a diferencia del botón de micrófono principal que graba 6s fijos
// para comandos cortos) y la app la sube para transcribirla + estructurarla
// con el LLM local. El usuario revisa/edita el resultado antes de guardarlo
// -- nada se persiste hasta que pulsa "Guardar receta" (ver /api/recipes/save
// en api.py).

const recBtn = document.getElementById('recBtn');
const statusText = document.getElementById('statusText');
const hint = document.getElementById('hint');
const transcriptBox = document.getElementById('transcriptBox');
const recipeForm = document.getElementById('recipeForm');
const fName = document.getElementById('fName');
const fServings = document.getElementById('fServings');
const fIngredients = document.getElementById('fIngredients');
const fSteps = document.getElementById('fSteps');
const saveBtn = document.getElementById('saveBtn');
const saveMsg = document.getElementById('saveMsg');

let mediaRecorder = null;
let chunks = [];
let recording = false;

function setStatus(text, btnClass) {
  statusText.textContent = text;
  recBtn.classList.remove('recording', 'thinking');
  if (btnClass) recBtn.classList.add(btnClass);
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
      uploadRecipeAudio(new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' }));
    };
    mediaRecorder.start();
    recording = true;
    hint.textContent = 'Toca de nuevo cuando termines de dictar';
    setStatus('🎙️ Escuchando… cuenta el nombre, ingredientes y pasos', 'recording');
  } catch (err) {
    setStatus('No pude acceder al micrófono 😕', null);
    console.error(err);
  }
}

function stopRecording() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  recBtn.disabled = true;
  hint.textContent = '';
  mediaRecorder.stop();
}

function ingredientsToText(ingredients) {
  return (ingredients || [])
    .map((ing) => [ing.item || '', ing.amount ?? '', ing.unit || ''].join(', '))
    .join('\n');
}

// Parses "item, cantidad, unidad" lines back into the schema the API
// expects. Cantidad is only kept if it parses as a number -- otherwise the
// backend would silently coerce it to null anyway, better to do it here so
// what's shown in the field matches what gets saved.
function textToIngredients(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [item, amount, unit] = line.split(',').map((p) => (p || '').trim());
      const parsedAmount = amount && !isNaN(parseFloat(amount)) ? parseFloat(amount) : null;
      return { item, amount: parsedAmount, unit: unit || null };
    })
    .filter((ing) => ing.item);
}

function textToSteps(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function uploadRecipeAudio(blob) {
  setStatus('🤔 Transcribiendo e interpretando la receta…', 'thinking');
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  try {
    const res = await fetch('api/recipes/upload', { method: 'POST', body: form });
    const data = await res.json();
    recBtn.disabled = false;

    if (!data.ok) {
      setStatus(data.error || 'No te he entendido, prueba otra vez', null);
      return;
    }

    transcriptBox.hidden = false;
    transcriptBox.textContent = `"${data.transcript}"`;

    const r = data.recipe || {};
    fName.value = r.name || '';
    fServings.value = r.servings ?? '';
    fIngredients.value = ingredientsToText(r.ingredients);
    fSteps.value = (r.steps || []).join('\n');

    recipeForm.hidden = false;
    setStatus('✅ Revisa la receta y corrige lo que haga falta', null);
    hint.textContent = 'Toca el micrófono para dictar otra receta';
  } catch (err) {
    recBtn.disabled = false;
    setStatus('Error hablando con el servidor 😕', null);
    console.error(err);
  }
}

recBtn.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  saveMsg.className = '';
  saveMsg.textContent = 'Guardando…';

  const body = {
    name: fName.value.trim(),
    servings: fServings.value ? parseInt(fServings.value, 10) : null,
    ingredients: textToIngredients(fIngredients.value),
    steps: textToSteps(fSteps.value),
  };

  try {
    const res = await fetch('api/recipes/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      saveMsg.className = 'err';
      saveMsg.textContent = `😕 ${data.error || 'No se pudo guardar la receta'}`;
      return;
    }
    saveMsg.className = 'ok';
    saveMsg.textContent = `✅ "${data.recipe.name}" guardada -- ya puedes pedirla por voz o elegirla en la pantalla principal.`;
  } catch (err) {
    saveMsg.className = 'err';
    saveMsg.textContent = '😕 Error hablando con el servidor';
    console.error(err);
  } finally {
    saveBtn.disabled = false;
  }
});
