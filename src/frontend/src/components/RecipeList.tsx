import RecipeCard from './RecipeCard';
import type { RecipeListItem } from '../api';

interface RecipeListProps {
  /** null = still loading. */
  recipes: RecipeListItem[] | null;
  onSelect: (name: string) => void;
}

/** The "tap to pick one" home-screen list (Picker.tsx) -- no voice/LLM
 * needed to see what's available locally. */
export default function RecipeList({ recipes, onSelect }: RecipeListProps) {
  return (
    <div className="recipe-list">
      {recipes === null && <div className="loading-hint">Cargando recetas…</div>}
      {recipes?.length === 0 && <div className="loading-hint">No hay recetas locales todavía.</div>}
      {recipes?.map((r) => <RecipeCard key={r.name} recipe={r} onSelect={onSelect} />)}
    </div>
  );
}
