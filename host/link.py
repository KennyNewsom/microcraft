"""Strict fixed-size serial protocol shared by the startup test and PC bridge."""
import secrets
import struct
import time
import zlib

PACKETS = 10_000
SIZE = 64


class LinkError(RuntimeError):
    pass


def frame(op, sequence, payload=b''):
    if len(payload) > 48:
        raise ValueError('Payload exceeds 48 bytes')
    body = struct.pack('<4sBBHI48s', b'MCB1', op, 0, 48, sequence, payload)
    return body + struct.pack('<I', zlib.crc32(body))


def decode(data):
    if len(data) != SIZE or data[:4] != b'MCB1' or data[5:8] != b'\x00\x30\x00':
        raise LinkError('Invalid serial frame')
    if zlib.crc32(data[:60]) != struct.unpack_from('<I', data, 60)[0]:
        raise LinkError('CRC mismatch')
    return data[4], struct.unpack_from('<I', data, 8)[0], data[12:60]


class Link:
    def __init__(self, port, timeout=1.0):
        self.port = port
        self.timeout = timeout
        self.sequence = 0
        self.ready = False
        self.failed = False

    def exchange(self, request, echo=False):
        if self.failed:
            raise LinkError('Link is latched failed; reset the micro:bit before retrying')
        try:
            if self.port.write(request) != SIZE:
                raise LinkError('Short serial write')
            # Circuit settling can touch every active edit. The startup echo gate
            # retains its strict timeout; only stateful runtime work gets longer.
            deadline = time.monotonic() + (max(self.timeout, 10.0) if self.ready and request[4] in (5, 27) else self.timeout)
            received = bytearray()
            while len(received) < SIZE and time.monotonic() < deadline:
                received.extend(self.port.read(SIZE - len(received)))
            if len(received) != SIZE:
                seq = struct.unpack_from('<I', request, 8)[0]
                raise LinkError(f'Timeout at sequence {seq}: received {len(received)}/{SIZE} bytes')
            op, seq, payload = decode(received)
            if op == 255:
                raise LinkError(f'Firmware error {payload[0]}, sequence {seq}')
            if seq != struct.unpack_from('<I', request, 8)[0]:
                raise LinkError('Wrong sequence: dropped, duplicated, or stale response')
            if echo and received != request:
                raise LinkError('Echo mismatch')
            if not echo and op != (request[4] | 128):
                raise LinkError('Unexpected response opcode')
            return payload
        except Exception:
            self.failed = True
            self.ready = False
            raise

    def boot(self, baud=1_000_000, progress=lambda n: None):
        if self.sequence or self.ready:
            raise LinkError('Already booted; reset the board for a new test')
        nonce = secrets.token_bytes(8)
        self.exchange(frame(1, 0, nonce + struct.pack('<I', baud)), echo=True)
        time.sleep(0.25)
        self.port.baudrate = baud
        start = time.monotonic()
        for seq in range(1, PACKETS + 1):
            # Includes random bytes, all-zero, all-one, alternating and ramp patterns.
            payload = (bytes(48), b'\xff' * 48, b'\x55\xaa' * 24,
                       bytes((seq + j) & 255 for j in range(48)), secrets.token_bytes(48))[seq % 5]
            self.sequence = seq
            self.exchange(frame(2, seq, payload), echo=True)
            if seq % 1000 == 0:
                progress(seq)
        elapsed = time.monotonic() - start
        self.sequence = PACKETS + 1
        self.exchange(frame(3, self.sequence, nonce))
        self.ready = True
        return {'packets': PACKETS, 'baud': baud, 'seconds': round(elapsed, 3),
                'wire_bytes_per_second': round(PACKETS * SIZE * 2 / elapsed, 1)}

    def command(self, op, payload=b''):
        if not self.ready:
            raise LinkError('Startup gate has not passed')
        self.sequence += 1
        return self.exchange(frame(op, self.sequence, payload))
