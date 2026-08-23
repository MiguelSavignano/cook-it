/**
 * Sharing a recipe: every recipe has a uuid (src/recipe_store.py) and that
 * uuid IS its address -- https://<this host>/r/<uuid>, the route Recipe.tsx
 * renders and api.py's catch-all serves.
 *
 * The link is built from window.location.origin, not from a configured
 * hostname: Cook-It is a local app reached at whatever address the phone
 * used to get here (a LAN IP, a tunnel, a Pi's hostname...), and the only
 * host known to work for the person being sent the link is the one the
 * sender is already on.
 */

/** The absolute, pasteable URL for a recipe. */
export function recipeShareUrl(uuid: string): string {
  return new URL(`${import.meta.env.BASE_URL}r/${uuid}`, window.location.origin).toString();
}

/**
 * What actually happened when the user asked to share -- the UI says
 * something different for each:
 *   'shared'  the OS share sheet took it (phones)
 *   'copied'  no share sheet, so the link went to the clipboard
 *   'failed'  neither worked; show the URL and let them copy it by hand
 */
export type ShareOutcome = 'shared' | 'copied' | 'failed';

export async function shareRecipe(uuid: string, name?: string): Promise<ShareOutcome> {
  const url = recipeShareUrl(uuid);

  // navigator.share is the right thing on a phone (WhatsApp, Messages...),
  // which is where a cooking app gets shared from. It rejects when the user
  // dismisses the sheet -- that's a cancel, not a failure to fall back from.
  if (navigator.share) {
    try {
      await navigator.share({ title: name ? `Cook-It · ${name}` : 'Cook-It', url });
      return 'shared';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'shared';
      // Anything else (no permission, unsupported payload) -> try the clipboard.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    // Clipboard access needs a secure context, which run_web.sh's HTTPS
    // gives us -- but not if someone reaches the app over plain HTTP.
    return 'failed';
  }
}
