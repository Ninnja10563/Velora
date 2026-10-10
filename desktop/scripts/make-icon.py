"""Create the code-defined Velora logo without external image dependencies.

The SVG alongside this script is the editable vector source. This deterministic
rasterizer renders the same geometry; macOS sips/iconutil create the ICNS bundle.
"""
from pathlib import Path
import platform
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SIZE = 1024
POLYGON = [(212, 332), (412, 812), (592, 812), (792, 332), (592, 332), (492, 612), (392, 332)]
SPARKLE = [(712, 152), (748, 248), (852, 292), (748, 336), (712, 432), (676, 336), (572, 292), (676, 248)]


def in_polygon(x, y, polygon):
    inside = False
    previous = polygon[-1]
    for point in polygon:
        ax, ay = point
        bx, by = previous
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
        previous = point
    return inside


def pixel(x, y):
    # Rounded square, matching icon.svg's rectangle exactly.
    if not (48 <= x <= 976 and 48 <= y <= 976):
        return (0, 0, 0, 0)
    cx, cy = min(max(x, 264), 760), min(max(y, 264), 760)
    if (x - cx) ** 2 + (y - cy) ** 2 > 216 ** 2:
        return (0, 0, 0, 0)
    if 572 <= x <= 852 and 152 <= y <= 432 and in_polygon(x, y, SPARKLE):
        return (106, 82, 122, 255)
    if 212 <= x <= 792 and 332 <= y <= 812 and in_polygon(x, y, POLYGON):
        return (106, 82, 122, 255)
    return (236, 229, 240, 255)


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)


rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        samples = [pixel(x + dx, y + dy) for dx, dy in ((.25, .25), (.75, .25), (.25, .75), (.75, .75))]
        # Premultiplied alpha averaging keeps the outer edge clean.
        alpha = sum(p[3] for p in samples)
        rgb = [round(sum(p[c] * p[3] for p in samples) / alpha) if alpha else 0 for c in range(3)]
        rows.extend((*rgb, round(alpha / 4)))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
(ASSETS / "icon.png").write_bytes(png)

if platform.system() == "Darwin":
    iconset = ASSETS / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = "@2x" if scale == 2 else ""
            target = iconset / f"icon_{size}x{size}{suffix}.png"
            subprocess.run(["sips", "-z", str(size * scale), str(size * scale), str(ASSETS / "icon.png"), "--out", str(target)], check=True, capture_output=True)
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")], check=True)
    print("Created macOS icon.icns")
else:
    print("Created icon.png; ICNS conversion runs on the macOS build host.")
