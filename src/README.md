# AgentForge UI

The frontend calls the Node API through Vite's /api proxy.
Tasks are queued for approval. Approval triggers the local four-stage LangGraph pipeline.
Task history is loaded from the server on page load and can be refreshed manually.
The local API is not authenticated; do not expose it publicly.
