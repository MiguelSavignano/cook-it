#!/bin/bash
# Records 6s from the TONOR mic (card 1) and transcribes with faster-whisper.
# Dev diagnostic script -- see docs/feasibility.md §8.4 for why it exists
# (launched manually so the recording is synced to when you actually speak).
set -e
cd "$(dirname "$0")"

echo "Recording 6 seconds -- talk NOW!"
arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -d 6 mic_test.wav
echo "Recording done, transcribing..."

source .venv/bin/activate
python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('small', device='cpu', compute_type='int8')
segments, info = model.transcribe('mic_test.wav', language='es')
segments = list(segments)
print('Language:', info.language, round(info.language_probability, 3))
if not segments:
    print('(no speech detected / silence)')
for s in segments:
    print(f'[{s.start:.1f}-{s.end:.1f}] {s.text}')
"
