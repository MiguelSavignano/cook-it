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

// --- Pantry: "cook with what I have" -----------------------------------
// Photo -> ingredients -> ideas -> a draft negotiated down to what the user
// actually has, then handed off to /cook. See src/pantry.py for the flow.
// These endpoints return no audio (the negotiation is tap-driven on screen)
// except confirmPantry(), which speaks the opening line like selectRecipe.

/** One of the 2-3 ideas proposed from the detected ingredients. */
export interface PantrySuggestion {
  name: string;
  why: string;
  /** Important ingredients this dish needs that weren't in the photo. */
  missing: string[];
}

/** The full recipe being negotiated, plus what's still unaccounted for. */
export interface PantryDraft {
  name: string;
  servings?: string | number | null;
  summary?: string;
  ingredients: Ingredient[];
  steps: Step[];
  tip?: string;
  /** Checklist for step 6: ingredients the user hasn't confirmed having. */
  missing: string[];
}

export type PantryPhase = 'ingredients' | 'suggestions' | 'draft';

export interface PantryState {
  active?: false;
  phase: PantryPhase;
  ingredients: string[];
  /** Ruled out via "no tengo X" -- never reappears in a rebuilt draft. */
  excluded: string[];
  suggestions: PantrySuggestion[];
  draft: PantryDraft | null;
  vision_time?: number;
  vision_backend?: string;
  llm_time?: number;
}

interface PantryOk {
  ok: true;
  state: PantryState;
  latency?: Record<string, number>;
}

export interface PantryError {
  ok: false;
  reason?: string;
  error?: string;
}

export type PantryResponse = PantryOk | PantryError;

export const getPantryState = () => getJSON<PantryState>('api/pantry/state');

export const resetPantry = () => postJSON<{ ok: boolean }>('api/pantry/reset');

/** Step 1-2: upload the (already downscaled) picture, get ingredient names. */
export async function uploadPantryPhoto(blob: Blob): Promise<PantryResponse> {
  const form = new FormData();
  form.append('photo', blob, 'pantry.jpg');
  const res = await fetch('api/pantry/photo', { method: 'POST', body: form });
  return res.json();
}

/** Step 3: the user-corrected list -> 2-3 recipe ideas. */
export const submitPantryIngredients = (ingredients: string[]) =>
  postJSON<PantryResponse>('api/pantry/ingredients', { ingredients });

/** Step 4: pick an idea -> full recipe + missing-ingredient checklist. */
export const choosePantryRecipe = (name: string) =>
  postJSON<PantryResponse>('api/pantry/choose', { name });

/** Step 5: "no tengo huevos" -> same dish, rebuilt without them. */
export const excludePantryItems = (items: string[]) =>
  postJSON<PantryResponse>('api/pantry/exclude', { items });

/** Step 6 confirmed: promotes the draft to the active cooking session. */
export const confirmPantryRecipe = () => postJSON<VoiceResponse>('api/pantry/confirm');
