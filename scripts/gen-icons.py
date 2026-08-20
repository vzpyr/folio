#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_TAURI = ROOT / "src-tauri"

MASTER = ROOT / "media" / "f400-transparent-letterbounds-ffffff.png"
WORDMARK_LIGHT = ROOT / "media" / "folio400-transparent-letterbounds-0f0f0f.png"
WORDMARK_DARK = ROOT / "media" / "folio400-transparent-letterbounds-ffffff.png"

FAVICON = ROOT / "frontend" / "public" / "favicon.png"
ANDROID_RES = SRC_TAURI / "gen" / "android" / "app" / "src" / "main" / "res"

CANVAS = 1024
FAVICON_SIZE = 64

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def hex_to_rgba(hex_str):
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        sys.exit(f"color must be 6 hex digits, got {hex_str}")
    return (int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16), 255)


def canonicalize_icns(path):
    data = path.read_bytes()
    if data[:4] != b"icns":
        return
    total = int.from_bytes(data[4:8], "big")
    chunks = []
    pos = 8
    while pos + 8 <= min(total, len(data)):
        ctype = data[pos : pos + 4]
        clen = int.from_bytes(data[pos + 4 : pos + 8], "big")
        if clen < 8 or pos + clen > len(data):
            return
        chunks.append((ctype, clen, data[pos + 8 : pos + clen]))
        pos += clen
    if pos != total or not chunks:
        return
    chunks.sort(key=lambda c: c[0])
    body = b"".join(c + clen.to_bytes(4, "big") + p for c, clen, p in chunks)
    path.write_bytes(b"icns" + (8 + len(body)).to_bytes(4, "big") + body)


def gen_launcher_and_favicon(tmp):
    bg = os.environ.get("FOLIO_ICON_BG", "0f0f0f").lstrip("#")
    fg_h = int(os.environ.get("FOLIO_ICON_FG_HEIGHT", "560"))
    desktop = os.environ.get("FOLIO_ICON_DESKTOP", "circle")
    if desktop not in ("circle", "transparent"):
        sys.exit(f"FOLIO_ICON_DESKTOP must be circle or transparent, got {desktop}")

    if not MASTER.is_file():
        sys.exit(f"master icon not found: {MASTER}")

    master = Image.open(MASTER).convert("RGBA")
    mw, mh = master.size
    if mw >= mh:
        sys.exit(f"master must be taller than wide, got {master.size}")

    scale = fg_h / mh
    fw = max(1, round(mw * scale))
    letter = master.resize((fw, fg_h), Image.LANCZOS)
    ox, oy = (CANVAS - fw) // 2, (CANVAS - fg_h) // 2

    fg = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    fg.alpha_composite(letter, (ox, oy))
    fg_path = tmp / "fg.png"
    fg.save(fg_path)

    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(icon).ellipse((0, 0, CANVAS - 1, CANVAS - 1), fill=hex_to_rgba(bg))
    icon.alpha_composite(letter, (ox, oy))
    icon_path = tmp / "icon.png"
    icon.save(icon_path)

    manifest = {
        "default": icon_path.name if desktop == "circle" else fg_path.name,
        "bg_color": f"#{bg}",
        "android_fg": fg_path.name,
        "android_monochrome": fg_path.name,
    }
    manifest_path = tmp / "icon-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    icon.resize((FAVICON_SIZE, FAVICON_SIZE), Image.LANCZOS).save(FAVICON)
    print(f"wrote {FAVICON.relative_to(ROOT)}")

    try:
        subprocess.run(
            ["cargo", "tauri", "icon", str(manifest_path)],
            cwd=str(SRC_TAURI),
            check=True,
        )
    except FileNotFoundError:
        sys.exit("cargo not found on path")


def gen_wordmark():
    h_dp = int(os.environ.get("FOLIO_WORDMARK_HEIGHT", "52"))
    for src, prefix in (
        (WORDMARK_LIGHT, "drawable"),
        (WORDMARK_DARK, "drawable-night"),
    ):
        im = Image.open(src).convert("RGBA")
        aspect = im.size[0] / im.size[1]
        w_dp = round(h_dp * aspect)
        for bucket, s in DENSITIES.items():
            rs = im.resize((round(w_dp * s), round(h_dp * s)), Image.LANCZOS)
            outdir = ANDROID_RES / f"{prefix}-{bucket}"
            outdir.mkdir(parents=True, exist_ok=True)
            rs.save(outdir / "folio_wordmark.png", "PNG")
            print(f"wrote {outdir.relative_to(ROOT)}/folio_wordmark.png {rs.size}")


def main():
    with tempfile.TemporaryDirectory() as tmp_dir:
        gen_launcher_and_favicon(Path(tmp_dir))
    print("regenerated launcher icons")
    canonicalize_icns(SRC_TAURI / "icons" / "icon.icns")
    print("canonicalized icon.icns")
    gen_wordmark()
    print("done")


if __name__ == "__main__":
    main()
