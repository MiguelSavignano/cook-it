import { useState } from 'react';
import { recipeShareUrl, shareRecipe, type ShareOutcome } from '../lib/share';
import './ShareButton.css';

interface ShareButtonProps {
  uuid: string;
  name?: string;
  /** 'full' = the labelled button on a recipe's page; 'icon' = the small one on a card. */
  variant?: 'full' | 'icon';
}

const FEEDBACK: Record<Exclude<ShareOutcome, 'failed'>, string> = {
  shared: '¡Compartido!',
  copied: '¡Enlace copiado!',
};

/**
 * Hands out a recipe's link (/r/<uuid>). Uses the phone's share sheet when
 * there is one and the clipboard otherwise -- and if neither works (no
 * clipboard access outside a secure context), it falls back to showing the
 * URL so it can still be copied by hand rather than dead-ending.
 */
export default function ShareButton({ uuid, name, variant = 'full' }: ShareButtonProps) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  async function handleShare() {
    const result = await shareRecipe(uuid, name);
    setOutcome(result);
    if (result !== 'failed') setTimeout(() => setOutcome(null), 2200);
  }

  return (
    <div className={`share-wrap ${variant}`}>
      <button
        className="share-btn"
        title="Compartir esta receta"
        aria-label={name ? `Compartir ${name}` : 'Compartir esta receta'}
        onClick={(e) => {
          // On a recipe card the button sits inside a tappable row: sharing
          // a recipe should not also start cooking it.
          e.stopPropagation();
          void handleShare();
        }}
      >
        <span aria-hidden="true">🔗</span>
        {variant === 'full' && <span className="share-label">Compartir</span>}
      </button>

      {outcome && outcome !== 'failed' && (
        <span className="share-feedback" role="status">{FEEDBACK[outcome]}</span>
      )}

      {outcome === 'failed' && (
        <input
          className="share-fallback"
          readOnly
          value={recipeShareUrl(uuid)}
          aria-label="Enlace de la receta"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
