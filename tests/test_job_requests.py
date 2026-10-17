from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import app


class JobRequestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="job-requests-")
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source.mp4"
        self.source.write_bytes(b"video")
        self.worker_started = threading.Event()
        self.calls = []
        def worker(job_id):
            self.calls.append(job_id)
            self.worker_started.set()
        for name, value in (("JOBS", {}), ("process_job", worker),
                            ("FFMPEG", "ffmpeg"), ("FFPROBE", "ffprobe")):
            patcher = patch.object(app, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.payload = {"request_id": "a" * 32, "paths": [str(self.source)],
                        "mode": "max", "ghost": 10, "inflate": 0}

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, payload=None, path="/api/process", method="POST"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            body = json.dumps(payload).encode("utf-8") if payload is not None else None
            connection.request(method, path, body=body, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_repeat_after_lost_response_reuses_job_even_if_source_disappears(self):
        original_send = app.Handler.send_json
        dropped = threading.Event()
        def lose_response(handler, payload, status=200):
            if handler.path == "/api/process" and not dropped.is_set():
                dropped.set()
                handler.close_connection = True
                return
            return original_send(handler, payload, status)
        with patch.object(app.Handler, "send_json", lose_response):
            with self.assertRaises(http.client.RemoteDisconnected):
                self.request(self.payload)
        self.assertTrue(self.worker_started.wait(2))
        self.source.unlink()
        status, response = self.request(self.payload)
        self.assertEqual(status, 200, response)
        self.assertEqual(response, {"job": self.payload["request_id"]})
        self.assertEqual(self.calls, [self.payload["request_id"]])
        status, public = self.request(path="/api/job/" + response["job"], method="GET")
        self.assertEqual(status, 200, public)
        self.assertEqual(set(public), {"status", "files"})

    def test_concurrent_same_id_starts_one_worker(self):
        barrier = threading.Barrier(8)
        def start(_):
            barrier.wait(timeout=3)
            return self.request(self.payload)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(start, range(8)))
        self.assertEqual(results, [(200, {"job": self.payload["request_id"]})] * 8)
        self.assertTrue(self.worker_started.wait(2))
        self.assertEqual(self.calls, [self.payload["request_id"]])
        self.assertEqual(len(app.JOBS), 1)

    def test_conflict_compares_declared_values_and_paths(self):
        status, response = self.request(self.payload)
        self.assertEqual(status, 200, response)
        for changed in ({"paths": [str(self.source), str(self.source.parent / "missing.mp4")]},
                        {"mode": "stealth"}, {"ghost": "10"}, {"inflate": 31}):
            with self.subTest(changed=changed):
                status, response = self.request({**self.payload, **changed})
                self.assertEqual(status, 409, response)
                self.assertIn("request_id", response["error"])
        self.assertEqual(len(app.JOBS), 1)
        self.assertTrue(self.worker_started.wait(2))
        self.assertEqual(len(self.calls), 1)

    def test_invalid_request_id_is_rejected(self):
        for value in (None, "", "a" * 31, "g" * 32, 123, ["a" * 32]):
            with self.subTest(value=value):
                status, response = self.request({**self.payload, "request_id": value})
                self.assertEqual(status, 400, response)
                self.assertIn("request_id", response["error"])
        self.assertEqual(self.calls, [])
        self.assertEqual(app.JOBS, {})

    def test_legacy_requests_still_create_independent_jobs(self):
        payload = {name: value for name, value in self.payload.items() if name != "request_id"}
        first_status, first = self.request(payload)
        second_status, second = self.request(payload)
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertNotEqual(first["job"], second["job"])
        self.assertEqual(len(app.JOBS), 2)


if __name__ == "__main__":
    unittest.main()
