/**
 * Cook-It API client -- thin typed wrappers over src/api.py's endpoints.
 * Every path is relative (no leading slash): resolves correctly whether the
 * SPA's current URL is "/" or "/cook" (both are one directory level deep,
 * same as the old static pages were), and if this ever ends up reverse
 * proxied under a subpath (e.g. Caddy "/cookit/*") it still lands on that
 * subpath's own /api instead of the domain root's.
 */
import type { Step } from './lib/timer';

export interface Ingredient {
  item: string;
  amount: number | string | null;
  unit: string;
}

/** GET /api/state -- {active: false} (or a 404-shaped absence) when nothing's cooking. */
export interface RecipeState {
  active?: false;
  name: string;
  servings?: string | number | null;
  summary?: string;
  ingredients?: Ingredient[];
  steps: Step[];
  tip?: string;
  verified_source?: boolean;
  current_step: number;
}

export function isActiveState(state: RecipeState | null | undefined): state is RecipeState {
  return !!state && state.active !== false;
}

/** GET /api/recipes -- the local recipe list for the "tap to pick one" home screen. */
export interface RecipeListItem {
  name: string;
  servings?: string | number | null;
  tip?: string;
}

interface AudioFields {
  spoken_text: string;
  audio_base64?: string;
  audio_mime?: string;
}

/** Shared shape of every voice/button endpoint's *success* response. */
export interface VoiceResult<TData = Record<string, unknown>> extends AudioFields {
  ok: true;
  type?: 'new_recipe' | 'next' | 'previous' | 'question';
  user_text?: string;
  data: TData;
  latency?: Record<string, number>;
}

/** ...and its failure shape (no active recipe, STT/LLM error, recipe not found...). */
export interface VoiceError extends Partial<AudioFields> {
  ok: false;
  reason?: string;
  error?: string;
}

export type VoiceResponse<TData = Record<string, unknown>> = VoiceResult<TData> | VoiceError;

/** next_step()/previous_step()'s data shape (recipe_engine.py). */
export interface StepData {
  ok: boolean;
  finished: boolean;
  current_step?: number;
  total_steps?: number;
  step_text?: string;
  name: string;
  tip?: string;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return res.json() as Promise<T>;
}

export const getState = () => getJSON<RecipeState>('api/state');

export const resetSession = () => postJSON<{ ok: boolean }>('api/reset');

export const listRecipes = () => getJSON<RecipeListItem[]>('api/recipes');

export const selectRecipe = (name: string) =>
  postJSON<VoiceResponse>('api/recipes/select', { name });

export const nextStep = () => postJSON<VoiceResponse<StepData>>('api/next');

export const previousStep = () => postJSON<VoiceResponse<StepData>>('api/previous');

/** Microphone button: uploads the recorded clip, always goes through the LLM
 * (new recipe or follow-up question) -- see api.py's /api/question. */
export async function askQuestion(blob: Blob): Promise<VoiceResponse> {
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  const res = await fetch('api/question', { method: 'POST', body: form });
  return res.json();
}
