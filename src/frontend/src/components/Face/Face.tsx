import { useEffect, useState } from 'react';
import Eye from './Eye';
import Mouth from './Mouth';
import type { FaceState } from './types';
import './Face.css';

interface FaceProps {
  state: FaceState;
}

interface Look {
  x: number;
  y: number;
}

// Small random look within the eye socket. Biased slightly upward so idle
// reads as "thinking about it" rather than a blank stare -- the "expresión
// de pensar" that was asked for.
function randomLook(spreadX: number, spreadY: number): Look {
  const x = (Math.random() - 0.5) * spreadX * 2;
  const y = (Math.random() - 0.5) * spreadY * 2 - Math.random() * 1.5;
  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
}

/**
 * The animated face: idle "thinking" look with wandering eyes/blinks, plus
 * listening/thinking/speaking/happy/confused expressions -- everything
 * about the face's *movement* lives here and in Eye/Mouth, self-contained.
 * `state` is owned by the Cook page (it's driven by recording/fetch/audio
 * events that live at that level); this component only reacts to it.
 */
export default function Face({ state }: FaceProps) {
  const [look, setLook] = useState<Look>({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);

  // Wandering gaze: a fresh look every few seconds while idle ("de vez en
  // cuando"), faster darting while actively thinking something out, a fixed
  // attentive look while listening, centered otherwise.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (state === 'idle') {
      setLook(randomLook(4, 3));
      intervalId = setInterval(() => setLook(randomLook(4, 3)), 2800 + Math.random() * 2400);
    } else if (state === 'thinking') {
      setLook(randomLook(6, 5));
      intervalId = setInterval(() => setLook(randomLook(6, 5)), 450 + Math.random() * 350);
    } else if (state === 'listening') {
      setLook({ x: 0, y: -1 }); // attentive, looking straight at you
    } else {
      setLook({ x: 0, y: 0 });
    }
    return () => clearInterval(intervalId);
  }, [state]);

  // Occasional blink -- independent of state, runs for the face's whole
  // lifetime (a self-rescheduling timeout, same as the old scheduleBlink()).
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout>;
    let closeTimer: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      openTimer = setTimeout(() => {
        setBlinking(true);
        closeTimer = setTimeout(() => setBlinking(false), 140);
        scheduleBlink();
      }, 3000 + Math.random() * 3500);
    };
    scheduleBlink();
    return () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    };
  }, []);

  return (
    <div className={`face state-${state}${blinking ? ' blink' : ''}`}>
      <div className="ring" />
      <div className="eyes">
        <Eye look={look} />
        <Eye look={look} />
      </div>
      <Mouth state={state} />
      <div className="cheeks">
        <span className="cheek left" />
        <span className="cheek right" />
      </div>
    </div>
  );
}
