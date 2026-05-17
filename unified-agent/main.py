import asyncio
import importlib.util
import io
import os
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from dotenv import load_dotenv
from PIL import Image
from vision_agents.core import Agent, AgentLauncher, Runner, User
from vision_agents.plugins import gemini, getstream, ultralytics

from nano_banana import NanoBananaProcessor

base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

SAVED_PROMPT_FILE = base_dir / "saved_prompt.txt"
CAPTURES_DIR = base_dir / "captures"
CAPTURES_DIR.mkdir(exist_ok=True)

LOCAL_MERCHANDISE_IMAGE_PATH = "/Users/ryanfoster/Desktop/1dcd35bc9ac0fce33944798239aff636.png"

if os.getenv("serper_API") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("serper_API", "")

def speak_back(text: str) -> None:
    if not text.strip():
        return
    try:
        subprocess.run(["say", text], check=False)
    except Exception as exc:
        print(f"[UnifiedAgent] TTS failed: {exc}")

class _FrameCaptureProcessor:
    def __init__(self) -> None:
        self.latest_frame: Any | None = None
        self.call: Any | None = None

    def attach_agent(self, agent: Any) -> None:
        _ = agent

    def attach_call(self, call: Any) -> None:
        self.call = call

    async def process(self, frame: Any) -> Any:
        self.latest_frame = frame
        return frame

    def save_snapshot(self) -> Path | None:
        frame = self.latest_frame
        if frame is None:
            return None

        if isinstance(frame, Image.Image):
            img = frame.convert("RGB")
        elif hasattr(frame, "to_ndarray"):
            img = Image.fromarray(frame.to_ndarray(format="rgb24")).convert("RGB")
        elif hasattr(frame, "__array_interface__") or hasattr(frame, "shape"):
            img = Image.fromarray(frame).convert("RGB")
        elif isinstance(frame, (bytes, bytearray, memoryview)):
            img = Image.open(io.BytesIO(bytes(frame))).convert("RGB")
        else:
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = CAPTURES_DIR / f"capture_{timestamp}.png"
        img.save(out_path, format="PNG")

        (CAPTURES_DIR / "latest.png").unlink(missing_ok=True)
        img.save(CAPTURES_DIR / "latest.png", format="PNG")

        return out_path

    async def emit_capture_event(self, path: Path) -> None:
        if self.call is None:
            return
        payload = {
            "event": "photo_captured",
            "image_path": str(path),
            "timestamp": datetime.now().isoformat(),
        }
        try:
            maybe_coro = self.call.send_custom_event("photo_captured", payload)
            if asyncio.iscoroutine(maybe_coro):
                await maybe_coro
        except Exception:
            pass

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

def _build_generic_product_url(item_name: str) -> str:
    normalized_name = item_name.strip()
    if not normalized_name:
        return "https://www.google.com/search?q=clothing+product"
    return f"https://www.google.com/search?q={quote_plus(normalized_name + ' clothing product')}"

def _resolve_product_url(item_name: str) -> tuple[str, str]:
    normalized_name = item_name.strip()
    if not normalized_name:
        return _build_generic_product_url(""), "generic"

    module = _load_style_finder_module()
    api_key = os.getenv("serper_API", "").strip()

    if module is not None and api_key:
        try:
            output_url, _, _, _ = module.find_product_url_with_backplan(
                normalized_name,
                api_key,
                module.DEFAULT_LIMIT,
                module.MAX_BACKPLAN_ATTEMPTS,
            )
            if isinstance(output_url, str) and output_url.strip():
                return output_url.strip(), "style_finder"
        except Exception:
            pass

    return _build_generic_product_url(normalized_name), "generic"

