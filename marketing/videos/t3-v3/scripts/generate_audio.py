#!/usr/bin/env python3
"""Builds the full soundtrack of the T3 ad from src/timeline.json.

  SFX bus   : sparse cues from timeline.sfx (see sfx_synth.py)
  Music bus : original score (see music_synth.py), ducked under the SFX bus
  Master    : look-ahead peak limiter, then true-peak normalization

Outputs (48 kHz, 16-bit stereo):
  public/audio/mix.wav           soundtrack used by the composition
  public/audio/stems/music.wav   music bus before ducking
  public/audio/stems/sfx.wav     SFX bus
  public/audio/sfx/<type>.wav    each effect isolated (for re-edits)

Requires: python3 + numpy.
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_synth import render_music  # noqa: E402
from sfx_synth import GENERATORS, SR, rng  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TIMELINE = json.loads((ROOT / "src" / "timeline.json").read_text())
OUT_DIR = ROOT / "public" / "audio"

TARGET_TRUE_PEAK_DBTP = -2.0
MUSIC_GAIN_DB = -7.0
DUCK_DEPTH_DB = -9.0
LIMITER_CEILING = 10 ** (-2.5 / 20)
BLOCK = 48  # 1 ms analysis blocks for ducking and limiting


def true_peak_dbtp(stereo: np.ndarray, oversample: int = 4) -> float:
    peaks = []
    for ch in range(stereo.shape[1]):
        spectrum = np.fft.rfft(stereo[:, ch])
        upsampled = np.fft.irfft(spectrum, n=len(stereo) * oversample) * oversample
        peaks.append(np.max(np.abs(upsampled)))
    return 20 * np.log10(max(peaks))


def block_peaks(stereo: np.ndarray) -> np.ndarray:
    n_blocks = int(np.ceil(len(stereo) / BLOCK))
    padded = np.zeros((n_blocks * BLOCK, 2))
    padded[: len(stereo)] = stereo
    return np.abs(padded).max(axis=1).reshape(n_blocks, BLOCK).max(axis=1)


def blocks_to_samples(values: np.ndarray, n: int) -> np.ndarray:
    centers = np.arange(len(values)) * BLOCK + BLOCK / 2
    return np.interp(np.arange(n), centers, values)


def duck_gain(sfx: np.ndarray) -> np.ndarray:
    """Envelope follower on the SFX bus (fast attack, slow release) -> music gain."""
    peaks = block_peaks(sfx)
    attack, release = 1 - np.exp(-1 / 3), 1 - np.exp(-1 / 220)
    env = np.zeros_like(peaks)
    level = 0.0
    for i, p in enumerate(peaks):
        level += (attack if p > level else release) * (p - level)
        env[i] = level
    amount = np.clip(env / 0.35, 0, 1)
    return blocks_to_samples(10 ** (DUCK_DEPTH_DB * amount / 20), len(sfx))


def limit(stereo: np.ndarray) -> np.ndarray:
    peaks = block_peaks(stereo)
    needed = np.minimum(1.0, LIMITER_CEILING / np.maximum(peaks, 1e-9))
    lookahead = 4
    padded = np.concatenate([needed, np.ones(lookahead)])
    ahead = np.min(np.stack([padded[i : i + len(needed)] for i in range(lookahead + 1)]), axis=0)
    smoothed = np.empty_like(ahead)
    gain = 1.0
    release_per_block = 1 - np.exp(-1 / 80)
    for i, g in enumerate(ahead):
        gain = g if g < gain else gain + (g - gain) * release_per_block
        smoothed[i] = gain
    return stereo * blocks_to_samples(smoothed, len(stereo))[:, None]


def write_wav(path: Path, stereo: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dither = (rng.uniform(-0.5, 0.5, stereo.shape) + rng.uniform(-0.5, 0.5, stereo.shape)) / 32768
    pcm = np.clip((stereo + dither) * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())


def to_peak_dbtp(stereo: np.ndarray, target: float) -> np.ndarray:
    return stereo * 10 ** ((target - true_peak_dbtp(stereo)) / 20)


def main() -> None:
    fps = TIMELINE["fps"]
    total = int(TIMELINE["durationInFrames"] / fps * SR)
    beats = TIMELINE["beats"]

    sfx = np.zeros((total, 2))
    cache: dict[str, np.ndarray] = {}
    for cue in TIMELINE["sfx"]:
        kind = cue["type"]
        if kind not in cache:
            cache[kind] = GENERATORS[kind]()
        sound = cache[kind] * 10 ** (cue.get("gainDb", 0) / 20)
        start = max(0, round((beats[cue["at"]] + cue.get("offset", 0)) / fps * SR))
        end = min(total, start + len(sound))
        sfx[start:end] += sound[: end - start]

    music = render_music(TIMELINE)[:total] * 10 ** (MUSIC_GAIN_DB / 20)
    sfx /= np.max(np.abs(sfx))

    mix = music * duck_gain(sfx)[:, None] + sfx
    mix *= 1.35 / np.max(np.abs(mix))
    mix = to_peak_dbtp(limit(mix), TARGET_TRUE_PEAK_DBTP)

    write_wav(OUT_DIR / "mix.wav", mix)
    write_wav(OUT_DIR / "stems" / "music.wav", to_peak_dbtp(music, -3.0))
    write_wav(OUT_DIR / "stems" / "sfx.wav", to_peak_dbtp(sfx, -3.0))
    for kind, sound in cache.items():
        write_wav(OUT_DIR / "sfx" / f"{kind}.wav", to_peak_dbtp(sound, -3.0))

    print(
        f"mix.wav: {total / SR:.2f}s, {len(TIMELINE['sfx'])} SFX cues, "
        f"true peak {true_peak_dbtp(mix):.2f} dBTP"
    )


if __name__ == "__main__":
    main()
