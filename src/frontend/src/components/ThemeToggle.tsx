import { Moon, Sun } from './icons';
import { useTheme } from '../hooks/useTheme';
import './ThemeToggle.css';

/**
 * The one control for light/dark. Shows the theme you'd get by tapping it
 * (a sun while dark, a moon while light) rather than the one you're in --
 * on a button, the icon is the action.
 *
 * Present on both routes on purpose: leaving /cook to change it would reset
 * the session (see Cook.tsx's handleBack), and the kitchen light is exactly
 * the kind of thing that changes mid-recipe.
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toDark = theme === 'light';

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={toDark ? 'Modo oscuro' : 'Modo claro'}
      aria-label={toDark ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
    >
      {toDark ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  );
}