async def create_agent(**kwargs) -> Agent:
    llm = gemini.Realtime(fps=3, model="gemini-3.1-flash-live-preview")

    frame_capture = _FrameCaptureProcessor()
    nano_processor = NanoBananaProcessor(
        api_key=os.getenv("GOOGLE_API_KEY"),
        model=os.getenv("NANO_BANANA_MODEL", "gemini-2.5-flash-image"),
        output_dir=os.getenv("TRYON_OUTPUT_DIR", str(base_dir / "outputs")),
    )
    pose_processor = ultralytics.YOLOPoseProcessor(model_path="yolo26n-pose.pt")

    processors = [frame_capture, nano_processor, pose_processor]

    # Voice Agent tools
    async def take_photo() -> str:
        for count in ("3", "2", "1"):
            speak_back(count)
            await asyncio.sleep(1)

        out_path = frame_capture.save_snapshot()
        if out_path is None:
            return "No video frame available — make sure the camera is on."

        await frame_capture.emit_capture_event(out_path)
        speak_back("Photo captured.")
        print(f"\n[UnifiedAgent] Photo captured: {out_path}\n")
        return f"Photo captured: {out_path.name}"

    async def save_prompt(prompt: str) -> str:
        SAVED_PROMPT_FILE.write_text(prompt, encoding="utf-8")
        speak_back("Prompt saved.")
        print(f"\n[UnifiedAgent] Prompt saved: {prompt}\n")
        return "Prompt saved."

    async def read_saved_prompt() -> str:
        if SAVED_PROMPT_FILE.exists():
            return SAVED_PROMPT_FILE.read_text(encoding="utf-8")
        return "No prompt saved yet."

    llm.register_function(
        description="Call this immediately when the user says 'I'm ready'. Waits 3 seconds then captures a photo from the live video stream."
    )(take_photo)
    llm.register_function(
        description="Save the user's spoken words verbatim as a prompt for later use. Call this when the user says 'save that', 'done', or 'got it'."
    )(save_prompt)
    llm.register_function(
        description="Read back the most recently saved prompt."
    )(read_saved_prompt)

    # My Agent tools
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
        product_url, product_url_source = await asyncio.to_thread(_resolve_product_url, item_id)
        result["product_url"] = product_url
        result["product_url_source"] = product_url_source
        await nano_processor.emit_result(result)
        return (
            f"Applied item_id={item_id}, status={result.get('status')}, "
            f"image_url={result.get('image_url')}, product_url_source={product_url_source}"
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
        agent_user=User(name="UnifiedAgent", id="unified-agent"),
        instructions=(
            "You are a unified virtual mirror assistant. Your workflow is:\n"
            "1. COACHING: Provide real-time feedback on the user's form.\n"
            "2. TRY-ON COORDINATION: When the user wants to try on an item, ASK your Assistant to find it. "
            "Wait for the Assistant to confirm they sent the image. Then tell the user you will take their photo. "
            "Use take_photo to capture their pose. Once captured, use set_pose_image with the photo path, and FINALLY call try_on_current_item to generate the try-on."
        ),
        llm=llm,
        processors=processors,
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
            event_type = event.get("type")
            payload = event.get("payload", {}) or {}

            # Voice control
            if event_type == "voice_control":
                action = payload.get("action")
                if action == "start_transcription":
                    await agent.simple_response(
                        "Voice mode started. Say I'm ready to capture a photo, then dictate your prompt."
                    )
                elif action == "stop_transcription":
                    await agent.simple_response("Voice mode stopped.")

            # Try-On Events
            if not nano_processor:
                return

            if event_type == "receive_merchandise_image":
                url = payload.get("image_url")
                if url:
                    await nano_processor.set_merchandise(url)
                    await agent.simple_response("I have received the image from the Assistant. Get ready, I will now take your photo for the try-on!")

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
                product_url_source = "provided" if product_url else ""
                if not product_url:
                    item_name_value = item_name if isinstance(item_name, str) else ""
                    product_url, product_url_source = await asyncio.to_thread(
                        _resolve_product_url, item_name_value
                    )

                if image_source:
                    await nano_processor.set_merchandise(image_source)

                    if isinstance(pose_image_url, str) and pose_image_url.strip():
                        await nano_processor.set_pose_image(pose_image_url)

                    result = await nano_processor.generate_tryon()
                    result["item_id"] = item_id
                    result["product_url"] = product_url
                    result["product_url_source"] = product_url_source
                    await nano_processor.emit_result(result)

            elif event_type == "set_pose_image":
                pose_image_url = payload.get("pose_image_url")
                if isinstance(pose_image_url, str) and pose_image_url.strip():
                    await nano_processor.set_pose_image(pose_image_url)

                    configured_local_path = LOCAL_MERCHANDISE_IMAGE_PATH.strip()
                    if configured_local_path:
                        await nano_processor.set_merchandise(configured_local_path)

                    if nano_processor.merchandise_image:
                        result = await nano_processor.generate_tryon()
                        await nano_processor.emit_result(result)

            elif event_type == "camera_state":
                _ = payload.get("is_camera_active")

        try:
            maybe_coro = call.on("custom", handle_custom_event)
            _ = maybe_coro
        except Exception:
            pass

        await agent.simple_response(
            "Hi! I am your unified assistant. I can analyze your form, capture photos with a countdown, and generate virtual try-ons."
        )
        await agent.finish()

if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
