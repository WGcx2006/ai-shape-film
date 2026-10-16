#!/usr/bin/env python3
"""Build bilingual subtitles, a self-contained offline player, and source ZIP.

Only Python's standard library is used. The source files remain untouched.
Run after score.py; MP4 rendering may run independently at the same time.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
SRT_NAME = "智能的形状_双语字幕.srt"
PLAYER_NAME = "智能的形状_离线播放器.html"
ZIP_NAME = "智能的形状_源码.zip"


def sha256(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def replace_once(text: str, original: str, replacement: str, label: str) -> str:
    count = text.count(original)
    if count != 1:
        raise ValueError(f"{label}: expected exactly one source match; found {count}")
    return text.replace(original, replacement, 1)


def data_uri(filename: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(filename.read_bytes()).decode("ascii")


def timestamp(milliseconds: int) -> str:
    seconds, ms = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{ms:03}"


def read_captions() -> list[dict]:
    captions = json.loads((ROOT / "src" / "captions.json").read_text(encoding="utf-8"))
    if not isinstance(captions, list) or not captions:
        raise ValueError("captions.json must contain a nonempty list")
    previous_end = 0
    for index, caption in enumerate(captions, 1):
        start, end = caption["start"], caption["end"]
        if not (isinstance(start, (int, float)) and isinstance(end, (int, float))
                and math.isfinite(start) and math.isfinite(end)
                and 0 <= start < end <= 240 and start >= previous_end):
            raise ValueError(f"Caption {index} has invalid or overlapping timing")
        for language in ("zh", "en"):
            value = caption[language]
            if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
                raise ValueError(f"Caption {index}: expected one nonempty {language} line")
        previous_end = end
    return captions


def make_srt(captions: list[dict]) -> dict:
    filename = OUT / SRT_NAME
    blocks = [
        f"{index}\n{timestamp(round(caption['start'] * 1000))} --> "
        f"{timestamp(round(caption['end'] * 1000))}\n{caption['zh']}\n{caption['en']}"
        for index, caption in enumerate(captions, 1)
    ]
    filename.write_text("\n\n".join(blocks) + "\n", encoding="utf-8-sig", newline="\n")
    written_blocks = filename.read_text(encoding="utf-8-sig").strip().split("\n\n")
    if written_blocks != blocks:
        raise ValueError("SRT read-back does not match the caption source")
    timing_pattern = re.compile(r"^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$")
    if any(not timing_pattern.fullmatch(block.splitlines()[1]) for block in written_blocks):
        raise ValueError("SRT timing syntax is invalid")
    return {"file": str(filename), "captions": len(captions), "encoding": "UTF-8 with BOM",
            "firstStartSeconds": captions[0]["start"], "lastEndSeconds": captions[-1]["end"],
            "orderedAndNonoverlapping": True, "sourceRoundTripPassed": True,
            "sha256": sha256(filename)}


class ResourceAudit(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.external_resources = []
        self.resource_count = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for key, value in attrs:
            if key in ("src", "poster") or (tag == "link" and key == "href"):
                self.resource_count += 1
                if value and not value.startswith("data:"):
                    self.external_resources.append({"tag": tag, "attribute": key, "value": value})


def make_player(captions: list[dict]) -> dict:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for name in ("SansSC.ttf", "Mono.ttf"):
        html = replace_once(html, f"url('./fonts/{name}')",
                            f"url('{data_uri(ROOT / 'fonts' / name, 'font/ttf')}')",
                            f"Embedded font {name}")
    html = replace_once(html, 'src="./out/score.m4a"',
                        f'src="{data_uri(OUT / "score.m4a", "audio/mp4")}"', "Embedded score")
    data = (ROOT / "src" / "data.js").read_text(encoding="utf-8")
    for declaration in ("function rng(", "function trainDemo(", "function surface(",
                        "function gradient(", "const descent="):
        data = replace_once(data, "export " + declaration, declaration, f"data.js {declaration}")
    atmosphere = (ROOT / "src" / "atmosphere.js").read_text(encoding="utf-8")
    atmosphere = replace_once(atmosphere, "export function atmosphere(", "function atmosphere(",
                              "atmosphere.js export")
    film = (ROOT / "src" / "film.js").read_text(encoding="utf-8")
    for statement in ("import {atmosphere} from './atmosphere.js';",
                      "import {rng,trainDemo,surface,gradient,descent} from './data.js';"):
        film = replace_once(film, statement, "", f"film.js {statement}")
    caption_json = json.dumps(captions, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    film = replace_once(film, "captions=await(await fetch('./src/captions.json')).json();",
                        "captions=" + caption_json + ";", "Embedded captions")
    script = "(() => {\n'use strict';\n" + data + "\n" + atmosphere + "\n" + film + "\n})();\n"
    if re.search(r"</script\b", script, flags=re.IGNORECASE):
        raise ValueError("Inline JavaScript contains an HTML closing-script delimiter")
    if re.search(r"(?m)^\s*(?:import\s|export\s)", script) or re.search(r"\bfetch\s*\(", script):
        raise ValueError("Unresolved module statement or runtime fetch in offline script")
    html = replace_once(html, '<script type="module" src="./src/film.js"></script>',
                        "<script>\n" + script + "</script>", "Embedded renderer")
    licenses = []
    for name, license_path in (("NotoSansSC-OFL.txt", ROOT / "fonts" / "NotoSansSC-OFL.txt"),
                               ("IBMPlexMono-OFL.txt", ROOT / "fonts" / "IBMPlexMono-OFL.txt"),
                               ("project-MIT", ROOT / "LICENSE"),
                               ("third-party-notices", ROOT / "THIRD_PARTY_NOTICES.md")):
        text = license_path.read_text(encoding="utf-8")
        if re.search(r"</script\b", text, flags=re.IGNORECASE):
            raise ValueError(f"Unexpected script delimiter in {name}")
        licenses.append(f'<script type="text/plain" id="license-{name}">\n{text}\n</script>')
    html = replace_once(html, "</body>", "\n" + "\n".join(licenses) + "\n</body>", "Font licenses")
    audit = ResourceAudit()
    audit.feed(html)
    css_urls = re.findall(r"url\(['\"]?([^'\")]+)", html)
    if audit.external_resources or any(not url.startswith("data:") for url in css_urls):
        raise ValueError(f"Offline HTML still references external resources: {audit.external_resources}")
    filename = OUT / PLAYER_NAME
    filename.write_text(html, encoding="utf-8", newline="\n")
    return {"file": str(filename), "bytes": filename.stat().st_size,
            "sha256": sha256(filename), "embeddedFonts": ["Noto Sans SC", "IBM Plex Mono"],
            "embeddedAudio": "AAC-LC in MP4", "embeddedCaptionCount": len(captions),
            "externalResources": audit.external_resources, "fontLicensesEmbedded": True,
            "moduleImportsRemoved": 2, "browserPlaybackTest": "Required separately"}


def make_source_zip() -> dict:
    files = []
    for directory in ("src", "scripts", "docs", "fonts"):
        files += [path for path in (ROOT / directory).rglob("*")
                  if path.is_file() and "__pycache__" not in path.parts and path.suffix not in (".pyc", ".pyo")]
    for name in ("index.html", "package.json", "package-lock.json", "README.md", "requirements.txt", "requirements-voice.txt", "LICENSE", "THIRD_PARTY_NOTICES.md", ".gitignore"):
        path = ROOT / name
        if path.exists():
            files.append(path)
    files.append(OUT / "score.m4a")
    files.sort(key=lambda path: path.relative_to(ROOT).as_posix())
    filename = OUT / ZIP_NAME
    temporary = OUT / (ZIP_NAME + ".partial")
    prefix = "ai-shape-film/"
    expected_names = [prefix + path.relative_to(ROOT).as_posix() for path in files]
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, name in zip(files, expected_names):
            archive.write(path, name)
    with zipfile.ZipFile(temporary, "r") as archive:
        bad_member = archive.testzip()
        if bad_member:
            raise ValueError(f"ZIP CRC failed: {bad_member}")
        if archive.namelist() != expected_names:
            raise ValueError("ZIP membership does not match the source allowlist")
        forbidden = [name for name in archive.namelist()
                     if any(part in name.split("/") for part in (".tools", ".deps", "node_modules", "parts"))
                     or name.endswith((".wav", ".mp4", ".zip", ".partial"))]
        if forbidden:
            raise ValueError(f"Unexpected generated files in source ZIP: {forbidden}")
    temporary.replace(filename)
    return {"file": str(filename), "bytes": filename.stat().st_size,
            "sha256": sha256(filename), "fileCount": len(files), "crcPassed": True,
            "members": expected_names, "containsScore": prefix + "out/score.m4a" in expected_names}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        if not (OUT / "score.m4a").is_file():
            raise FileNotFoundError("out/score.m4a is missing. Run python scripts/score.py first.")
        captions = read_captions()
        srt = make_srt(captions)
        print(f"Subtitles: {srt['file']} ({srt['captions']} cues)", flush=True)
        player = make_player(captions)
        print(f"Offline player: {player['file']} ({player['bytes']:,} bytes)", flush=True)
        source = make_source_zip()
        print(f"Source ZIP: {source['file']} ({source['fileCount']} files; CRC passed)", flush=True)
        report = {"packagedAt": datetime.now(timezone.utc).isoformat(),
                  "subtitles": srt, "offlinePlayer": player, "sourceArchive": source,
                  "sourceSha256": {name: sha256(ROOT / name) for name in
                                   ("index.html", "src/film.js", "src/data.js", "src/atmosphere.js",
                                    "src/captions.json", "out/score.m4a")}}
        report_path = OUT / "package-report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Package report: {report_path}")
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
