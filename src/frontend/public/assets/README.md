# Face assets

Placeholder art for the `/cook` route's face (`src/components/Face/`) —
replace these files directly, no code changes needed as long as you keep
the filenames and the general shape (a horizontal mouth curve / a vertical
eye blob). This is Vite's `public/` folder, so these are copied byte-for-byte
into the build (`static_dist/assets/...`) and served at `/assets/...` — no
import/bundling step to work around.

| File | Used for |
|---|---|
| `eye.svg` | Both eyes (the moving "pupil" — see below). Rendered small, so keep it simple/bold. |
| `mouth-idle.svg` | Default mouth (idle/listening/thinking/confused/speaking all reuse this file, CSS just rotates/scales it for those states). |
| `mouth-happy.svg` | Mouth once a recipe finishes (`state-happy`) — `Mouth.tsx` swaps the `<img>`'s `src` to this file for that one state, back to `mouth-idle.svg` otherwise. |

## Conventions

- **Color**: solid fill/stroke baked into the file (`#55D8F2`, matching
  `--screen-blue` in `src/theme.css`) rather than `currentColor` — an
  `<img>`-loaded SVG can't inherit CSS color from the page anyway. If you
  change the blue in `theme.css`, update it here too to match.
- **Glow**: added in CSS (`filter: drop-shadow(...)`), not baked into the
  file — keep the artwork itself flat/un-blurred.
- **Transparent background**, no border/frame — these sit directly on the
  black "screen" background.
- **viewBox aspect ratio** roughly matches what's on screen now (mouth
  ~2.2:1 wide, eye ~3:5 tall) but isn't load-bearing — CSS sizes the `<img>`
  box and scales your artwork to fit (`object-fit: contain`), so a
  different aspect ratio just letterboxes instead of stretching.

## What CSS/React still does to these images

Both eyes are the *same* `eye.svg`, layered inside a small clipped socket
(`Eye.tsx`'s `.eye` div) that `Face.tsx` nudges around (`translate`, via
React state) for the idle "looking around" effect and squashes flat for a
blink — none of that touches the artwork itself. The mouth gets `rotate()`
for confused and a `scaleY()` pulse for speaking. So the file only needs to
draw one static shape each; the animation is applied on top, in CSS.

The *happy* eyes ("^ ^" closed curves) are still plain CSS, not an image —
they're a fundamentally different closed shape from the open `eye.svg`, so
redraw them in `Eye.module.css`'s `.happy` rule directly.
