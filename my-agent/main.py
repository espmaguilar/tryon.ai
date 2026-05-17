import asyncio
import importlib.util
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from vision_agents.core import Agent, AgentLauncher, Runner, User
from vision_agents.plugins import gemini, getstream

from nano_banana import NanoBananaProcessor


base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

# Set this to a local clothing image path on this computer.
# Example (macOS): "/Users/yourname/Pictures/garment.png"
LOCAL_MERCHANDISE_IMAGE_PATH = "/Users/ryanfoster/Desktop/1dcd35bc9ac0fce33944798239aff636.png"

# Use serper_API from .env as the primary key source for runtime integrations.
if os.getenv("serper_API") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("serper_API", "")


@lru_cache(maxsize=1)
def _load_style_finder_module():
    style_finder_path = base_dir.parent / "style-finder" / "main.py"
    if not style_finder_path.exists():
        return None
    spec = importlib.util.spec_from_file_location("style_finder_main", style_finder_path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _resolve_product_url(item_name: str) -> str:
    normalized_name = item_name.strip()
    if not normalized_name:
        return ""

    module = _load_style_finder_module()
    if module is None:
        return ""

    api_key = os.getenv("serper_API", "").strip()
    if not api_key:
        return ""

    try:
        output_url, _, _, _ = module.find_product_url_with_backplan(
            normalized_name,
            api_key,
            module.DEFAULT_LIMIT,
            module.MAX_BACKPLAN_ATTEMPTS,
        )
    except Exception:
        return ""

    return output_url.strip() if isinstance(output_url, str) else ""


async def create_agent(**kwargs) -> Agent:
    llm = gemini.Realtime(fps=3)

    nano_processor = NanoBananaProcessor(
        api_key=os.getenv("GOOGLE_API_KEY"),
        model=os.getenv("NANO_BANANA_MODEL", "gemini-2.5-flash-image"),
        output_dir=os.getenv("TRYON_OUTPUT_DIR", str(base_dir / "outputs")),
    )

    @llm.register_function(
        description="Set the merchandise image to try on. Input should be a local file path or data URL."
    )
    async def set_merchandise(image_path_or_url: str) -> str:
        value = await nano_processor.set_merchandise(image_path_or_url)
        return f"Merchandise set to: {value}"

    @llm.register_function(
        description="Set the captured customer pose image (from pose/camera capture pipeline). Input should be a local file path or data URL."
    )
    async def set_pose_image(image_path_or_url: str) -> str:
        value = await nano_processor.set_pose_image(image_path_or_url)
        return f"Pose image set to: {value}"

    @llm.register_function(
        description="Generate a virtual try-on result using the captured pose image (or latest camera frame fallback) and selected merchandise."
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
        configured_local_path = LOCAL_MERCHANDISE_IMAGE_PATH.strip()
        payload_path = image_url.strip() if isinstance(image_url, str) else ""
        merchandise_source = configured_local_path or payload_path

        if not merchandise_source:
            return "No merchandise image source provided. Set LOCAL_MERCHANDISE_IMAGE_PATH or send image_url."

        await nano_processor.set_merchandise(merchandise_source)
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

    @llm.register_function(description="Clear the captured customer pose image.")
    async def clear_pose_image() -> str:
        await nano_processor.clear_pose_image()
        return "Pose image cleared."

    return Agent(
        edge=getstream.Edge(),
        agent_user=User(name="Assistant", id="agent"),
        instructions=(
            "You are a virtual mirror assistant. Help the user try on merchandise. "
            "Use set_merchandise to choose an item, set_pose_image with the captured customer pose image, "
            "then use try_on_current_item to generate a mirror try-on result."
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
                payload_image_url = payload.get("image_url")
                payload_product_url = payload.get("product_url")
                item_id = payload.get("item_id")
                item_name = payload.get("item_name")
                pose_image_url = payload.get("pose_image_url")

                configured_local_path = LOCAL_MERCHANDISE_IMAGE_PATH.strip()
                image_source = configured_local_path
                if not image_source and isinstance(payload_image_url, str):
                    image_source = payload_image_url.strip()

                product_url = payload_product_url.strip() if isinstance(payload_product_url, str) else ""
                if not product_url and isinstance(item_name, str) and item_name.strip():
                    product_url = await asyncio.to_thread(_resolve_product_url, item_name)

                if image_source:
                    await nano_processor.set_merchandise(image_source)

                    if isinstance(pose_image_url, str) and pose_image_url.strip():
                        await nano_processor.set_pose_image(pose_image_url)

                    result = await nano_processor.generate_tryon()
                    result["item_id"] = item_id
                    result["product_url"] = product_url
                    await nano_processor.emit_result(result)

            elif event_type == "set_pose_image":
                pose_image_url = payload.get("pose_image_url")
                if isinstance(pose_image_url, str) and pose_image_url.strip():
                    await nano_processor.set_pose_image(pose_image_url)

                    # Ensure a garment is available, preferring configured local image.
                    configured_local_path = LOCAL_MERCHANDISE_IMAGE_PATH.strip()
                    if configured_local_path:
                        await nano_processor.set_merchandise(configured_local_path)

                    if nano_processor.merchandise_image:
                        result = await nano_processor.generate_tryon()
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
            "Hi! I can help with virtual try-on. Provide the merchandise image URL/path and the captured pose image URL/path, then ask me to generate the try-on."
        )
        await agent.finish()


if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
