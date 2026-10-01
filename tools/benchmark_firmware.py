"""Read-only world benchmark on a freshly reset board; never opens the real save."""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'host'),str(ROOT/'.tools/python')]
import serial
from link import Link
from chunks import ChunkStore, Pager

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',default='COM5')
    parser.add_argument('--baud',type=int,default=230400)
    parser.add_argument('--output',required=True)
    parser.add_argument('--reset',action='store_true')
    parser.add_argument('--polled',action='store_true',help='Use revision-5 chunk round trips for a baseline')
    parser.add_argument('--capacity-test',action='store_true',help='Fill and reload the advertised edit limit in the temporary world')
    parser.add_argument('--legacy-compression',action='store_true',help='Use legacy RLE even on revision-7 firmware')
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='microcraft-bench-') as directory:
        with serial.Serial(args.port,115200,timeout=.02,write_timeout=1) as port:
            link=Link(port)
            gate=link.boot(args.baud,lambda n:print(f'Gate: {n}/10000',flush=True))
            cap=struct.unpack('<12I',link.command(4))
            compression=cap[11] if cap[2]>=7 and not args.legacy_compression and not args.polled else 0
            pager=Pager(link,ChunkStore(directory),cap[8] if cap[2]>=6 else 4096,cap[2]>=6 and not args.polled,compression)
            start=time.perf_counter(); pager.view(0,(0,0)); view_ms=(time.perf_counter()-start)*1000
            results=[]
            for key in [(0,0),(-2,-2),(2,2)]:
                slot=pager.loaded[key]['slot']
                cycles,checksum=struct.unpack_from('<II',link.command(29,bytes([slot]))) if cap[2]>=6 else (0,0)
                start=time.perf_counter(); chunk=pager.read(key); elapsed=(time.perf_counter()-start)*1000
                calculated=0
                for (v,) in struct.iter_unpack('<H',chunk): calculated=(calculated*33+v)&0xffffffff
                if cycles: assert calculated==checksum, 'CPU generation and streamed chunk differ'
                results.append({'chunk':key,'generation_ms':cycles/64000 if cycles else None,
                                'stream_ms':elapsed,'sha256':hashlib.sha256(chunk).hexdigest(),
                                'compression':getattr(link,'last_chunk_stats',None)})
                print(results[-1],flush=True)
            start=time.perf_counter()
            for key in pager.loaded: pager.read(key)
            all_ms=(time.perf_counter()-start)*1000
            if args.capacity_test:
                groups={g['name']:g['start'] for g in json.loads((ROOT/'host/data/states.json').read_text())['groups']}
                def actor(body=b''): return body.ljust(48,b'\0')
                assert link.command(9,actor())[12]
                assert link.command(8,actor(struct.pack('<iii',3*32,10*32,3*32)))[12]
                def edit(x,y,z,item,action=1):
                    p=struct.pack('<iiiHBBBBBBB',x,y,z,item,action,1,0,255,128,128,0)
                    result=link.command(5,actor(p)); assert result[13], result.hex()
                    pager.checkpoint_edit(result)
                edit(3,7,3,groups['lever']); edit(4,7,3,groups['redstone_wire'])
                edit(5,7,3,groups['redstone_lamp']); edit(4,7,4,groups['iron_door'])
                edit(3,8,3,65535)
                chunk=pager.read((0,0))
                def block(x,y,z): return struct.unpack_from('<H',chunk,((z*16+x)*128+y)*2)[0]
                assert block(5,8,3)==groups['redstone_lamp']+1
                assert (block(4,8,3)-groups['redstone_wire'])%16==15
                assert (block(4,8,4)-groups['iron_door'])&36==36
                for x,z in [(3,3),(4,3),(5,3),(4,4)]: edit(x,8,z,0,2)
                assert not pager.snapshot(pager.loaded[(0,0)]['slot'])[0]
                assert link.command(10,actor())[12]
                print('Gameplay PASS: lever, dust, lamp and paired powered iron door on the real MCU',flush=True)
                slot=pager.loaded[(0,0)]['slot']; limit=cap[7]
                pairs=[(i,3000+i%50) for i in range(1,32768) if i%128][:limit]
                for offset in range(0,len(pairs),11):
                    batch=pairs[offset:offset+11]
                    assert link.command(14,bytes([slot,len(batch)])+b''.join(struct.pack('<HH',*p) for p in batch))[0]
                assert not link.command(14,bytes([slot,1])+struct.pack('<HH',32767,3000))[0], 'Over-capacity load accepted'
                snapshot,_=pager.snapshot(slot); assert snapshot==dict(pairs)
                pager.store.save((0,0),snapshot)
                pager.view(0,(20,20)); pager.view(0,(0,0))
                snapshot,_=pager.snapshot(pager.loaded[(0,0)]['slot']); assert snapshot==dict(pairs)
                print(f'Capacity PASS: {limit} wide-state edits survive unload and disk reload',flush=True)
            cap_end=struct.unpack('<12I',link.command(4))
            pager.close()
            report={'gate':gate,'capability':cap,'streaming':pager.streaming,'compression':compression,'stack_used':cap_end[9],
                    'capacity_test':args.capacity_test,
                    'descriptor_load_ms':view_ms,'full_25_chunk_stream_ms':all_ms,'samples':results}
            Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2),flush=True)
            if args.reset: link.command(30)
if __name__=='__main__': main()
