import type { FaceState } from './types';

// Mouth artwork is a swappable file, not CSS -- see public/assets/README.md.
// Every state except "happy" reuses the idle drawing (CSS rotates/scales it
// for confused/speaking, via the .face.state-X .mouth rules in Face.css);
// "happy" is the one state with its own image.
const MOUTH_SRC: Partial<Record<FaceState, string>> = {
  happy: '/assets/mouth-happy.svg',
};
const MOUTH_IDLE_SRC = '/assets/mouth-idle.svg';

interface MouthProps {
  state: FaceState;
}

export default function Mouth({ state }: MouthProps) {
  return <img className="mouth" src={MOUTH_SRC[state] ?? MOUTH_IDLE_SRC} alt="" draggable={false} />;
}
