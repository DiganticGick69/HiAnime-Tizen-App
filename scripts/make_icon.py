"""Render tizen-app/icon.png (512x512) without external dependencies."""
import struct
import sys
import zlib
from pathlib import Path

N = 512
BG, BG2, PINK = (32, 31, 49), (58, 57, 81), (255, 186, 222)


def inside_rounded(x, y, r=96):
    cx = min(max(x, r), N - 1 - r)
    cy = min(max(y, r), N - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_triangle(x, y):
    # Play triangle centred slightly right of middle.
    ax, ay, bx, by, cx, cy = 190, 140, 190, 372, 390, 256
    def side(px, py, qx, qy, rx, ry):
        return (px - rx) * (qy - ry) - (qx - rx) * (py - ry)
    d1, d2, d3 = side(x, y, ax, ay, bx, by), side(x, y, bx, by, cx, cy), side(x, y, cx, cy, ax, ay)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def pixel(x, y):
    if not inside_rounded(x, y):
        return (0, 0, 0, 0)
    ring = (x - 256) ** 2 + (y - 256) ** 2
    if 170 ** 2 <= ring <= 186 ** 2:
        return PINK + (255,)
    if inside_triangle(x, y):
        return PINK + (255,)
    t = y / N
    return tuple(int(BG[i] * (1 - t) + BG2[i] * t) for i in range(3)) + (255,)


def main(out):
    raw = bytearray()
    for y in range(N):
        raw.append(0)
        for x in range(N):
            # 2x2 supersampling for smooth edges.
            acc = [0, 0, 0, 0]
            for sx, sy in ((x, y), (x + .5, y), (x, y + .5), (x + .5, y + .5)):
                p = pixel(sx, sy)
                for i in range(4):
                    acc[i] += p[i]
            raw.extend(int(v / 4) for v in acc)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    Path(out).write_bytes(png)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tizen-app/icon.png")
