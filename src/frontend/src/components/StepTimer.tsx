import type { MouseEvent } from 'react';
import { formatTimer } from '../lib/timer';
import type { StepTimerPhase } from '../hooks/useStepTimer';
import { Play, Stop } from './icons';
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
 * The countdown for the current step, rendered inside that step's block on
 * the strip (see Cook.tsx). Purely presentational -- the countdown itself
 * lives in useStepTimer, owned by Cook.tsx, so it keeps ticking even while
 * this isn't mounted.
 *
 * The step's node on the rail doubles as this timer's progress ring (drawn
 * in Cook.tsx, which has the remaining/total pair); what's here is the
 * readout and its one button.
 */
export default function StepTimer({ seconds, phase, display, message, onStart, onCancel }: StepTimerProps) {
  // stopPropagation so a tap on the button is never also read as the start
  // of a swipe by the strip above it.
  const handle = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (phase === 'finished') {
    return <div className="timer-message">{message}</div>;
  }

  const running = phase === 'running';
  return (
    <div className="timer-view">
      <div className="timer-display">{running ? display : formatTimer(seconds)}</div>
      <button
        className={`timer-btn ${running ? 'stop' : 'start'}`}
        onClick={handle(running ? onCancel : onStart)}
        title={running ? 'Cancelar temporizador' : 'Iniciar temporizador'}
        aria-label={running ? 'Cancelar temporizador' : `Iniciar temporizador de ${formatTimer(seconds)}`}
      >
        {running ? <Stop size={15} /> : <Play size={16} />}
      </button>
    </div>
  );
}
