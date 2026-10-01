"""Execute the production C++ cache as ARM machine code, without a connected board."""
from pathlib import Path
import subprocess
import sys
import unittest
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
STATES = json.loads((ROOT/'host/data/states.json').read_text())
STATE_COUNT = len(STATES['states'])
GROUPS = {g['name']: g['start'] for g in STATES['groups']}
sys.path.insert(0, str(ROOT / '.tools/emulator'))
try:
    from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
    from unicorn.arm_const import UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3
    from elftools.elf.elffile import ELFFile
except ImportError:
    Uc = None
COMPILER = ROOT / '.tools/xpack-arm-none-eabi-gcc-15.2.1-1.1/bin/arm-none-eabi-g++.exe'


@unittest.skipUnless(Uc and COMPILER.exists(), 'Optional ARM tests require project compiler, unicorn and pyelftools')
class ARMWorldTests(unittest.TestCase):
    capacity = 4096
    @classmethod
    def setUpClass(cls):
        target = ROOT / f'build/world-test-{cls.capacity}.elf'
        target.parent.mkdir(exist_ok=True)
        subprocess.run([str(COMPILER), '-mcpu=cortex-m4', '-mthumb', '-Os', '-nostdlib',
                        '-fno-builtin', '-fno-exceptions', '-fno-rtti', f'-DMICROCRAFT_CACHE_CAPACITY={cls.capacity}', '-Wl,-Ttext=0x100000',
                        '-Wl,-Tdata=0x20000000', '-Wl,--entry=init_world',
                        str(ROOT / 'tests/world_harness.cpp'), '-o', str(target)], check=True)
        cls.elf = target

    def setUp(self):
        self.cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        self.cpu.mem_map(0x100000, 0x10000)
        self.cpu.mem_map(0x20000000, 0x20000)
        with self.elf.open('rb') as f:
            elf = ELFFile(f)
            for seg in elf.iter_segments():
                if seg['p_type'] == 'PT_LOAD' and seg['p_filesz']:
                    # Linker headers may precede the text page; ignore non-executable header segment.
                    address = seg['p_vaddr']
                    if address < 0x100000:
                        data = seg.data()[0x100000-address:]
                        if data: self.cpu.mem_write(0x100000, data)
                    else:
                        self.cpu.mem_write(address, seg.data())
            self.symbols = {s.name: s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
        self.call('init_world')

    def call(self, name, *args):
        self.cpu.reg_write(UC_ARM_REG_SP, 0x2001fff0)
        self.cpu.reg_write(UC_ARM_REG_LR, 0x10fff1)
        for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), args):
            self.cpu.reg_write(reg, value & 0xffffffff)
        self.cpu.emu_start(self.symbols[name] | 1, 0x10fff0, count=20000000)
        self.assertEqual(self.cpu.reg_read(UC_ARM_REG_PC), 0x10fff0, 'ARM function exceeded instruction limit')
        return self.cpu.reg_read(UC_ARM_REG_R0)

    def test_wide_states_survive_hash_deletion_and_slot_unload(self):
        for slot in (0, 1, 99):
            self.call('load_chunk', slot, slot, 0)
            for i in range(100): self.call('set_block', slot, i+32, 255+i*31)
        self.call('unload_chunk', 1)
        for slot in (0, 99):
            for i in range(100): self.assertEqual(self.call('get_block', slot, i+32), 255+i*31)

    def test_doors_pair_interact_break_and_support(self):
        self.call('load_chunk', 0, 0, 0); self.call('options', 1, 0, 128, 0)
        door = GROUPS['oak_door']
        self.assertEqual(self.call('place', 3, 7, 3, door), 1)
        lower = self.call('at', 3, 8, 3)
        self.assertEqual((lower-door)&3, 2)
        self.assertEqual(self.call('at', 3, 9, 3), lower+8)
        self.assertEqual(self.call('place', 3, 9, 3, 65535), 1)
        self.assertEqual(self.call('at', 3, 8, 3), door+((lower-door)^4))
        self.call('remove_block', 3, 9, 3)
        self.assertEqual(self.call('at', 3, 8, 3), 0)
        self.assertEqual(self.call('at', 3, 9, 3), 0)
        self.call('place', 3, 7, 3, door)
        self.call('remove_block', 3, 7, 3)
        self.assertEqual(self.call('at', 3, 8, 3), 0)
        self.assertEqual(self.call('at', 3, 9, 3), 0)
        iron = GROUPS['iron_door']
        self.call('place', 5, 7, 5, iron)
        before = self.call('at', 5, 8, 5)
        self.assertNotEqual(self.call('place', 5, 8, 5, 65535), 1)
        self.assertEqual(self.call('at', 5, 8, 5), before)

    def test_slab_merge_top_and_stair_corners(self):
        self.call('load_chunk', 0, 0, 0); self.call('options', 1, 0, 128, 0)
        slab = GROUPS['oak_slab']; stair = GROUPS['stone_stairs']
        self.call('place', 3, 7, 3, slab)
        self.assertEqual(self.call('at', 3, 8, 3), slab)
        self.call('place', 3, 8, 3, slab)
        self.assertEqual(self.call('at', 3, 8, 3), slab+2)
        self.call('put', 5, 10, 5, 4); self.call('options', 0, 64, 128, 0)
        self.call('place', 5, 10, 5, slab)
        self.assertEqual(self.call('at', 5, 9, 5), slab+1)
        self.call('place', 5, 10, 5, stair)  # occupied slab refuses overwrite
        self.assertEqual(self.call('at', 5, 9, 5), slab+1)
        self.call('options', 1, 0, 128, 0); self.call('place', 8, 7, 8, stair)
        self.assertEqual(self.call('at', 8, 8, 8), stair+2)
        self.call('options', 1, 64, 128, 0); self.call('place', 8, 7, 9, stair)
        self.assertEqual(self.call('at', 8, 8, 8), stair+2+4*8)
        self.call('remove_block', 8, 8, 9)
        self.assertEqual(self.call('at', 8, 8, 8), stair+2)

    def test_circuit_attenuation_lamp_iron_door_trapdoor_and_source_removal(self):
        self.call('load_chunk', 0, 0, 0)
        lever=GROUPS['lever']; wire=GROUPS['redstone_wire']; lamp=GROUPS['redstone_lamp']
        door=GROUPS['iron_door']; trap=GROUPS['iron_trapdoor']
        self.call('put', 2, 8, 3, lever)
        for x in range(3, 10): self.call('put', x, 8, 3, wire)
        self.call('put', 10, 8, 3, lamp)
        self.call('put', 9, 8, 4, door); self.call('put', 9, 9, 4, door+8)
        self.call('put', 8, 8, 4, trap)
        self.call('options', 1, 0, 128, 0)
        self.assertEqual(self.call('place', 2, 8, 3, 65535), 1)
        for x in range(3, 10): self.assertEqual((self.call('at', x, 8, 3)-wire)%16, 18-x)
        self.assertEqual(self.call('at', 10, 8, 3), lamp+1)
        self.assertEqual(self.call('at', 9, 8, 4), door+36)
        self.assertEqual(self.call('at', 9, 9, 4), door+44)
        self.assertEqual(self.call('at', 8, 8, 4), trap+20)
        self.call('place', 2, 8, 3, 65535)
        for x in range(3, 10): self.assertEqual((self.call('at', x, 8, 3)-wire)%16, 0)
        self.assertEqual(self.call('at', 10, 8, 3), lamp)
        self.assertEqual(self.call('at', 9, 8, 4), door)
        self.assertEqual(self.call('at', 8, 8, 4), trap)

    def test_door_capacity_failure_is_atomic(self):
        self.call('load_chunk', 0, 0, 0)
        for i in range(self.capacity*3//4-1): self.call('set_block', 0, i+16384, 65)
        self.call('options', 1, 0, 128, 0)
        self.assertEqual(self.call('place', 3, 7, 3, GROUPS['oak_door']), 3)
        self.assertEqual(self.call('at', 3, 8, 3), 0)
        self.assertEqual(self.call('at', 3, 9, 3), 0)

    def test_all_100_chunk_slots_keep_independent_edits(self):
        for slot in range(100):
            self.call('load_chunk', slot, slot * 16, 0)
            self.assertEqual(self.call('set_block', slot, 12, 65), 1)
        self.assertEqual(self.call('used_edits'), 100)
        for slot in range(100):
            self.assertEqual(self.call('get_block', slot, 12), 65)

    def test_determinism_negatives_and_legacy_spawn(self):
        self.assertEqual(self.call('divide', -1, 16), 0xffffffff)
        self.assertEqual(self.call('divide', -16, 16), 0xffffffff)
        self.assertEqual(self.call('divide', -17, 16), 0xfffffffe)
        self.call('load_chunk', 0, 0, 0)
        for y in range(128):
            self.assertEqual(self.call('get_block', 0, y), 1 if y == 0 else 2 if y < 7 else 3 if y == 7 else 0)
        self.call('load_chunk', 1, -70, 90)
        first = [self.call('get_block', 1, y) for y in range(128)]
        self.call('unload_chunk', 1)
        self.call('load_chunk', 1, -70, 90)
        self.assertEqual(first, [self.call('get_block', 1, y) for y in range(128)])
        self.assertIn(4, first)
        self.assertLess(self.call('world_size'), self.capacity*5+2048)

    def test_edit_eviction_isolation_and_capacity(self):
        for s in range(50): self.call('load_chunk', s, s, -s)
        self.assertEqual(self.call('set_block', 0, 12, 65), 1)
        self.assertEqual(self.call('get_block', 0, 12), 65)
        self.assertNotEqual(self.call('get_block', 1, 12), 65)
        self.call('unload_chunk', 0)
        self.assertEqual(self.call('used_edits'), 0)

        self.call('load_chunk', 0, 0, 0)
        limit = self.capacity*3//4
        for i in range(limit): self.assertEqual(self.call('set_block', 0, i, 65), 1)
        self.assertEqual(self.call('set_block', 0, limit+1, 65), 0)
        self.assertEqual(self.call('used_edits'), limit)
        self.assertEqual(self.call('set_block', 0, 12, 0), 1)
        self.assertEqual(self.call('set_block', 0, limit+1, 65), 1)
        self.call('unload_chunk', 0)
        self.assertEqual(self.call('used_edits'), 0)

    def test_repeated_eviction_keeps_other_chunk_edits(self):
        self.call('load_chunk', 0, 0, 0)
        self.call('load_chunk', 1, 1, 0)
        for i in range(200): self.call('set_block', 1, i+64, 65)
        for cycle in range(30):
            self.call('load_chunk', 0, cycle, cycle)
            for i in range(200): self.call('set_block', 0, i+32, 65)
            self.call('unload_chunk', 0)
            self.assertEqual(self.call('used_edits'), 200)
            for i in range(200): self.assertEqual(self.call('get_block', 1, i+64), 65)

    def test_cpp_compressed_chunks_decode_exactly_in_python(self):
        sys.path.insert(0,str(ROOT/'host'))
        from serial_codec import decode_chunk_frame
        for x,z in [(0,0),(-2,-2),(2,2)]:
            self.call('load_chunk',0,x,z)
            if x==0:
                for index,state in [(8,3684),(9,255),(10,256),(128+8,3065)]:
                    self.call('set_block',0,index,state)
            self.call('codec_begin',0,0)
            result=bytearray(); frames=0
            while len(result)<65536:
                cursor=self.call('codec_next'); frames+=1
                payload=bytes(self.cpu.mem_read(self.symbols['codecPacket'],48))
                self.assertEqual(decode_chunk_frame(payload,result,STATE_COUNT),cursor)
                self.assertLess(frames,4000)
            checksum=0
            for (state,) in struct.iter_unpack('<H',result): checksum=(checksum*33+state)&0xffffffff
            self.assertEqual(checksum,self.call('chunk_checksum',0))
            if x==0:
                self.assertLess(frames,10,'Flat repeated columns should collapse to a few frames')
                self.assertEqual(struct.unpack_from('<H',result,128*2+16)[0],3065)
            self.call('unload_chunk',0)
        # Worst-case literals, wide IDs, long runs and alternating repeated columns.
        for kind in (1,2,3):
            self.call('codec_begin',0,kind); result=bytearray()
            while len(result)<65536:
                self.call('codec_next')
                decode_chunk_frame(bytes(self.cpu.mem_read(self.symbols['codecPacket'],48)),result,STATE_COUNT)
            expected=[]
            for i in range(32768):
                v=(i*2654435761)&0xffffffff; v^=v>>13
                expected.append(3065 if kind==1 else (3684 if i%2 else 255) if kind==2 else v%STATE_COUNT)
            self.assertEqual(result,struct.pack('<32768H',*expected))

    def test_pc_compressed_edits_decode_in_cpp_before_application(self):
        sys.path.insert(0,str(ROOT/'host'))
        from serial_codec import encode_edits
        self.call('load_chunk',0,0,0)
        pairs=[(i,255+(i*31)%3000) for i in range(1,300) if i%128]
        pairs += [(32767,3684)]
        payloads=list(encode_edits(0,pairs,STATE_COUNT))
        self.assertLess(len(payloads),(len(pairs)+10)//11)
        for payload in payloads:
            self.cpu.mem_write(self.symbols['codecPacket'],payload.ljust(48,b'\0'))
            self.assertEqual(self.call('decode_edit_test'),1)
        for index,state in pairs: self.assertEqual(self.call('get_block',0,index),state)
        for malformed in [bytes([0,1,2,0,0]),bytes([0,1,3,128,0,4]),bytes([0,1,4,255,255,3,4]),
                          bytes([0,2,4,30,4,0,255]),bytes([0,1,2,30,4])+b'\1']:
            self.cpu.mem_write(self.symbols['codecPacket'],malformed.ljust(48,b'\0'))
            self.assertEqual(self.call('decode_edit_test'),0)


class BareMetalWorldTests(ARMWorldTests):
    capacity = 16384
