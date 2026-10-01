# Microcraft

Experimental Minecraft Java **26.1 and 26.2** server with authoritative C++ game logic and
terrain generation on a **micro:bit v2**. The PC handles USB transport, Minecraft
network packets, version translation, and persistent storage. Geyser is not included.

The default firmware is now freestanding C++: no CODAL, SoftDevice, scheduler, or
application heap. It uses the nRF52833's 128 KiB address space, with an explicit
8 KiB stack reservation and hardware instruction cache enabled. USB still runs on
the board's separate DAPLink interface processor. See [the measured performance
and memory report](docs/performance.md); removing CODAL does not change the 64 MHz CPU clock.

## Server-list icon

Replace `server-icon.png` in the project folder with your own **64 x 64 PNG**
(under 64 KiB). After starting the updated bridge, refresh Minecraft's server list
to see changes; later icon replacements do not require a bridge restart. A missing
or incorrectly sized image falls back to the bundled Microcraft badge. Optionally
set `MICROCRAFT_ICON` to a different PNG path before launching the server.

The default logo combines a grass-topped circuit board with red M-shaped LEDs.
Its editable source is `assets/microcraft-icon.svg`; `tools/build_server_icon.py`
rebuilds the default PNG without overwriting an existing custom `server-icon.png`.

## World generation and paging

- The server fixes view distance at **2 chunks**: a 5 × 5 square per player.
  Environmental fog starts at 6 blocks and becomes opaque at 14 blocks. Vanilla
  needs neighboring chunks to render its outer sections, so the fog covers the
  inner rendered edge (as close as 16 blocks), not just the loaded-chunk boundary.
- Four players can explore independently. The micro:bit retains the union of their
  views, up to **100 chunk descriptors**. A chunk unloads only when no player
  needs it.
- Each chunk is 16 × 16 blocks and **128 blocks high**. Custom seeded hills,
  grass, dirt, stone, and coal ore are generated on the micro:bit. This is not
  vanilla Minecraft's generator; there are no trees, structures, or caves yet.
- The old 32 × 32 spawn area stays flat, with a gradual transition to hills.
  Horizontal coordinates range from -1,000,000 through 999,999, including negatives.
- Untouched terrain is **never saved to disk**. Once evicted, it is regenerated
  deterministically from the fixed world seed when needed again.
- Modified chunks are stored individually in `world/chunks-v1/<x>.<z>.json`.
  Files contain the chunk's sparse block edits, rather than a redundant full terrain
  array. Reloading streams those edits to the MCU, which reconstructs the chunk.
- Before eviction, the PC reads the MCU's edits and atomically saves a dirty chunk.
  Accepted changes also checkpoint **only affected chunks** immediately, protecting work
  from PC crashes while it remains loaded. Circuit and paired-block changes include
  their affected neighbors. A rejected or no-op edit creates no file.
- `world/chunks-v1/world.json` records the seed and generator version. Keep it with
  the chunk files. Generator version 1 must remain stable for regeneration.

The MCU world cache occupies **83,164 bytes**, using fixed arrays and no application
heap allocations. Its hash table supports **12,288 changed blocks across all active
chunks**. Baseline terrain consumes no edit entries. Returning a block to its
procedural value frees an entry. At capacity, new edits are rejected with an
in-game message; leaving modified chunks frees their entries after saving them.
If returning to an area requires more edits than RAM can hold, the bridge stops
with a capacity error and preserves the saved files. There is no unlimited-memory
fallback on the PC.

The PC keeps temporary copies of visible MCU-produced chunks to encode network
packets. It neither generates terrain nor authorizes edits. Overlapping player
views reuse these copies to avoid duplicate serial transfers.

## Existing worlds

On the first start, the bridge migrates the legacy `world/blocks.bin` into separate
modified-chunk files. The old file remains untouched as a backup. Its contents are
not reimported after the chunk world's metadata has been created. New edits live
in `world/chunks-v1/`, so back up that **entire directory** going forward.

