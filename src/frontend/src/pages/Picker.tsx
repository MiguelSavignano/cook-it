import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import RecipeList from '../components/RecipeList';
import CookingLoader from '../components/CookingLoader';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useMicRecorder } from '../hooks/useMicRecorder';
import {
  askQuestion, getState, isActiveState, listRecipes, selectRecipe,
  type RecipeListItem,
} from '../api';
import './Picker.css';

type StatusVariant = 'idle' | 'listening' | 'thinking';

// A recipe just picked/created here carries a spoken greeting (summary +
// step 1) that couldn't be played on this page without navigation killing
// it mid-sentence -- stashed for Cook.tsx to pick up and play once mounted,
// one beat later.
const PENDING_AUDIO_KEY = 'cookit_pending_audio';

/**
 * The recipe picker/creator ("/"): mic button (new recipe or, indirectly,
 * a follow-up question once redirected) + a tap-to-pick local recipe list.
 * The active-recipe view (steps, progress, next/previous) lives on its own
 * route -- see Cook.tsx -- so this page only ever shows the picker.
 */
export default function Picker() {
  const navigate = useNavigate();
  const audio = useAudioPlayer();

  const [recipes, setRecipes] = useState<RecipeListItem[] | null>(null);
  const [statusVariant, setStatusVariant] = useState<StatusVariant>('idle');
  const [statusText, setStatusText] = useState<ReactNode>('Toca el micrófono y pide una receta');
  const [userText, setUserText] = useState('');
  const [busy, setBusy] = useState(false);

  const resetToIdle = useCallback(() => {
    setStatusVariant('idle');
    setStatusText('Toca el micrófono y pide una receta');
  }, []);

  // Hands off to the dedicated cooking route (Cook.tsx) once a recipe is
  // active -- this page only ever picks/creates a recipe, never steps
  // through one.
  const goToCook = useCallback(
    (data: { audio_base64?: string; audio_mime?: string }) => {
      if (data.audio_base64) {
        sessionStorage.setItem(
          PENDING_AUDIO_KEY,
          JSON.stringify({ audio_base64: data.audio_base64, audio_mime: data.audio_mime }),
        );
      }
      navigate('/cook');
    },
    [navigate],
  );

  const sendAudio = useCallback(
    async (blob: Blob) => {
      // On THIS page a recipe is never already active (see the mount
      // effect below -- an active one redirects away immediately), so the
      // mic here always means "create/find a recipe", never a follow-up
      // question about one already on screen. That's a slower,
      // gemma3-backed call, hence the "creando tu receta" loader instead
      // of a plain "pensando".
      setBusy(true);
      setStatusVariant('thinking');
      setStatusText(<CookingLoader />);
      try {
        const data = await askQuestion(blob);
        if (!data.ok) {
          if (data.audio_base64) audio.play(data.audio_base64, data.audio_mime);
          setStatusVariant('idle');
          setStatusText(data.spoken_text || 'No te he entendido, prueba otra vez');
          return;
        }
        setUserText(data.user_text ? `"${data.user_text}"` : '');
        goToCook(data);
      } catch (err) {
        setStatusVariant('idle');
        setStatusText('Error hablando con el servidor 😕');
        console.error(err);
      } finally {
        setBusy(false);
      }
    },
    [audio, goToCook],
  );

  const mic = useMicRecorder({
    onRecorded: sendAudio,
    onError: (err) => {
      setStatusVariant('idle');
      setStatusText('No pude acceder al micrófono 😕');
      console.error(err);
    },
  });

  // Recording just started -- mirrors the old startRecording().
  useEffect(() => {
    if (mic.recording) {
      setUserText('');
      setStatusVariant('listening');
      setStatusText('🎙️ Escuchando… habla ahora');
    }
  }, [mic.recording]);

  async function handleSelectRecipe(name: string) {
    // Tapping a recipe card: starts that recipe directly, same result
    // shape as asking for it by voice, but skips STT entirely. Local
    // recipes always have their summary/tip cached, so this is just as
    // close to instant as "Next"/"Previous" -- no LLM call either.
    setStatusVariant('thinking');
    setStatusText('🤔 Pensando…');
    try {
      const data = await selectRecipe(name);
      if (!data.ok) {
        if (data.audio_base64) audio.play(data.audio_base64, data.audio_mime);
        setStatusVariant('idle');
        setStatusText(data.spoken_text || 'No he encontrado esa receta, prueba con otra.');
        return;
      }
      goToCook(data);
    } catch (err) {
      setStatusVariant('idle');
      setStatusText('Error hablando con el servidor 😕');
      console.error(err);
    }
  }

  // On load: if a recipe is already active (session memory from a previous
  // visit), skip straight to the cooking route instead of showing the
  // picker; otherwise load the local recipe list for the tap-to-pick grid.
  useEffect(() => {
    (async () => {
      const state = await getState();
      if (isActiveState(state)) {
        navigate('/cook');
        return;
      }
      resetToIdle();
      try {
        setRecipes(await listRecipes());
      } catch (err) {
        console.error(err);
        setRecipes([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="picker-page">
      <header>
        <h1>🍳 Cook-It</h1>
        <p>Tu ayudante de cocina, 100% local y por voz</p>
      </header>

      <div className="stage">
        <div className="mic-wrap">
          <button
            id="micBtn"
            className={statusVariant !== 'idle' ? statusVariant : undefined}
            title="Toca y habla"
            disabled={busy}
            onClick={() => mic.toggle()}
          >
            🎤
          </button>
          <div id="statusText">{statusText}</div>
          <div id="userText">{userText}</div>
        </div>

        <div className="card placeholder">
          <div className="placeholder-title">👨‍🍳 ¿Qué cocinamos hoy?</div>
          <RecipeList recipes={recipes} onSelect={handleSelectRecipe} />
          <div className="examples">
            <span>O pide cualquier otra por voz: "Cómo se hace una paella"</span>
          </div>
        </div>
      </div>

      <footer>Todo corre en tu ordenador: whisper (STT) · gemma3 vía Ollama (LLM) · Piper (TTS)</footer>
    </div>
  );
}
