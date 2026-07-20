"""
Generate Float's app-icon source images (pure stdlib, no Pillow).

Writes three 1024x1024 PNGs into assets/, which @capacitor/assets turns into
Android launcher icons during the build:
  - icon-background.png : full-bleed green gradient (adaptive background layer)
  - icon-foreground.png : white diamond mark on transparent (adaptive foreground)
  - icon-only.png       : rounded-square gradient + white mark (legacy / round / store)

Run:  python make_icons.py
"""
import os, zlib, struct

S = 1024
C0 = (38, 200, 132)   # top-left green
C1 = (18, 146, 95)    # bottom-right green
WHITE = (255, 255, 255)
CX = CY = (S - 1) / 2.0
A = 0.30 * S          # diamond half-size (center to tip)
RR = 0.20 * S         # rounded-square corner radius
SQRT2 = 2 ** 0.5

os.makedirs("assets", exist_ok=True)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def write_png(path, pixels):
    """pixels: bytearray of RGBA, length S*S*4."""
    raw = bytearray()
    stride = S * 4
    for y in range(S):
        raw.append(0)                       # filter type 0 for this row
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    ihdr = struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))


def gradient_rgb(px, py):
    t = (px + py) / (2.0 * (S - 1))
    return (int(C0[0] + (C1[0] - C0[0]) * t),
            int(C0[1] + (C1[1] - C0[1]) * t),
            int(C0[2] + (C1[2] - C0[2]) * t))


def diamond_cov(x, y):
    # L1 "diamond" edge, anti-aliased ~1px along the true (perpendicular) normal.
    perp = ((abs(x) + abs(y)) - A) / SQRT2
    return clamp(0.5 - perp)


def rrect_cov(x, y):
    qx = abs(x) - (S / 2.0 - RR)
    qy = abs(y) - (S / 2.0 - RR)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    dist = (ox * ox + oy * oy) ** 0.5 + min(max(qx, qy), 0.0) - RR
    return clamp(0.5 - dist)


def build(mode):
    px_out = bytearray(S * S * 4)
    i = 0
    for py in range(S):
        y = py - CY
        for px in range(S):
            x = px - CX
            if mode == "background":
                r, g, b = gradient_rgb(px, py)
                a = 255
            elif mode == "foreground":
                m = diamond_cov(x, y)
                r, g, b = WHITE
                a = int(255 * m)
            else:  # icon-only
                ba = rrect_cov(x, y)
                gr, gg, gb = gradient_rgb(px, py)
                m = diamond_cov(x, y)
                r = int(gr + (255 - gr) * m)
                g = int(gg + (255 - gg) * m)
                b = int(gb + (255 - gb) * m)
                a = int(255 * clamp(ba + m))
            px_out[i] = r; px_out[i + 1] = g; px_out[i + 2] = b; px_out[i + 3] = a
            i += 4
    return px_out


for name, mode in (("icon-background", "background"),
                   ("icon-foreground", "foreground"),
                   ("icon-only", "icon-only")):
    write_png(os.path.join("assets", name + ".png"), build(mode))
    print("wrote assets/%s.png" % name)

print("done")
