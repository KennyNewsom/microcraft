import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'host'))
from link import Link, LinkError, decode, frame


class Port:
    def __init__(self, fault=None):
        self.fault = fault
        self.buffer = b''
        self.requests = []

    def write(self, data):
        op, seq, payload = decode(data)
        self.requests.append((op, seq))
        self.buffer = data if op in (1, 2) else frame(op | 128, seq, payload)
        if self.fault and seq == 42:
            self.buffer = self.fault(self.buffer)
        return len(data)

    def read(self, size):
        # Model arbitrary USB fragmentation, not one-read-per-packet behavior.
        out, self.buffer = self.buffer[:min(7, size)], self.buffer[min(7, size):]
        return out


class Tests(unittest.TestCase):
    @patch('link.time.sleep')
    def test_all_10000_before_start(self, _):
        port = Port()
        link = Link(port)
        self.assertEqual(link.boot()['packets'], 10000)
        self.assertEqual(port.requests, [(1, 0)] + [(2, n) for n in range(1, 10001)] + [(3, 10001)])
        self.assertTrue(link.ready)

    @patch('link.time.sleep')
    def test_faults_prevent_start_and_latch_failure(self, _):
        faults = [lambda b: b'', lambda b: b[:-1],
                  lambda b: b[:20] + bytes([b[20] ^ 1]) + b[21:],
                  lambda b: frame(2, 41, b[12:60]),
                  lambda b: frame(2, 42, bytes(48))]
        for fault in faults:
            with self.subTest(fault=fault):
                port = Port(fault)
                link = Link(port, timeout=0.001)
                with self.assertRaises(LinkError):
                    link.boot()
                self.assertFalse(link.ready)
                self.assertTrue(link.failed)
                self.assertFalse(any(op == 3 for op, seq in port.requests))
                with self.assertRaises(LinkError):
                    link.command(4)

    def test_unvalidated_link_cannot_run_gameplay(self):
        with self.assertRaises(LinkError):
            Link(Port()).command(5, bytes(4))

    def test_crc_and_bounds(self):
        self.assertEqual(decode(frame(2, 99, bytes(range(48)))), (2, 99, bytes(range(48))))
        with self.assertRaises(ValueError):
            frame(2, 0, bytes(49))
        with self.assertRaises(LinkError):
            decode(bytes(64))


if __name__ == '__main__':
    unittest.main()
