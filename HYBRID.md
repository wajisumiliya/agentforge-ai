# AgentForge Hybrid AI configuration

AgentForge runs the React dashboard and Node API locally. The Python service routes each agent's model call according to the task mode.

## Modes
- `offline`: Ollama only; never calls the cloud provider.
- `online`: OpenAI-compatible chat-completions API only; no fallback.
- `hybrid`: cloud-first when configured, otherwise local; on cloud HTTP/response errors, fall back to local Ollama. A task can therefore use different providers across its four steps. Cloud requests may send task and prior-agent content to the configured provider.

## Python service environment (PowerShell)

```powershell
$env:OLLAMA_URL='http://127.0.0.1:11434'
$env:OLLAMA_MODEL='qwen2.5:3b'
# Optional: configure an OpenAI-compatible cloud service
$env:CLOUD_AI_API_KEY='YOUR_PROVIDER_KEY'
$env:CLOUD_AI_BASE_URL='https://api.openai.com/v1'
$env:CLOUD_AI_MODEL='gpt-4o-mini'
cd ai
uvicorn main:app --host 127.0.0.1 --port 8000
```

**Never commit API keys or expose the Python service publicly.** The API key stays in the Python process environment, not in the React browser or Node task records. If you do not set `CLOUD_AI_API_KEY`, hybrid uses local Ollama and online mode fails with a provider error. Cloud usage can incur fees; this implementation does not guarantee free cloud access.

## Run and verify

From the repository root, run `powershell -ExecutionPolicy Bypass -File .\\build-check.ps1` to execute frontend build, Node tests, and Python tests. The tests mock cloud and Ollama; they do not prove real provider connectivity. Start all three local services as described in SETUP.md. Select Hybrid, Online or Offline in the dashboard before queuing a task. The selected mode is saved per task.

## Limitations

The fallback is **per agent request**, not a transaction-wide restart. Cloud errors are caught and local inference is attempted; if both fail, the task fails. The cloud API is expected to support the OpenAI chat completions format. Provider secrets are configured through environment variables only; there is no browser-based credential editor. No web browsing or automatic repository edits are added by hybrid routing.
