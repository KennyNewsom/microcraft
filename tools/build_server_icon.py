"""Build the original Microcraft pixel-art badge as PNG and editable SVG."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
rectangles = []
pixels = bytearray(64 * 64 * 3)

def rect(x, y, width, height, color):
    rgb = bytes.fromhex(color)
    rectangles.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="#{color}"/>')
    for row in range(y, y + height):
        for col in range(x, x + width):
            start = (row * 64 + col) * 3
            pixels[start:start + 3] = rgb

rect(0, 0, 64, 64, '101d2b')
rect(9, 13, 48, 44, '080f19')
rect(7, 10, 48, 44, '314757')
rect(10, 19, 42, 29, '192b37')
rect(7, 10, 48, 7, '7ed957')
rect(7, 17, 8, 4, '4da443')
rect(23, 17, 7, 3, '4da443')
rect(44, 17, 11, 4, '4da443')
rect(12, 12, 7, 2, 'b6ef75')
rect(35, 12, 10, 2, 'b6ef75')
rect(11, 26, 5, 5, '9badb2')
rect(46, 26, 5, 5, '9badb2')
rect(12, 27, 3, 3, 'd4e1d5')
rect(47, 27, 3, 3, 'd4e1d5')
for row, pattern in enumerate(['10001', '11011', '10101', '10001', '10001']):
    for col, bit in enumerate(pattern):
        rect(20 + col * 5, 23 + row * 5, 3, 3, 'ff6464' if bit == '1' else '31414c')
for x in (12, 21, 30, 39, 48):
    rect(x, 48, 4, 6, 'edbd5d')
rect(3, 36, 4, 2, '4da443')
rect(55, 36, 6, 2, '4da443')
rect(59, 32, 2, 4, '4da443')

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

raw = b''.join(b'\0' + pixels[y * 192:(y + 1) * 192] for y in range(64))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 64, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
assets = ROOT / 'assets'
assets.mkdir(exist_ok=True)
(assets / 'microcraft-icon.png').write_bytes(png)
(assets / 'microcraft-icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">\n' + '\n'.join(rectangles) + '\n</svg>\n')
# Rebuilding the default must never overwrite the owner's customized icon.
if not (ROOT / 'server-icon.png').exists():
    (ROOT / 'server-icon.png').write_bytes(png)
