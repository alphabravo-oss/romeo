import unittest
from unittest.mock import patch

from romeo_client import RomeoClient


class FakeSseResponse:
    def __init__(self, lines: list[bytes]):
        self.lines = lines

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def __iter__(self):
        return iter(self.lines)


class RunEventStreamTests(unittest.TestCase):
    def test_sends_cursor_ignores_heartbeats_and_deduplicates_replay(self):
        response = FakeSseResponse(
            [
                b"retry: 1000\n",
                b"\n",
                b": heartbeat\n",
                b"\n",
                b"event: message.delta\n",
                b"id: 7\n",
                b'data: {"id":"evt_7","runId":"run_1","sequence":7,"type":"message.delta","data":{"text":"old"}}\n',
                b"\n",
                b"event: run.completed\n",
                b"id: 8\n",
                b'data: {"id":"evt_8","runId":"run_1","sequence":8,"schemaVersion":1,"type":"run.completed","data":{}}\n',
                b"\n",
            ]
        )
        captured = []

        def open_request(request, timeout):
            captured.append((request, timeout))
            return response

        client = RomeoClient("https://romeo.example", "rmk_test", timeout=9)
        with patch("romeo_client.client.urlopen", open_request):
            events = list(client.stream_run_events("run_1", after_sequence=7))

        self.assertEqual([event["sequence"] for event in events], [8])
        request, timeout = captured[0]
        self.assertEqual(request.get_header("Last-event-id"), "7")
        self.assertEqual(request.get_header("Authorization"), "Bearer rmk_test")
        self.assertEqual(timeout, 9)

    def test_rejects_invalid_cursor(self):
        client = RomeoClient()
        with self.assertRaises(ValueError):
            list(client.stream_run_events("run_1", after_sequence=-1))


if __name__ == "__main__":
    unittest.main()
