# External connections through playit.gg

Run the playit agent on the same PC as Microcraft. In the playit dashboard, create
or edit a **Minecraft Java** TCP tunnel with these settings:

| Setting | Value |
| --- | --- |
| Local address | `127.0.0.1` |
| Local port | `25565` |
| Proxy Protocol | **None** |

Microcraft expects the normal Minecraft handshake. Do not enable HAProxy PROXY
headers: this bridge does not parse them. [playit's explanation](https://playit.gg/support/what-is-proxy-protocol/).
No router port-forward or additional inbound firewall rule is required for the
same-PC tunnel. The public playit address belongs in friends' Minecraft clients,
not in `MICROCRAFT_HOST` or the tunnel's local target.

Stop an existing bridge, reset the micro:bit, wait for **L**, then run:

```powershell
$env:MICROCRAFT_BAUD = '230400'
npm.cmd run start:playit
```

After the 10,000-packet gate passes, the bridge listens on `127.0.0.1:25565` with
Minecraft account verification enabled. Friends use the tunnel's public address
in **Minecraft Java 26.1 or 26.2**. On this PC, use `localhost:25565`. Initial terrain
streaming still takes about 14 seconds. The tunnel does not change MCU gameplay,
the four-player limit, RAM capacity, world saves, or the startup gate.

The agent must stay online while players connect. The public port can differ from
the local port; use exactly the address/port playit provides. Java tunnel hostnames
may use DNS SRV records, allowing players to omit an explicit port.

## Optional settings

- `MICROCRAFT_LISTEN_PORT`: local listener port, default `25565`. Match it in playit.
- `MICROCRAFT_HOST`: local bind address. Playit mode defaults to `127.0.0.1`.
  Set `0.0.0.0` if direct LAN connections are also needed.
- `MICROCRAFT_NETWORK=playit`: enables the same defaults with `npm.cmd start`.
- `MICROCRAFT_ONLINE_MODE=true|false`: explicit authentication override. Public
  mode defaults to `true`; players need valid Minecraft Java accounts. Offline
  MicroBot probes are intended for LAN/test mode, not the authenticated endpoint.

Ordinary `npm.cmd start` preserves the existing LAN/offline defaults. Environment
overrides persist in the PowerShell session, so remove an old override before
expecting the profile default to apply.

## Checking the tunnel

```powershell
node tools/check_endpoint.js YOUR-PLAYIT-HOSTNAME
# Or, when playit gives an explicit port:
node tools/check_endpoint.js YOUR-PLAYIT-HOSTNAME 12345
```

This checks Minecraft status without occupying either player slot. If local status
works but the public address fails, check the playit agent is online and that the
tunnel targets the exact local address/port above with Proxy Protocol disabled.
Authentication and actual gameplay still require a signed-in Minecraft client.

Run `npm.cmd run setup:versions` once with JDK 17+ installed. The bridge launches
ViaProxy automatically on the configured public port and binds its internal
26.1 backend to a random loopback port. Profiles are handed off with a temporary
secret and matched to the backend connection before login. The internal listener
rejects connections that did not complete this handoff. Keep the playit tunnel
target at `127.0.0.1:25565`; no dashboard changes are needed.

## Chat and skins

Authenticated mode forwards Mojang's signed skin properties and validates player
chat certificates, message signatures, and acknowledgement history. Player chat
is relayed unchanged using Java 26.1 signed chat packets. Reconnect after updating
the bridge to receive the new profile and secure-chat configuration. If Minecraft
reports an expired chat key, restart the game to refresh its account certificate.

Offline LAN/test mode has no authenticated skin profile and uses system messages
for unsigned chat; it does not advertise secure chat. Slash commands are not
implemented. Authentication and chat processing run on the PC and do not consume
the micro:bit's chunk memory.
