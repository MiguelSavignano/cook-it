/**
 * The spoken greeting (summary + step 1) that comes back when a recipe is
 * started. It can't be played on the page that started it -- navigating to
 * /cook kills it mid-sentence -- so it's stashed here and picked up by
 * Cook.tsx a beat later, once that page has mounted.
 *
 * sessionStorage rather than router state: it survives the full page load
 * that a shared link goes through, and it's per-tab, so two phones on the
 * same app never inherit each other's greeting.
 */

// Kept in sync with Cook.tsx, which reads this key on mount.
const PENDING_AUDIO_KEY = 'cookit_pending_audio';

export interface PendingAudio {
  audio_base64?: string;
  audio_mime?: string;
}

export function stashPendingAudio({ audio_base64, audio_mime }: PendingAudio): void {
  if (!audio_base64) return;
  try {
    sessionStorage.setItem(PENDING_AUDIO_KEY, JSON.stringify({ audio_base64, audio_mime }));
  } catch (err) {
    // A greeting that can't be stashed is worth losing silently -- the
    // recipe still opens, it just opens without the intro line.
    console.error(err);
  }
}
