#!/usr/bin/env python3
"""Decode the entire deliverable and audit its real frames, timestamps and sound.

Uses FFmpeg directly; FFprobe and Python packages are not required. No success
report is written from a render manifest or from a small selection of frames.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
DEFAULT_FILE = OUT / "智能的形状_AI科普短片.mp4"
EXPECTED_WIDTH, EXPECTED_HEIGHT = 1920, 1080
EXPECTED_FPS, EXPECTED_DURATION = 30, 240
EXPECTED_FRAMES = EXPECTED_FPS * EXPECTED_DURATION
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
FRAME_RE = re.compile(
    rf"\[Parsed_showinfo[^\]]*\].*?n:\s*(\d+)\s+pts:\s*(-?\d+)"
    rf"\s+pts_time:\s*({NUMBER}).*?\bs:(\d+)x(\d+)\b"
)
TIMEBASE_RE = re.compile(r"config in time_base:\s*(\d+)/(\d+), frame_rate:\s*(\d+)/(\d+)")
BLACK_RE = re.compile(rf"black_start:({NUMBER})\s+black_end:({NUMBER})\s+black_duration:({NUMBER})")


def ffmpeg_path() -> str:
    override = os.environ.get("FFMPEG_PATH")
    candidates = [override] if override else []
    candidates += [str(ROOT / ".tools" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg"))]
    binaries = ROOT / ".deps" / "imageio_ffmpeg" / "binaries"
    if binaries.exists():
        candidates += [str(p) for p in binaries.glob("ffmpeg*") if p.is_file() and p.suffix != ".md"]
    candidates.append(shutil.which("ffmpeg"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise FileNotFoundError("FFmpeg not found. Set FFMPEG_PATH or put FFmpeg in .tools/.")


def digest(filename: Path) -> str:
    value = hashlib.sha256()
    with filename.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def finite_db(value: str) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except ValueError:
        return None


def verify(filename: Path, report_path: Path, edge_black: float) -> dict:
    started = time.monotonic()
    ffmpeg = ffmpeg_path()
    log_path = report_path.with_suffix(".ffmpeg.log")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "passed": False,
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "file": str(filename),
        "bytes": filename.stat().st_size,
        "sha256": digest(filename),
        "method": "Full video and audio decode with FFmpeg; every decoded video PTS checked.",
        "expected": {"width": EXPECTED_WIDTH, "height": EXPECTED_HEIGHT,
                     "fps": EXPECTED_FPS, "seconds": EXPECTED_DURATION,
                     "frames": EXPECTED_FRAMES, "audioCodec": "aac"},
        "ffmpeg": ffmpeg,
        "decodeLog": str(log_path),
        "checks": {},
    }
    command = [
        ffmpeg, "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-xerror",
        "-i", str(filename), "-map", "0:v:0", "-map", "0:a:0",
        "-vf", "showinfo,blackdetect=d=0.5:pix_th=0.04:pic_th=0.98",
        "-af", "astats=metadata=0:reset=0", "-fps_mode", "passthrough",
        "-f", "null", "-",
    ]
    report["command"] = command
    metadata, audio_stats, black_intervals = {}, {}, []
    seen_dimensions, pts_errors, index_errors = set(), [], []
    frame_count = 0
    first_pts = last_pts = previous_pts = None
    timebase = None
    decoded_rate = None
    max_interval_error = Fraction(0)
    max_timeline_error = Fraction(0)
    input_section = True
    overall_audio = False
    tail = []
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    with log_path.open("w", encoding="utf-8", newline="\n") as logfile:
        proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace",
                                creationflags=creationflags)
        assert proc.stderr is not None
        for line in proc.stderr:
            logfile.write(line)
            tail.append(line.rstrip())
            if len(tail) > 24:
                tail.pop(0)
            if line.lstrip().startswith("Stream mapping:"):
                input_section = False
            if input_section:
                duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", line)
                if duration:
                    metadata["durationSeconds"] = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
                if "Stream #" in line and "Video:" in line and "videoCodec" not in metadata:
                    metadata["videoStream"] = line.strip()
                    codec = re.search(r"Video:\s*([^\s,(]+)", line)
                    size = re.search(r"\b(\d{2,5})x(\d{2,5})\b", line)
                    rate = re.search(r"(\d+(?:\.\d+)?)\s+fps\b", line)
                    if codec:
                        metadata["videoCodec"] = codec[1]
                    if size:
                        metadata["width"], metadata["height"] = int(size[1]), int(size[2])
                    if rate:
                        metadata["fps"] = float(rate[1])
                if "Stream #" in line and "Audio:" in line and "audioCodec" not in metadata:
                    metadata["audioStream"] = line.strip()
                    codec = re.search(r"Audio:\s*([^\s,(]+)", line)
                    sample_rate = re.search(r"(\d+)\s+Hz", line)
                    if codec:
                        metadata["audioCodec"] = codec[1]
                    if sample_rate:
                        metadata["audioSampleRate"] = int(sample_rate[1])
                    metadata["audioStereo"] = bool(re.search(r"\bstereo\b", line))
            config = TIMEBASE_RE.search(line)
            if config:
                timebase = Fraction(int(config[1]), int(config[2]))
                decoded_rate = Fraction(int(config[3]), int(config[4]))
            frame = FRAME_RE.search(line)
            if frame:
                index, pts = int(frame[1]), int(frame[2])
                seen_dimensions.add((int(frame[4]), int(frame[5])))
                if index != frame_count and len(index_errors) < 20:
                    index_errors.append({"decodedOrder": frame_count, "reportedIndex": index})
                if first_pts is None:
                    first_pts = pts
                if timebase is not None:
                    timeline_error = abs(pts * timebase - Fraction(frame_count, EXPECTED_FPS))
                    max_timeline_error = max(max_timeline_error, timeline_error)
                    if previous_pts is not None:
                        interval = (pts - previous_pts) * timebase
                        error = abs(interval - Fraction(1, EXPECTED_FPS))
                        max_interval_error = max(max_interval_error, error)
                        if error > timebase / 2 and len(pts_errors) < 20:
                            pts_errors.append({"frame": frame_count, "previousPts": previous_pts,
                                               "pts": pts, "intervalSeconds": float(interval)})
                previous_pts = last_pts = pts
                frame_count += 1
                if frame_count % 1800 == 0:
                    print(f"Decoded {frame_count}/{EXPECTED_FRAMES} frames", flush=True)
            black = BLACK_RE.search(line)
            if black:
                black_intervals.append({"start": float(black[1]), "end": float(black[2]),
                                        "duration": float(black[3])})
            if "Parsed_astats" in line:
                if re.search(r"\bOverall\s*$", line):
                    overall_audio = True
                if overall_audio:
                    measurement = re.search(r"\]\s+(Peak level dB|RMS level dB|Number of samples):\s*(\S+)", line)
                    if measurement:
                        key = {"Peak level dB": "peakDbfs", "RMS level dB": "rmsDbfs",
                               "Number of samples": "sampleFrames"}[measurement[1]]
                        audio_stats[key] = finite_db(measurement[2])
        proc.stderr.close()
        return_code = proc.wait()
    sample_rate = metadata.get("audioSampleRate")
    sample_frames = audio_stats.get("sampleFrames")
    if sample_rate and sample_frames is not None:
        audio_stats["decodedSeconds"] = sample_frames / sample_rate
    bad_black = [interval for interval in black_intervals
                 if interval["end"] > edge_black and interval["start"] < EXPECTED_DURATION - edge_black]
    timeline_tolerance = timebase / 2 if timebase else Fraction(0)
    checks = report["checks"]
    checks["fullDecodeSucceeded"] = return_code == 0
    checks["containerDuration"] = abs(metadata.get("durationSeconds", -1) - EXPECTED_DURATION) <= 0.1
    checks["dimensions"] = (metadata.get("width"), metadata.get("height")) == (EXPECTED_WIDTH, EXPECTED_HEIGHT) and seen_dimensions == {(EXPECTED_WIDTH, EXPECTED_HEIGHT)}
    checks["frameRate"] = metadata.get("fps") == EXPECTED_FPS and decoded_rate == EXPECTED_FPS
    checks["frameCount"] = frame_count == EXPECTED_FRAMES
    checks["frameIndicesContinuous"] = frame_count > 0 and not index_errors
    checks["timestampsContinuous"] = timebase is not None and frame_count == EXPECTED_FRAMES and not pts_errors and max_timeline_error <= timeline_tolerance
    checks["aacAudio"] = metadata.get("audioCodec") == "aac"
    checks["audioFullyDecoded"] = abs(audio_stats.get("decodedSeconds", -1) - EXPECTED_DURATION) <= 0.1
    checks["audioAudible"] = audio_stats.get("peakDbfs") is not None and audio_stats["peakDbfs"] > -60 and audio_stats.get("rmsDbfs") is not None
    checks["noUnexpectedLongBlack"] = not bad_black
    report.update({
        "metadata": metadata,
        "video": {"decodedFrames": frame_count, "decodedSizes": sorted([list(size) for size in seen_dimensions]),
                  "timeBase": str(timebase) if timebase is not None else None,
                  "decodedFrameRate": str(decoded_rate) if decoded_rate is not None else None,
                  "firstPts": first_pts, "lastPts": last_pts,
                  "firstSeconds": float(first_pts * timebase) if first_pts is not None and timebase else None,
                  "lastSeconds": float(last_pts * timebase) if last_pts is not None and timebase else None,
                  "maxIntervalErrorSeconds": float(max_interval_error),
                  "maxTimelineErrorSeconds": float(max_timeline_error),
                  "indexErrorExamples": index_errors, "timestampErrorExamples": pts_errors},
        "audio": audio_stats,
        "blackDetection": {"minimumSeconds": 0.5, "pixelThreshold": 0.04,
                           "pictureBlackRatio": 0.98, "allowedOpeningAndClosingSeconds": edge_black,
                           "intervals": black_intervals, "unexpectedIntervals": bad_black},
        "decodeExitCode": return_code,
        "elapsedSeconds": round(time.monotonic() - started, 3),
    })
    report["passed"] = all(checks.values())
    if return_code:
        report["decodeErrorTail"] = tail
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--report", type=Path, default=OUT / "verification.json")
    parser.add_argument("--edge-black-seconds", type=float, default=2.0,
                        help="Permit near-black intervals entirely inside the first/last N seconds (default: 2).")
    args = parser.parse_args()
    if not 0 <= args.edge_black_seconds <= 5:
        parser.error("--edge-black-seconds must be between 0 and 5")
    filename, report_path = args.file.resolve(), args.report.resolve()
    if not filename.is_file():
        print(f"Missing film: {filename}", file=sys.stderr)
        return 2
    try:
        report = verify(filename, report_path, args.edge_black_seconds)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Verification could not finish: {error}", file=sys.stderr)
        return 2
    for name, passed in report["checks"].items():
        print(f"{'PASS' if passed else 'FAIL'}  {name}")
    print(f"Report: {report_path}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
