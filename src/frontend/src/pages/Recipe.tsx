import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ShareButton from '../components/ShareButton';
import ThemeToggle from '../components/ThemeToggle';
import { stashPendingAudio } from '../lib/pendingAudio';
import { hasStepTimer, parseStepTimerSeconds, stepText, stepTip } from '../lib/timer';
import { getRecipe, startRecipe, type Recipe as RecipeData } from '../api';
import './Recipe.css';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; recipe: RecipeData }
  | { kind: 'not-found' }
  | { kind: 'error' };

/** "40:00" -> "40 min", for the badge next to a timed step. */
function timerLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * A recipe at its own address ("/r/<uuid>") -- the page a shared link opens.
 *
 * It deliberately shows the whole recipe WITHOUT starting it: someone who
 * has just been sent a link wants to see what the dish is, what it needs
 * and how long it takes before committing, not to land on step 1 with a
 * voice already talking. Starting is one tap away, and from there it's the
 * ordinary cooking session (Cook.tsx) -- a shared recipe is not a different
 * kind of recipe, just one you arrived at differently.
 */
export default function Recipe() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();

  const [view, setView] = useState<View>({ kind: 'loading' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) {
      setView({ kind: 'not-found' });
      return;
    }
    (async () => {
      try {
        const res = await getRecipe(uuid);
        setView(res.ok ? { kind: 'ready', recipe: res.recipe } : { kind: 'not-found' });
      } catch (err) {
        console.error(err);
        setView({ kind: 'error' });
      }
    })();
  }, [uuid]);

  useEffect(() => {
    if (view.kind === 'ready') document.title = `Cook-It · ${view.recipe.name}`;
    return () => { document.title = 'Cook-It'; };
  }, [view]);

  const handleStart = useCallback(async () => {
    if (!uuid) return;
    setStarting(true);
    setStartError(null);
    try {
      const data = await startRecipe(uuid);
      if (!data.ok) {
        setStartError(data.spoken_text || 'No he podido empezar esta receta.');
        return;
      }
      // The greeting plays on /cook, one beat later -- see lib/pendingAudio.
      stashPendingAudio(data);
      navigate('/cook');
    } catch (err) {
      console.error(err);
      setStartError('Error hablando con el servidor 😕');
    } finally {
      setStarting(false);
    }
  }, [navigate, uuid]);

  if (view.kind === 'loading') {
    return (
      <div className="recipe-page">
        <div className="recipe-sheet loading-hint">Cargando receta…</div>
      </div>
    );
  }

  if (view.kind !== 'ready') {
    // A uuid this install doesn't know: a link from someone else's Cook-It,
    // or one whose recipe was deleted. There's no lookup that can fix it,
    // so say so plainly and point back at what this machine does have.
    return (
      <div className="recipe-page">
        <div className="recipe-sheet recipe-missing">
          <div className="recipe-missing-title">
            {view.kind === 'not-found' ? '🤷 No conozco esta receta' : '😕 No he podido cargarla'}
          </div>
          <p>
            {view.kind === 'not-found'
              ? 'Este enlace no existe en esta cocina. Los enlaces solo funcionan en el Cook-It que los creó.'
              : 'Ha fallado la conexión con el servidor. Inténtalo otra vez.'}
          </p>
          <button className="recipe-start-btn" onClick={() => navigate('/')}>
            🏠 Ver las recetas de aquí
          </button>
        </div>
      </div>
    );
  }

  const { recipe } = view;

  return (
    <div className="recipe-page">
      <div className="recipe-sheet">
        <div className="recipe-topbar">
          <button className="recipe-back" onClick={() => navigate('/')} aria-label="Volver a las recetas">
            ⟵ Recetas
          </button>
          <ThemeToggle />
        </div>

        <h1 className="recipe-name">{recipe.name}</h1>
        <div className="recipe-meta">
          {recipe.servings && <span className="recipe-servings">🍽️ {String(recipe.servings)}</span>}
          <span className="recipe-steps-count">📋 {recipe.steps.length} pasos</span>
          {!recipe.verified_source && (
            // Curated recipes are hand-written; this one came out of the
            // LLM, and whoever opens the link deserves to know which it is.
            <span className="recipe-generated" title="Generada por el modelo, no revisada a mano">
              🤖 generada
            </span>
          )}
        </div>

        {recipe.summary && <p className="recipe-summary">{recipe.summary}</p>}

        <section className="recipe-section">
          <h2>Ingredientes</h2>
          <ul className="recipe-ingredients">
            {recipe.ingredients.map((ing, i) => (
              <li key={`${ing.item}-${i}`}>
                <span className="ingredient-item">{ing.item}</span>
                {(ing.amount || ing.unit) && (
                  <span className="ingredient-amount">
                    {[ing.amount, ing.unit].filter(Boolean).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="recipe-section">
          <h2>Pasos</h2>
          <ol className="recipe-steps">
            {recipe.steps.map((step, i) => (
              <li key={i}>
                <span className="step-body">{stepText(step)}</span>
                {hasStepTimer(step) && (
                  <span className="step-timer-badge">
                    ⏱️ {timerLabel(parseStepTimerSeconds(step) as number)}
                  </span>
                )}
                {stepTip(step) && <span className="step-tip">💡 {stepTip(step)}</span>}
              </li>
            ))}
          </ol>
        </section>

        {/* The dish's general advice. Anything specific to one step is
            printed with that step above -- see stepTip(). */}
        {recipe.tip && <div className="recipe-tip"><b>💡 Tip:</b> {recipe.tip}</div>}

        <div className="recipe-actions">
          <button className="recipe-start-btn" disabled={starting} onClick={() => void handleStart()}>
            {starting ? '🤔 Preparando…' : '👨‍🍳 Empezar a cocinar'}
          </button>
          <ShareButton uuid={recipe.uuid} name={recipe.name} />
        </div>
        {startError && <div className="recipe-error">{startError}</div>}
      </div>
    </div>
  );
}
