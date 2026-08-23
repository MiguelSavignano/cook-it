import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StepTimer from '../components/StepTimer';
import { Book, Bulb, Check, ChevronDown, ChevronLeft, ChevronUp, Home, Mic } from '../components/icons';
import ThemeToggle from '../components/ThemeToggle';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useMicRecorder } from '../hooks/useMicRecorder';
import { useStepTimer } from '../hooks/useStepTimer';
import { useSwipeNav } from '../hooks/useSwipeNav';
import { parseStepTimerSeconds, stepText, stepTip } from '../lib/timer';
import {
  askQuestion, getState, isActiveState, nextStep, previousStep, resetSession,
  type RecipeState, type StepData, type VoiceResponse,
} from '../api';
import './Cook.css';

/**
 * What the voice flow is currently doing: idle (waiting), listening
 * (recording), thinking (waiting for the LLM), speaking (an answer's audio
 * is playing), happy (recipe finished), confused (something went wrong).
 * Drives the ask bar's styling and its label.
 */
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused';

const DEFAULT_HINTS: Record<VoiceState, string> = {
  idle: 'Pregunta sobre este paso',
  listening: 'Escuchando…',
  thinking: 'Pensando…',
  speaking: 'Hablando…',
  happy: 'Pide otra receta',
  confused: 'Prueba otra vez',
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
 * The strip doesn't scroll -- everything has to fit -- so a long step is
 * set smaller rather than pushed off screen. Thresholds are in characters
 * and were picked against the longest steps in src/recipes/.
 */
function headlineSize(text: string): 'lg' | 'md' | 'sm' {
  if (text.length > 180) return 'sm';
  if (text.length > 90) return 'md';
  return 'lg';
}

// Geometry of the node on the rail, shared by the CSS and the ring's maths.
const RING_SIZE = 52;
const RING_RADIUS = 24;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The hands-free cooking route: the recipe as one vertical strip you swipe
 * through -- what's done sits above, the current step is expanded in the
 * middle, what's next peeks below. Swipe UP for the next step (the strip
 * moves the way the recipe reads), DOWN to go back.
 *
 * The strip starts one position BEFORE step 1, on the recipe itself: the
 * summary the assistant speaks as a greeting, plus the dish's one piece of
 * general advice. That's local to this page -- the server's current_step
 * still counts instructions only -- so moving between the intro and step 1
 * costs no request and no speech.
 *
 * Separate page from Picker ("/") on purpose: different layout
 * (portrait-phone, one thumb, nothing to aim at) and a different job (step
 * through a recipe with your hands busy, not pick/create one).
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
  // Which way the last step change went, so the incoming step animates in
  // from the side it actually came from.
  const [navDir, setNavDir] = useState<'up' | 'down'>('up');
  // Sitting on the recipe intro rather than on a step (see the note above).
  const [atIntro, setAtIntro] = useState(true);

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
    // A step change (button, swipe or "siguiente paso" by voice) means we're
    // past the intro; only a deliberate swipe back down returns to it.
    if (state.current_step > 0) setAtIntro(false);
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
        setVoiceState('confused', 'Error hablando con el servidor');
        console.error(err);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [speak, setVoiceState],
  );

  const mic = useMicRecorder({
    onRecorded: sendAudio,
    onError: (err) => {
      setVoiceState('confused', 'No pude acceder al micrófono');
      console.error(err);
    },
  });

  // Recording just started -- clear whatever question/answer was on screen
  // and switch to "listening".
  useEffect(() => {
    if (mic.recording) {
      setUserText('');
      setAnswer(null);
      setVoiceState('listening');
    }
  }, [mic.recording, setVoiceState]);

  const buttonAction = useCallback(
    async (action: () => Promise<VoiceResponse<StepData>>) => {
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
        setVoiceState('confused', 'Error hablando con el servidor');
        console.error(err);
      } finally {
        setNavBusy(false);
      }
    },
    [navigate, refreshState, renderFinished, setVoiceState, speak],
  );

  const atFirstStep = view.kind === 'active' && view.state.current_step === 0;
  const finished = view.kind === 'finished';

  const goNext = useCallback(() => {
    setNavDir('up');
    // Leaving the intro just uncovers step 1, which the server is already
    // on -- asking it to advance would skip a step.
    if (atIntro) {
      setAtIntro(false);
      return;
    }
    void buttonAction(nextStep);
  }, [atIntro, buttonAction]);

  const goPrevious = useCallback(() => {
    setNavDir('down');
    if (atIntro) return;
    if (atFirstStep) {
      setAtIntro(true);
      return;
    }
    void buttonAction(previousStep);
  }, [atFirstStep, atIntro, buttonAction]);

  const swipe = useSwipeNav({
    onNext: goNext,
    onPrevious: goPrevious,
    disabled: navBusy || finished || view.kind === 'loading',
  });

  // Arrow keys do what the swipe does -- a swipe is unreachable by keyboard,
  // and this page is just as usable on a laptop propped up in the kitchen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (navBusy || finished) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') goPrevious();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, goNext, goPrevious, navBusy]);

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

  const showTimer = view.kind === 'active' && stepTimer.seconds !== null;
  // Fraction of the countdown already spent, for the ring around the node.
  const timerProgress =
    stepTimer.seconds && stepTimer.remaining !== null
      ? 1 - Math.max(0, Math.min(1, stepTimer.remaining / stepTimer.seconds))
      : 0;

  const steps = view.kind === 'active' ? view.state.steps : [];
  const current = view.kind === 'active' ? view.state.current_step : 0;
  // The dish's one general tip: shown on the intro and again at the end,
  // never on the steps -- those carry their own (stepTip) or none at all.
  const mainTip = view.kind === 'active' ? view.state.tip : view.kind === 'finished' ? view.tip : undefined;
  const showIntro = view.kind === 'active' && atIntro;

  return (
    <div className="cook-stage">
      <header className="cook-topbar">
        <button className="icon-btn" title="Empezar otra receta" aria-label="Empezar otra receta" onClick={() => void handleBack()}>
          <ChevronLeft size={24} />
        </button>
        <div className="cook-title">
          {view.kind === 'loading' ? 'Cargando…' : view.kind === 'finished' ? view.name : view.state.name}
        </div>
        {view.kind === 'active' && !showIntro && (
          <div className="step-counter" aria-label={`Paso ${current + 1} de ${steps.length}`}>
            <span className="counter-now">{String(current + 1).padStart(2, '0')}</span>
            <span className="counter-total">/{steps.length}</span>
          </div>
        )}
        {showIntro && <div className="step-counter intro">{steps.length} pasos</div>}
        {finished && <div className="step-counter done">¡Terminado!</div>}
        <ThemeToggle />
      </header>

      <div className="strip-wrap" {...swipe.handlers}>
        <div className="rail" aria-hidden="true" />
        <div
          className={`strip ${swipe.settling ? 'settling' : ''}`}
          style={{ transform: `translateY(${swipe.offset}px)` }}
        >
          {view.kind === 'loading' && <div className="strip-loading">Cargando…</div>}

          {showIntro && view.kind === 'active' && (
            <>
              <div className="step-row current from-down" key="intro">
                <div className="node"><span className="node-dot intro"><Book size={18} /></span></div>
                <div className="row-body">
                  <div className="intro-name">{view.state.name}</div>
                  <div className="step-headline size-sm">{view.state.summary}</div>
                  {mainTip && (
                    <div className="tip-box">
                      <span className="tip-icon"><Bulb size={16} /></span>
                      <span>{mainTip}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="step-row next">
                <div className="node"><span className="node-dot">1</span></div>
                <div className="row-text">{stepText(steps[0])}</div>
              </div>
            </>
          )}

          {view.kind === 'active' && !showIntro && (
            <>
              {current > 0 ? (
                <div className="step-row past">
                  <div className="node"><span className="node-dot done"><Check size={13} /></span></div>
                  <div className="row-text">{stepText(steps[current - 1])}</div>
                </div>
              ) : (
                <div className="step-row past">
                  <div className="node"><span className="node-dot"><Book size={12} /></span></div>
                  <div className="row-text">{view.state.name}</div>
                </div>
              )}

              <div className={`step-row current from-${navDir}`} key={current}>
                <div className="node">
                  <svg className="node-ring" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
                    <circle className="ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} />
                    {showTimer && (
                      <circle
                        className="ring-progress"
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RING_RADIUS}
                        strokeDasharray={`${RING_CIRCUMFERENCE * timerProgress} ${RING_CIRCUMFERENCE}`}
                      />
                    )}
                  </svg>
                  <span className="node-number">{current + 1}</span>
                </div>

                <div className="row-body">
                  <div className={`step-headline size-${headlineSize(stepText(steps[current]))}`}>
                    {stepText(steps[current])}
                  </div>

                  {showTimer && (
                    <StepTimer
                      seconds={stepTimer.seconds as number}
                      phase={stepTimer.phase}
                      display={stepTimer.display}
                      message={stepTimer.message}
                      onStart={stepTimer.start}
                      onCancel={stepTimer.cancel}
                    />
                  )}

                  {userText && <div className="user-text">{userText}</div>}
                  {answer !== null && <div className="answer-box">{answer}</div>}
                  {stepTip(steps[current]) && (
                    <div className="tip-box">
                      <span className="tip-icon"><Bulb size={16} /></span>
                      <span>{stepTip(steps[current])}</span>
                    </div>
                  )}
                </div>
              </div>

              {current < steps.length - 1 && (
                <div className="step-row next">
                  <div className="node"><span className="node-dot">{current + 2}</span></div>
                  <div className="row-text">{stepText(steps[current + 1])}</div>
                </div>
              )}
            </>
          )}

          {finished && (
            <div className="step-row current finished-row">
              <div className="node"><span className="node-dot done big"><Check size={20} /></span></div>
              <div className="row-body">
                <div className="step-headline">¡Receta terminada! Buen provecho.</div>
                {mainTip && (
                  <div className="tip-box">
                    <span className="tip-icon"><Bulb size={16} /></span>
                    <span>{mainTip}</span>
                  </div>
                )}
                <button className="home-btn" onClick={() => navigate('/')}>
                  <Home size={17} /> Volver a recetas
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="strip-fade" aria-hidden="true" />
      </div>

      {!finished && (
        <div className="swipe-bar">
          <button
            className="icon-btn"
            title="Paso anterior"
            aria-label="Paso anterior"
            disabled={navBusy || showIntro}
            onClick={goPrevious}
          >
            <ChevronDown size={22} />
          </button>
          <span className="swipe-hint">
            <ChevronUp size={15} /> {showIntro ? 'Desliza para empezar' : 'Desliza hacia arriba'}
          </span>
          <button
            className="icon-btn"
            title="Paso siguiente"
            aria-label="Paso siguiente"
            disabled={navBusy}
            onClick={goNext}
          >
            <ChevronUp size={22} />
          </button>
        </div>
      )}

      <button
        className={`ask-bar ${voiceState !== 'idle' ? voiceState : ''}`}
        aria-label="Hacer una pregunta por voz"
        onClick={() => mic.toggle()}
      >
        <span className="ask-mic"><Mic size={24} /></span>
        <span className="ask-label">
          {voiceHint ?? (showIntro && voiceState === 'idle' ? 'Pregunta sobre la receta' : DEFAULT_HINTS[voiceState])}
        </span>
      </button>
    </div>
  );
}
