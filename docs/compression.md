# Compression measurements

Measured September 30, 2026 on the attached micro:bit v2 at 230400 baud.
Both serial formats were measured on the same revision-7 bare-metal firmware.
Measurements include generation, serial framing, USB transfer and Python decoding,
and exclude Minecraft chunk encoding, internet transport and client rendering.
These are individual engineering runs, not latency guarantees.

| Workload | Previous RLE | Column-copy / RLE / literals |
| --- | ---: | ---: |
| 25-chunk view transfer | 7.146 s | 2.618 s |
| Untouched flat chunk transfer | 241 ms | 37 ms |
| Untouched flat chunk serial bytes, including request | 4480 | 128 |
| Hills at (-2,-2), serial bytes including request | 5760 | 3584 |
| Hills at (2,2), serial bytes including request | 5696 | 2496 |

The 25-chunk workload is approximately **2.73x faster**. A flat chunk containing
65536 decoded state bytes becomes 14 token bytes inside one CRC-protected response
frame. Irregular terrain and player edits compress less; random data uses literal
tokens instead of paying for a separate RLE token for every individual block.

Both runs passed the unchanged 10000-packet exact-echo startup gate. Every sampled
chunk's SHA-256 hash matched. The new-format hardware run also exercised a real
lever/dust/lamp/iron-door circuit and filled all 12288 edit slots, saved to a
temporary world, unloaded, restored through the PC encoder and MCU decoder, and
verified all state IDs. An additional edit was correctly refused at capacity.
Encoding that same saved edit set requires 878 restore frames instead of 1118
with the old fixed-width records, a 21% reduction in upload frames.
The player's existing saved world was backed up and its file hashes were unchanged.

The codec adds **520 bytes of static scratch RAM**. The linked image uses 83924
static bytes, reserves an 8192-byte stack, and leaves 38956 bytes free. The observed
stack high-water mark during the compressed capacity test was 656 bytes.
The compressor stages two columns rather than keeping raw chunks in a queue;
one serial operation is outstanding, so producer backpressure stays bounded.

Minecraft clients already negotiate vanilla zlib at a 256-byte threshold.
The proxy configuration makes this explicit, and client tests verify negotiation
through both 26.1 and 26.2 wire paths. The micro:bit column codec is decoded on
the PC before Minecraft's palette encoding and zlib layer. No client mod is needed.

Raw comparison: [benchmark JSON](benchmarks/2026-09-30-compression.json).
The byte format and strict bounds are documented in [the protocol](protocol.md).

Reproduce on a reset, idle board (temporary world only):

```powershell
python tools/benchmark_firmware.py --legacy-compression --reset --output logs/compression-legacy.json
python tools/benchmark_firmware.py --capacity-test --reset --output logs/compression-new.json
```

The diagnostic `--reset` command is accepted only after all chunks and players
are unloaded and the MCU has no edits left. It does not reflash firmware.
