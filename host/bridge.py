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
from chunks import ChunkStore, Pager


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
        palette = json.loads((Path(__file__).parent / 'data/states.json').read_text())['states']
        capability = link.command(4)
        if int.from_bytes(capability[4:8], 'little') != len(palette):
            raise ValueError('Firmware palette differs from PC palette; flash the matching firmware')
        revision = int.from_bytes(capability[8:12], 'little')
        if (revision not in (5, 6, 7) or
                int.from_bytes(capability[12:16], 'little') != 4 or
                int.from_bytes(capability[20:24], 'little') != 100):
            raise ValueError('Firmware revision 5, 6 or 7 is required; flash the matching firmware')
        buckets = int.from_bytes(capability[32:36], 'little') if revision >= 6 else 4096
        compression = int.from_bytes(capability[44:48], 'little') if revision >= 7 else 0
        pager = Pager(link, ChunkStore(Path(__file__).resolve().parents[1] / 'world'), buckets, revision >= 6, compression)
        report.update(firmware_revision=revision, serial_compression=bool(compression & 1), cache_bytes=int.from_bytes(capability[:4], 'little'),
                      edit_limit=int.from_bytes(capability[28:32], 'little'),
                      runtime='bare-metal' if int.from_bytes(capability[40:44], 'little') else 'CODAL')
        emit({'event': 'ready', 'report': report})
        while True:
            try:
                request = inbox.get(timeout=0.2)
            except queue.Empty:
                link.command(4)
                continue
            if request is None:
                pager.close()
                break
            op = request['op']
            payload = bytes.fromhex(request.get('payload', ''))
            if op == 21:
                actor, cx, cz = struct.unpack('<Bii', payload)
                pager.view(actor, (cx, cz))
                response = pager.settle()
            elif op == 22:
                response = pager.read(struct.unpack('<ii', payload))
            elif op in (4, 5, 8, 9, 10):
                response = link.command(op, payload)
                if op == 5:
                    response = pager.checkpoint_edit(response)
                if op == 10:
                    pager.view(payload[47])
                    response = pager.settle()
            else:
                raise ValueError('Invalid network RPC')
            emit({'id': request['id'], 'payload': response.hex()})


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit({'event': 'fatal', 'error': str(exc)})
        raise SystemExit(1)
