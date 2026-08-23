import { useCallback, useRef, useState } from 'react';

/**
 * Vertical swipe navigation for the cooking strip: swipe UP for the next
 * step, DOWN for the previous one (see Cook.tsx -- the recipe reads as a
 * strip that scrolls upward, so "up" is "forward").
 *
 * Pointer Events rather than touch events on purpose: the same code path
 * then works with a finger, a mouse and a stylus, which also makes it
 * testable in a desktop browser.
 *
 * The element these handlers go on MUST set `touch-action: none` in CSS,
 * or the browser claims the vertical gesture for scrolling/pull-to-refresh
 * before we ever see a pointermove.
 */

/** Travel that commits to a step change on its own. */
const COMMIT_DISTANCE = 64;
/** A quick flick commits with less travel: px/ms over this counts... */
const FLICK_VELOCITY = 0.45;
/** ...as long as it moved at least this far (rules out a jittery tap). */
const FLICK_MIN_DISTANCE = 24;
/** Movement needed before we decide whether this is a swipe at all. */
const AXIS_LOCK_SLOP = 8;
/** The strip follows the finger damped, so it reads as weight, not lag. */
const DRAG_RESISTANCE = 0.5;

export type SwipeDirection = 'up' | 'down';

interface UseSwipeNavOptions {
  onNext: () => void;
  onPrevious: () => void;
  /** While true, gestures are ignored (a step change is already in flight). */
  disabled?: boolean;
}

interface Gesture {
  x: number;
  y: number;
  at: number;
  /** null until the pointer has moved enough to tell a swipe from a tap. */
  vertical: boolean | null;
}

export function useSwipeNav({ onNext, onPrevious, disabled }: UseSwipeNavOptions) {
  const gesture = useRef<Gesture | null>(null);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);

  const end = useCallback(() => {
    gesture.current = null;
    setSettling(true);
    setOffset(0);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !e.isPrimary) return;
      gesture.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, vertical: null };
      setSettling(false);
    },
    [disabled],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (g.vertical === null) {
      if (Math.abs(dx) < AXIS_LOCK_SLOP && Math.abs(dy) < AXIS_LOCK_SLOP) return;
      // Axis lock: a mostly-horizontal drag isn't ours -- let it go rather
      // than fighting whatever else might want it.
      g.vertical = Math.abs(dy) > Math.abs(dx);
      if (!g.vertical) {
        gesture.current = null;
        return;
      }
      // Only now do we own the pointer, so a tap on a button inside the
      // strip still behaves like a plain tap.
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    setOffset(dy * DRAG_RESISTANCE);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dy = e.clientY - g.y;
      const elapsed = Math.max(1, e.timeStamp - g.at);
      const velocity = Math.abs(dy) / elapsed;
      const committed =
        g.vertical === true &&
        (Math.abs(dy) >= COMMIT_DISTANCE ||
          (velocity >= FLICK_VELOCITY && Math.abs(dy) >= FLICK_MIN_DISTANCE));

      end();
      if (!committed) return;
      if (dy < 0) onNext();
      else onPrevious();
    },
    [end, onNext, onPrevious],
  );

  return {
    /** Spread onto the swipe surface. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: end,
    },
    /** px the strip is dragged by right now (0 when idle). */
    offset,
    /** True while the strip is animating back to rest after a gesture. */
    settling,
  };
}
