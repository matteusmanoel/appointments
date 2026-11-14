#!/usr/bin/env python3
"""Synthesizes every sound effect of the T3 v3 ad from scratch and mixes them
into a single 48 kHz stereo track aligned to src/timeline.json.

No samples are used: every sound is generated from sine waves and seeded white
noise, so the output is original material owned by the project.

Outputs:
  public/audio/sfx-mix.wav       full 15 s mix used by the composition
  public/audio/sfx/<type>.wav    each effect isolated (for re-edits)

Requires: python3 + numpy.
"""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

SR = 48_000
ROOT = Path(__file__).resolve().parent.parent
TIMELINE = json.loads((ROOT / "src" / "timeline.json").read_text())
OUT_DIR = ROOT / "public" / "audio"
TARGET_TRUE_PEAK_DBTP = -3.0

rng = np.random.default_rng(20261114)


def seconds(n: float) -> np.ndarray:
    return np.arange(int(n * SR)) / SR


def noise(n_seconds: float) -> np.ndarray:
    return rng.standard_normal(int(n_seconds * SR))


def svf(signal: np.ndarray, cutoff_hz: np.ndarray | float, q: float, mode: str) -> np.ndarray:
    """Chamberlin state-variable filter with per-sample cutoff (for sweeps)."""
    n = len(signal)
    fc = np.broadcast_to(np.asarray(cutoff_hz, dtype=float), (n,))
    f = 2.0 * np.sin(np.pi * np.minimum(fc, SR / 6.5) / SR)
    damp = 1.0 / q
    low = band = 0.0
    out = np.empty(n)
    for i in range(n):
        high = signal[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        out[i] = band if mode == "band" else (low if mode == "low" else high)
    return out


def normalize(x: np.ndarray) -> np.ndarray:
    peak = np.max(np.abs(x))
    return x / peak if peak > 0 else x


def fade_edges(x: np.ndarray, fade_in_ms: float = 1.0, fade_out_ms: float = 8.0) -> np.ndarray:
    y = x.copy()
    a = max(1, int(SR * fade_in_ms / 1000))
    b = max(1, int(SR * fade_out_ms / 1000))
    y[:a] *= np.linspace(0, 1, a)
    y[-b:] *= np.linspace(1, 0, b)
    return y


def pan(mono: np.ndarray, position: np.ndarray | float) -> np.ndarray:
    """Equal-power pan, position in [-1, 1] (may vary per sample)."""
    p = np.broadcast_to(np.asarray(position, dtype=float), mono.shape)
    angle = (p + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1)


# ---------------------------------------------------------------- generators


def whoosh(duration: float = 0.42, f0: float = 300, f1: float = 5200, peak_at: float = 0.78) -> np.ndarray:
    n = int(duration * SR)
    t = np.linspace(0, 1, n)
    cutoff = f0 * (f1 / f0) ** (t**1.4)
    body = svf(noise(duration), cutoff, q=1.6, mode="band")
    air = svf(noise(duration), cutoff * 1.8, q=0.8, mode="band") * 0.35
    env = np.where(t < peak_at, (t / peak_at) ** 2.4, ((1 - t) / (1 - peak_at)) ** 1.2)
    mono = fade_edges(normalize((body + air) * env))
    return pan(mono, np.linspace(-0.55, 0.55, n))


def whoosh_short() -> np.ndarray:
    return whoosh(duration=0.2, f0=900, f1=7000, peak_at=0.7)


def impact(duration: float = 0.75, weight: float = 1.0) -> np.ndarray:
    t = seconds(duration)
    freq = 42 + 120 * np.exp(-t * 28)
    sub = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * (6.5 / weight))
    crack = svf(noise(duration), 1800.0, q=0.9, mode="band") * np.exp(-t * 38)
    click = svf(noise(duration), 6000.0, q=0.7, mode="high") * np.exp(-t * 180)
    tail = svf(noise(duration), 420.0, q=0.7, mode="low") * np.exp(-t * 9)
    mix = sub * 1.0 + normalize(crack) * 0.38 * weight + normalize(click) * 0.32 + normalize(tail) * 0.22
    mono = np.tanh(2.2 * mix) / np.tanh(2.2)
    return pan(fade_edges(normalize(mono), 0.3, 30), 0.0)


def impact_soft() -> np.ndarray:
    t = seconds(0.45)
    freq = 55 + 90 * np.exp(-t * 35)
    sub = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 11)
    thud = svf(noise(0.45), 900.0, q=0.8, mode="low") * np.exp(-t * 45)
    mono = np.tanh(1.6 * (sub + normalize(thud) * 0.3))
    return pan(fade_edges(normalize(mono), 0.3, 25), 0.0)


def snap() -> np.ndarray:
    """Punchy hit for each kinetic word: short body + bright transient."""
    t = seconds(0.32)
    freq = 70 + 190 * np.exp(-t * 40)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 16)
    snap_noise = svf(noise(0.32), 3500.0, q=0.9, mode="band") * np.exp(-t * 70)
    mono = np.tanh(2.0 * (body + normalize(snap_noise) * 0.55))
    return pan(fade_edges(normalize(mono), 0.2, 20), 0.0)


