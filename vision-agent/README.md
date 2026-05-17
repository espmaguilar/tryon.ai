# Vision Agents — Video AI Agent (uv + Python 3.12)

This small project demonstrates a Vision Agents video AI agent that joins a call, analyzes pose with YOLO pose model, and provides realtime feedback.

Prerequisites
- Python 3.12
- `uv` CLI (https://uv.run) — used to initialize/manage dependencies and run the project

Setup
1. Initialize project with `uv` and add dependencies:

```bash
uv init
uv add "vision-agents[getstream,gemini,ultralytics]" python-dotenv
```

2. Create `.env` (already included) and fill in your keys:

```
STREAM_API_KEY=your_stream_api_key
STREAM_API_SECRET=your_stream_api_secret
GOOGLE_API_KEY=your_google_api_key
serper_API=your_serper_api_key
groq_API=your_groq_api_key
```

3. Place or download a YOLO pose model file named `yolo26n-pose.pt` next to `main.py`.

Run

```bash
uv run main.py run
```

Reference docs
- https://visionagents.ai
- MCP server: https://visionagents.ai/mcp
- Skill: https://visionagents.ai/skill.md

Decart (Runtime style changes)
--------------------------------
If you add the Decart plugin and set `DECART_API_KEY`, the agent can apply realtime visual restyling to the video stream and update styles during a live session.

1) Install the Decart integration:

```bash
uv add "vision-agents[decart]"
# or: pip install "vision-agents[decart]"
```

2) Populate `.env` with your Decart key:

```
DECART_API_KEY=your_decart_api_key
```

3) Example — Human prompt that the LLM can map to the registered function:

```
"Change the video style to: Studio Ghibli animation style"
```

When `create_agent()` registers the `change_style(prompt: str)` function on the LLM, the model can choose to call that function in response to a user message like the one above — which will cause the processor to update the active prompt atomically.

4) Programmatic example (directly updating the processor):

```py
# inside an active agent session or async handler with access to the processor
await restyling_processor.update_prompt("Neon cyberpunk city")
```

Notes
- If `vision-agents[decart]` is not installed or `DECART_API_KEY` is unset, the code falls back to running without the restyling processor and will log an initialization message.
- Decart processors accept `initial_image` and `update_state(image=...)` for reference-image based costume swaps.

