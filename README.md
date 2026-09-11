# Microcraft

Experimental Minecraft Java **26.1** prototype with C++ gameplay decisions on a
micro:bit v2 and a PC providing serial transport, Minecraft protocol encoding,
and persistent world storage. Geyser is not included.

## Ownership

- **PC:** `world/blocks.bin` is the durable world, plus network framing, registries,
  compression, and client connections. Saved blocks are streamed over USB at startup.
- **micro:bit:** a fixed **32,768-byte RAM cache**, movement bounds, block reach,
  palette validation, block edits, and first-world generation. No world data is
  saved to the board's flash. Accepted edits are sent back to the PC for saving.
- This first 32×32×32 world fits entirely in the active cache. It does **not** yet
  page a larger world as a player moves. The remaining board RAM is for CODAL,
  heap, stacks, serial buffers, and player state.

Two creative players can fly, break blocks, and place **254 block types**: wood,
glass, colored wool/concrete/terracotta, stone variants, ores, metals, and more.
The floor is immutable. Unsupported items are rejected and show an action-bar message.
Directional blocks currently use their default orientation. Sand, gravel, and
concrete powder stay where placed; block updates and falling physics are not simulated.
There are no mobs,
survival mechanics, crafting, redstone, fluids, collision simulation, or dynamic
lighting. World coordinates are x/z 0–31 and y 0–31. Movement is bounded by the MCU.
The network adapter uses full skylight for this prototype.

## Setup and run

You need a micro:bit v2, a USB data cable, Node.js, Python 3, and a Minecraft Java
**26.1** client. Development used Node.js 24 and Python 3.14 on Windows.
Install the PC dependencies with `npm ci --ignore-scripts` and
`python -m pip install -r requirements.txt`, then build and flash the firmware
using the instructions below.

Find the board's serial port in Device Manager and set `MICROCRAFT_PORT` if it
is not COM5. The MICROBIT drive is a flashing interface, not a world-storage disk.

1. Stop any running copy of the bridge before restarting.
2. Press the board's reset button. Wait for **L** on the LED display.
3. In this project folder, run `npm start`.
4. Wait for all **10,000 exact echoes** and saved-world restoration (about 80
   seconds at the currently selected 230,400 baud).
5. Connect a Minecraft Java **26.1** client to **localhost:25565**.

The prototype listens on all IPv4 interfaces and uses offline authentication for
LAN testing. On the second computer, use **your server PC's LAN IP:25565** with Java 26.1.
Use distinct Minecraft usernames. Internet forwarding and authenticated multiplayer
have not been configured. Keep this offline-mode prototype on a trusted LAN.
`tools/enable-lan.ps1` is a firewall helper from the development setup; review
and adjust its program path, local address, and subnet for your network before running it.
Stop a foreground bridge with Ctrl+C. The board shows **X** after the host stops
responding; reset it before the next run. **S** means the startup gate passed.

`MICROCRAFT_PORT` overrides COM5. `MICROCRAFT_BAUD` can be `115200`, `230400`,
`460800`, `921600`, or `1000000`. `MICROCRAFT_HOST=127.0.0.1` restricts listening
to this PC. The server defaults to **230400**, the fastest tested passing speed.
There is no automatic retry or fallback during startup.

```powershell
$env:MICROCRAFT_BAUD = '230400'
npm start
```

An independent high-speed test is available after resetting the board:

```powershell
python host/boot_test.py --port COM5 --baud 1000000
```

The test exits after checking the running firmware's RAM size; the firmware then
halts when its host watchdog expires. Use `--hold` to keep sending heartbeats.

## Startup gate

This is an **application startup gate**, not a replacement for DAPLink's bootloader.

1. PC and MCU exchange a session nonce and target baud at 115,200.
2. Both switch to the requested baud.
3. PC sends exactly 10,000 numbered 64-byte frames, one outstanding at a time.
   Payloads cycle through zeros, ones, alternating bits, ramps, and random bytes.
4. MCU validates framing, CRC-32, and order, then echoes the entire frame.
5. PC checks every echoed byte. Loss, truncation, corruption, wrong sequence,
   or a timeout latches failure. No server listener is created on failure.
6. Only after all echoes match does the PC send START with the session nonce.
7. PC restores the saved RAM cache, then opens the local Minecraft listener.

The MCU requires ordered, CRC-protected requests during play as well. A two-second
host watchdog halts it if the bridge disappears. The bridge closes the game server
when serial communication fails. The host continues heartbeats with no player online.

Passing this test validates the tested stop-and-wait traffic pattern, not arbitrary
continuous bursts or a guarantee that the link can never fail later.

## Verification

