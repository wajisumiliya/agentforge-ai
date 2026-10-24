# AgentForge local MVP

## Setup
Node.js 20+, Python 3.11+, Ollama.

1. Pull model: `ollama pull qwen2.5:3b`.
2. Generate a 32-byte secret in PowerShell: `$bytes=New-Object byte[] 32; $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); [Convert]::ToBase64String($bytes)`.
3. Set `AGENTFORGE_API_KEY` in the **Node.js server process environment** to the generated secret. Example PowerShell: `$env:AGENTFORGE_API_KEY="your-generated-secret"`. Never commit this value.
4. In root: `npm install`, `npm run dev`.
5. In another terminal (with the secret set): `cd server`, `npm install`, `npm run dev`.
6. In another terminal: `cd ai`, create a Python virtual environment, `pip install -r requirements.txt`, `uvicorn main:app --host 127.0.0.1 --port 8000`.
7. Open http://localhost:5173 and enter the same API key in the access panel.

## Storage
Optional `DATABASE_URL` configures PostgreSQL; otherwise tasks are in Node process memory. Task history loads from the API. PostgreSQL task approval uses an atomic status claim, but rejected tasks and memory mode are not multi-instance safe.

## Limitations
Four sequential LangGraph agents generate textual results, no real web research or code execution. Approval is an API action, not role-based authorization. The browser keeps the API key in sessionStorage. This is **not** production-grade authentication: no user identities, sessions, or authorization. Do not expose the Node API or Ollama publicly. Node binds to localhost. Public deployment requires proper authentication, rate limits, HTTPS, CSRF/security review, and secure hosting for inference.

## Reliability notes (v0.7)
The local API throttles ten invalid key attempts per one-minute window and limits in-process concurrent AI approvals to two. These protections are not distributed across servers. PostgreSQL task claims are atomic, but global concurrency across multiple API instances is not enforced. Task status refresh uses polling rather than streaming. Do not expose the service to the internet until a production authentication and deployment review is completed.

## Interrupted tasks
When using PostgreSQL with exactly one Node API instance, set `AGENTFORGE_SINGLE_INSTANCE=true` to mark previously Running tasks Failed on startup. Do not enable this with multiple API instances: one instance could incorrectly mark another instance's active tasks as failed. In-memory tasks are lost when the process restarts. Approved requests return HTTP 202 and continue asynchronously within the Node process; this is not a durable worker queue.
