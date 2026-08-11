/** Three short WebAudio beeps (no asset file) for when a step timer finishes. */
export function playTimerBeep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    [0, 0.3, 0.6].forEach((t) => {
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
    });
    o.start();
    o.stop(ctx.currentTime + 1);
  } catch (err) {
    // No AudioContext available (or blocked) -- the on-screen message still
    // shows, so this is safe to just skip.
    console.error('No se pudo reproducir el aviso del temporizador:', err);
  }
}
