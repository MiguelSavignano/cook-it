import { useCallback, useState } from 'react';

/**
 * Light/dark theme, remembered across visits.
 *
 * Light is the default and the OS setting is deliberately ignored (see the
 * note in theme.css): a kitchen screen is read in daylight far more often
 * than in the dark, so following the phone's evening switch to dark would
 * get it wrong most of the time. Dark is one tap away and, once chosen, it
 * sticks.
 *
 * The attribute is applied to <html>, not to a React root, because the
 * document background (safe areas, overscroll gutter, address bar tint)
 * reads its color from there. index.html applies the stored value before
 * the first paint; this hook is what keeps it in sync afterwards.
 */

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'cookit_theme';
const DEFAULT_THEME: Theme = 'light';

function storedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    // Private mode / storage blocked: no memory, so every visit starts on
    // the default.
    return null;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? DEFAULT_THEME);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Not remembered, but still applied for this visit.
      }
      // Light is what the stylesheet does with no attribute at all, so the
      // attribute only ever needs to be there for dark.
      const root = document.documentElement;
      if (next === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
      return next;
    });
  }, []);

  return { theme, toggle };
}
