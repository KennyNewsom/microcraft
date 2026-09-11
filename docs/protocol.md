# Microcraft serial protocol v1

Every request and response is exactly 64 bytes. Integers are little-endian.
The UART uses 8 data bits, no parity, one stop bit, and no flow control.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | ASCII `MCB1` |
| 4 | 1 | Opcode |
| 5 | 1 | Flags, must be zero |
| 6 | 2 | Payload size, always 48 |
| 8 | 4 | Sequence number |
| 12 | 48 | Payload, unused bytes padded with zeros by the host |
| 60 | 4 | IEEE CRC-32 of bytes 0–59, matching Python `zlib.crc32` |

The host sends one request at a time. It never retries after an uncertain result.
HELLO and TEST return the exact original frame. Other successful replies use the
request opcode OR 128 and the same sequence. Error replies use opcode 255.

| Opcode | Request | Response payload |
| --- | --- | --- |
| 1 HELLO | Sequence 0; 8-byte nonce, then 4-byte baud | Exact echo |
| 2 TEST | Sequences 1–10000; varied 48-byte binary data | Exact echo |
| 3 START | Sequence 10001; same nonce | Echoed payload; opcode 131 |
| 4 HEARTBEAT | No arguments | Four uint32 values: cache bytes, palette entries, runtime revision (2), player slots (2) |
| 5 EDIT | uint8 x, y, z, palette ID | Same four fields, then uint8 accepted |
| 6 READ | uint32 cache offset | Up to 48 cache bytes, final page zero-padded |
| 7 RESTORE | uint32 cache offset, then up to 44 saved bytes | Echoed payload |
| 8 MOVE | Three int16 positions, units of 1/32 block | Accepted/current position, then uint8 accepted |
| 9 JOIN | Player slot | Spawn position as three int16 values, then uint8 accepted |
| 10 LEAVE | Player slot | accepted=1 at payload offset 6 |

EDIT, MOVE, JOIN, and LEAVE select player slot 0 or 1 in payload byte 47 (frame
byte 59). Other payload fields retain their existing offsets. The MCU rejects
actions for inactive players and checks reach using the selected player's own
position. An invalid slot number halts the link with error 14. JOIN rejects an
already active slot; LEAVE deactivates it. The PC checks runtime revision and
slot count before restoring the world. Gameplay packets from old bridges are
not supported; install the matching PC code and firmware together.

HELLO starts at 115200 baud. The board echoes it, waits 100 ms, then changes baud.
The host waits 250 ms after receiving the echo before changing its port speed.
115200, 230400, 460800, 921600 and 1000000 are accepted as requested test rates.
Only use a rate that passes the startup gate. Runtime sequences continue at 10002.

The MCU rejects START unless all 10000 TEST requests were valid and ordered.
The PC additionally verifies that all 10000 echoes were returned exactly. The MCU
has a two-second request deadline after HELLO; the host has a one-second reply
deadline. After any link error, reset the board to start another session.

RESTORE is only permitted before the first JOIN, MOVE, or EDIT. Every restored
block must use a valid palette ID, and the floor must remain bedrock. The host
reads the cache back and checks it against the saved file before opening the
Minecraft listener. There are no MCU filesystem or world-flash operations.

Cache index: `(y * 32 + z) * 32 + x`. The append-only palette is recorded in
`host/data/palette.json`: 0 air, 1 bedrock, 2 dirt, 3 grass block, 4 stone, followed
by additional building materials through ID 254. ID 255 represents an unsupported
item and is rejected by the MCU. The PC translates valid IDs into Java 26.1 block
states. The firmware advertises its palette count in HEARTBEAT, and the bridge
refuses to restore a world if its palette count differs. Old world bytes retain
their meaning without migration. Never reorder existing palette entries.

An ERROR response's first payload byte identifies the failure:

| Code | Meaning |
| --- | --- |
| 1–3 | Bad HELLO frame, command/sequence, or requested baud |
| 4–5 | TEST timeout/framing/CRC failure, or wrong TEST command/sequence |
| 6–7 | Bad START frame, sequence, command, or nonce |
| 8–9 | Runtime timeout/framing/CRC failure, or wrong sequence |
| 10–11 | Invalid READ offset, or unsupported runtime command |
| 12–13 | RESTORE outside loading phase/range, or invalid saved block |
| 14 | Invalid player slot |

The LED displays L while waiting/testing, S after START, and X when halted.
The bridge uses an input queue capped at 32 commands and sends idle heartbeats
every 200 ms. No game simulation proceeds after a latched serial failure.
