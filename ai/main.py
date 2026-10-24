import os
from typing import TypedDict
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END

app = FastAPI(title="AgentForge Multi-Agent AI")

class Task(BaseModel):
    task: str = Field(min_length=1, max_length=4000)

class AgentState(TypedDict):
    task: str
    plan: str
    research: str
    draft: str
    result: str
    trace: list[dict[str, str]]

async def ask(role: str, instruction: str) -> str:
    url = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    async with httpx.AsyncClient(timeout=110) as client:
        response = await client.post(f"{url}/api/generate", json={
            "model": model, "system": role, "prompt": instruction,
            "stream": False, "options": {"num_predict": 500}
        })
        response.raise_for_status()
        return response.json().get("response", "").strip()

async def planner(state: AgentState):
    answer = await ask("You are a planning agent. Create a concise actionable plan. Do not claim external research or actions.", state["task"])
    return {"plan": answer, "trace": state["trace"] + [{"agent": "Planner", "output": answer}]}

async def researcher(state: AgentState):
    answer = await ask("You are a reasoning and research assistant without web access. Analyze using existing knowledge. Explicitly note anything requiring verification.", f"Task: {state['task']}\nPlan: {state['plan']}")
    return {"research": answer, "trace": state["trace"] + [{"agent": "Researcher", "output": answer}]}

async def developer(state: AgentState):
    answer = await ask("You are a technical implementation agent. Draft practical deliverables or code when appropriate. You cannot execute tools or modify files.", f"Task: {state['task']}\nPlan: {state['plan']}\nAnalysis: {state['research']}")
    return {"draft": answer, "trace": state["trace"] + [{"agent": "Developer", "output": answer}]}

async def reviewer(state: AgentState):
    answer = await ask("You are a quality reviewer. Critique and improve the draft, clearly distinguishing proposed work from completed work.", f"Original task: {state['task']}\nDraft: {state['draft']}")
    return {"result": answer, "trace": state["trace"] + [{"agent": "Reviewer", "output": answer}]}

builder = StateGraph(AgentState)
for name, handler in [("planner", planner), ("researcher", researcher), ("developer", developer), ("reviewer", reviewer)]:
    builder.add_node(name, handler)
builder.add_edge(START, "planner")
builder.add_edge("planner", "researcher")
builder.add_edge("researcher", "developer")
builder.add_edge("developer", "reviewer")
builder.add_edge("reviewer", END)
graph = builder.compile()

@app.get("/health")
def health():
    return {"status": "ok", "agents": ["Planner", "Researcher", "Developer", "Reviewer"]}

@app.post("/run")
async def run(task: Task):
    try:
        state = await graph.ainvoke({"task": task.task, "plan": "", "research": "", "draft": "", "result": "", "trace": []})
        return {"result": state["result"], "trace": state["trace"]}
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Local Ollama request failed. Check Ollama and the configured model.") from exc
