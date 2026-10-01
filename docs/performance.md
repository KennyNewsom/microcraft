# Bare-metal firmware measurements

Measured September 15, 2026 on the development micro:bit v2, at **230,400 baud**.
The PC stores the world; the MCU still generates terrain and authorizes gameplay.

| Measurement | CODAL reference | Final bare-metal build |
| --- | ---: | ---: |
| CPU generation/readback of one untouched 16×16×128 chunk | 115.7–118.2 ms | 18.2–21.0 ms |
| Generate and transfer one sampled chunk to Python | 601.7–735.9 ms | 228.0–287.1 ms |
| Generate and transfer a 25-chunk view to Python | 17.64 s | 6.80 s |
| Maximum active block edits | 3,072 | 12,288 |

CPU generation is roughly **5.6–6.4× faster** in these samples; the 25-chunk serial
workload is **2.59× faster**. These results do not support a 30–50× overall speedup.
The CPU already ran at 64 MHz with CODAL. The improvement combines freestanding
`-O3`/LTO compilation, hardware instruction caching, cached terrain-column values,
skipping edit-table lookups for untouched chunks, and removing per-frame serial
request/response round trips. It cannot be attributed to removing CODAL alone.

The CPU measurement uses the Cortex-M4 DWT cycle counter over 32,768 state reads
and a rolling checksum; it includes interrupts but excludes serial transfer. The
serial measurements include generation, framing, USB transport and Python
decompression, but exclude Node encoding, ViaProxy, Internet latency and client
rendering. They are single-run engineering measurements, not percentile guarantees.
Samples `(0,0)`, `(-2,-2)` and `(2,2)` include the flat spawn and nearby hills.
All three chunk SHA-256 hashes matched the reference exactly.

Both final and reference images passed the unchanged 10,000-packet startup gate.
The final build also passed actual-board lever/dust/lamp/iron-door interaction,
12,288 wide-state edit insertion, rejection of an extra edit, and snapshot/save/
unload/reload verification in a temporary world. The player's save was not used by
these write tests. A 1,000,000-baud trial failed at packet 4 (62/64 bytes received),
so production stays at 230,400 with no silent retries or baud fallback.

## RAM budget

| Allocation | Bytes |
| --- | ---: |
| Physical application-processor SRAM | 131,072 |
| Static data, including world cache and driver buffers | 83,404 |
| Reserved stack | 8,192 |
| Unallocated gap | 39,476 |
| World cache, within static data | 83,164 |

The cache contains 16,384 hash buckets and accepts 12,288 live edits. It uses
fixed arrays with no application heap. An extra 32,768-bucket table would not fit
this representation, so the spare RAM remains available for future work and margin.
The linker asserts that static data cannot overlap the stack reservation. A stack
canary scan measured **560 bytes used** during the hardware benchmark; this is an
observed high-water mark, not proof of worst-case stack use.

The separate DAPLink interface processor still handles USB and drag-and-drop
flashing. The application image replaces CODAL/SoftDevice only on the nRF52833.
The physical reset pin configuration and L/S/X display remain supported.

## Reproduce

With the server stopped, flash the desired image once. The benchmark creates its
own temporary PC world and never opens `world/chunks-v1`.

```powershell
python tools/build_firmware.py --codal --reference
# Flash build/MICROCRAFT-CODAL.hex and wait for L.
python tools/benchmark_firmware.py --polled --reset --output logs/reference.json
python tools/build_firmware.py
# Flash build/MICROCRAFT.hex and wait for L.
python tools/benchmark_firmware.py --capacity-test --reset --output logs/baremetal.json
```

`--reset` uses a maintenance command only after every chunk is unloaded and every
player is inactive. This is not available through Minecraft, and the normal server
launcher still assumes the MCU is already waiting. On an actual link failure,
reset the board before trying again; a failed gate never enters gameplay.

Recorded data: [benchmark JSON](benchmarks/2026-09-15.json).
Hardware references: [Micro:bit pin mapping](https://tech.microbit.org/hardware/schematic/),
[Nordic UARTE](https://docs.nordicsemi.com/r/bundle/ps_nrf52833/page/uarte.html),
[Nordic instruction cache](https://docs.nordicsemi.com/r/bundle/ps_nrf52833/page/nvmc.html).
