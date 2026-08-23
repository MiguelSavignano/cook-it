import { useNavigate } from 'react-router-dom';
import ShareButton from './ShareButton';
import type { RecipeListItem } from '../api';

interface RecipeCardProps {
  recipe: RecipeListItem;
  onSelect: (uuid: string) => void;
}

/**
 * One recipe on the home screen. Tapping the card still starts cooking
 * straight away (that's what the picker is for); the two small controls
 * underneath are the ways to NOT start it -- open its page, or send it to
 * someone. A card is a <div> rather than a <button> for exactly that
 * reason: buttons can't nest.
 */
export default function RecipeCard({ recipe, onSelect }: RecipeCardProps) {
  const navigate = useNavigate();

  return (
    <div className="recipe-card">
      <button
        className="recipe-card-main"
        title={`Cocinar ${recipe.name}`}
        onClick={() => onSelect(recipe.uuid)}
      >
        <span className="recipe-card-name">{recipe.name}</span>
        {recipe.servings && <span className="recipe-card-servings">{String(recipe.servings)}</span>}
      </button>
      <div className="recipe-card-actions">
        <button
          className="recipe-card-view"
          title={`Ver ${recipe.name} sin empezar`}
          onClick={() => navigate(`/r/${recipe.uuid}`)}
        >
          Ver receta
        </button>
        <ShareButton uuid={recipe.uuid} name={recipe.name} variant="icon" />
      </div>
    </div>
  );
}
