import struct
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'host'))
from serial_codec import decode_chunk_frame, encode_edits
from link import Link, frame


def packet(cursor, tokens):
    return (struct.pack('<HB',cursor,len(tokens))+tokens).ljust(48,b'\0')


class CompressionTests(unittest.TestCase):
    def test_flat_chunk_one_frame_and_wide_literals(self):
        tokens=bytes([3,1,1,3,6,2,3,1,3,3,120,0,2,255])
        result=bytearray()
        decode_chunk_frame(packet(32768,tokens),result,3685)
        column=struct.pack('<128H',1,*([2]*6),3,*([0]*120))
        self.assertEqual(result,column*256)
        result=bytearray()
        decode_chunk_frame(packet(3,bytes([0,3])+struct.pack('<3H',255,256,3684)),result,3685)
        self.assertEqual(result,struct.pack('<3H',255,256,3684))

    def test_invalid_tokens_lengths_references_and_cursors(self):
        for value in [packet(128,bytes([2,1])),packet(1,bytes([3,0,4])),
                      packet(2,bytes([3,1,4])),packet(1,bytes([8,1,4])),
                      packet(1,bytes([0,1,255])),packet(1,bytes([1,1,255,255])),
                      packet(1,bytes([4,1,4]))[:-1]+b'\1',
                      bytes([1,0,46])+bytes(45),packet(32769,bytes([3,1,0]))]:
            with self.subTest(payload=value):
                with self.assertRaises(ValueError): decode_chunk_frame(value,bytearray(),3685)
        result=bytearray(256)
        with self.assertRaises(ValueError): decode_chunk_frame(packet(128,bytes([2,1])),result,3685)
        with self.assertRaises(ValueError): decode_chunk_frame(packet(32768,bytes([2,255,2,1])),result,3685)

    def test_corrupt_dropped_duplicate_reordered_frames_latch_link(self):
        a=frame(147,1,packet(128,bytes([3,128,4])))
        b=frame(147,1,packet(16384,bytes([2,127])))
        c=frame(147,1,packet(32768,bytes([2,128])))
        class Port:
            def __init__(self,frames): self.buffer=b''.join(frames)
            def write(self,request): return len(request)
            def read(self,size):
                value=self.buffer[:min(size,7)]; self.buffer=self.buffer[len(value):]; return value
        port=Port([a,b,c]); link=Link(port,timeout=.01); link.ready=True
        self.assertEqual(link.compressed_chunk(0,3685),struct.pack('<H',4)*32768)
        self.assertEqual(link.last_chunk_stats['frames'],3)
        for frames in [[a,c],[a,b,b,c],[b,a,c],[a,b],
                       [a[:-1]+bytes([a[-1]^1]),b,c],[frame(147,2,a[12:60]),b,c]]:
            with self.subTest(frames=len(frames)):
                link=Link(Port(frames),timeout=.01); link.ready=True
                with self.assertRaises((ValueError,RuntimeError)): link.compressed_chunk(0,3685)
                self.assertTrue(link.failed); self.assertFalse(link.ready)

    def test_edit_encoding_bounds_duplicates_and_large_gaps(self):
        pairs=[(i,3065) for i in range(1,128)]+[(32767,3684)]
        packets=list(encode_edits(99,pairs,3685))
        self.assertLess(len(packets),12)
        self.assertTrue(all(len(p)<=48 and 0<p[1]<=32 and p[2]==len(p)-3 for p in packets))
        for pairs in [[(1,4),(1,5)],[(0,0)],[(32768,4)],[(1,3685)],[(1,-1)]]:
            with self.assertRaises(ValueError): list(encode_edits(0,pairs,3685))
        self.assertEqual(list(encode_edits(0,[],3685)),[])
