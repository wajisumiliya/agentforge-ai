import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
app = FastAPI(title="AgentForge Local AI")
class Task(BaseModel):
    task: str = Field(min_length=1, max_length=4000)
@app.get("/health")
def health(): return {"status": "ok"}
@app.post("/run")
async def run(task: Task):
    url = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    try:
        async with httpx.AsyncClient(timeout=110) as client:
            response = await client.post(f"{url}/api/generate", json={"model": model, "prompt": task.task, "stream": False})
            response.raise_for_status()
            return {"result": response.json().get("response", "")}
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Ollama unavailable or model missing")
