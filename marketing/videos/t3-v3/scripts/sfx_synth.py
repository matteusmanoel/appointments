"""Sound effects of the T3 ad, synthesized from scratch.

No samples are used: every sound is generated from sine waves and seeded white
noise, so the output is original material owned by the project. Each generator
returns a stereo float array (n, 2) normalized to a peak of 1.0.
"""

from __future__ import annotations

import numpy as np

SR = 48_000

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


def metal_ring(duration: float, partials: list[float], decay: float, beat_hz: float) -> np.ndarray:
    """Inharmonic steel ring; detuned pairs give the shimmering beat of a blade."""
    t = seconds(duration)
    ring = np.zeros_like(t)
    for i, f in enumerate(partials):
        amp = 1.0 / (1 + i * 0.6)
        ring += amp * (np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * (f + beat_hz) * t + i))
    return ring * np.exp(-t * decay)


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


def katana_draw() -> np.ndarray:
    """Blade leaving the scabbard: rising resonant scrape ending in a steel 'shing'."""
    draw = 0.33
    t = seconds(draw)
    u = t / draw
    scrape = svf(noise(draw), 2400 * (7200 / 2400) ** u, q=5.0, mode="band")
    grit = 0.55 + 0.45 * np.sign(np.sin(2 * np.pi * 38 * t))
    glide = sum(
        np.sin(2 * np.pi * np.cumsum(f * (1 + 0.06 * u)) / SR) / (i + 1)
        for i, f in enumerate([1870.0, 2990.0, 4410.0, 6230.0])
    )
    body = (normalize(scrape) * grit * 0.8 + normalize(glide) * 0.35) * u**1.3
    ring = metal_ring(1.3, [2350.0, 3720.0, 5030.0, 6810.0, 8200.0], decay=3.2, beat_hz=3.5)
    out = np.zeros(len(t) + len(ring))
    out[: len(t)] += normalize(body)
    out[len(t) - int(0.02 * SR) : len(t) - int(0.02 * SR) + len(ring)] += normalize(ring) * 0.75
    mono = fade_edges(normalize(out), 3, 60)
    return pan(mono, np.concatenate([np.linspace(-0.4, 0.2, len(t)), np.full(len(ring), 0.2)]))


def katana_slash() -> np.ndarray:
    """Cut through the air and the hit: fast swish, transient, low thump, long ring."""
    duration = 1.4
    t = seconds(duration)
    swish_len = int(0.16 * SR)
    u = np.linspace(0, 1, swish_len)
    swish = svf(noise(0.16), 900 * (7000 / 900) ** u, q=1.3, mode="band")
    swish *= np.where(u < 0.75, (u / 0.75) ** 2, ((1 - u) / 0.25) ** 0.8)
    hit_at = int(0.12 * SR)
    th = t[: len(t) - hit_at]
    thump = np.sin(2 * np.pi * np.cumsum(48 + 90 * np.exp(-th * 30)) / SR) * np.exp(-th * 7)
    click = svf(noise(0.05), 5000.0, q=0.7, mode="high") * np.exp(-seconds(0.05) * 160)
    ring = metal_ring(duration - 0.12, [2100.0, 3300.0, 4700.0, 6600.0, 9100.0], decay=3.6, beat_hz=5.0)

    out = np.zeros(len(t))
    out[:swish_len] += normalize(swish) * 0.9
    out[hit_at : hit_at + len(thump)] += np.tanh(2.0 * thump) * 0.9
    out[hit_at : hit_at + len(click)] += normalize(click) * 0.7
    out[hit_at : hit_at + len(ring)] += normalize(ring) * 0.55
    mono = fade_edges(normalize(out), 1, 80)
    return pan(mono, np.concatenate([np.linspace(-0.7, 0.7, swish_len), np.full(len(t) - swish_len, 0.0)]))


GENERATORS = {
    "whoosh": whoosh,
    "impact": impact,
    "tick": tick,
    "pop": pop,
    "beep_confirm": beep_confirm,
    "riser": riser,
    "shimmer": shimmer,
    "katana_draw": katana_draw,
    "katana_slash": katana_slash,
}
