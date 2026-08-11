import { useCallback, useEffect, useRef } from 'react';

/**
 * Plays base64 WAV clips on THIS device (the one the user is holding), not
 * on the server -- the API sends back audio instead of playing it itself,
 * precisely so a phone gets the answer in its own hand, not through
 * whatever machine happens to run the backend.
 *
 * Only one clip is ever audible at once: play() always stops/discards
 * whatever's still playing first. This is the ONE place that rule lives --
 * both Picker and Cook import this same hook, instead of each page having
 * its own copy of a "stop the previous clip" fix (the bug this fixes: tap
 * the mic/next/previous again before the previous response finished
 * playing -- the button re-enables the same tick the new audio starts --
 * and the two used to play over each other).
 */
export function useAudioPlayer() {
  const currentRef = useRef<{ player: HTMLAudioElement; url: string } | null>(null);

  const stop = useCallback(() => {
    const current = currentRef.current;
    if (!current) return;
    current.player.pause();
    current.player.onended = null;
    current.player.onerror = null;
    URL.revokeObjectURL(current.url);
    currentRef.current = null;
  }, []);

  const play = useCallback(
    (base64: string, mime = 'audio/wav', onEnd?: () => void) => {
      stop();
      const bytes = atob(base64);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      currentRef.current = { player, url };

      const finish = () => {
        // Only clean up if this player is still the current one -- stop()
        // may have already superseded it (e.g. a newer clip started).
        if (currentRef.current?.player === player) {
          URL.revokeObjectURL(url);
          currentRef.current = null;
        }
        onEnd?.();
      };
      player.onended = finish;
      player.onerror = finish;
      player.play().catch((err) => {
        console.error('No se pudo reproducir el audio:', err);
        finish();
      });
    },
    [stop],
  );

  // Don't leave a clip playing (or a blob: URL leaked) past the component
  // that owns this hook going away.
  useEffect(() => stop, [stop]);

  return { play, stop };
}
