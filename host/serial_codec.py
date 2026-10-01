"""Bounded lossless serial codecs; world states and disk format are unchanged."""
import struct

SIZE = 32768


def decode_chunk_frame(payload, result, state_count):
    if len(payload) != 48 or len(result) % 2:
        raise ValueError('Invalid compressed frame size')
    next_cursor, length = struct.unpack_from('<HB', payload)
    cursor = len(result) // 2
    if not cursor < next_cursor <= SIZE or not 1 <= length <= 45 or any(payload[3+length:]):
        raise ValueError('Invalid compressed cursor, length or padding')
    offset, end = 3, 3+length
    while offset < end:
        if offset+2 > end:
            raise ValueError('Truncated compressed token')
        token, count = payload[offset:offset+2]
        offset += 2
        if not count:
            raise ValueError('Empty compressed token')
        if token == 2:
            if len(result) < 256 or len(result) % 256 or len(result)+count*256 > next_cursor*2:
                raise ValueError('Invalid compressed column reference')
            result.extend(bytes(result[-256:])*count)
            continue
        if token not in (0, 1, 3, 4):
            raise ValueError('Unknown compressed token')
        width = 1 if token in (3, 4) else 2
        repeated = token in (1, 3)
        size = width if repeated else width*count
        if offset+size > end or len(result)+count*2 > next_cursor*2:
            raise ValueError('Compressed token exceeds frame or chunk')
        values = payload[offset:offset+size]
        offset += size
        if width == 1:
            values = b''.join(struct.pack('<H', value) for value in values)
        if any(value >= state_count for (value,) in struct.iter_unpack('<H', values)):
            raise ValueError('Invalid compressed state')
        result.extend(values*count if repeated else values)
    if len(result) != next_cursor*2:
        raise ValueError('Compressed cursor mismatch: missing, duplicate or reordered frame')
    return next_cursor


def varint(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def encode_edits(slot, pairs, state_count):
    """Yield independently decodable frames, max 32 edits / 45 encoded bytes."""
    if not 0 <= slot < 100:
        raise ValueError('Invalid compressed edit slot')
    body, count, next_index = bytearray(), 0, 0
    for index, state in sorted(pairs):
        if (type(index) is not int or type(state) is not int or
                not next_index <= index < SIZE or not 0 <= state < state_count or
                (index % 128 == 0 and state != 1)):
            raise ValueError('Invalid compressed edit')
        encoded = varint(index-next_index)+varint(state)
        if count == 32 or len(body)+len(encoded) > 45:
            yield bytes([slot, count, len(body)])+body
            body, count, next_index = bytearray(), 0, 0
            encoded = varint(index)+varint(state)
        body.extend(encoded)
        count += 1
        next_index = index+1
    if count:
        yield bytes([slot, count, len(body)])+body
