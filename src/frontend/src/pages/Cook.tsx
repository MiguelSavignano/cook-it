import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StepTimer from '../components/StepTimer';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useMicRecorder } from '../hooks/useMicRecorder';
import { useStepTimer } from '../hooks/useStepTimer';
import { parseStepTimerSeconds, stepText } from '../lib/timer';
import {
  askQuestion, getState, isActiveState, nextStep, previousStep, resetSession,
  type RecipeState, type StepData, type VoiceResponse,
} from '../api';
import './Cook.css';

/**
 * What the voice flow is currently doing: idle (waiting), listening
 * (recording), thinking (waiting for the LLM), speaking (an answer's audio
 * is playing), happy (recipe finished), confused (something went wrong).
 * Drives the mic button's styling and the caption under it, and decides
 * whether the step timer gets the slot instead (see showTimer below).
 */
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused';

const DEFAULT_HINTS: Record<VoiceState, string> = {
  idle: 'Toca el micrófono para preguntar',
  listening: '🎙️ Escuchando…',
  thinking: '🤔 Pensando…',
  speaking: '',
  happy: 'Toca el micrófono para pedir otra receta',
  confused: '',
};

type CookView =
  | { kind: 'loading' }
  | { kind: 'active'; state: RecipeState }
  | { kind: 'finished'; name: string; tip?: string };

// A recipe just picked/created on "/" carries a spoken greeting (summary +
// step 1) that couldn't be played there without navigation killing it
// mid-sentence -- see Picker.tsx's goToCook(). Played here instead, once.
const PENDING_AUDIO_KEY = 'cookit_pending_audio';

/**
 * The hands-free cooking route: mic button + step navigation. Separate
 * page from Picker ("/") on purpose -- different layout (landscape-mobile,
 * buttons pinned to the screen edges), different job (step through a
 * recipe hands-free, not pick/create one).
 */
