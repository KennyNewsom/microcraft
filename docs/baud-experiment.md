# Interface baud experiment

Hardware test on 2026-09-15, bare-metal revision 6 and DAPLink 0255.
Each run began with a debug reset, without reflashing. The startup handshake
used 115200 baud. The target then selected its 460800 UART register setting
(Nordic documents a nominal actual rate of 457143).

| Target setting | Requested USB interface baud | Exact-echo result |
| --- | --- | --- |
| 460800 | 457143 | Failed at sequence 1: received 7/64 bytes |
| 460800 | 460800 | Failed at sequence 1: received 7/64 bytes |

The custom rate was accepted by the serial API, but this does not measure the
interface chip's physical UART rate. These runs do not establish whether it
rounded the request, or whether framing, buffering, or another issue caused
the failure. They do not demonstrate stability at either higher setting.

Reproduce on an idle, freshly reset board:

```powershell
python host/boot_test.py --port COM5 --baud 460800 --host-baud 457143
# Reset before the separate control run:
python host/boot_test.py --port COM5 --baud 460800
```

The override is only exposed by the diagnostic tool. Production remains at
230400 baud; the 10000-packet gate and failure behavior are unchanged.
