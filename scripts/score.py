"""Original, deterministic 240-second score for The Shape of Intelligence.

Run with Python + NumPy. All instruments and effects are synthesized here;
there are no sampled instruments, external recordings, or copyrighted melodies.
The local .tools/ffmpeg.exe handles two-pass mastering and AAC verification.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
LOCAL_FFMPEG = [ROOT / ".tools" / name for name in
                (["ffmpeg.exe", "ffmpeg"] if os.name == "nt" else ["ffmpeg", "ffmpeg.exe"])]
FFMPEG = Path(os.environ.get("FFMPEG_PATH") or
              next((str(path) for path in LOCAL_FFMPEG if path.is_file()), "") or
              shutil.which("ffmpeg") or "ffmpeg")
SR = 48_000
DURATION = 240
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
RNG = np.random.default_rng(20933)
N = SR * DURATION
MIX = np.zeros((N, 2), dtype=np.float32)
SPACE = np.zeros((N, 2), dtype=np.float32)
COUNTS: dict[str, int] = {}

SECTIONS = [
    {"start": 0, "end": 16, "name": "悬念 / The question", "energy": .24},
    {"start": 16, "end": 24, "name": "片名 / The shape of intelligence", "energy": .72},
    {"start": 24, "end": 52, "name": "数据与学习 / Learning from data", "energy": .48},
    {"start": 52, "end": 80, "name": "梯度山谷 / Finding a direction", "energy": .63},
    {"start": 80, "end": 104, "name": "向量星空 / A space of meaning", "energy": .46},
    {"start": 104, "end": 136, "name": "注意力 / Connecting the context", "energy": .65},
    {"start": 136, "end": 164, "name": "文本生成 / One token at a time", "energy": .76},
    {"start": 164, "end": 192, "name": "扩散图像 / From noise to form", "energy": .84},
    {"start": 192, "end": 220, "name": "事实核验 / Testing what we know", "energy": .44},
    {"start": 220, "end": 240, "name": "升华 / The questions ahead", "energy": .68},
]

# (bass, four-note close voicing): D minor with a luminous D-major final cadence.
CHORDS = {
    "d": (38, [62, 65, 69, 76]),       # Dm(add9)
    "b": (34, [62, 65, 69, 70]),       # Bbmaj7
    "f": (41, [60, 64, 65, 69]),       # Fmaj7
    "c": (36, [60, 64, 67, 74]),       # Cadd9
    "g": (31, [58, 62, 65, 69]),       # Gm9
    "a": (33, [61, 64, 67, 69]),       # A7
    "s": (33, [62, 64, 69, 74]),       # Asus4
    "m": (33, [60, 64, 67, 69]),       # Am7
    "D": (38, [62, 66, 69, 76]),       # D(add9)
}
PROGRESSIONS = [
    "ddbbggss", "dbsa", "dbfcdbfcgbsaad", "gdbcgdbcbdsaad",
    "fmbcfmbcgbcs", "dfcgbdsa dfcgbdsa".replace(" ", ""),
    "dbfcdbfcgbsaad", "bfcdbfcdbfcgcs", "bgda bgda bgdsad".replace(" ", ""),
    "dbfcgbDDDD",
]


def hz(midi: float) -> float:
    return 440 * 2 ** ((midi - 69) / 12)


def add(at: float, signal: np.ndarray, gain: float, pan: float = 0,
        wet: float = .25, label: str = "note") -> None:
    start = round(at * SR)
    if start >= N:
        return
    if start < 0:
        signal = signal[-start:]
        start = 0
    length = min(len(signal), N - start)
    if length <= 0:
        return
    signal = signal[:length].astype(np.float32, copy=False) * gain
    # Constant-power pan; space receives a softer, wider copy.
    theta = (float(np.clip(pan, -1, 1)) + 1) * np.pi / 4
    left, right = math.cos(theta), math.sin(theta)
    MIX[start:start + length, 0] += signal * left
    MIX[start:start + length, 1] += signal * right
    if wet:
        SPACE[start:start + length, 0] += signal * left * wet
        SPACE[start:start + length, 1] += signal * right * wet
    COUNTS[label] = COUNTS.get(label, 0) + 1


def timeline(duration: float) -> np.ndarray:
    return np.arange(round(duration * SR), dtype=np.float32) / SR


def envelope(t: np.ndarray, sustain: float, attack: float, release: float) -> np.ndarray:
    a = np.minimum(t / max(attack, .001), 1)
    a = np.sin(a * np.pi / 2) ** 2
    r = np.clip((sustain + release - t) / max(release, .001), 0, 1)
    return a * np.sin(r * np.pi / 2) ** 2


def piano(midi: float, velocity: float = .8, duration: float = 3.8) -> np.ndarray:
    t = timeline(duration)
    f = hz(midi)
    y = np.zeros_like(t)
    # Slight string inharmonicity, transient-rich hammer, individually decaying partials.
    for partial in range(1, 9):
        freq = f * partial * math.sqrt(1 + .00011 * partial * partial)
        decay = 2.9 / (partial ** .7) * (220 / f) ** .18
        amplitude = velocity ** (.7 + partial * .08) / partial ** 1.6
        detune = .0006 if partial <= 3 else 0
        y += amplitude * np.exp(-t / decay) * (
            np.sin(2 * np.pi * freq * t) * .65 +
            np.sin(2 * np.pi * freq * (1 + detune) * t + .13) * .35)
    y += RNG.normal(0, .06, len(t)).astype(np.float32) * np.exp(-t * 160)
    y *= (1 - np.exp(-t * 200)) * np.clip((duration - t) / .18, 0, 1)
    return y


def organ(midi: float, sustain: float, bright: float = .5) -> np.ndarray:
    t = timeline(sustain + 1.5)
    f = hz(midi)
    y = .72 * np.sin(2 * np.pi * f * t)
    y += .24 * np.sin(2 * np.pi * f * 2 * t + .1)
    y += (.08 + bright * .07) * np.sin(2 * np.pi * f * 3 * t)
    y += bright * .075 * np.sin(2 * np.pi * f * 4 * t)
    y *= 1 + .018 * np.sin(2 * np.pi * 4.7 * t)
    return y * envelope(t, sustain, .3, 1.5)


def strings(midi: float, sustain: float, brightness: float = .6) -> np.ndarray:
    t = timeline(sustain + 1.1)
    f = hz(midi)
    vibrato = .0018 * np.sin(2 * np.pi * 5.15 * t) * np.minimum(t / .7, 1)
    y = np.zeros_like(t)
    for partial in range(1, 7):
        amp = np.exp(-partial * (.3 + (1 - brightness) * .25)) / partial
        phase = 2 * np.pi * f * partial * t
        y += amp * (np.sin(phase * 1.0018 + vibrato * f * partial) +
                    np.sin(phase * .9983 + .7)) * .5
    return y * envelope(t, sustain, .7, 1.1)


def pluck(midi: float, duration: float = 1.6, glass: bool = False) -> np.ndarray:
    t = timeline(duration)
    f = hz(midi)
    if glass:
        y = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2) +
             .24 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 4.6) +
             .08 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 8))
    else:
        y = np.sin(2 * np.pi * f * t + 1.8 * np.sin(2 * np.pi * f * t) * np.exp(-t * 14))
        y *= np.exp(-t * 5.5)
    return y * (1 - np.exp(-t * 380)) * np.clip((duration - t) / .05, 0, 1)


def bass(midi: float, duration: float = .44) -> np.ndarray:
    t = timeline(duration)
    f = hz(midi)
    y = np.sin(2 * np.pi * f * t) + .24 * np.sin(2 * np.pi * f * 2 * t)
    y += .08 * np.sin(2 * np.pi * f * 3 * t)
    return y * (1 - np.exp(-t * 130)) * np.exp(-t * 2.5) * np.clip((duration - t) / .08, 0, 1)


def kick() -> np.ndarray:
    t = timeline(.7)
    phase = 2 * np.pi * (43 * t + 70 * .025 * (1 - np.exp(-t / .025)))
    return np.sin(phase) * np.exp(-t * 8) + RNG.normal(0, .14, len(t)) * np.exp(-t * 150)


def snare() -> np.ndarray:
    t = timeline(.32)
    noise = RNG.normal(0, .7, len(t)).astype(np.float32)
    noise = noise - np.roll(noise, 1) * .6
    return noise * np.exp(-t * 20) + .4 * np.sin(2 * np.pi * 175 * t) * np.exp(-t * 30)


def hat(opened: bool = False) -> np.ndarray:
    t = timeline(.27 if opened else .1)
    noise = RNG.normal(0, .5, len(t)).astype(np.float32)
    high = noise - np.roll(noise, 1)
    return high * np.exp(-t * (18 if opened else 65)) * np.minimum(t * 1200, 1)


def whoosh(at: float, duration: float, strength: float = .1, reverse: bool = False) -> None:
    t = timeline(duration)
    noise = RNG.normal(0, 1, len(t)).astype(np.float32)
    smooth = np.convolve(noise, np.ones(23, dtype=np.float32) / 23, mode="same")
    shape = (t / duration) ** 1.8 if reverse else np.sin(np.pi * t / duration) ** 2
    sweep = np.sin(2 * np.pi * (160 * t + 260 * t * t / duration))
    sound = (smooth * 1.1 + .055 * sweep) * shape
    sound *= np.clip((duration - t) / .025, 0, 1)
    add(at, sound, strength, -.15, .7, "transition air")


def impact(at: float, strength: float = .25, tonal: int = 38) -> None:
    t = timeline(3.5)
    f = hz(tonal)
    sound = np.sin(2 * np.pi * (f * t + 28 * .035 * (1 - np.exp(-t / .035)))) * np.exp(-t * 2.5)
    sound += RNG.normal(0, .25, len(t)) * np.exp(-t * 45)
    add(at, sound, strength, 0, .45, "chapter impact")


def add_theme(start: float, transpose: int = 0, gain: float = .13,
              instrument: str = "piano", variant: int = 0) -> None:
    # Original four-bar "question / answer" theme. Four versions share its contour.
    phrases = [
        [(0, 74, 1.5), (1.5, 69, .5), (2, 72, 1), (3.5, 74, 1.5),
         (5, 77, 2), (7.5, 76, .5), (8, 72, 1.5), (10, 69, 1.5),
         (12, 70, 1), (13.5, 69, .5), (14, 65, 1), (15.5, 74, 2)],
        [(0, 77, 1.5), (2, 76, 1), (3.5, 72, .5), (4, 74, 2),
         (7, 69, 1), (8, 70, 1.5), (10, 72, 1), (11.5, 76, 1.5),
         (13, 74, 1), (14.5, 69, .5), (15, 74, 2)],
        [(0, 74, 1), (1.5, 77, .5), (2.5, 81, 1.5), (4.5, 79, 1),
         (6, 77, 2), (8.5, 76, 1), (10, 72, 1.5), (12, 74, 3)],
        [(0, 74, 2), (3, 69, 1), (4.5, 76, 1.5), (7, 78, 2),
         (10, 81, 1.5), (12, 76, 1), (14, 74, 3)],
    ]
    for step, note, beats in phrases[variant]:
        at = start + step * BEAT
        if instrument == "strings":
            sound = strings(note + transpose, beats * BEAT, .72)
            add(at, sound, gain, .08, .52, "theme strings")
            add(at, piano(note + transpose, .62, 3.5), gain * .7, -.12, .5, "theme piano")
        else:
            add(at, piano(note + transpose, .78, 4.2), gain, -.12, .55, "theme piano")


def compose() -> None:
    drum_kick, drum_snare, drum_hat, open_hat = kick(), snare(), hat(), hat(True)
    for section_id, sec in enumerate(SECTIONS):
        start, end, energy = sec["start"], sec["end"], sec["energy"]
        progression = PROGRESSIONS[section_id]
        bars = round((end - start) / BAR)
        print(f"Composing {sec['name']} ({start}–{end}s)", flush=True)
        for b in range(bars):
            at = start + b * BAR
            root, notes = CHORDS[progression[b % len(progression)]]
            # Two-bar breath, an eight-bar arc, and deliberate rests create forward motion.
            arc = .84 + .16 * math.sin(np.pi * (b % 8) / 8)
            energy_bar = energy * arc
            if section_id == 8:
                energy_bar *= 1 - .38 * b / bars
            if section_id == 9:
                energy_bar *= 1 - .67 * max(0, (b - 5) / 5)
            for j, note in enumerate(notes):
                pan = (j - 1.5) / 3 * .7
                add(at, strings(note - 12, 2.15, energy), .078 * energy_bar,
                    pan, .62, "harmony strings")
                if section_id in (0, 1, 7, 9) or b % 4 == 0:
                    add(at, organ(note - 12, 1.9, energy), .060 * energy_bar,
                        -pan, .65, "harmony organ")
            add(at, organ(root, 1.8, .15), .08 * energy_bar, 0, .3, "organ pedal")

            if section_id == 0:
                if b % 2 == 0:
                    add(at + .5, pluck(notes[1] + 12, 3, True), .06, -.4 + b * .1, .75, "question bell")
                if b >= 4:
                    add(at + 1, bass(root + 12, .65), .07, 0, .1, "anticipation pulse")
                continue
            if section_id == 9 and b >= 7:
                if b == 7:
                    for j, note in enumerate([50, 57, 62, 66, 69, 76]):
                        add(at + j * .075, piano(note, .58, 5.9), .115, (j - 2.5) * .13, .75, "final chord")
                continue

            # Arpeggio orchestration evolves: data dots, a wide vector harp, then fast generation.
            pattern = [0, 2, 1, 3, 2, 1, 3, 2]
            steps = 8 if section_id in (2, 3, 5, 6, 7) else 4
            if section_id == 8 and b >= 8:
                steps = 2
            for step in range(steps):
                note = notes[pattern[(step + b % 2) % 8]]
                if section_id == 4:
                    note += 12
                if section_id == 7 and b >= 6:
                    note += 12 if step % 3 == 0 else 0
                timing = step * BAR / steps + (.014 if step % 2 else 0)
                pan = math.sin(step * 1.8 + b * .5) * .56
                volume = .045 * energy_bar * (1.2 if step % 4 == 0 else .85)
                add(at + timing, pluck(note, 1.7, section_id in (4, 7, 9)), volume,
                    pan, .4, "evolving arpeggio")
            if b % 2 == 0 or section_id in (1, 9):
                for j, note in enumerate(notes[:3]):
                    add(at + .06 * j, piano(note - 12, .45, 3.1), .052 * energy_bar,
                        -.3 + j * .25, .48, "piano harmony")

            # Bass and percussion leave room for contemplative passages.
            bass_beats = [0, 1.5, 2, 3.5] if section_id in (5, 6, 7) else [0, 2]
            if section_id in (4, 8, 9):
                bass_beats = [0]
            for beat in bass_beats:
                add(at + beat * BEAT, bass(root, .72), .20 * energy_bar, 0, .09, "bass pulse")
            active_drums = section_id in (1, 2, 3, 5, 6, 7) or (section_id == 9 and b < 5)
            if active_drums:
                # Last bars thin out into transitions rather than looping through them.
                for beat in ([0, 2] if b < bars - 1 else [0]):
                    add(at + beat * BEAT, drum_kick, .17 * energy_bar, 0, .06, "kick")
                if section_id in (3, 5, 6, 7, 9):
                    for beat in [1, 3]:
                        add(at + beat * BEAT, drum_snare, .039 * energy_bar, .12, .28, "snare")
                for step in range(8):
                    add(at + step * .25, open_hat if step == 6 and b % 2 else drum_hat,
                        .021 * energy_bar * (1 if step % 2 else .68), -.25 if step % 2 else .2,
                        .10, "hi-hat")
            if b % 4 == 3 and section_id in (3, 5, 6, 7):
                for fill in range(3):
                    add(at + 1.5 + fill * .125, pluck(notes[(fill + 1) % 4] + 12, .5),
                        .028 * energy_bar, -.5 + fill * .5, .25, "phrase fill")

    # Theme statements develop the same contour across distinct emotional contexts.
    add_theme(16, gain=.16, instrument="strings")
    add_theme(32, transpose=-12, gain=.135)
    add_theme(44, transpose=-12, gain=.10, variant=1)
    add_theme(56, gain=.12, instrument="strings", variant=1)
    add_theme(68, transpose=-12, gain=.11)
    add_theme(82, gain=.13, variant=2)
    add_theme(94, transpose=-12, gain=.10, variant=1)
    add_theme(108, transpose=-12, gain=.12)
    add_theme(120, gain=.12, instrument="strings", variant=1)
    add_theme(138, gain=.135, instrument="strings")
    add_theme(150, gain=.145, instrument="strings", variant=2)
    add_theme(166, gain=.15, instrument="strings", variant=2)
    add_theme(178, gain=.16, instrument="strings", variant=1)
    add_theme(196, transpose=-12, gain=.12)
    add_theme(208, transpose=-12, gain=.09, variant=1)
    add_theme(220, gain=.16, instrument="strings", variant=2)
    add_theme(228, gain=.13, instrument="strings", variant=3)

    for sec in SECTIONS[1:]:
        point = sec["start"]
        whoosh(point - 1.8, 1.8, .16 if point in (16, 164, 220) else .09, True)
        impact(point, .24 if point in (16, 164, 220) else .13)
        whoosh(point, 1.1, .10)

    # Narrative sound design: data clicks, descending optimization, network links,
    # stochastic generation, diffusion texture, and a clear fact-check resolution.
    for at in np.arange(27, 50, 1.25):
        add(float(at), pluck(81 + int(RNG.choice([0, 3, 7, 10])), .3), .016,
            float(RNG.uniform(-.7, .7)), .20, "data point")
    for at in [54, 60, 66, 72, 77]:
        for j, note in enumerate([81, 77, 74, 69]):
            add(at + j * .11, pluck(note, .8, True), .033, .35 - j * .2, .6, "gradient descent")
    for at in [84, 90, 98, 107, 115, 123, 131]:
        for j, note in enumerate([74, 81, 86]):
            add(at + j * .18, pluck(note, 2.6, True), .037, -.6 + j * .6, .7, "semantic connection")
    for at in np.arange(140, 162, .75):
        add(float(at), pluck(int(RNG.choice([74, 77, 79, 81])), .2), .014,
            float(RNG.uniform(-.4, .4)), .15, "token tick")
    for at, length, strength in [(164, 5.5, .10), (171, 4.2, .07), (179, 3.5, .05)]:
        whoosh(at, length, strength)
    for at in [197, 204, 213]:
        for j, note in enumerate([62, 69, 74]):
            add(at + j * .12, pluck(note, 2.4, True), .04, -.2 + .2 * j, .55, "verification chime")


def render_space() -> None:
    print("Rendering stereo room and final fades", flush=True)
    # Multitap algorithmic reverberation. Delays are prime-ish, alternating stereo.
    for seconds, gain, swap in [(.071, .24, True), (.113, .21, False),
                               (.179, .17, True), (.263, .15, False),
                               (.397, .12, True), (.557, .10, False),
                               (.809, .075, True), (1.123, .053, False),
                               (1.607, .035, True), (2.113, .022, False)]:
        delay = round(seconds * SR)
        MIX[delay:] += SPACE[:-delay, ::-1] * gain if swap else SPACE[:-delay] * gain
    fade_in = round(1.0 * SR)
    fade_out = round(5.0 * SR)
    MIX[:fade_in] *= np.sin(np.linspace(0, np.pi / 2, fade_in, dtype=np.float32))[:, None] ** 2
    MIX[-fade_out:] *= np.sin(np.linspace(np.pi / 2, 0, fade_out, dtype=np.float32))[:, None] ** 2
    MIX[:] -= np.mean(MIX, axis=0, dtype=np.float64).astype(np.float32)
    peak = float(np.max(np.abs(MIX)))
    MIX[:] *= .80 / max(peak, .001)


def ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run([str(FFMPEG), "-hide_banner", "-nostdin", *args],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace")
    if proc.returncode:
        raise RuntimeError(proc.stderr[-6000:])
    return proc


def loudness(path: Path) -> dict:
    proc = ffmpeg(["-i", str(path), "-af", "loudnorm=I=-16:TP=-1.8:LRA=10:print_format=json",
                   "-f", "null", "-"])
    blocks = re.findall(r"\{\s*\"input_i\".*?\}", proc.stderr, re.S)
    if not blocks:
        raise RuntimeError("FFmpeg loudness statistics missing")
    return json.loads(blocks[-1])


def master() -> dict:
    OUT.mkdir(exist_ok=True)
    raw = OUT / "score-premaster.tmp.wav"
    with wave.open(str(raw), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        for start in range(0, N, SR * 10):
            block = np.clip(MIX[start:start + SR * 10], -.9999, .9999)
            out.writeframes((block * 32767).astype("<i2").tobytes())
    print("Measuring premaster / two-pass EBU R128 mastering", flush=True)
    before = loudness(raw)
    filt = ("loudnorm=I=-16:TP=-1.8:LRA=10:linear=true:"
            f"measured_I={before['input_i']}:measured_TP={before['input_tp']}:"
            f"measured_LRA={before['input_lra']}:measured_thresh={before['input_thresh']}:"
            f"offset={before['target_offset']}:print_format=json")
    wav = OUT / "score.wav"
    aac = OUT / "score.m4a"
    ffmpeg(["-y", "-i", str(raw), "-af", filt, "-ar", str(SR), "-c:a", "pcm_s24le", str(wav)])
    ffmpeg(["-y", "-i", str(wav), "-c:a", "aac", "-b:a", "256k", "-ar", str(SR),
            "-movflags", "+faststart", "-metadata", "title=The Shape of Intelligence — Original Score",
            "-metadata", "artist=Original procedural composition", str(aac)])
    print("Checking decoded AAC and final WAV", flush=True)
    wav_stats, aac_stats = loudness(wav), loudness(aac)
    # Codec overshoot is possible. Apply only a measured corrective trim if needed.
    if float(aac_stats["input_tp"]) > -1.5:
        correction = -1.7 - float(aac_stats["input_tp"])
        adjusted = OUT / "score-corrected.tmp.wav"
        ffmpeg(["-y", "-i", str(wav), "-af", f"volume={correction}dB", "-c:a", "pcm_s24le", str(adjusted)])
        os.replace(adjusted, wav)
        ffmpeg(["-y", "-i", str(wav), "-c:a", "aac", "-b:a", "256k", "-ar", str(SR),
                "-movflags", "+faststart", str(aac)])
        wav_stats, aac_stats = loudness(wav), loudness(aac)
    check = ffmpeg(["-i", str(aac), "-af", "silencedetect=noise=-50dB:d=1", "-f", "null", "-"])
    silent_events = re.findall(r"silence_(?:start|end): [^\n]+", check.stderr)
    decoded = ffmpeg(["-i", str(aac), "-af", "astats=metadata=0:reset=0", "-f", "null", "-"])
    stats_lines = [line.strip() for line in decoded.stderr.splitlines()
                   if any(word in line for word in ["Peak level dB", "RMS level dB", "Number of samples", "DC offset", "NaNs", "Infs"])]
    report = {
        "title": "The Shape of Intelligence — original score",
        "composition": "Original deterministic additive / FM / noise synthesis; no samples or external audio",
        "generator": "scripts/score.py", "seed": 20933,
        "duration_seconds": DURATION, "sample_rate_hz": SR, "channels": 2,
        "tempo_bpm": BPM, "meter": "4/4", "bars": 120,
        "key": "D minor, with F-major color and D-major closing cadence",
        "instruments": ["inharmonic hammered piano", "additive pipe organ", "detuned bowed-string pad",
                        "FM plucks", "glass partials", "sub bass", "synthesized percussion", "noise sweeps"],
        "sections": SECTIONS, "event_counts": COUNTS,
        "mastering": {"method": "FFmpeg two-pass EBU R128 loudnorm", "target_lufs": -16,
                      "target_true_peak_dbtp": -1.8, "maximum_allowed_true_peak_dbtp": -1.5,
                      "target_lra_lu": 10, "premaster": before},
        "wav": {"path": "out/score.wav", "codec": "PCM signed 24-bit", "bytes": wav.stat().st_size,
                "measured": wav_stats},
        "aac": {"path": "out/score.m4a", "codec": "AAC-LC", "bitrate_target": 256_000,
                "bytes": aac.stat().st_size, "measured_after_decode": aac_stats},
        "silence_events": silent_events, "decoded_signal_checks": stats_lines,
        "checks": {
            "duration_exact_from_synthesis": len(MIX) == SR * DURATION,
            "aac_loudness_within_half_lu": abs(float(aac_stats["input_i"]) + 16) <= .5,
            "aac_true_peak_pass": float(aac_stats["input_tp"]) <= -1.5,
            "wav_true_peak_pass": float(wav_stats["input_tp"]) <= -1.5,
            "finite_source_signal": bool(np.isfinite(MIX).all()),
        },
    }
    (OUT / "audio-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not all(report["checks"].values()):
        raise RuntimeError(f"Audio validation failed: {report['checks']}")
    raw.unlink()
    return report


if __name__ == "__main__":
    started = time.perf_counter()
    compose()
    render_space()
    result = master()
    print(json.dumps({"elapsed_seconds": round(time.perf_counter() - started, 1),
                      "checks": result["checks"],
                      "aac_lufs": result["aac"]["measured_after_decode"]["input_i"],
                      "aac_true_peak_dbtp": result["aac"]["measured_after_decode"]["input_tp"],
                      "events": sum(COUNTS.values())}, ensure_ascii=False, indent=2), flush=True)
