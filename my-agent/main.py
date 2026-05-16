import os
from pathlib import Path

from dotenv import load_dotenv
from vision_agents.core import Agent, AgentLauncher, Runner, User
from vision_agents.plugins import gemini, getstream

from nano_banana import NanoBananaProcessor


base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

# Use SERPER_API_KEY from .env as the primary key source for runtime integrations.
if os.getenv("SERPER_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("SERPER_API_KEY", "")


async def create_agent(**kwargs) -> Agent:
    llm = gemini.Realtime(fps=3)

    nano_processor = NanoBananaProcessor(
        api_key=os.getenv("NANO_BANANA_API_KEY"),
        model=os.getenv("NANO_BANANA_MODEL", "nano-banana-2"),
        output_dir=os.getenv("TRYON_OUTPUT_DIR", str(base_dir / "outputs")),
    )

    @llm.register_function(
        description="Set the merchandise image to try on. Input should be an image URL or local file path."
    )
    async def set_merchandise(image_path_or_url: str) -> str:
        value = await nano_processor.set_merchandise(image_path_or_url)
        return f"Merchandise set to: {value}"

    @llm.register_function(
        description="Generate a virtual try-on result using the latest camera frame and selected merchandise."
    )
    async def try_on_current_item() -> str:
        result = await nano_processor.generate_tryon()
        await nano_processor.emit_result(result)
        return (
            f"Try-on status: {result.get('status')}, "
            f"job_id: {result.get('job_id')}, "
            f"image_url: {result.get('image_url')}"
        )

    @llm.register_function(description="Apply selected frontend item and generate a mirror update.")
    async def apply_selected_item(item_id: str, image_url: str) -> str:
        await nano_processor.set_merchandise(image_url)
        result = await nano_processor.generate_tryon()
        result["item_id"] = item_id
        await nano_processor.emit_result(result)
        return (
            f"Applied item_id={item_id}, status={result.get('status')}, "
            f"image_url={result.get('image_url')}"
        )

    @llm.register_function(description="Update camera active state from frontend.")
    async def set_camera_state(is_camera_active: bool) -> str:
        state = "active" if is_camera_active else "inactive"
        return f"Frontend camera state recorded: {state}"

    @llm.register_function(description="Clear the currently selected merchandise image.")
    async def clear_merchandise() -> str:
        await nano_processor.clear_merchandise()
        return "Merchandise cleared."

    return Agent(
        edge=getstream.Edge(),
        agent_user=User(name="Assistant", id="agent"),
        instructions=(
            "You are a virtual mirror assistant. Help the user try on merchandise. "
            "Use set_merchandise to choose an item, then use try_on_current_item to generate "
            "a mirror result from the latest camera frame."
        ),
        llm=llm,
        processors=[nano_processor],
    )


async def join_call(agent: Agent, call_type: str, call_id: str, **kwargs) -> None:
    call = await agent.create_call(call_type, call_id)

    nano_processor = None
    for processor in getattr(agent, "processors", []):
        if hasattr(processor, "attach_call"):
            processor.attach_call(call)
        if isinstance(processor, NanoBananaProcessor):
            nano_processor = processor

    async with agent.join(call):
        async def handle_custom_event(event: dict) -> None:
            if not nano_processor:
                return
            event_type = event.get("type")
            payload = event.get("payload", {}) or {}

            if event_type == "set_merchandise":
                image_url = payload.get("image_url")
                item_id = payload.get("item_id")
                if isinstance(image_url, str) and image_url.strip():
                    await nano_processor.set_merchandise(image_url)
                    result = await nano_processor.generate_tryon()
                    result["item_id"] = item_id
                    await nano_processor.emit_result(result)

            elif event_type == "camera_state":
                # Reserved for future frame/camera gating logic.
                _ = payload.get("is_camera_active")

        try:
            maybe_coro = call.on("custom", handle_custom_event)
            # Some SDKs return unsubscribe functions; keep best-effort behavior.
            _ = maybe_coro
        except Exception:
            pass

        await agent.simple_response(
            "Hi! I can help with virtual try-on. Select an item in the frontend, then I will generate and send mirror updates."
        )
        await agent.finish()


if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