## Setup and run

You need a micro:bit v2, a USB data cable, Node.js, Python 3, JDK 17 or newer,
and a Minecraft Java **26.1 or 26.2** client. Set `JAVA_HOME` if your JDK is not
on PATH. Development uses Windows, Node.js 24, Python 3.14, and JDK 26.

```powershell
npm.cmd ci --ignore-scripts
python -m pip install -r requirements.txt
npm.cmd run setup:versions
```

Version compatibility starts automatically with the bridge. It uses the pinned
[ViaProxy 3.4.12 release](https://github.com/ViaVersion/ViaProxy/releases/tag/v3.4.12)
on the PC to translate 26.2 clients to the bridge's 26.1 protocol. The setup command
verifies its SHA-256 and builds the included identity plugin. Both client versions
can play together; this does not add 26.2 blocks or mechanics to the micro:bit.
The proxy authenticates accounts in public mode and hands their profiles to a
protected loopback backend. Signed chat, skins, and skin overlays are preserved.
The configured port and playit tunnel still point to the public listener.

Set `MICROCRAFT_COMPAT=false` to run the original direct 26.1 listener without
Java. `node tools/probe_versions.js` exercises simultaneous clients through 26.1
and actual 26.2 wire translation against a fake MCU, including signed chat.

Build and flash the firmware below. Find the serial port in Device Manager; COM5
is the default. The MICROBIT drive is a flashing interface, not world storage.

1. Stop any existing bridge.
2. Reset the board and wait for **L** on its display.
3. Start from the project folder:

```powershell
$env:MICROCRAFT_PORT = 'COM5'
$env:MICROCRAFT_BAUD = '230400'
npm.cmd start
```

4. Wait for **10,000 exact packet echoes** and the listener-ready message. The gate
   takes about 65 seconds on the development board.
5. Connect to `localhost:25565`, or the server PC's LAN IP from another computer.
   A 25-chunk MCU generation/serial-transfer benchmark takes about **2.62 seconds**
   with revision-7 compression (see [measurements](docs/compression.md));
   login also includes PC encoding, version translation, and client rendering.
   Moving across a chunk boundary streams only the newly visible strip.

The server uses offline authentication for trusted LAN testing and supports four
creative players with distinct usernames. Set `MICROCRAFT_HOST=127.0.0.1` to listen
only locally. For authenticated external connections through playit.gg, use
`npm.cmd run start:playit` and follow [the playit setup guide](docs/playit.md).
Review the development addresses in `tools/enable-lan.ps1` before using it elsewhere.
Use `npm.cmd` in PowerShell to avoid its script execution policy blocking `npm.ps1`.

`MICROCRAFT_BAUD` accepts 115200, 230400, 460800, 921600, or 1000000. On this board,
230400 passes; higher tested rates fail the startup gate. There is no silent fallback.
Stop with Ctrl+C and reset the MCU before restarting. **S** means startup passed;
**X** means the link failed or the host stopped responding.

## Gameplay limits

Creative flight, block breaking and placement, immutable bedrock, per-player movement
bounds, and MCU reach validation are implemented. The original 254 placeable block
types are joined by 69 functional types, using 3,685 stable block states including air.

- Wooden and iron doors have paired halves, rotation, hinges, and powered states.
  Wooden doors and trapdoors toggle on right-click; iron versions require power.
- Wood and selected stone slabs support bottom, top, and double placement. Stairs
  rotate with the player, support upside-down placement, and form inner/outer corners.
- Levers mount on floors, walls, and ceilings. Dust carries power with attenuation,
  including one-block steps. Redstone blocks supply power; lamps and adjacent
  doors/trapdoors respond. Sneak to place against an interactive block.

All placement, interaction, stair shape, and power calculations run on the micro:bit.
The PC receives the resulting states, saves affected chunks, and updates viewers.
Circuits settle immediately after edits and chunk-view changes. This is a simplified
redstone model: no repeaters, comparators, pistons, delayed ticks, power through solid
blocks, or waterlogging. Fixtures need full-block support (double slabs also work).
Other directional blocks retain their default orientation. There are no mobs,
crafting, survival, falling blocks, fluid simulation, collision simulation, or dynamic lighting.
The client receives static full skylight. The 128-block build height is smaller than
vanilla's overworld; the network dimension still uses vanilla registry definitions.

`npm.cmd run test-player` joins a movement-only MicroBot which occupies the second
slot. It never edits blocks. Close it to free that slot for another client.

## Build firmware

Firmware revision **7** adds lossless column-copy/RLE compression for chunk streams
and compact saved-edit restores. It retains revision 6's bare-metal operation,
larger cache, and streaming without per-packet PC round trips. The bridge also
accepts revisions 5 and 6 with their previous wire formats; revision 5 has its old
3,072-edit limit. Existing chunk saves keep their IDs and need no conversion.
Returning to the smaller firmware can exceed its RAM limit if more edits are loaded.
The MCU compressor uses 520 bytes of static scratch RAM and preserves all block
states and saved builds. Minecraft clients already use standard zlib packet
compression, so no client mod is required. See [the protocol](docs/protocol.md)
for compression formats and bounds and [measured results](docs/compression.md).
The default build needs only the project-local ARM compiler and Python:

```powershell
python tools/get_compiler.py
node tools/build_states.js
python tools/build_firmware.py
```

Copy `build/MICROCRAFT.hex` onto the **MICROBIT** drive, not a MAINTENANCE drive.
The build emits an ELF, map, and `build/memory.json` beside the HEX. The linker
rejects static allocations that overlap the reserved stack. The launcher does not
reflash firmware or automatically reset the board.

For the optional CODAL reference build:

```powershell
python -m pip install --target .tools/python pyserial cmake ninja
git clone https://github.com/lancaster-university/microbit-v2-samples.git .tools/codal
git -C .tools/codal checkout 04b7089d82af24534f3dcd460a9c343850b60b5d
python tools/build_firmware.py --codal
```

This writes `build/MICROCRAFT-CODAL.hex` with the smaller cache. Add `--reference`
to disable terrain fast paths for baseline measurements. Neither build changes
DAPLink on the separate interface MCU.

## Verification

```powershell
npm.cmd test
node tools/probe_streaming.js  # offline test server, two free player slots; read-only
node tools/probe_versions.js   # isolated 26.1/26.2 translation test, no MCU needed
```

The suite covers startup corruption/drop failures, save migration, modified-only
persistence, save failure before eviction, four-player view unions, negative chunk
coordinates, chunk unload packets, movement bursts, and Java configuration tags.

Optional tests execute the production C++ cache as ARM machine code in Unicorn,
including wide-state cache eviction, atomic door placement, slab merging, stair
corners, lever/dust attenuation, and powered lamps/doors/trapdoors:

```powershell
python -m pip install --target .tools/emulator unicorn pyelftools
python -m unittest discover -s tests -p test_world_arm.py -v
```

With the server stopped and the board freshly reset, `python tools/probe_paging.py`
runs the 10,000-packet gate and real hardware tests in a **temporary copy** of the
old world: full migration readback, 100 slots, negative coordinates, independent
player reach, saving, eviction, and regeneration. Reset again before starting the
server. This probe defaults to COM5 and 230400 baud.

Registry tags are checked in for Java 26.1. `python tools/generate_tags.py` rebuilds
them from an installed 26.1 client JAR; pass a JAR path as its first argument when
needed. The tests do not replace visual checking in the official Minecraft client.

See [docs/protocol.md](docs/protocol.md) for serial operations. Local logs, saves,
compiled firmware, dependencies, and generated media are excluded from Git.
