# Microcraft runtime protocol revision 5

Serial frames are 64 bytes: MCB1, opcode u8, reserved zero u8, length u16=48,
sequence u32, payload[48], CRC32 u32 over bytes 0-59. Integers are little-endian.
One request is outstanding at a time. Replies use opcode | 128; errors use 255.
Framing, sequence, CRC, timeout, or echo failures halt until a physical reset.
The PC must send traffic within the two-second MCU watchdog, including streaming.
The PC allows up to ten seconds for edit/settle replies; other commands and the
startup packet gate keep the normal one-second timeout. Failures are never retried.

## Startup

At 115200 baud, op 1/sequence 0 carries a nonce[8] and requested baud u32. Both
ends switch baud. Op 2/sequences 1-10000 must echo all 64 bytes exactly. Only then
may op 3/sequence 10001 carry the nonce and enable runtime. This application gate
does not replace DAPLink's bootloader.

## Runtime commands

Actor commands use payload byte 47 for slots 0 through 3. Player coordinates are signed
**i32 fixed-point, 1/32 block units**. Block coordinates are signed i32 whole blocks.
The previous i16/byte-coordinate runtime is incompatible.

| Op | Request payload | Reply payload |
| --- | --- | --- |
| 4 | empty heartbeat | u32 fields: cache bytes, palette size=3685, revision=5, players=4, height=128, slots=100, edit count, edit capacity=3072 |
| 5 | clicked x/y/z i32 at 0/4/8, state/item u16 at 12, action at 14 (0 diagnostic raw, 1 use/place, 2 break), face at 15, yaw at 16, cursor Y/X/Z at 17/18/19, sneak at 20, actor at 47 | actual edited x/y/z at 0/4/8; accepted at 13, current state low byte at 14 / high byte at 18, matches baseline at 15, reason at 16 (0 OK, 1 invalid, 2 RAM full), changed at 17, changed-slot bitmap at 20-32 |
| 8 | x/y/z fixed-point i32 at 0/4/8, actor | authoritative coordinates; accepted at 12 |
| 9 | actor | spawn coordinates i32 x3; accepted at 12 |
| 10 | actor | success at 12 |
| 11 | seed u32 | echo; allowed once after startup |
| 12 | free slot u8, chunk x/z i32 at 1/5 | success at 0; assigns procedural descriptor |
| 13 | slot u8, stream cursor u16 at 1 | next cursor u16, count u8, up to 15 pairs of run length u8 / state u16 at byte 3 |
| 14 | slot u8, count u8, up to 11 index u16 / state u16 records at 2 | success at 0; restore deltas; capacity failure stops bridge without changing disk |
| 15 | slot u8 | unload a clean chunk; dirty unload is fatal |
| 16 | slot u8 | acknowledge completed PC save and clear dirty flag |
| 17 | slot u8, hash-table cursor u16 | next cursor u16, count u8, dirty u8, up to 11 index u16 / state u16 records at byte 4 |
| 27 | empty | settle shapes/power after paging; accepted at 13, changed at 17, changed-slot bitmap at 20-32 |

Yaw encodes a full turn in 256 units (0=south). Cursor coordinates range 0-255.
Faces follow Minecraft's down/up/north/south/west/east order. State 65535 means
empty or unsupported held item; it can interact but cannot place. IDs 0-254 retain
their original meanings. `host/data/states.json` and generated `firmware/States.h`
define the append-only mapping. Waterlogged states are not generated.

Chunk index is **(localZ * 16 + localX) * 128 + Y**, range 0-32767.
Op 13 walks that order; runs may cross columns. Its end cursor is 32768.
Op 17 scans the hash table; its end cursor is 4096. The PC validates run lengths,
counts, palette IDs and cursors before using generated data.

The fixed hash table has 4096 buckets capped at 3072 live deltas. Keys encode the
chunk slot and local index in bits 0-21; bits 22-29 hold the high state byte. The
existing byte value array holds the low state byte. The cache including its 13-byte
changed-slot bitmap occupies 21,704 bytes. Back-shift deletion prevents tombstone buildup during
repeated travel. Bedrock and reach checks are MCU decisions. A no-op edit does not
become dirty; returning a block to its procedural value removes its delta.

## PC-only RPCs

Node sends JSON lines to Python. Op 21 (slot u8, center chunk x/z i32) reconciles
the union of four 5x5 views. Op 22 (chunk x/z i32) reads and decompresses a resident
MCU chunk. These two opcodes are not sent to the serial wire. Leaving removes a
player's view. View changes and edits are serialized; movement bursts coalesce.
Op 22 returns 65,536 bytes of little-endian u16 states. Python appends changed
chunk x/z i32 pairs after the 48-byte replies to edits, view changes, and leave.
Node re-reads those chunks and broadcasts only their changed states.

Eviction is snapshot, atomic save if dirty, op 16, then op 15. A save failure
cannot authorize eviction. Accepted changed-block replies also checkpoint that
affected chunks before network acknowledgment, including neighboring circuit states.
Snapshots that match the saved deltas do not rewrite files. Only modified chunks are saved;
clean generated terrain is discarded. Disk/link failures stop gameplay.
