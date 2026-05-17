import asyncio
import base64
import io
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from PIL import Image
from vision_agents.core import Agent, AgentLauncher, Runner, User
from vision_agents.plugins import gemini
from vision_agents.plugins import getstream as va_getstream


base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

SAVED_PROMPT_FILE = base_dir / "saved_prompt.txt"
CAPTURES_DIR = base_dir / "captures"
CAPTURES_DIR.mkdir(exist_ok=True)

CLOSET_ITEMS = [
    {
        "id": "t1",
        "name": "Cyberpunk Bomber",
        "image_url": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
    },
    {
        "id": "t2",
        "name": "Classic Denim Jacket",
        "image_url": "https://images.unsplash.com/photo-1541099649105-f69ad21f3246",
    },
    {
        "id": "t3",
        "name": "Oversized Linen Shirt",
        "image_url": "https://images.unsplash.com/photo-1596755094514-f87e34085b2c",
    },
    {
        "id": "t4",
        "name": "Minimalist Black Tee",
        "image_url": "https://images.unsplash.com/photo-1527719327859-c6ce80353573",
    },
]


def _closest_item(query: str) -> dict[str, str] | None:
    normalized = query.strip().lower()
    if not normalized:
        return None

    exact = next((item for item in CLOSET_ITEMS if item["name"].lower() == normalized), None)
    if exact:
        return exact

    partial = next((item for item in CLOSET_ITEMS if normalized in item["name"].lower()), None)
    if partial:
        return partial

    tokens = normalized.split()
    return next(
        (
            item
            for item in CLOSET_ITEMS
            if any(token in item["name"].lower() for token in tokens)
        ),
        None,
    )


class _FrameCaptureProcessor:
    """Pass-through processor that caches the latest video frame for on-demand snapshots."""

    def __init__(self) -> None:
        self.latest_frame: Any | None = None
        self.call: Any | None = None
        self.latest_capture_data_url: str = ""

    def attach_call(self, call: Any) -> None:
        self.call = call

    async def process(self, frame: Any) -> Any:
        self.latest_frame = frame
        return frame

    @staticmethod
    def _png_to_data_url(path: Path) -> str:
        raw = path.read_bytes()
        encoded = base64.b64encode(raw).decode("ascii")
        return f"data:image/png;base64,{encoded}"

    async def emit_custom_event(self, event_type: str, payload: dict[str, Any]) -> None:
        if self.call is None:
            return
        try:
            maybe_coro = self.call.send_custom_event(event_type, payload)
            if asyncio.iscoroutine(maybe_coro):
                await maybe_coro
        except Exception:
            pass

    def save_snapshot(self) -> Path | None:
        """Convert the cached frame to PNG and write it to disk. Returns the path or None."""
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

        # Stable pointer other programs can watch
        (CAPTURES_DIR / "latest.png").unlink(missing_ok=True)
        img.save(CAPTURES_DIR / "latest.png", format="PNG")

        self.latest_capture_data_url = self._png_to_data_url(out_path)
        return out_path

    async def emit_capture_event(self, path: Path) -> None:
        payload = {
            "event": "photo_captured",
            "image_path": str(path),
            "image_data_url": self.latest_capture_data_url,
            "timestamp": datetime.now().isoformat(),
        }
        await self.emit_custom_event("photo_captured", payload)


async def create_agent(**_) -> Agent:
    llm = gemini.Realtime(fps=5)
    frame_capture = _FrameCaptureProcessor()

    async def take_photo() -> str:
        await asyncio.sleep(1)
        await asyncio.sleep(1)
        await asyncio.sleep(1)

        out_path = frame_capture.save_snapshot()
        if out_path is None:
            return "No video frame available — make sure the camera is on."

        await frame_capture.emit_capture_event(out_path)
        print(f"\n[VoiceAgent] Photo captured: {out_path}\n")
        return f"Photo captured: {out_path.name}"

    async def choose_garment(garment_name: str) -> str:
        item = _closest_item(garment_name)
        if item is None:
            available = ", ".join(i["name"] for i in CLOSET_ITEMS)
            return f"I could not match '{garment_name}'. Available items: {available}"

        pose_image_url = frame_capture.latest_capture_data_url
        payload = {
            "item_id": item["id"],
            "item_name": item["name"],
            "image_url": item["image_url"],
            "pose_image_url": pose_image_url,
            "source": "voice_agent",
        }

        await frame_capture.emit_custom_event("voice_garment_selected", payload)

        if pose_image_url:
            await frame_capture.emit_custom_event("generate_tryon", payload)
        else:
            await frame_capture.emit_custom_event("set_merchandise", payload)

        return f"Selected garment: {item['name']}"

    async def save_prompt(prompt: str) -> str:
        SAVED_PROMPT_FILE.write_text(prompt, encoding="utf-8")
        print(f"\n[VoiceAgent] Prompt saved: {prompt}\n")
        return "Prompt saved."

    async def read_saved_prompt() -> str:
        if SAVED_PROMPT_FILE.exists():
            return SAVED_PROMPT_FILE.read_text(encoding="utf-8")
        return "No prompt saved yet."

    llm.register_function(
        description=(
            "Call this immediately when the user says 'I'm ready'. "
            "Waits 3 seconds then captures a photo from the live video stream."
        )
    )(take_photo)
    llm.register_function(
        description=(
            "Select garment by spoken name. Use exact closet item names when possible, "
            "then emit selection and try-on events."
        )
    )(choose_garment)
    llm.register_function(
        description=(
            "Save the user's spoken words verbatim as a prompt for later use. "
            "Call this when the user says 'save that', 'done', or 'got it'."
        )
    )(save_prompt)
    llm.register_function(
        description="Read back the most recently saved prompt."
    )(read_saved_prompt)

    return Agent(
        edge=va_getstream.Edge(),
        agent_user=User(name="VoiceScribe", id="voice-agent"),
        instructions=(
            "You have three jobs:\n"
            "1. PHOTO: The moment you hear 'I'm ready', call take_photo immediately "
            "and count down out loud at the same time: '3... 2... 1... smile!'\n"
            "2. GARMENT: When the user asks to try an item, call choose_garment with the spoken garment name.\n"
            "3. TRANSCRIBE: When the user dictates a prompt and signals they're done "
            "('save that', 'done', 'got it'), call save_prompt with the exact words spoken.\n"
            "Never paraphrase. Keep confirmations brief."
        ),
        llm=llm,
        processors=[frame_capture],
    )


async def join_call(agent: Agent, call_type: str, call_id: str, **_) -> None:
    call = await agent.create_call(call_type, call_id)

    for processor in getattr(agent, "processors", []):
        if hasattr(processor, "attach_call"):
            processor.attach_call(call)

    async with agent.join(call):
        await agent.simple_response(
            "Ready. Say 'I'm ready' for a photo countdown, "
            "say an outfit name to select a garment, "
            "or dictate a prompt and say 'save that' when done."
        )
        await agent.finish()


if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
