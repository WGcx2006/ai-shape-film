"""Optional Chinese neural narration, aligned to the film's existing captions.

Install requirements-voice.txt, then run `python scripts/narrate.py`.
Requires an internet connection only when a speech cache entry is missing.
`--sample` renders the opening two cues for review; `--offline` requires cache.
The original music-only film is never modified.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
CACHE = OUT / "narration"
LOCAL_DEPS = ROOT / ".deps" / "tts"
if LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))
FFMPEG = os.environ.get("FFMPEG_PATH") or next(
    (str(ROOT / ".tools" / name) for name in ("ffmpeg.exe", "ffmpeg")
     if (ROOT / ".tools" / name).is_file()), shutil.which("ffmpeg") or "ffmpeg")
SR = 48000
DURATION = 240
VOICE = "zh-CN-YunxiNeural"
RATE = "-8%"
PITCH = "-2Hz"
DUCK_DB = -10.0


def run(args: list[str], *, binary=False):
    p = subprocess.run([FFMPEG, "-hide_banner", "-nostdin", "-y", *args],
                       capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode("utf-8", errors="replace")[-6000:])
    return p.stdout if binary else p.stderr.decode("utf-8", errors="replace")


def read_audio(path: Path, channels=1) -> np.ndarray:
    data = run(["-i", str(path), "-vn", "-ar", str(SR), "-ac", str(channels),
                "-f", "f32le", "pipe:1"], binary=True)
    return np.frombuffer(data, dtype="<f4").reshape(-1, channels).copy()


def write_wave(path: Path, data: np.ndarray):
    pcm = np.round(np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1 if data.ndim == 1 else data.shape[1])
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def loudness(path: Path, label: str) -> dict:
    log = run(["-i", str(path), "-vn", "-af",
               "loudnorm=I=-16:TP=-1.8:LRA=10:print_format=json", "-f", "null", "-"])
    (CACHE / f"{label}-loudness.log").write_text(log, encoding="utf-8")
    matches = re.findall(r'\{\s*"input_i".*?\}', log, re.S)
    if not matches:
        raise RuntimeError("Missing FFmpeg loudness measurement")
    return json.loads(matches[-1])


async def synthesize(captions: list[dict], offline: bool) -> list[Path]:
    import edge_tts
    version = importlib.metadata.version("edge-tts")
    paths = []
    for i, cue in enumerate(captions):
        settings = {"text": cue["zh"], "voice": VOICE, "rate": RATE,
                    "pitch": PITCH, "edge_tts_version": version}
        key = hashlib.sha256(json.dumps(settings, ensure_ascii=False,
                           sort_keys=True).encode()).hexdigest()[:12]
        path = CACHE / f"{i + 1:02d}-{key}.mp3"
        meta = path.with_suffix(".json")
        valid = False
        if path.is_file() and meta.is_file():
            saved = json.loads(meta.read_text(encoding="utf-8"))
            valid = saved.get("settings") == settings and saved.get("sha256") == sha(path)
        if not valid:
            if offline:
                raise RuntimeError(f"Missing speech cache for cue {i + 1}")
            # Three sequential attempts avoid stranding an otherwise complete run
            # on a transient speech-service connection failure.
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(cue["zh"], VOICE, rate=RATE,
                                               pitch=PITCH).save(str(path))
                    if path.stat().st_size < 1000:
                        raise RuntimeError("Speech service returned an empty clip")
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1 + attempt)
            meta.write_text(json.dumps({"settings": settings, "sha256": sha(path),
                            "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                            ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        paths.append(path)
        print(f"Speech cue {i+1}/{len(captions)}: {'cache' if valid else 'generated'}", flush=True)
    return paths


def arrange(captions, clips, duration):
    voice = np.zeros((int(duration * SR), 1), dtype=np.float32)
    duck = np.zeros(int(duration * SR), dtype=np.float32)
    report = []
    for i, (cue, path) in enumerate(zip(captions, clips)):
        raw = read_audio(path)
        active = np.flatnonzero(np.abs(raw[:, 0]) > 10 ** (-55 / 20))
        if len(active) == 0:
            raise RuntimeError(f"Cue {i + 1} has no audible speech")
        left = max(0, int(active[0]) - int(.025 * SR))
        right = min(len(raw), int(active[-1]) + int(.075 * SR))
        clip = raw[left:right]
        start = cue["start"] + .15
        available = cue["end"] - .20 - start
        original_duration = len(clip) / SR
        tempo = max(1.0, original_duration / available)
        if tempo > 1.12:
            raise RuntimeError(f"Cue {i + 1} requires excessive speed-up: {tempo:.3f}")
        if tempo > 1.0:
            trimmed = CACHE / f"{i + 1:02d}-trimmed.wav"
            fitted = CACHE / f"{i + 1:02d}-fitted.wav"
            write_wave(trimmed, clip)
            run(["-i", str(trimmed), "-af", f"atempo={tempo:.8f}", str(fitted)])
            clip = read_audio(fitted)
        # Match speech level without clipping peaks or shortening spoken words.
        peak = float(np.max(np.abs(clip)))
        rms = float(np.sqrt(np.mean(clip.astype(np.float64) ** 2)))
        gain_db = min(-21.0 - 20 * math.log10(max(rms, 1e-9)),
                      -3.0 - 20 * math.log10(max(peak, 1e-9)))
        clip *= 10 ** (gain_db / 20)
        pos = round(start * SR)
        end = pos + len(clip)
        if end > round((cue["end"] - .19) * SR):
            raise RuntimeError(f"Cue {i + 1} crosses subtitle window")
        if end > len(voice):
            raise RuntimeError("Speech exceeds film duration")
        voice[pos:end] += clip
        # A short anticipatory fade and slow release prevent pumping. Music
        # remains at the lower level across natural pauses inside each phrase.
        attack = int(.12 * SR)
        release = int(.55 * SR)
        a = max(0, pos - attack)
        b = min(len(voice), end + release)
        duck[a:pos] = np.maximum(duck[a:pos], np.linspace(0, 1, pos-a, endpoint=False))
        duck[pos:end] = 1
        duck[end:b] = np.maximum(duck[end:b], np.linspace(1, 0, b-end, endpoint=False))
        report.append({"cue": i + 1, "text": cue["zh"],
                       "subtitle_start": cue["start"], "subtitle_end": cue["end"],
                       "speech_start": pos / SR, "speech_end": end / SR,
                       "speech_duration": len(clip) / SR,
                       "source_duration": len(raw) / SR,
                       "trimmed_duration_before_tempo": original_duration,
                       "tempo": tempo, "gain_db": gain_db,
                       "peak_dbfs": 20 * math.log10(float(np.max(np.abs(clip)))),
                       "rms_dbfs": 20 * math.log10(float(np.sqrt(np.mean(clip**2)))),
                       "cache": str(path.relative_to(ROOT)).replace("\\", "/"),
                       "cache_sha256": sha(path), "fits_window": True})
    return voice, duck, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true", help="Render the first two cues (16 seconds)")
    parser.add_argument("--offline", action="store_true", help="Use existing cache only")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    captions_path = ROOT / "src" / "captions.json"
    captions = json.loads(captions_path.read_text(encoding="utf-8"))
    if args.sample:
        captions = captions[:2]
    duration = 16 if args.sample else DURATION
    clips = asyncio.run(synthesize(captions, args.offline))
    voice, duck, cues = arrange(captions, clips, duration)
    voice_path = CACHE / "sample-narration.wav" if args.sample else OUT / "narration.wav"
    write_wave(voice_path, voice)
    music = read_audio(OUT / "score.wav", channels=2)[:len(voice)]
    if len(music) != len(voice):
        raise RuntimeError("Music does not cover the film duration")
    mixed = music * (10 ** (DUCK_DB * duck / 20))[:, None] + voice
    if np.max(np.abs(mixed)) > .995:
        # Preserve sample headroom; final loudness is set below, in two passes.
        mixed *= .995 / np.max(np.abs(mixed))
    raw = CACHE / ("sample-mix.wav" if args.sample else "mix-premaster.wav")
    write_wave(raw, mixed)
    before = loudness(raw, "sample-premaster" if args.sample else "premaster")
    filt = ("loudnorm=I=-16:TP=-1.8:LRA=10:linear=true:"
            f"measured_I={before['input_i']}:measured_TP={before['input_tp']}:"
            f"measured_LRA={before['input_lra']}:measured_thresh={before['input_thresh']}:"
            f"offset={before['target_offset']}:print_format=json")
    mastered = CACHE / ("sample-master.wav" if args.sample else "mix-master.wav")
    master_log = run(["-i", str(raw), "-af", filt, "-ar", str(SR), "-c:a", "pcm_s24le", str(mastered)])
    (CACHE / ("sample-mastering.log" if args.sample else "mastering.log")).write_text(master_log, encoding="utf-8")
    audio = CACHE / "sample.m4a" if args.sample else OUT / "narrated-score.m4a"
    run(["-i", str(mastered), "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(audio)])
    measured = loudness(audio, "sample-aac" if args.sample else "aac")
    if float(measured["input_tp"]) > -1.5:
        # Lossy AAC can overshoot PCM true-peak; compensate in the WAV source
        # and measure the encoded result again rather than trusting a target.
        correction = -1.6 - float(measured["input_tp"])
        run(["-i", str(mastered), "-af", f"volume={correction}dB", "-c:a", "aac",
             "-b:a", "256k", "-movflags", "+faststart", str(audio)])
        measured = loudness(audio, "sample-aac-final" if args.sample else "aac-final")
    if abs(float(measured["input_i"]) + 16) > .5 or float(measured["input_tp"]) > -1.5:
        raise RuntimeError(f"Master outside loudness bounds: {measured}")
    report = {"engine": "Microsoft Edge online neural TTS via edge-tts",
              "edge_tts_version": importlib.metadata.version("edge-tts"),
              "voice": VOICE, "rate": RATE, "pitch": PITCH,
              "text_source": "src/captions.json", "text_source_sha256": sha(captions_path),
              "speech_text_identical_to_zh_captions": True,
              "sample_rate": SR, "duration_seconds": duration,
              "music_duck_db": DUCK_DB, "duck_attack_seconds": .12, "duck_release_seconds": .55,
              "target_integrated_lufs": -16, "max_true_peak_dbtp": -1.5,
              "measured_aac": measured, "cues": cues,
              "cue_count": len(cues), "all_cues_fit": all(c["fits_window"] for c in cues),
              "narration_non_silent_samples": int(np.count_nonzero(np.abs(voice) > 1e-4)),
              "original_video_sha256": sha(OUT / "智能的形状_AI科普短片.mp4")}
    if not args.sample:
        original = OUT / "智能的形状_AI科普短片.mp4"
        video = OUT / "智能的形状_中文配音版.mp4"
        run(["-i", str(original), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0",
             "-c:v", "copy", "-c:a", "copy", "-t", str(DURATION),
             "-metadata", "title=智能的形状 | 中文配音版",
             "-metadata", "comment=Chinese synthetic narration: zh-CN-YunxiNeural (Microsoft Edge TTS)",
             "-movflags", "+faststart", str(video)])
        decode = run(["-v", "error", "-xerror", "-i", str(video), "-map", "0:v:0",
                      "-map", "0:a:0", "-f", "null", "-"])
        (CACHE / "full-decode.log").write_text(decode, encoding="utf-8")
        original_hash = run(["-i", str(original), "-map", "0:v:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"], binary=True)
        dubbed_hash = run(["-i", str(video), "-map", "0:v:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"], binary=True)
        if original_hash != dubbed_hash:
            raise RuntimeError("Video stream changed unexpectedly")
        report.update({"output": str(video.relative_to(ROOT)).replace("\\", "/"),
                       "output_sha256": sha(video), "video_stream_unchanged": True,
                       "video_stream_sha256": original_hash.decode().strip(),
                       "full_av_decode_passed": True})
    report_path = CACHE / "sample-report.json" if args.sample else OUT / "narration-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"audio": str(audio), "report": str(report_path), "measured_lufs": measured["input_i"],
                      "true_peak_dbtp": measured["input_tp"], "cue_count": len(cues)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
