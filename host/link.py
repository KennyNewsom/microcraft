"""Strict fixed-size serial protocol shared by the startup test and PC bridge."""
import secrets
import struct
import time
import zlib
from serial_codec import decode_chunk_frame

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

    def boot(self, baud=1_000_000, progress=lambda n: None, *, host_baud=None):
        if self.sequence or self.ready:
            raise LinkError('Already booted; reset the board for a new test')
        nonce = secrets.token_bytes(8)
        self.exchange(frame(1, 0, nonce + struct.pack('<I', baud)), echo=True)
        time.sleep(0.25)
        self.port.baudrate = baud if host_baud is None else host_baud
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
        return {'packets': PACKETS, 'baud': baud, 'host_baud': self.port.baudrate, 'seconds': round(elapsed, 3),
                'wire_bytes_per_second': round(PACKETS * SIZE * 2 / elapsed, 1)}

    def command(self, op, payload=b''):
        if not self.ready:
            raise LinkError('Startup gate has not passed')
        self.sequence += 1
        return self.exchange(frame(op, self.sequence, payload))

    def compressed_chunk(self, slot, state_count):
        """Revision-7 chunk stream with bounded token decoding and strict integrity."""
        if not self.ready or self.failed:
            raise LinkError('Startup gate has not passed')
        self.sequence += 1
        result, frames, encoded = bytearray(), 0, 0
        try:
            if self.port.write(frame(19, self.sequence, bytes([slot, 0, 0]))) != SIZE:
                raise LinkError('Short serial write')
            while len(result) < 65536:
                deadline = time.monotonic()+self.timeout
                received = bytearray()
                while len(received) < SIZE and time.monotonic() < deadline:
                    received.extend(self.port.read(SIZE-len(received)))
                op, sequence, payload = decode(received)
                if op != 147 or sequence != self.sequence:
                    raise LinkError('Wrong compressed opcode or sequence')
                decode_chunk_frame(payload, result, state_count)
                frames += 1
                encoded += payload[2]
            self.last_chunk_stats = {'raw_bytes': len(result), 'encoded_bytes': encoded,
                                     'wire_bytes': (frames+1)*SIZE, 'frames': frames}
            return bytes(result)
        except BaseException:
            self.failed = True
            self.ready = False
            raise

    def stream_chunk(self, slot):
        """One request, ordered CRC-protected response frames until cursor 32768."""
        if not self.ready or self.failed:
            raise LinkError('Startup gate has not passed')
        self.sequence += 1
        cursor = 0
        frames, encoded = 0, 0
        try:
            if self.port.write(frame(18, self.sequence, bytes([slot, 0, 0]))) != SIZE:
                raise LinkError('Short serial write')
            while cursor < 32768:
                deadline = time.monotonic() + self.timeout
                received = bytearray()
                while len(received) < SIZE and time.monotonic() < deadline:
                    received.extend(self.port.read(SIZE-len(received)))
                op, sequence, payload = decode(received)
                if op != 146 or sequence != self.sequence:
                    raise LinkError('Wrong streamed opcode or sequence')
                next_cursor, count = struct.unpack_from('<HB', payload)
                if not 1 <= count <= 15 or not cursor < next_cursor <= 32768:
                    raise LinkError('Invalid streamed cursor or count')
                lengths = [payload[3+i*3] for i in range(count)]
                if not all(lengths) or cursor+sum(lengths) != next_cursor:
                    raise LinkError('Dropped, duplicated, or reordered chunk frame')
                cursor = next_cursor
                frames += 1
                encoded += count*3
                yield payload
            self.last_chunk_stats = {'raw_bytes': 65536, 'encoded_bytes': encoded,
                                     'wire_bytes': (frames+1)*SIZE, 'frames': frames}
        except BaseException:
            self.failed = True
            self.ready = False
            raise
