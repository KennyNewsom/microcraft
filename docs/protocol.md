# Microcraft runtime protocol revision 7

Serial frames are 64 bytes: MCB1, opcode u8, reserved zero u8, length u16=48,
sequence u32, payload[48], CRC32 u32 over bytes 0-59. Integers are little-endian.
One request is outstanding at a time. Replies use opcode | 128; errors use 255.
Ops 18 and 19 send multiple ordered response frames for one request; other replies remain single-frame.
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
| 4 | empty heartbeat | u32 fields: cache bytes, palette size=3685, revision=7, players=4, height=128, slots=100, edit count, edit limit=12288, bucket count=16384, stack high-water bytes, bare-metal flag=1, compression flags=3 |
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
| 18 | slot u8, cursor u16=0 | consecutive op-13-format frames, all with this request sequence, until next cursor=32768; every frame has CRC |
| 19 | slot u8, cursor u16=0 | compressed frames: decoded end cursor u16, encoded byte count u8, up to 45 bytes of tokens; unused bytes zero; ends at cursor=32768 |
| 20 | slot u8, edit count u8 (1-32), encoded byte count u8 (1-45), compact edit records at 3; unused bytes zero | success at 0; validate entire frame before applying restore edits |
| 27 | empty | settle shapes/power after paging; accepted at 13, changed at 17, changed-slot bitmap at 20-32 |
| 29 | slot u8 (maintenance only) | u32 DWT cycles for reading/generating a complete chunk, u32 rolling checksum |
| 30 | empty (maintenance only) | acknowledge, then reset; refused unless every player/chunk is inactive and no edits remain |

Maintenance commands are not exposed by the public bridge. Op 18 retains CRC,
sequence, timeout and cursor validation: a missing, duplicate or reordered frame
halts the link. Op 19 additionally validates decoded cursors, lengths, states,
column references and zero padding. The startup gate is unchanged. Revision-5
firmware falls back to op 13 and its 4,096-bucket snapshot limit; revision 6 uses
op 18 and uncompressed edit restores. The capability flag at byte 44 advertises
op 19 (bit 0) and op 20 (bit 1). No new opcodes are sent to older boards.

## Lossless serial compression

Op 19 tokens never straddle frames. Each token begins with an opcode and nonzero
u8 count. States are the existing MCU palette IDs, not Minecraft registry IDs.

| Token | Data after token and count | Decoded states |
| --- | --- | --- |
| 0 | count little-endian u16 states | wide literals |
| 1 | one little-endian u16 state | count copies |
| 2 | none | count copies of the last decoded 128-block column |
| 3 | one u8 state | count copies |
| 4 | count u8 states | byte literals, expanded to u16 |

Column copies are valid only at a 128-state boundary after a complete column
exists. No token may expand past the frame's declared end cursor or chunk size.
The MCU stages current and previous columns in 512 bytes; the codec including
its two cursor fields occupies 520 bytes. It generates bounded response frames
as needed. The serial worker permits one outstanding operation, preventing a
queue of raw chunks from consuming MCU RAM.

Op 20 stores each edit as two canonical unsigned LEB128 integers: index gap,
then state ID. The first gap is an absolute index; subsequent gaps are measured
from the previous index plus one. Each frame resets this base. IDs, indices,
bedrock, count, byte length and padding are checked before any edit is applied.
Capacity failure has the same behavior as op 14: the bridge stops and keeps the
saved file intact. Saving to disk still uses the same atomic JSON format.

Minecraft network connections use the standard zlib compression negotiated at
a 256-byte packet threshold, including through ViaProxy. Vanilla clients decode
it without a mod. The serial column codec is decoded on the PC before normal
Minecraft chunk encoding; the Minecraft client never receives custom tokens.

Yaw encodes a full turn in 256 units (0=south). Cursor coordinates range 0-255.
Faces follow Minecraft's down/up/north/south/west/east order. State 65535 means
empty or unsupported held item; it can interact but cannot place. IDs 0-254 retain
their original meanings. `host/data/states.json` and generated `firmware/States.h`
define the append-only mapping. Waterlogged states are not generated.

Chunk index is **(localZ * 16 + localX) * 128 + Y**, range 0-32767.
Op 13 walks that order; runs may cross columns. Its end cursor is 32768.
Op 17 scans the hash table; its end cursor is the advertised bucket count. The PC validates run lengths,
counts, palette IDs and cursors before using generated data.

The bare-metal hash table has 16384 buckets capped at 12288 live deltas. Keys encode the
chunk slot and local index in bits 0-21; bits 22-29 hold the high state byte. The
existing byte value array holds the low state byte. The cache including its 13-byte
changed-slot bitmap and cached terrain-column data occupies 83,164 bytes. Per-chunk
edit counts use existing descriptor padding and bypass hash lookups for untouched
chunks. Back-shift deletion prevents tombstone buildup during
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
