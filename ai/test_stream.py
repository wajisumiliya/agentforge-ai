import asyncio
import json
import unittest
from unittest.mock import patch
import main

class StreamTest(unittest.IsolatedAsyncioTestCase):
    async def test_stream(self):
        async def fake_ask(role, instruction):
            return "Mock response"
        with patch.object(main, "ask", fake_ask):
            response = await main.run_stream(main.Task(task="Create a plan"))
            events = [json.loads(part) async for part in response.body_iterator]
        self.assertEqual([e["agent"] for e in events if e["type"] == "progress"], ["Planner", "Researcher", "Developer", "Reviewer"])
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(len(events[-1]["trace"]), 4)

    async def test_stream_failure_is_reported(self):
        async def failing_ask(role, instruction):
            raise RuntimeError("Ollama unavailable")
        with patch.object(main, "ask", failing_ask):
            response = await main.run_stream(main.Task(task="Create a plan"))
            events = [json.loads(part) async for part in response.body_iterator]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertNotIn("RuntimeError", events[0]["error"])

if __name__ == "__main__":
    unittest.main()
