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

## Reliability notes (v1.0 MVP)
The local API throttles ten invalid key attempts per one-minute window and limits in-process concurrent AI approvals to two. These protections are not distributed across servers. PostgreSQL task claims are atomic, but global concurrency across multiple API instances is not enforced. Task status refresh uses polling rather than streaming. Do not expose the service to the internet until a production authentication and deployment review is completed.

## Interrupted tasks
When using PostgreSQL with exactly one Node API instance, set `AGENTFORGE_SINGLE_INSTANCE=true` to mark previously Running tasks Failed on startup. Do not enable this with multiple API instances: one instance could incorrectly mark another instance's active tasks as failed. In-memory tasks are lost when the process restarts. The in-memory store keeps up to 1,000 task records under normal conditions and prunes older terminal tasks; pending and running tasks are never evicted by this cleanup. PostgreSQL retention is not automatically pruned. Approved requests return HTTP 202 and continue asynchronously within the Node process; this is not a durable worker queue.

## Windows end-to-end smoke test

From PowerShell, start Ollama and verify that the model is installed:

```powershell
ollama list
ollama pull qwen2.5:3b
```

Start the three processes from the setup section in separate terminals. In a fourth terminal, verify Python AI health:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Submit a local AI streaming request directly to the Python service (this bypasses the Node approval queue):

```powershell
$body = @{ task = "Write a short project plan for a book inventory app" } | ConvertTo-Json
Invoke-WebRequest -Uri http://127.0.0.1:8000/run-stream -Method Post -ContentType 'application/json' -Body $body
```

Expected: four progress events (Planner, Researcher, Developer, Reviewer), followed by one complete event. Then use the browser to connect with the same Node API key, queue a task, approve it, and observe the progress bar. On a CPU-only machine, inference can be slow. If Ollama is unavailable, the task should show Failed instead of Completed.

For a complete Windows build and automated verification, run this command from the repository root after pulling the latest main branch:

```powershell
powershell -ExecutionPolicy Bypass -File .\\build-check.ps1
```

This checks React/TypeScript compilation, Node syntax, Node API integration tests, Python compilation, and Python unit tests. It requires Node.js, npm, Python and internet access to install packages. It does not start Ollama or validate a real model response. GitHub Actions also runs this script on a Windows runner.

To run automated tests locally:

```powershell
npm install
npm run build
Push-Location server
npm install
Pop-Location
node --test server/tests/*.test.mjs
Push-Location ai
python -m pip install -r requirements.txt
python -m unittest discover -p 'test_*.py' -v
Pop-Location
```

Do not expose these development endpoints to the public internet.

## Verification checklist before deployment

1. Open the GitHub Actions page for the latest `main` commit and confirm **both** `frontend` and `python` jobs completed successfully. A commit being present on GitHub is not evidence that CI passed.
2. Run the local Node integration tests and Python unit tests using the commands above. The integration suite uses a mock AI server; it does **not** verify that Ollama is installed or responsive.
3. Run the Windows smoke test against a real Ollama model and verify four ordered progress events followed by a complete event.
4. In the dashboard, queue and approve a task. Confirm that its status progresses from Pending approval to Running to Completed, and that the final answer and all four traces are visible.
5. Restart the Node API and verify the expected persistence behavior: memory mode loses tasks; PostgreSQL retains them. A running task is not automatically resumed.

AgentForge currently drafts plans, research-style analysis and code suggestions; it does **not** execute generated code, browse the web, modify repositories or deploy applications. Keep it bound to localhost until authentication and infrastructure are production hardened.