```powershell
python -m unittest discover -s tests -v
node --test tests/minecraft.test.js
node tools/probe_server.js  # against a running local bridge, with no player joined
node tools/probe_server.js --edits  # also checks PC persistence and restores the test block
node tools/probe_server.js --palette  # checks new materials and the highest palette ID
node tools/probe_two_clients.js  # real MCU: two players, independent reach, shared edits, reconnect
```

The Python tests exercise 10,000 successful echoes and injected drop, truncation,
corruption, stale-response, and changed-payload failures. The Node integration test
uses a Java 26.1 protocol client and a simulated MCU transport. The hardware probe
checks real-board login, chunks, out-of-bounds movement rejection, and floor protection.
These protocol tests do not replace visual testing in the official Minecraft client.

Login includes vanilla registry tags from the installed Java 26.1 client. These
are required even though the prototype does not simulate enchantments or other
full-game mechanics. `python tools/generate_tags.py` regenerates the checked-in
network tag data from `%APPDATA%/.minecraft/versions/26.1/26.1.jar`; an alternative
26.1 JAR path can be passed as its first argument. The builder resolves nested tags
against the exact registry IDs advertised by the PC bridge and rejects missing
required entries. The login regression test checks tags arrive before configuration
finishes, since a packet-only client otherwise misses vanilla registry-load errors.

Measured on this board with 64-byte stop-and-wait frames:

| Baud | Result |
| --- | --- |
| 115200 | Prior pass: 10,000 packets in 124.232 seconds |
| 230400 | Pass: 10,000 in 69.713 seconds; live restart also passed in 69.304 seconds |
| 460800 | Failed at sequence 1, 0/64 reply bytes |
| 921600 | Failed at sequence 1, 0/64 reply bytes |
| 1000000 | Failed at sequence 65, 14/64 reply bytes |

Every failed run blocked startup. A real two-client test at 230400 also passed
200 MCU-authorized movement commands in 1.440 seconds, plus independent reach
checks, shared block edits, persistence, and slot reuse. These are measured test
results, not guarantees for all future traffic. Local run logs are excluded from Git.

The MCU has two fixed player slots, each with its own position and active flag.
The PC assigns a slot to each connection; it broadcasts player entities and
accepted block edits. A disconnected player's slot is not reused until its old
queued actions finish and the MCU acknowledges LEAVE. A third client is refused.
The world cache remains 32768 bytes, shared by both players.

Player movement uses Java 26.1's `sync_entity_position` packet, including position,
velocity, and float rotation fields. The dependency's legacy `entity_teleport`
layout is incompatible with the official client and must not be used. The wire
regression test decodes movement bytes independently of that library's decoder.

Run `npm run test-player` to join a movement-only client named MicroBot. It circles
above spawn, never edits blocks, and occupies one player slot. Stop a foreground
test player with Ctrl+C. It does not automatically reconnect after server shutdown.

## Build firmware

Build helpers use project-local tools under `.tools/`:

```powershell
python -m pip install --target .tools/python pyserial cmake
python -m pip install --target .tools/python --upgrade ninja
git clone https://github.com/lancaster-university/microbit-v2-samples.git .tools/codal
git -C .tools/codal checkout 04b7089d82af24534f3dcd460a9c343850b60b5d
python tools/get_compiler.py
python tools/build_firmware.py
npm ci --ignore-scripts
```

Copy `build/MICROCRAFT.hex` onto the MICROBIT drive to replace the board's current
program. Do not copy firmware onto a `MAINTENANCE` drive. The application C++ code
is in `firmware/main.cpp`; `host/link.py` owns the strict link protocol.

The build helper adds the missing 460800 case to the pinned CODAL NRF52 driver's
baud switch. This enables a real hardware rate selection instead of silently
using 115200 for that requested value; it does not make this board's USB link
pass the 460800-baud test.

CODAL's linker reports include a large reserved heap, so its RAM-region percentage
is not a measurement of live heap consumption. The application cache itself is
exactly 32 KiB; runtime stack/heap high-water marks have not yet been instrumented.

## References

- [micro:bit hardware](https://tech.microbit.org/hardware/)
- [DAPLink and USB serial limitations](https://tech.microbit.org/software/daplink-interface/)
- [CODAL C++ build sources](https://github.com/lancaster-university/microbit-v2-samples)
- [Minecraft protocol implementation](https://github.com/PrismarineJS/node-minecraft-protocol)

Next substantial milestone: replace the single active region with a bounded chunk
cache backed by PC world pages, then add more gameplay within measured RAM limits.

## Video outro

The `video/` folder contains procedural Blender scripts for a six-second outro
and original synthesized sound effects. See [video/README.md](video/README.md).
Rendering the house requires a local saved world; saves and rendered media are
excluded from this repository.
