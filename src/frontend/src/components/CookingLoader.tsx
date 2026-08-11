import './CookingLoader.css';

/** Shown while gemma3 generates a brand-new (non-local) recipe -- plain
 * CSS, no external GIF/asset. */
export default function CookingLoader() {
  return (
    <span className="cooking-loader">
      <span className="pot">🍲</span>
      <span className="steam"><span></span><span></span><span></span></span>
      Creando tu receta…
    </span>
  );
}
