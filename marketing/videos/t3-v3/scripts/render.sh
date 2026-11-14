#!/usr/bin/env bash
# Renders every deliverable of the T3 v3 ad into out/ and checks the audio peak.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p out

MAX_TRUE_PEAK_DBTP="-1.0"

echo "1/5 Synthesizing SFX mix (public/audio/sfx-mix.wav)"
python3 scripts/generate_sfx.py

echo "2/5 Rendering out/t3-v3.mp4 (H.264 + AAC)"
npx remotion render T3V3 out/t3-v3.mp4 \
  --codec=h264 --crf=16 --pixel-format=yuv420p \
  --audio-codec=aac --audio-bitrate=192k

echo "3/5 Silent version out/t3-v3-sem-audio.mp4 (same video stream, audio removed)"
npx remotion ffmpeg -y -hide_banner -loglevel error \
  -i out/t3-v3.mp4 -map 0:v:0 -c:v copy -an -movflags +faststart out/t3-v3-sem-audio.mp4

echo "4/5 Contact sheet out/t3-v3-contact-sheet.png"
npx remotion still ContactSheet out/t3-v3-contact-sheet.png --frame=0 --image-format=png

echo "5/5 Checking true peak of the encoded AAC track"
TRUE_PEAK=$(npx remotion ffmpeg -hide_banner -nostats -i out/t3-v3.mp4 -vn \
  -af loudnorm=print_format=json -f null - 2>&1 \
  | sed -n 's/.*"input_tp" : "\([^"]*\)".*/\1/p')
INTEGRATED=$(npx remotion ffmpeg -hide_banner -nostats -i out/t3-v3.mp4 -vn \
  -af loudnorm=print_format=json -f null - 2>&1 \
  | sed -n 's/.*"input_i" : "\([^"]*\)".*/\1/p')
echo "   true peak: ${TRUE_PEAK} dBTP (limit ${MAX_TRUE_PEAK_DBTP}) | integrated: ${INTEGRATED} LUFS"
if awk "BEGIN { exit !(${TRUE_PEAK} >= ${MAX_TRUE_PEAK_DBTP}) }"; then
  echo "   ERROR: true peak above ${MAX_TRUE_PEAK_DBTP} dBTP" >&2
  exit 1
fi

echo "Done."
ls -la out
