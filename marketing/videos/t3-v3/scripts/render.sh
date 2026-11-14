#!/usr/bin/env bash
# Renders every deliverable of the T3 v3.1 ad into out/ and checks the audio peak.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p out

NAME="t3-v3-1"
MAX_TRUE_PEAK_DBTP="-1.0"

echo "1/5 Synthesizing soundtrack (public/audio/mix.wav: music + SFX)"
python3 scripts/generate_audio.py

echo "2/5 Rendering out/${NAME}.mp4 (H.264 + AAC)"
npx remotion render T3V3 "out/${NAME}.mp4" \
  --codec=h264 --crf=16 --pixel-format=yuv420p \
  --audio-codec=aac --audio-bitrate=192k

echo "3/5 Silent version out/${NAME}-sem-audio.mp4 (same video stream, audio removed)"
npx remotion ffmpeg -y -hide_banner -loglevel error \
  -i "out/${NAME}.mp4" -map 0:v:0 -c:v copy -an -movflags +faststart "out/${NAME}-sem-audio.mp4"

echo "4/5 Contact sheet out/${NAME}-contact-sheet.png"
npx remotion still ContactSheet "out/${NAME}-contact-sheet.png" --frame=0 --image-format=png

echo "5/5 Checking true peak of the encoded AAC track"
LOUDNESS=$(npx remotion ffmpeg -hide_banner -nostats -i "out/${NAME}.mp4" -vn \
  -af loudnorm=print_format=json -f null - 2>&1)
TRUE_PEAK=$(sed -n 's/.*"input_tp" : "\([^"]*\)".*/\1/p' <<<"${LOUDNESS}")
INTEGRATED=$(sed -n 's/.*"input_i" : "\([^"]*\)".*/\1/p' <<<"${LOUDNESS}")
echo "   true peak: ${TRUE_PEAK} dBTP (limit ${MAX_TRUE_PEAK_DBTP}) | integrated: ${INTEGRATED} LUFS"
if awk "BEGIN { exit !(${TRUE_PEAK} >= ${MAX_TRUE_PEAK_DBTP}) }"; then
  echo "   ERROR: true peak above ${MAX_TRUE_PEAK_DBTP} dBTP" >&2
  exit 1
fi

echo "Done."
ls -la out
