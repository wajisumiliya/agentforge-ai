import asyncio
import json
import unittest
from unittest.mock import patch, AsyncMock, MagicMock
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

    async def test_ollama_health_ready(self):
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "qwen2.5:3b"}]}
        client = AsyncMock()
        client.get.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(main.httpx, "AsyncClient", return_value=context):
            result = await main.ollama_health()
        self.assertEqual(result, {"status": "ready", "model": "qwen2.5:3b"})

    async def test_ollama_health_missing_model(self):
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "other:latest"}]}
        client = AsyncMock()
        client.get.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(main.httpx, "AsyncClient", return_value=context):
            result = await main.ollama_health()
        self.assertEqual(result["status"], "model_missing")

    async def test_ollama_health_unavailable(self):
        client = AsyncMock()
        client.get.side_effect = main.httpx.ConnectError("offline")
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(main.httpx, "AsyncClient", return_value=context):
            result = await main.ollama_health()
        self.assertEqual(result["status"], "unavailable")

    async def test_cloud_request_uses_chat_completions(self):
        response = MagicMock()
        response.json.return_value = {'choices': [{'message': {'content': 'Cloud result'}}]}
        client = AsyncMock()
        client.post.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(main.os.environ, {'CLOUD_AI_API_KEY': 'private-test-key', 'CLOUD_AI_BASE_URL': 'https://example.invalid/v1', 'CLOUD_AI_MODEL': 'test-model'}), patch.object(main.httpx, 'AsyncClient', return_value=context):
            result = await main.cloud_ask('system role', 'user task')
        self.assertEqual(result, 'Cloud result')
        args, kwargs = client.post.call_args
        self.assertEqual(args[0], 'https://example.invalid/v1/chat/completions')
        self.assertEqual(kwargs['json']['model'], 'test-model')
        self.assertEqual(kwargs['json']['messages'][1]['content'], 'user task')
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer private-test-key')

    async def test_online_mode_without_key_fails_without_local_fallback(self):
        with patch.dict(main.os.environ, {}, clear=True), patch.object(main.httpx, 'AsyncClient') as client:
            token = main.mode_context.set('online')
            try:
                with self.assertRaisesRegex(ValueError, 'not configured'):
                    await main.ask('role', 'prompt')
            finally:
                main.mode_context.reset(token)
            client.assert_not_called()

    async def test_hybrid_uses_cloud_when_available(self):
        with patch.dict(main.os.environ, {'CLOUD_AI_API_KEY': 'test-key'}), patch.object(main, 'cloud_ask', AsyncMock(return_value='Cloud result')) as cloud, patch.object(main.httpx, 'AsyncClient') as local:
            token = main.mode_context.set('hybrid')
            try:
                self.assertEqual(await main.ask('role', 'prompt'), 'Cloud result')
            finally:
                main.mode_context.reset(token)
            cloud.assert_awaited_once()
            local.assert_not_called()

    async def test_provider_health_does_not_expose_secret(self):
        with patch.dict(main.os.environ, {'CLOUD_AI_API_KEY': 'sensitive-test-token', 'CLOUD_AI_MODEL': 'test-model'}):
            info = main.provider_health()
        self.assertEqual(info['cloud'], 'configured')
        self.assertEqual(info['model'], 'test-model')
        self.assertNotIn('sensitive-test-token', json.dumps(info))

    async def test_provider_health_unconfigured(self):
        with patch.dict(main.os.environ, {}, clear=True):
            self.assertEqual(main.provider_health()['cloud'], 'not_configured')

    async def test_online_mode_uses_cloud_only(self):
        with patch.object(main, 'cloud_ask', AsyncMock(return_value='Cloud answer')) as cloud, patch.object(main.httpx, 'AsyncClient') as local:
            token = main.mode_context.set('online')
            try:
                self.assertEqual(await main.ask('role', 'prompt'), 'Cloud answer')
            finally:
                main.mode_context.reset(token)
            cloud.assert_awaited_once()
            local.assert_not_called()

    async def test_hybrid_falls_back_to_local(self):
        response = MagicMock()
        response.json.return_value = {'response': 'Local answer'}
        client = AsyncMock()
        client.post.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.dict(main.os.environ, {'CLOUD_AI_API_KEY': 'test-key'}), patch.object(main, 'cloud_ask', AsyncMock(side_effect=main.httpx.ConnectError('offline'))), patch.object(main.httpx, 'AsyncClient', return_value=context):
            token = main.mode_context.set('hybrid')
            try:
                self.assertEqual(await main.ask('role', 'prompt'), 'Local answer')
            finally:
                main.mode_context.reset(token)

    async def test_offline_never_calls_cloud(self):
        response = MagicMock()
        response.json.return_value = {'response': 'Local answer'}
        client = AsyncMock()
        client.post.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(main, 'cloud_ask', AsyncMock()) as cloud, patch.object(main.httpx, 'AsyncClient', return_value=context):
            token = main.mode_context.set('offline')
            try:
                self.assertEqual(await main.ask('role', 'prompt'), 'Local answer')
            finally:
                main.mode_context.reset(token)
            cloud.assert_not_awaited()

    async def test_empty_ollama_response_is_rejected(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": "  "}
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_context = MagicMock()
        mock_context.__aenter__ = AsyncMock(return_value=mock_client)
        mock_context.__aexit__ = AsyncMock(return_value=False)
        with patch.object(main.httpx, "AsyncClient", return_value=mock_context):
            with self.assertRaises(ValueError):
                await main.ask("Planner", "Create a plan")

if __name__ == "__main__":
    unittest.main()
