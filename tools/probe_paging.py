"""Hardware paging test in a temporary PC world; reset board before and after."""
from pathlib import Path
import json
import shutil
import struct
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'host'), str(ROOT/'.tools/python')]
import serial
from link import Link
from chunks import ChunkStore, Pager


def actor_data(actor, body=b''):
    return body.ljust(47, b'\0') + bytes([actor])


def main():
    with tempfile.TemporaryDirectory(prefix='microcraft-paging-') as temp:
        root = Path(temp)
        if (ROOT/'world/blocks.bin').exists():
            shutil.copyfile(ROOT/'world/blocks.bin', root/'blocks.bin')
        with serial.Serial('COM5', 115200, timeout=.05, write_timeout=1) as port:
            link = Link(port)
            print(link.boot(230400, lambda n: print(f'Gate: {n}/10000', flush=True)), flush=True)
            cap = struct.unpack('<12I', link.command(4))
            assert cap[2] in (5,6,7) and cap[3:6] == (4,128,100), cap
            print('Application cache bytes:', cap[0], 'edit limit:', cap[7], flush=True)
            pager = Pager(link, ChunkStore(root),cap[8] if cap[2]>=6 else 4096,cap[2]>=6,cap[11] if cap[2]>=7 else 0)
            for actor in range(4): assert link.command(9, actor_data(actor))[12]
            start = time.monotonic(); pager.view(0, (1, 1))
            for key in pager.loaded: pager.read(key)
            print('25 complete chunks streamed in', round(time.monotonic()-start, 3), 'seconds', flush=True)
            if (root/'blocks.bin').exists():
                old = (root/'blocks.bin').read_bytes()
                for cz in range(2):
                    for cx in range(2):
                        chunk = pager.read((cx, cz))
                        for z in range(16):
                            for x in range(16):
                                for y in range(32):
                                    assert struct.unpack_from('<H', chunk, ((z*16+x)*128+y)*2)[0] == old[(y*32+cz*16+z)*32+cx*16+x]
                print('Existing house: every legacy block matches MCU output', flush=True)
            pager.view(1, (20, 20)); assert len(pager.loaded) == 50
            pager.view(2, (40, 40)); pager.view(3, (60, 60))
            assert len(pager.loaded) == 100
            for actor in (2, 3):
                pager.view(actor)
                assert link.command(10, actor_data(actor))[12]
            pager.view(0, (-1, -1)); assert len(pager.loaded) == 50
            original = pager.read((-1, -1))
            assert link.command(8, actor_data(0, struct.pack('<iii', -32, 60*32, -32)))[12]
            edit = struct.pack('<iiiH', -1, 60, -1, 65)
            assert not link.command(5, actor_data(1, edit))[13], 'Other player must not borrow reach'
            result = link.command(5, actor_data(0, edit)); assert result[13]
            pager.checkpoint_edit(result)
            target = (15*16+15)*128+60
            assert struct.unpack_from('<H', pager.read((-1, -1)), target*2)[0] == 65
            pager.view(0, (10, 10))
            assert ChunkStore(root).load((-1, -1)) == {target: 65}
            assert not (root/'chunks-v1/-2.-2.json').exists(), 'Untouched chunks must not be saved'
            pager.view(0, (-1, -1))
            assert struct.unpack_from('<H', pager.read((-1, -1)), target*2)[0] == 65
            result = link.command(5, actor_data(0, struct.pack('<iiiH', -1, 60, -1, 0)))
            assert result[13]; pager.checkpoint_edit(result)
            assert pager.read((-1, -1)) == original
            pager.close()
            print('PASS: 100 slots, four players, negative coordinates, independent reach, modified unload/reload, regeneration, baseline restoration', flush=True)


if __name__ == '__main__': main()
