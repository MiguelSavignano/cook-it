import { useCallback, useEffect, useRef, useState } from 'react';

const RECORD_MS = 6000;

export interface UseMicRecorderOptions {
  /** Called once recording stops (auto-timeout or a manual toggle) with the clip. */
  onRecorded: (blob: Blob) => void;
  /** Called if getUserMedia itself fails (mic blocked/unavailable) -- the
   * two pages show this differently (confused face vs. status text), so
   * it's left to the caller rather than baked in here. */
  onError?: (err: unknown) => void;
  recordMs?: number;
}

/**
 * Push-to-talk-ish recording: tap to start, auto-stops after `recordMs`,
 * tap again to stop early. Shared by Picker (new recipe/question) and Cook
 * (follow-up question) -- both used to carry their own near-identical copy
 * of this MediaRecorder wiring.
 */
export function useMicRecorder({ onRecorded, onError, recordMs = RECORD_MS }: UseMicRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoStop = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearAutoStop();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        onRecorded(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      clearAutoStop();
      timeoutRef.current = setTimeout(stop, recordMs);
    } catch (err) {
      onError?.(err);
    }
  }, [onError, onRecorded, recordMs, stop]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  // Don't leave the mic open (or a pending auto-stop timer) past the
  // component that owns this hook going away.
  useEffect(
    () => () => {
      clearAutoStop();
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') recorder.stop();
    },
    [],
  );

  return { recording, toggle };
}
