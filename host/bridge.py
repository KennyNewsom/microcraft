"""Serial owner. JSON lines on stdio carry bounded RPCs from the PC network adapter."""
import argparse
import base64
import json
from pathlib import Path
import queue
import struct
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.tools/python'))
import serial
from link import Link


def emit(message):
    print(json.dumps(message), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='COM5')
    parser.add_argument('--baud', type=int, choices=[115200, 230400, 460800, 921600, 1000000], default=115200)
    args = parser.parse_args()
    inbox = queue.Queue(maxsize=32)

    def read_input():
        try:
            for line in sys.stdin:
                if len(line) > 1024:
                    raise ValueError('Oversized IPC command')
                inbox.put(json.loads(line))
        finally:
            inbox.put(None)

    threading.Thread(target=read_input, daemon=True).start()
    with serial.Serial(args.port, 115200, timeout=0.05, write_timeout=1) as port:
        link = Link(port)
        report = link.boot(args.baud, lambda n: emit({'event': 'progress', 'packets': n}))
        palette = json.loads((Path(__file__).parent / 'data/palette.json').read_text())
        capability = link.command(4)
        if int.from_bytes(capability[4:8], 'little') != len(palette):
            raise ValueError('Firmware palette differs from PC palette; flash the matching firmware')
        if int.from_bytes(capability[8:12], 'little') != 2 or int.from_bytes(capability[12:16], 'little') != 2:
            raise ValueError('Two-player firmware revision 2 is required')
        world_path = Path('world/blocks.bin')
        saved = None
        if world_path.exists():
            saved = world_path.read_bytes()
            if len(saved) != 32768:
                raise ValueError('World file must contain exactly 32768 bytes')
            for offset in range(0, len(saved), 44):
                link.command(7, struct.pack('<I', offset) + saved[offset:offset+44])
        world = bytearray()
        for offset in range(0, 32768, 48):
            world.extend(link.command(6, struct.pack('<I', offset)))
        del world[32768:]
        if saved is not None:
            if world != saved:
                raise ValueError('MCU cache does not match the PC world after streaming')
            emit({'event': 'restored', 'bytes': len(saved)})
        world_path.parent.mkdir(exist_ok=True)

        def save():
            temporary = world_path.with_suffix('.tmp')
            temporary.write_bytes(world)
            temporary.replace(world_path)

        save()
        emit({'event': 'ready', 'report': report, 'world': base64.b64encode(world).decode()})
        while True:
            try:
                request = inbox.get(timeout=0.2)
            except queue.Empty:
                link.command(4)
                continue
            if request is None:
                break
            op = request['op']
            if op not in (4, 5, 6, 8, 9, 10):
                raise ValueError('Invalid network RPC')
            payload = bytes.fromhex(request.get('payload', ''))
            response = link.command(op, payload)
            if op == 5 and response[4]:
                x, y, z, block = response[:4]
                world[(y * 32 + z) * 32 + x] = block
                save()
            emit({'id': request['id'], 'payload': response.hex()})


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit({'event': 'fatal', 'error': str(exc)})
        raise SystemExit(1)
