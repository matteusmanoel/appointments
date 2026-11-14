"""Original background score of the T3 ad, synthesized from scratch.

112.5 BPM, so one beat is exactly 16 video frames at 30 fps and the cuts of
src/timeline.json land on the grid. Narrative arc:

  hook / pain / proof / pain peak : A minor, tension rising (filter opens,
                                    drums and bass densify, riser into the turn)
  delegate (the turn)             : F major -> G major lift, then a breath of
                                    silence for the katana draw
  close (resolution)              : A major on the katana slash, bright groove

Every voice is additive synthesis or seeded noise: no samples, no loops from
third parties.
"""

from __future__ import annotations

import numpy as np

from sfx_synth import SR, pan, rng, seconds


def midi(note: int) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


A1, BB1, C2, E1, F1, G1 = 33, 34, 36, 28, 29, 31
A2, E2, F2, G2, BB2 = 45, 40, 41, 43, 46
A3, CS4, C4, E3, E4, F3, G3, B3, D4, F4, G4, A4 = 57, 61, 60, 52, 64, 53, 55, 59, 62, 65, 67, 69
C5, CS5, E5, A5 = 72, 73, 76, 81


def _shaped_noise(duration: float, low_hz: float, high_hz: float) -> np.ndarray:
    n = int(duration * SR)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spectrum[(freqs < low_hz) | (freqs > high_hz)] = 0
    out = np.fft.irfft(spectrum, n)
    return out / np.max(np.abs(out))


HAT_NOISE = _shaped_noise(0.4, 7000, 16000)
SNARE_NOISE = _shaped_noise(0.3, 900, 7000)
CRASH_NOISE = _shaped_noise(2.2, 3500, 16000)
RISER_NOISE = _shaped_noise(1.6, 1500, 12000)


def envelope(n: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(n)
    a = min(n, max(1, int(attack * SR)))
    r = min(n - a, max(1, int(release * SR)))
    env[:a] = np.linspace(0, 1, a)
    env[n - r :] *= np.linspace(1, 0, r)
    return env


def saw(freq: float, duration: float, cutoff: float, detune_cents: float = 0.0) -> np.ndarray:
    """Band-limited sawtooth through a 2-pole low-pass, built from harmonics."""
    t = seconds(duration)
    f = freq * 2 ** (detune_cents / 1200)
    out = np.zeros_like(t)
    k_max = max(1, int(min(15000.0, cutoff * 4) / f))
    for k in range(1, k_max + 1):
        amp = (1 / k) / np.sqrt(1 + (k * f / cutoff) ** 4)
        out += amp * np.sin(2 * np.pi * k * f * t + k * 0.7)
    return out


def kick() -> np.ndarray:
    t = seconds(0.4)
    body = np.sin(2 * np.pi * np.cumsum(46 + 95 * np.exp(-t * 32)) / SR) * np.exp(-t * 9)
    click = HAT_NOISE[: len(t)] * np.exp(-t * 300) * 0.25
    return np.tanh(1.8 * (body + click))


def snare() -> np.ndarray:
    t = seconds(0.25)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 28)
    return tone * 0.5 + SNARE_NOISE[: len(t)] * np.exp(-t * 18)


def hat(open_hat: bool = False) -> np.ndarray:
    t = seconds(0.3 if open_hat else 0.07)
    return HAT_NOISE[: len(t)] * np.exp(-t * (11 if open_hat else 70))


def crash() -> np.ndarray:
    t = seconds(2.2)
    return CRASH_NOISE[: len(t)] * np.exp(-t * 2.0)


def bass(note: int, duration: float, cutoff: float) -> np.ndarray:
    f = midi(note)
    t = seconds(duration)
    tone = saw(f, duration, cutoff) + 0.6 * np.sin(2 * np.pi * f * t)
    return np.tanh(1.4 * tone) * envelope(len(t), 0.004, 0.03)


def pluck(note: int) -> np.ndarray:
    f = midi(note)
    t = seconds(0.32)
    tone = sum(
        (0.5**i) * np.sin(2 * np.pi * f * (i + 1) * t) * np.exp(-t * (9 + 5 * i)) for i in range(4)
    )
    return tone * envelope(len(t), 0.002, 0.05)


