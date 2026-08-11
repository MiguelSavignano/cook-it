/**
 * One state at a time: idle (default -- wandering eyes, occasional blink, as
 * if thinking about the recipe), listening (recording), thinking (waiting
 * for the LLM), speaking (an answer's audio is playing), happy (recipe
 * finished), confused (something went wrong).
 */
export type FaceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused';

export const DEFAULT_FACE_HINTS: Record<FaceState, string> = {
  idle: 'Toca la cara para preguntar',
  listening: '🎙️ Escuchando…',
  thinking: '🤔 Pensando…',
  speaking: '',
  happy: 'Toca la cara para pedir otra receta',
  confused: '',
};
