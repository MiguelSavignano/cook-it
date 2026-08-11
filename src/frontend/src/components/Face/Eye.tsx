interface EyeProps {
  /** Pixel offset for the wandering-gaze effect -- both eyes get the same
   * offset from Face.tsx so they move together. */
  look: { x: number; y: number };
}

/** One eye: a clipped "socket" div (sized/blinked/happy-curved by
 * Face.css's state rules) containing the pupil image (see
 * public/assets/README.md) that Face.tsx nudges around. */
export default function Eye({ look }: EyeProps) {
  return (
    <div className="eye">
      <img
        className="pupil"
        src="/assets/eye.svg"
        alt=""
        draggable={false}
        style={{ transform: `translate(${look.x}px, ${look.y}px)` }}
      />
    </div>
  );
}