def tick() -> np.ndarray:
    t = seconds(0.06)
    tone = np.sin(2 * np.pi * 3100 * t) * np.exp(-t * 140)
    click = svf(noise(0.06), 7000.0, q=0.7, mode="high") * np.exp(-t * 400)
    mono = normalize(tone + normalize(click) * 0.4)
    return pan(fade_edges(mono, 0.1, 5), 0.15)


def pop() -> np.ndarray:
    t = seconds(0.09)
    freq = 520 + 700 * (1 - np.exp(-t * 60))
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 48)
    return pan(fade_edges(normalize(tone), 0.5, 10), -0.1)


def beep_confirm() -> np.ndarray:
    """Two rising bell-like notes (C6 then G6). Original, not any app's chime."""

    def note(freq: float, dur: float) -> np.ndarray:
        t = seconds(dur)
        partials = (
            np.sin(2 * np.pi * freq * t)
            + 0.28 * np.sin(2 * np.pi * freq * 2 * t)
            + 0.08 * np.sin(2 * np.pi * freq * 3.01 * t)
        )
        env = (1 - np.exp(-t * 900)) * np.exp(-t * 9)
        return partials * env

    first = note(1046.5, 0.11)
    gap = np.zeros(int(0.025 * SR))
    second = note(1568.0, 0.32)
    mono = np.concatenate([fade_edges(first, 0.5, 12), gap, fade_edges(second, 0.5, 40)])
    return pan(normalize(mono), 0.0)


def riser() -> np.ndarray:
    duration = 0.36
    n = int(duration * SR)
    t = np.linspace(0, 1, n)
    freq = 180 * (1600 / 180) ** (t**1.2)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR)
    tone = np.sign(tone) * np.abs(tone) ** 0.6
    hiss = svf(noise(duration), freq * 3, q=1.4, mode="band")
    env = t**1.6
    mono = fade_edges(normalize((tone * 0.55 + normalize(hiss) * 0.45) * env), 2, 6)
    return pan(mono, np.linspace(-0.3, 0.3, n))


def shimmer() -> np.ndarray:
    t = seconds(0.45)
    freqs = [2637.0, 3136.0, 3951.0, 5274.0]
    tones = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) for f in freqs)
    tremolo = 0.6 + 0.4 * np.sin(2 * np.pi * 22 * t)
    env = (1 - np.exp(-t * 400)) * np.exp(-t * 8)
    mono = normalize(tones * tremolo * env)
    return pan(fade_edges(mono, 0.5, 30), np.sin(2 * np.pi * 3 * t) * 0.4)


GENERATORS = {
    "whoosh": whoosh,
    "whoosh_short": whoosh_short,
    "impact": impact,
    "impact_soft": impact_soft,
    "snap": snap,
    "tick": tick,
    "pop": pop,
    "beep_confirm": beep_confirm,
    "riser": riser,
    "shimmer": shimmer,
}


# ---------------------------------------------------------------- mix + io


def true_peak_dbtp(stereo: np.ndarray, oversample: int = 4) -> float:
    peaks = []
    for ch in range(stereo.shape[1]):
        x = stereo[:, ch]
        spectrum = np.fft.rfft(x)
        upsampled = np.fft.irfft(spectrum, n=len(x) * oversample) * oversample
        peaks.append(np.max(np.abs(upsampled)))
    return 20 * np.log10(max(peaks))


def write_wav(path: Path, stereo: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dither = (rng.uniform(-0.5, 0.5, stereo.shape) + rng.uniform(-0.5, 0.5, stereo.shape)) / 32768
    pcm = np.clip((stereo + dither) * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())


def main() -> None:
    fps = TIMELINE["fps"]
    total = int(TIMELINE["durationInFrames"] / fps * SR)
    beats = TIMELINE["beats"]
    mix = np.zeros((total, 2))

    cache: dict[str, np.ndarray] = {}
    for cue in TIMELINE["sfx"]:
        kind = cue["type"]
        if kind not in cache:
            cache[kind] = GENERATORS[kind]()
        sound = cache[kind] * 10 ** (cue.get("gainDb", 0) / 20)
        frame = beats[cue["at"]] + cue.get("offset", 0)
        start = max(0, round(frame / fps * SR))
        end = min(total, start + len(sound))
        mix[start:end] += sound[: end - start]

    for kind, sound in cache.items():
        single = sound * 10 ** ((TARGET_TRUE_PEAK_DBTP - true_peak_dbtp(sound)) / 20)
        write_wav(OUT_DIR / "sfx" / f"{kind}.wav", single)

    gain_db = TARGET_TRUE_PEAK_DBTP - true_peak_dbtp(mix)
    mix *= 10 ** (gain_db / 20)
    write_wav(OUT_DIR / "sfx-mix.wav", mix)
    print(f"sfx-mix.wav: {total / SR:.2f}s, {len(TIMELINE['sfx'])} cues, true peak {true_peak_dbtp(mix):.2f} dBTP")


if __name__ == "__main__":
    main()