def chord(notes: list[int], duration: float, cutoff: float, attack: float, release: float) -> np.ndarray:
    """Wide detuned-saw pad, returned in stereo."""
    n = int(duration * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for note in notes:
        f = midi(note)
        left += saw(f, duration, cutoff, -9) + 0.5 * saw(f, duration, cutoff, 0)
        right += saw(f, duration, cutoff, +9) + 0.5 * saw(f, duration, cutoff, 0)
    env = envelope(n, attack, release)
    return np.stack([left * env, right * env], axis=1) / max(1, len(notes))


def riser(duration: float) -> np.ndarray:
    t = seconds(duration)
    u = t / duration
    sweep = np.sin(2 * np.pi * np.cumsum(220 * (1400 / 220) ** u) / SR)
    return (RISER_NOISE[: len(t)] * 0.7 + sweep * 0.3) * u**2.2


class Score:
    def __init__(self, fps: int, duration_frames: int) -> None:
        self.fps = fps
        self.buffer = np.zeros((int(duration_frames / fps * SR), 2))

    def sample(self, frame: float) -> int:
        return int(round(frame / self.fps * SR))

    def seconds(self, frames: float) -> float:
        return frames / self.fps

    def put(self, frame: float, sound: np.ndarray, gain: float, position: float = 0.0) -> None:
        stereo = sound if sound.ndim == 2 else pan(sound, position)
        start = self.sample(frame)
        end = min(len(self.buffer), start + len(stereo))
        if end > start:
            self.buffer[start:end] += stereo[: end - start] * gain


def render_music(timeline: dict) -> np.ndarray:
    fps = timeline["fps"]
    beat = timeline["musicBeatFrames"]
    eighth = beat // 2
    sixteenth = beat // 4
    scenes = timeline["scenes"]
    beats = timeline["beats"]
    s = Score(fps, timeline["durationInFrames"])

    hook0, hook1 = scenes["hook"]
    pain0, pain1 = scenes["problem"]
    proof0, proof1 = scenes["proof"]
    peak0, peak1 = scenes["value"]
    turn0, _ = scenes["delegate"]
    slash = beats["slash"]
    end = timeline["durationInFrames"]
    breath = beats["katanaDraw"] - 6

    def grid(a: int, b: int, step: int) -> range:
        return range(a, b, step)

    def bass_line(a: int, b: int, pattern: list[int], cutoff0: float, cutoff1: float, gain: float) -> None:
        for i, frame in enumerate(grid(a, b, eighth)):
            cutoff = cutoff0 + (cutoff1 - cutoff0) * (frame - a) / max(1, b - a)
            s.put(frame, bass(pattern[i % len(pattern)], s.seconds(eighth) * 0.9, cutoff), gain)

    def arp(a: int, b: int, notes: list[int], gain: float) -> None:
        for i, frame in enumerate(grid(a, b, sixteenth)):
            s.put(frame, pluck(notes[i % len(notes)]), gain, -0.35 if i % 2 else 0.35)

    def hats(a: int, b: int, step: int, gain: float, open_offbeats: bool = False) -> None:
        for frame in grid(a, b, step):
            s.put(frame, hat(), gain, 0.2)
        if open_offbeats:
            for frame in grid(a + eighth, b, beat):
                s.put(frame, hat(open_hat=True), gain * 0.55, 0.25)

    # Hook: drone, ticking hats, heartbeat kick, bass enters on ATENDENTE?
    s.put(hook0, chord([A2, E3], s.seconds(hook1 - hook0 + 4), 450, 0.02, 0.1), 0.38)
    hats(hook0, hook1, eighth, 0.10)
    for frame in grid(hook0, hook1, beat * 2):
        s.put(frame, kick(), 0.65)
        s.put(frame + 6, kick(), 0.35)
    bass_line(beats["atendente"], hook1, [A1], 350, 450, 0.42)

    # Pain: four-on-the-floor, bass filter opening, stabs on Marca / Remarca / Avisa.
    s.put(pain0, chord([A2, E3, A3], s.seconds(pain1 - pain0 + 4), 800, 0.01, 0.1), 0.45)
    for frame in grid(pain0, pain1, beat):
        s.put(frame, kick(), 0.85)
    hats(pain0, pain1, eighth, 0.13, open_offbeats=True)
    bass_line(pain0, pain1, [A1, A1, A2, A1], 450, 1100, 0.45)
    for key in ("marca", "remarca", "avisa"):
        s.put(beats[key], chord([A3, C4, E4, A4], 0.2, 3200, 0.002, 0.12), 0.55)

    # Proof: steady groove, quieter pad so the chat can be read, plucked arpeggio.
    s.put(proof0, chord([A2, E3, A3, C4], s.seconds(proof1 - proof0 + 4), 1000, 0.01, 0.1), 0.3)
    for frame in grid(proof0, proof1, beat):
        s.put(frame, kick(), 0.8)
    hats(proof0, proof1, eighth, 0.12, open_offbeats=True)
    bass_line(proof0, proof1, [A1, A1, A2, A1, A1, C2, A1, G1], 900, 1000, 0.42)
    arp(proof0, proof1, [A3, C4, E4, A4], 0.1)

    # Pain peak: snare on 2 and 4, 16th hats, phrygian A/Bb bass, riser and roll into the turn.
    mid = peak0 + (peak1 - peak0) // 2
    s.put(peak0, chord([A2, E3, A3, E4], s.seconds(mid - peak0), 1300, 0.01, 0.05), 0.5)
    s.put(mid, chord([A2, E3, A3, E4], s.seconds(peak1 - mid), 2300, 0.01, 0.05), 0.56)
    for i, frame in enumerate(grid(peak0, peak1, beat)):
        s.put(frame, kick(), 1.0)
        if i % 2 == 1:
            s.put(frame, snare(), 0.6)
    hats(peak0, peak1, sixteenth, 0.09)
    bass_line(peak0, peak1, [A1, A2, A1, A2, BB1, BB2, BB1, BB2], 1000, 2400, 0.52)
    arp(peak0, peak1 - beat, [E4, A4, C5, E5], 0.09)
    riser_len = beat * 2.5
    s.put(peak1 - riser_len, riser(s.seconds(riser_len)), 0.4)
    for i, frame in enumerate(grid(peak1 - beat, peak1, sixteenth // 2)):
        s.put(frame, snare(), 0.25 + 0.06 * i)

    # Turn: F major -> G major lift, then silence for the katana draw.
    domine = beats["domine"]
    s.put(turn0, crash(), 0.45)
    s.put(turn0, chord([F3, A3, C4, F4], s.seconds(domine - turn0), 2600, 0.005, 0.03), 0.62)
    s.put(domine, chord([G3, B3, D4, G4], s.seconds(breath - domine), 2800, 0.005, 0.03), 0.62)
    s.put(turn0, bass(F1, s.seconds(domine - turn0), 900), 0.55)
    s.put(domine, bass(G1, s.seconds(breath - domine), 900), 0.55)
    for frame in (turn0, turn0 + beat, domine, domine + beat):
        s.put(frame, kick(), 1.0)
    for frame in (turn0 + beat, domine + beat // 2):
        s.put(frame, snare(), 0.55)
    hats(turn0, breath, eighth, 0.12)

    # Resolution: A major lands on the slash, bright groove to the end.
    s.put(slash, crash(), 0.5)
    s.put(slash, chord([A3, CS4, E4, A4], s.seconds(end - slash), 2600, 0.004, 0.3), 0.55)
    for i, frame in enumerate(grid(slash, end, beat)):
        s.put(frame, kick(), 0.9)
        if i % 2 == 1:
            s.put(frame, snare(), 0.5)
    hats(slash + eighth, end, eighth, 0.12, open_offbeats=True)
    bass_line(slash, end, [A1, A2, A1, A2, E1 + 12, E2, E1 + 12, E2], 1300, 1500, 0.45)
    arp(slash + beat, end, [A4, CS5, E5, A5], 0.09)

    out = s.buffer
    fade = s.sample(beat)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    return out / np.max(np.abs(out))
