import { useCallback, useState } from 'react';
import {
  choosePantryRecipe, confirmPantryRecipe, excludePantryItems, resetPantry,
  submitPantryIngredients, uploadPantryPhoto,
  type PantryResponse, type PantryState, type VoiceResponse,
} from '../api';
import { downscaleImage } from '../lib/image';
import './PantryFlow.css';

interface PantryFlowProps {
  /** Recipe confirmed -- hand off to /cook (Picker owns the navigation). */
  onConfirmed: (data: Extract<VoiceResponse, { ok: true }>) => void;
  /** User backed out; Picker shows the normal recipe grid again. */
  onCancel: () => void;
}

/**
 * "Cook with what I have" (src/pantry.py): take a picture, correct what it
 * saw, pick from a few ideas, then whittle the recipe down to what's
 * actually in the kitchen before cooking starts.
 *
 * The detected ingredient list is EDITABLE on purpose: every vision model
 * misreads a cluttered counter sometimes, and a wrong ingredient here would
 * propagate into the recipe and every step after it. Cheaper to fix with a
 * tap than to unpick later.
 */
export default function PantryFlow({ onConfirmed, onCancel }: PantryFlowProps) {
  const [state, setState] = useState<PantryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [newIngredient, setNewIngredient] = useState('');

  /** Every backend call goes through here: one place to hold the spinner
   * label, surface the error text, and avoid double-submits. */
  const run = useCallback(
    async (label: string, fn: () => Promise<PantryResponse>) => {
      setBusy(true);
      setBusyLabel(label);
      setError('');
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error || 'Algo ha fallado, inténtalo otra vez.');
          return null;
        }
        setState(res.state);
        return res.state;
      } catch (err) {
        console.error(err);
        setError('Error hablando con el servidor 😕');
        return null;
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [],
  );

  async function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so picking the SAME file twice still fires onChange
    // (retaking a photo after a bad detection is a normal thing to do).
    event.target.value = '';
    if (!file) return;
    const small = await downscaleImage(file);
    await run('Mirando la foto…', () => uploadPantryPhoto(small));
  }

  function removeIngredient(name: string) {
    setState((s) => (s ? { ...s, ingredients: s.ingredients.filter((i) => i !== name) } : s));
  }

  function addIngredient() {
    const name = newIngredient.trim().toLowerCase();
    if (!name) return;
    setState((s) =>
      s && !s.ingredients.includes(name) ? { ...s, ingredients: [...s.ingredients, name] } : s,
    );
    setNewIngredient('');
  }

  async function handleCancel() {
    await resetPantry().catch(() => {});
    onCancel();
  }

  async function handleConfirm() {
    setBusy(true);
    setBusyLabel('Preparando la receta…');
    setError('');
    try {
      const data = await confirmPantryRecipe();
      if (!data.ok) {
        setError(data.error || 'No he podido empezar la receta.');
        return;
      }
      onConfirmed(data);
    } catch (err) {
      console.error(err);
      setError('Error hablando con el servidor 😕');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  const draft = state?.draft ?? null;

  return (
    <div className="card pantry">
      <div className="pantry-head">
        <div className="placeholder-title">📷 Cocina con lo que tienes</div>
        <button className="pantry-link" onClick={handleCancel} disabled={busy}>
          Cancelar
        </button>
      </div>

      {error && <div className="pantry-error">{error}</div>}
      {busy && <div className="pantry-busy">⏳ {busyLabel}</div>}

      {/* --- Step 1: take the picture ----------------------------------- */}
      {!state && !busy && (
        <>
          <p className="pantry-hint">
            Haz una foto de lo que tengas por la nevera o la encimera y te digo qué puedes cocinar.
          </p>
          <label className="pantry-photo-btn">
            {/* capture="environment" opens the rear camera directly on a
                phone; on a desktop browser it degrades to a file picker. */}
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
            📸 Hacer una foto
          </label>
        </>
      )}

      {/* --- Steps 2-3: correct what it saw, then ask for ideas ---------- */}
      {state && !draft && (
        <>
          <p className="pantry-hint">
            {state.ingredients.length > 0
              ? 'Esto es lo que he visto. Quita lo que no sea y añade lo que falte.'
              : 'No he reconocido nada en la foto. Añade a mano lo que tengas, o repite la foto con más luz.'}
          </p>

          <ul className="pantry-chips">
            {state.ingredients.map((name) => (
              <li key={name}>
                {name}
                <button
                  onClick={() => removeIngredient(name)}
                  disabled={busy}
                  aria-label={`Quitar ${name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="pantry-add">
            <input
              value={newIngredient}
              onChange={(e) => setNewIngredient(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addIngredient()}
              placeholder="Añadir ingrediente…"
              disabled={busy}
            />
            <button onClick={addIngredient} disabled={busy || !newIngredient.trim()}>
              Añadir
            </button>
          </div>

          <button
            className="pantry-primary"
            disabled={busy || state.ingredients.length === 0}
            onClick={() =>
              run('Buscando recetas…', () => submitPantryIngredients(state.ingredients))
            }
          >
            🔎 Buscar recetas
          </button>

          {/* --- Step 4: the proposals --- */}
          {state.suggestions.length > 0 && (
            <div className="pantry-suggestions">
              {state.suggestions.map((s) => (
                <button
                  key={s.name}
                  className="pantry-suggestion"
                  disabled={busy}
                  onClick={() => run('Escribiendo la receta…', () => choosePantryRecipe(s.name))}
                >
                  <span className="pantry-suggestion-name">{s.name}</span>
                  {s.why && <span className="pantry-suggestion-why">{s.why}</span>}
                  <span className="pantry-suggestion-missing">
                    {s.missing.length === 0
                      ? '✅ Lo tienes todo'
                      : `Te faltaría: ${s.missing.join(', ')}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* --- Steps 5-6: the checklist, and the "no tengo X" loop --------- */}
      {draft && (
        <>
          <div className="pantry-draft-name">{draft.name}</div>
          {draft.summary && <p className="pantry-hint">{draft.summary}</p>}

          {state!.excluded.length > 0 && (
            <p className="pantry-excluded">Sin: {state!.excluded.join(', ')}</p>
          )}

          {draft.missing.length > 0 ? (
            <>
              <p className="pantry-hint">
                <strong>¿Tienes todo esto?</strong> Toca lo que te falte y reescribo la receta sin
                ello.
              </p>
              <ul className="pantry-chips missing">
                {draft.missing.map((item) => (
                  <li key={item}>
                    {item}
                    <button
                      onClick={() => run('Rehaciendo la receta…', () => excludePantryItems([item]))}
                      disabled={busy}
                      aria-label={`No tengo ${item}`}
                    >
                      no tengo
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="pantry-hint">✅ Con lo que tienes te llega para esta receta.</p>
          )}

          <button className="pantry-primary" onClick={handleConfirm} disabled={busy}>
            👨‍🍳 Sí, tengo todo — ¡a cocinar!
          </button>
          <button
            className="pantry-link"
            disabled={busy}
            onClick={() => setState((s) => (s ? { ...s, draft: null } : s))}
          >
            ← Ver otras ideas
          </button>
        </>
      )}
    </div>
  );
}
