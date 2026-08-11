import { useCallback, useEffect, useRef, useState } from 'react';
import { createStepTimer, formatTimer, type StepTimerController } from '../lib/timer';
import { playTimerBeep } from '../lib/beep';

export type StepTimerPhase = 'ready' | 'running' | 'finished';

/**
 * Owns the countdown for whichever step is current -- lives in the Cook
 * page (not in the StepTimer component) so the controller/interval keeps
 * running even while StepTimer isn't the thing being rendered (a voice
 * interaction shows Face instead, but a running countdown shouldn't pause
 * just because you asked a question mid-timer).
 */
export function useStepTimer() {
  const [seconds, setSecondsState] = useState<number | null>(null);
  const [phase, setPhase] = useState<StepTimerPhase>('ready');
  const [display, setDisplay] = useState('0:00');
  const [message, setMessage] = useState('');
  const controllerRef = useRef<StepTimerController | null>(null);

  const stopController = useCallback(() => {
    controllerRef.current?.cancel();
    controllerRef.current = null;
  }, []);

  // Called whenever the current step changes (Cook.tsx's renderState
  // equivalent). Cancels whatever timer the *previous* step left running so
  // it never keeps ticking (and eventually beeping) for a step you've
  // already left.
  const setSeconds = useCallback(
    (newSeconds: number | null) => {
      stopController();
      setSecondsState(newSeconds);
      setPhase('ready');
      setMessage('');
      setDisplay(newSeconds ? formatTimer(newSeconds) : '0:00');
    },
    [stopController],
  );

  const start = useCallback(() => {
    if (!seconds) return;
    setPhase('running');
    setMessage('');
    const controller = createStepTimer(seconds, {
      onTick: (remaining) => setDisplay(formatTimer(remaining)),
      onFinish: (msg) => {
        controllerRef.current = null;
        playTimerBeep();
        setPhase('finished');
        setDisplay('⏰');
        setMessage(msg);
      },
    });
    controllerRef.current = controller;
    controller.start();
  }, [seconds]);

  // "✕ Cancelar" while running -- stop and go back to the ready state for
  // the same seconds (setSeconds() above is for switching to a different
  // step entirely, this is for staying on the same one).
  const cancel = useCallback(() => {
    stopController();
    setPhase('ready');
    setMessage('');
    setDisplay(seconds ? formatTimer(seconds) : '0:00');
  }, [seconds, stopController]);

  // Don't leave a countdown ticking (or eventually beeping) past the
  // component that owns this hook going away.
  useEffect(() => stopController, [stopController]);

  return { seconds, phase, display, message, setSeconds, start, cancel };
}
