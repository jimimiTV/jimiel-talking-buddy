#!/usr/bin/env python3
"""Draw the home-screen face. No dependencies; run once and commit the PNGs."""

import struct
import zlib
from pathlib import Path


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def ellipse(px, py, cx, cy, rx, ry):
    if rx <= 0 or ry <= 0:
        return False
    dx = (px - cx) / rx
    dy = (py - cy) / ry
    return dx * dx + dy * dy <= 1


def ring(px, py, cx, cy, r, width):
    dx = px - cx
    dy = py - cy
    dist = (dx * dx + dy * dy) ** 0.5
    return abs(dist - r) <= width


def color_at(px, py):
    bg = (244, 239, 228, 255)
    glow = (231, 211, 176, 255)
    rim = (227, 176, 138, 255)
    skin = (243, 199, 164, 255)
    cheek = (239, 176, 160, 255)
    eye = (62, 76, 89, 255)
    shine = (255, 248, 238, 255)
    mouth = (196, 109, 92, 255)

    if ellipse(px, py, 100, 98, 86, 86):
        bg = glow
    if ellipse(px, py, 100, 98, 74, 74):
        bg = rim
    if ellipse(px, py, 100, 98, 70, 70):
        bg = skin
    if ellipse(px, py, 62, 116, 11, 7):
        bg = cheek
    if ellipse(px, py, 138, 116, 11, 7):
        bg = cheek
    if ellipse(px, py, 74, 94, 7.2, 8.2) or ellipse(px, py, 126, 94, 7.2, 8.2):
        bg = eye
    if ellipse(px, py, 76.2, 91.2, 2.1, 2.1) or ellipse(px, py, 128.2, 91.2, 2.1, 2.1):
        bg = shine
    # Smile: a thick arc sitting under the eyes.
    if ring(px, py, 100, 92, 30, 2.3) and py >= 116:
        bg = mouth
    return bg


def write_png(path, size):
    raw = bytearray()
    samples = 3
    for y in range(size):
        raw.append(0)
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    px = (x + (sx + 0.5) / samples) / size * 200
                    py = (y + (sy + 0.5) / samples) / size * 200
                    color = color_at(px, py)
                    for i in range(4):
                        acc[i] += color[i]
            count = samples * samples
            raw.extend(channel // count for channel in acc)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    root = Path(__file__).resolve().parents[1]
    for size, name in ((180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        write_png(root / name, size)
        print(name, size)


if __name__ == "__main__":
    main()
