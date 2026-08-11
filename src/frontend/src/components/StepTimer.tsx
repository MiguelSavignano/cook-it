import type { MouseEvent } from 'react';
import { formatTimer } from '../lib/timer';
import type { StepTimerPhase } from '../hooks/useStepTimer';
import './StepTimer.css';

interface StepTimerProps {
  seconds: number;
  phase: StepTimerPhase;
  display: string;
  message: string;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * Takes over the exact spot Face occupies (see Cook.tsx) whenever the
 * current step needs one and there's no voice interaction in progress.
 * Purely presentational -- the actual countdown lives in useStepTimer,
 * owned by Cook.tsx, so it keeps ticking even while this isn't mounted.
 */
export default function StepTimer({ seconds, phase, display, message, onStart, onCancel }: StepTimerProps) {
  // Buttons stopPropagation so tapping them doesn't also bubble up to
  // face-wrap's click handler and toggle voice recording.
  const handleStart = (e: MouseEvent) => {
    e.stopPropagation();
    onStart();
  };
  const handleCancel = (e: MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

  return (
    <div className="timer-view">
      <div className="timer-display">{display}</div>
      {phase === 'finished' && <div className="timer-message">{message}</div>}
      {phase === 'ready' && (
        <button className="timer-btn timer-start-btn" onClick={handleStart}>
          ▶ Iniciar temporizador ({formatTimer(seconds)})
        </button>
      )}
      {phase === 'running' && (
        <button className="timer-btn timer-cancel-btn" onClick={handleCancel} title="Cancelar temporizador">
          ✕ Cancelar
        </button>
      )}
    </div>
  );
}
