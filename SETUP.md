# AgentForge — Local Multi-Agent MVP

## Requirements
Node.js 20+, Python 3.11+, Ollama, and approximately 3 GB free space for a small local model.

## Start
1. Install Ollama, then run `ollama pull qwen2.5:3b`.
2. From repository root: `npm install` and `npm run dev`.
3. Second terminal: `cd server`, `npm install`, `npm run dev`.
4. Third terminal: `cd ai`, `python -m venv .venv`, activate it, `pip install -r requirements.txt`, then `uvicorn main:app --host 127.0.0.1 --port 8000`.
5. Visit http://localhost:5173.

## Architecture
React → Express → FastAPI → LangGraph (Planner → Researcher → Developer → Reviewer) → Ollama.

Each agent produces a separate output and the API returns a trace. Researcher uses model knowledge only, not live web search. Developer drafts text/code but does not execute commands or change files.

## Limitations
Sequential multi-agent workflow implemented; no real autonomous tool execution. Runs are currently stored in browser memory only. PostgreSQL persistence, authentication, durable checkpoints, live streaming, and human approval gates are not yet implemented. Do not expose these services to the public internet without authentication, authorization, rate limiting, and operational safeguards.
