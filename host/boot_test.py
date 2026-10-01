"""Run with: python host/boot_test.py --port COM5 --baud 1000000."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.tools/python'))
import serial
from link import Link


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='COM5')
    parser.add_argument('--baud', type=int, choices=[115200, 230400, 460800, 921600, 1000000], default=1000000)
    parser.add_argument('--hold', action='store_true', help='Keep the firmware alive after the test')
    parser.add_argument('--host-baud', type=int, help='Experimental USB interface rate; MCU still uses --baud')
    args = parser.parse_args()
    print('Reset the micro:bit before each run. No retries or automatic baud fallback.', flush=True)
    try:
        with serial.Serial(args.port, 115200, timeout=0.05, write_timeout=1,
                           xonxoff=False, rtscts=False, dsrdtr=False) as port:
            link = Link(port)
            result = link.boot(args.baud, lambda n: print(f'{n}/10000 exact echoes', flush=True), host_baud=args.host_baud)
            ram = int.from_bytes(link.command(4)[:4], 'little')
            result['world_ram_bytes'] = ram
            result['status'] = 'PASS'
            print(json.dumps(result, indent=2), flush=True)
            Path('logs').mkdir(exist_ok=True)
            Path('logs/last-boot-test.json').write_text(json.dumps(result, indent=2))
            if args.hold:
                while True:
                    link.command(4)
                    time.sleep(0.25)
            else:
                print('Test complete; firmware will halt after its 2-second host watchdog expires.')
    except (OSError, RuntimeError) as exc:
        print(f'BOOT FAILED: {exc}. Server startup prohibited.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
