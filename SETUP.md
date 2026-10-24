# AgentForge — Multi-Agent MVP v0.2

## Requirements
Node.js 20+, Python 3.11+, Ollama. PostgreSQL is optional for persistent history.

## Run locally
1. Install Ollama and run `ollama pull qwen2.5:3b`.
2. At repository root: `npm install`, then `npm run dev`.
3. In a second terminal: `cd server`, `npm install`, then `npm run dev`.
4. In a third terminal: `cd ai`, create and activate a Python virtual environment, `pip install -r requirements.txt`, then `uvicorn main:app --host 127.0.0.1 --port 8000`.
5. Open http://localhost:5173.

## Optional PostgreSQL persistence
Set `DATABASE_URL` in the Node.js server environment to a valid PostgreSQL connection string. The server automatically creates its task table on startup. Never commit credentials. If omitted, tasks are stored in server memory and disappear when Node.js restarts. PostgreSQL data survives restarts.

## Workflow
React → Node.js Express API → approval queue → FastAPI → LangGraph (Planner → Researcher → Developer → Reviewer) → Ollama.
POST /api/tasks queues a task. POST /api/tasks/:id/approve runs it after approval. POST /api/tasks/:id/reject rejects it. GET /api/tasks lists the latest 100.

## Security and limitations
This is a local-only prototype. The API binds to 127.0.0.1 and has NO authentication or multi-user authorization. Approvals are not secure user-specific approvals and must NOT be exposed to the public internet. Tasks are textual drafts only: no shell commands, code execution, or external tool actions. Execution updates arrive when the request completes; streaming is not implemented. Concurrent approvals across multiple server instances are not supported. No deployment or integration tests have been completed.
