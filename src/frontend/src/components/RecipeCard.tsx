import type { RecipeListItem } from '../api';

interface RecipeCardProps {
  recipe: RecipeListItem;
  onSelect: (name: string) => void;
}

export default function RecipeCard({ recipe, onSelect }: RecipeCardProps) {
  return (
    <button className="recipe-card" onClick={() => onSelect(recipe.name)}>
      <span className="recipe-card-name">{recipe.name}</span>
      {recipe.servings && <span className="recipe-card-servings">{String(recipe.servings)}</span>}
    </button>
  );
}
