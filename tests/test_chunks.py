import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'host'))
from chunks import ChunkStore, Pager


class Link:
    def __init__(self, buckets=4096):
        self.buckets = buckets
        self.slots = {}
        self.loads = []

    def command(self, op, data=b''):
        out = bytearray(48)
        if op == 12:
            slot, x, z = struct.unpack('<Bii', data)
            self.slots[slot] = {'key': (x, z), 'edits': {}, 'dirty': False}
            self.loads.append((x, z))
        if op == 14:
            for i in range(data[1]):
                index, value = struct.unpack_from('<HH', data, 2+4*i)
                self.slots[data[0]]['edits'][index] = value
            out[0] = 1
        if op == 17:
            slot, cursor = struct.unpack('<BH', data)
            entry = self.slots[slot]
            pairs = list(entry['edits'].items())
            batch = pairs[cursor:cursor+11]
            struct.pack_into('<HBB', out, 0, cursor+11 if cursor+11 < len(pairs) else self.buckets, len(batch), entry['dirty'])
            for i, pair in enumerate(batch): struct.pack_into('<HH', out, 4+4*i, *pair)
        if op == 16: self.slots[data[0]]['dirty'] = False
        if op == 15:
            assert not self.slots[data[0]]['dirty']
            del self.slots[data[0]]
        return bytes(out)


class ChunkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_unmodified_discard_modified_reload_and_restart(self):
        store = ChunkStore(self.root); link = Link(); pager = Pager(link, store)
        pager.view(0, (0, 0))
        self.assertEqual(len(pager.loaded), 25)
        target = pager.loaded[(0, 0)]['slot']
        link.slots[target]['edits'][12] = 65
        link.slots[target]['dirty'] = True
        pager.view(0, (10, -10))
        files = list((self.root/'chunks-v1').glob('*.json'))
        self.assertEqual(sorted(p.name for p in files), ['0.0.json', 'world.json'])
        pager.view(0, (0, 0))
        self.assertEqual(link.slots[pager.loaded[(0, 0)]['slot']]['edits'], {12: 65})
        self.assertEqual(link.loads.count((1, 1)), 2)
        self.assertEqual(ChunkStore(self.root).load((0, 0)), {12: 65})

    def test_wide_states_reload_and_rle_stream_without_truncation(self):
        store = ChunkStore(self.root)
        saved = {10+i: 255+i*101 for i in range(20)}
        store.save((0, 0), saved)
        link = Link(); pager = Pager(link, store); pager.view(0, (0, 0))
        slot = pager.loaded[(0, 0)]['slot']
        self.assertEqual(link.slots[slot]['edits'], saved)
        original = link.command
        values = [255, 256, 3065, 3684]
        def stream(op, data=b''):
            if op != 13: return original(op, data)
            cursor = struct.unpack_from('<H', data, 1)[0]
            length = min(255, 32768-cursor)
            out = bytearray(48)
            struct.pack_into('<HBBH', out, 0, cursor+length, 1, length, values[cursor//255%4])
            return out
        link.command = stream
        read = pager.read((0, 0))
        self.assertEqual(len(read), 65536)
        for i in (0, 254, 255, 510, 765, 32767):
            self.assertEqual(struct.unpack_from('<H', read, i*2)[0], values[i//255%4])

    def test_union_of_two_views_and_disconnect(self):
        pager = Pager(Link(), ChunkStore(self.root))
        pager.view(0, (0, 0)); pager.view(1, (0, 0))
        self.assertEqual(len(pager.loaded), 25)
        slot = pager.loaded[(0, 0)]['slot']
        pager.view(0, (20, 20))
        self.assertEqual(len(pager.loaded), 50)
        self.assertEqual(pager.loaded[(0, 0)]['slot'], slot)
        pager.view(1)
        self.assertEqual(len(pager.loaded), 25)
        self.assertNotIn((0, 0), pager.loaded)
        pager.view(0)
        self.assertFalse(pager.loaded)

    def test_four_disjoint_views_and_shared_disconnect(self):
        pager = Pager(Link(), ChunkStore(self.root))
        for actor in range(4):
            pager.view(actor, (actor * 20, 0))
        self.assertEqual(len(pager.loaded), 100)
        self.assertEqual(len({v['slot'] for v in pager.loaded.values()}), 100)
        pager.view(3, (0, 0))
        self.assertEqual(len(pager.loaded), 75)
        pager.view(0)
        self.assertIn((0, 0), pager.loaded)
        pager.view(3)
        self.assertEqual(len(pager.loaded), 50)
        with self.assertRaises(ValueError): pager.view(4, (0, 0))

    def test_large_cache_snapshot_uses_advertised_cursor_limit(self):
        link=Link(16384); store=ChunkStore(self.root); pager=Pager(link,store,16384)
        pager.view(0,(0,0)); slot=pager.loaded[(0,0)]['slot']
        expected={i:3000+i%50 for i in range(1,5200) if i%128}
        link.slots[slot]['edits']=expected; link.slots[slot]['dirty']=True
        pager.evict((0,0))
        self.assertEqual(store.load((0,0)),expected)
        with self.assertRaises(ValueError): Pager(Link(),store,8193)

    def test_save_failure_prevents_eviction(self):
        pager = Pager(Link(), ChunkStore(self.root)); pager.view(0, (0, 0))
        slot = pager.loaded[(0, 0)]['slot']; pager.link.slots[slot]['dirty'] = True
        with patch.object(pager.store, 'save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError): pager.evict((0, 0))
        self.assertIn((0, 0), pager.loaded)
        self.assertTrue(pager.link.slots[slot]['dirty'])

    def test_checkpoint_only_changed_chunk_and_noop_creates_nothing(self):
        store = ChunkStore(self.root); pager = Pager(Link(), store); pager.view(0, (-1, -1))
        reply = bytearray(48)
        struct.pack_into('<iiiB', reply, 0, -1, 60, -1, 65)
        reply[13] = 1
        pager.checkpoint_edit(reply)
        self.assertIsNone(store.load((-1, -1)))
        reply[14] = 65; reply[17] = 1
        slot = pager.loaded[(-1, -1)]['slot']
        reply[20 + slot // 8] = 1 << (slot % 8)
        pager.link.slots[slot]['edits'][32700] = 3065
        pager.link.slots[slot]['dirty'] = True
        pager.checkpoint_edit(reply)
        self.assertEqual(store.load((-1, -1)), {(15*16+15)*128+60: 3065})
        self.assertIsNone(store.load((-2, -2)))
        reply[14] = 0; reply[15] = 1
        pager.link.slots[slot]['edits'].clear()
        pager.link.slots[slot]['dirty'] = True
        pager.checkpoint_edit(reply)
        self.assertEqual(store.load((-1, -1)), {})

    def test_legacy_house_migration_preserves_original(self):
        data = bytearray(32768)
        for i in range(len(data)):
            y = i//1024; data[i] = 1 if y == 0 else 2 if y < 7 else 3 if y == 7 else 0
        data[(12*32+18)*32+17] = 65
        old = self.root/'blocks.bin'; old.write_bytes(data)
        store = ChunkStore(self.root)
        self.assertEqual(store.load((1, 1)), {(2*16+1)*128+12: 65})
        self.assertIsNone(store.load((0, 0)))
        self.assertEqual(old.read_bytes(), data)
        store.save((1, 1), {55: 5})
        self.assertEqual(ChunkStore(self.root).load((1, 1)), {55: 5})

    def test_invalid_legacy_or_chunk_refused(self):
        (self.root/'blocks.bin').write_bytes(b'bad')
        with self.assertRaises(ValueError): ChunkStore(self.root)
        self.assertFalse((self.root/'chunks-v1/world.json').exists())
