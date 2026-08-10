#!/bin/bash
# Graba 6s del micro TONOR (card 1) y transcribe con faster-whisper.
set -e
cd "$(dirname "$0")"

echo "🎙️  Grabando 6 segundos — ¡habla YA!"
arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -d 6 mic_test.wav
echo "✅ Grabación terminada, transcribiendo..."

source .venv/bin/activate
python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('small', device='cpu', compute_type='int8')
segments, info = model.transcribe('mic_test.wav', language='es')
segments = list(segments)
print('Idioma:', info.language, round(info.language_probability, 3))
if not segments:
    print('(sin voz detectada / silencio)')
for s in segments:
    print(f'[{s.start:.1f}-{s.end:.1f}] {s.text}')
"
