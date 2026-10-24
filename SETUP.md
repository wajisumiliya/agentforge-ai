# AgentForge MVP Setup

Requires Node.js 20+, Python 3.11+, and Ollama.

1. Install Ollama and run `ollama pull qwen2.5:3b`.
2. From repository root run `npm install` then `npm run dev`.
3. In another terminal run `cd server && npm install && npm run dev`.
4. In another terminal run `cd ai && python -m venv .venv`, activate the environment, run `pip install -r requirements.txt` and `uvicorn main:app --host 127.0.0.1 --port 8000`.
5. Open http://localhost:5173.

Current status: functional single-model task MVP. Multi-agent orchestration, approvals, PostgreSQL persistence, and authentication are planned, NOT implemented. Do not expose the API publicly without authentication and rate limiting.
