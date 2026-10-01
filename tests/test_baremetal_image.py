"""Inspect the linked production image's boot vectors and physical memory bounds."""
from pathlib import Path
import struct
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/emulator'))
try:
    from elftools.elf.elffile import ELFFile
except ImportError:
    ELFFile=None

@unittest.skipUnless(ELFFile and (ROOT/'build/MICROCRAFT.elf').exists(),'Build bare-metal firmware and install pyelftools first')
class BareMetalImageTests(unittest.TestCase):
    def test_boot_vectors_stack_and_no_runtime_heap(self):
        with (ROOT/'build/MICROCRAFT.elf').open('rb') as source:
            elf=ELFFile(source)
            symbols={s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
            vector=struct.unpack('<64I',elf.get_section_by_name('.vectors').data())
            self.assertEqual(vector[0],0x20020000)
            self.assertEqual(vector[1],symbols['Reset_Handler']|1)
            self.assertEqual(vector[15],symbols['SysTick_Handler']|1)
            self.assertEqual(elf.get_section_by_name('.reset_config')['sh_addr'],0x10001200)
            self.assertEqual(struct.unpack('<II',elf.get_section_by_name('.reset_config').data()),(18,18))
            self.assertEqual(symbols['__stack_top']-symbols['__stack_limit'],8192)
            self.assertLess(symbols['__bss_end'],symbols['__stack_limit'])
            self.assertGreater(symbols['__bss_end']-0x20000000,81920)
            self.assertNotIn('malloc',symbols)
            self.assertFalse(any('codal' in s.lower() or 'softdevice' in s.lower() for s in symbols))