export default function Cook() {
  const navigate = useNavigate();
  const audio = useAudioPlayer();
  const stepTimer = useStepTimer();

  const [view, setView] = useState<CookView>({ kind: 'loading' });
  const [voiceState, setVoiceStateRaw] = useState<VoiceState>('idle');
  const [voiceHint, setVoiceHint] = useState<string | undefined>(undefined);
  const [userText, setUserText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [navBusy, setNavBusy] = useState(false);

  // `hint` overrides the state's default caption (e.g. a specific error
  // message); omit it to fall back to DEFAULT_HINTS[state].
  const setVoiceState = useCallback((state: VoiceState, hint?: string) => {
    setVoiceStateRaw(state);
    setVoiceHint(hint);
  }, []);

  // If there's audio, "speaking" until it ends, then back to idle;
  // otherwise idle right away. Every voice/button response goes through
  // this exact same path.
  const speak = useCallback(
    (audioBase64?: string, audioMime?: string) => {
      if (audioBase64) {
        setVoiceState('speaking');
        audio.play(audioBase64, audioMime, () => setVoiceState('idle'));
      } else {
        setVoiceState('idle');
      }
    },
    [audio, setVoiceState],
  );

  const applyState = useCallback((state: RecipeState) => {
    setView({ kind: 'active', state });
    stepTimer.setSeconds(parseStepTimerSeconds(state.steps[state.current_step]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderFinished = useCallback(
    (d: StepData) => {
      stepTimer.setSeconds(null);
      setVoiceState('happy');
      setView({ kind: 'finished', name: d.name || '', tip: d.tip });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [setVoiceState],
  );

  const refreshState = useCallback(async () => {
    const state = await getState();
    if (!isActiveState(state)) {
      // Nothing to cook here (finished and already left, reset elsewhere,
      // or this route was opened directly without picking a recipe first).
      navigate('/');
      return;
    }
    applyState(state);
  }, [applyState, navigate]);

  function handleVoiceResult(data: VoiceResponse) {
    if (!data.ok) return;
    if (data.type === 'question') {
      // Doesn't touch the current step -- just show the answer, keep going.
      setAnswer(data.spoken_text);
      return;
    }
    // type === 'new_recipe': the user asked, mid-cooking, to switch to a
    // different recipe -- reload the full state (steps reset to step 1).
    setAnswer(null);
    void refreshState();
  }

  const sendAudio = useCallback(
    async (blob: Blob) => {
      setVoiceState('thinking');
      try {
        const data = await askQuestion(blob);
        speak(data.audio_base64, data.audio_mime);
        if (!data.ok) {
          setVoiceState('confused', data.spoken_text || 'No te he entendido, prueba otra vez');
          return;
        }
        setUserText(data.user_text ? `"${data.user_text}"` : '');
        handleVoiceResult(data);
      } catch (err) {
        setVoiceState('confused', 'Error hablando con el servidor 😕');
        console.error(err);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [speak, setVoiceState],
  );

  const mic = useMicRecorder({
    onRecorded: sendAudio,
    onError: (err) => {
      setVoiceState('confused', 'No pude acceder al micrófono 😕');
      console.error(err);
    },
  });

  // Recording just started -- clear whatever question/answer was on screen
  // and switch the mic to "listening" (mirrors the old startRecording()).
  useEffect(() => {
    if (mic.recording) {
      setUserText('');
      setAnswer(null);
      setVoiceState('listening');
    }
  }, [mic.recording, setVoiceState]);

  async function buttonAction(action: () => Promise<VoiceResponse<StepData>>) {
    setNavBusy(true);
    setVoiceState('thinking');
    setUserText('');
    setAnswer(null);
    try {
      const data = await action();
      speak(data.audio_base64, data.audio_mime);
      if (!data.ok) {
        // No active recipe anymore (cleared elsewhere) -- nothing to step
        // through here, back to the picker.
        navigate('/');
        return;
      }
      if (data.data.finished) {
        renderFinished(data.data);
      } else {
        await refreshState();
      }
    } catch (err) {
      setVoiceState('confused', 'Error hablando con el servidor 😕');
      console.error(err);
    } finally {
      setNavBusy(false);
    }
  }

  // "Empezar otra receta": going back to "/" WITHOUT clearing the session
  // would just bounce straight back here (Picker redirects to /cook
  // whenever a recipe is active) -- so this is the one control that
  // actually resets.
  async function handleBack() {
    try {
      await resetSession();
    } catch (err) {
      console.error(err);
    }
    navigate('/');
  }

  useEffect(() => {
    document.title = 'Cook-It · Cocinando';
    return () => { document.title = 'Cook-It'; };
  }, []);

  // On mount: play a pending greeting from Picker (if any), then load the
  // active recipe's state.
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_AUDIO_KEY);
    if (raw) {
      sessionStorage.removeItem(PENDING_AUDIO_KEY);
      try {
        const { audio_base64, audio_mime } = JSON.parse(raw);
        if (audio_base64) speak(audio_base64, audio_mime);
      } catch (err) {
        console.error(err);
      }
    }
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showTimer = view.kind === 'active' && voiceState === 'idle' && stepTimer.seconds !== null;
  const finished = view.kind === 'finished';

  return (
    <div className="cook-stage">
      <button
        className="side-nav prev"
        title="Paso anterior"
        aria-label="Paso anterior"
        hidden={finished}
        disabled={navBusy || (view.kind === 'active' && view.state.current_step === 0)}
        onClick={() => void buttonAction(previousStep)}
      >
        <span className="arrow">‹</span><span className="side-label">Anterior</span>
      </button>

      <div className="cook-center">
        <div className="cook-topbar">
          <button className="back-btn" title="Empezar otra receta" aria-label="Empezar otra receta" onClick={() => void handleBack()}>⟵</button>
          <div className="cook-title">
            {view.kind === 'loading' ? 'Cargando…' : view.kind === 'finished' ? view.name : view.state.name}
          </div>
          <div className="cook-progress">
            {view.kind === 'active' && (
              <div className="dots">
                {view.state.steps.map((_, i) => (
                  <div
                    key={i}
                    className={`dot ${i < view.state.current_step ? 'done' : i === view.state.current_step ? 'current' : ''}`}
                  />
                ))}
              </div>
            )}
            <div className="progress-label">
              {view.kind === 'active' && `Paso ${view.state.current_step + 1} de ${view.state.steps.length}`}
              {view.kind === 'finished' && '¡Terminado! 🎉'}
            </div>
          </div>
        </div>

        <div className="voice-wrap">
          {showTimer && view.kind === 'active' ? (
            <StepTimer
              seconds={stepTimer.seconds as number}
              phase={stepTimer.phase}
              display={stepTimer.display}
              message={stepTimer.message}
              onStart={stepTimer.start}
              onCancel={stepTimer.cancel}
            />
          ) : (
            <>
              <button
                className={`cook-mic ${voiceState !== 'idle' ? voiceState : ''}`}
                title="Toca y habla"
                aria-label="Hacer una pregunta por voz"
                onClick={() => mic.toggle()}
              >
                🎤
              </button>
              <div className="voice-hint">{voiceHint ?? DEFAULT_HINTS[voiceState]}</div>
            </>
          )}
        </div>

        <div className="step-area">
          <div className="user-text">{userText}</div>
          {answer !== null && <div className="answer-box">🗣️ {answer}</div>}
          <div className="current-step">
            {view.kind === 'loading' && 'Cargando…'}
            {view.kind === 'active' && stepText(view.state.steps[view.state.current_step])}
            {view.kind === 'finished' && <div className="finished-msg">🎉 ¡Receta terminada! Buen provecho.</div>}
          </div>
          {view.kind === 'active' && view.state.tip && (
            <div className="tip-box"><b>💡 Tip:</b> {view.state.tip}</div>
          )}
          {view.kind === 'finished' && view.tip && (
            <div className="tip-box"><b>💡 Tip:</b> {view.tip}</div>
          )}
          {finished && (
            <button className="home-btn" onClick={() => navigate('/')}>🏠 Volver a recetas</button>
          )}
        </div>
      </div>

      <button
        className="side-nav next"
        title="Paso siguiente"
        aria-label="Paso siguiente"
        hidden={finished}
        disabled={navBusy}
        onClick={() => void buttonAction(nextStep)}
      >
        <span className="arrow">›</span><span className="side-label">Siguiente</span>
      </button>
    </div>
  );
}
