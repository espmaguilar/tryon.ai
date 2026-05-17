import asyncio
import io
import subprocess
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


def speak_back(text: str) -> None:
    if not text.strip():
        return
    try:
        subprocess.run(["say", text], check=False)
    except Exception as exc:
        print(f"[VoiceAgent] TTS failed: {exc}")


class _FrameCaptureProcessor:
    """Pass-through processor that caches the latest video frame for on-demand snapshots."""

    def __init__(self) -> None:
        self.latest_frame: Any | None = None
        self.call: Any | None = None

    def attach_agent(self, agent: Any) -> None:
        # Compatibility hook expected by vision-agents Agent.
        _ = agent

    def attach_call(self, call: Any) -> None:
        self.call = call

    async def process(self, frame: Any) -> Any:
        self.latest_frame = frame
        return frame

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

        return out_path

    async def emit_capture_event(self, path: Path) -> None:
        """Broadcast a GetStream custom event so the React app or other agents can react."""
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


async def create_agent(**_) -> Agent:
    llm = gemini.Realtime(fps=5)
    frame_capture = _FrameCaptureProcessor()

    async def take_photo() -> str:
        # Countdown + capture
        for count in ("3", "2", "1"):
            speak_back(count)
            await asyncio.sleep(1)

        out_path = frame_capture.save_snapshot()
        if out_path is None:
            return "No video frame available — make sure the camera is on."

        await frame_capture.emit_capture_event(out_path)
        speak_back("Photo captured.")
        print(f"\n[VoiceAgent] Photo captured: {out_path}\n")
        return f"Photo captured: {out_path.name}"

    async def save_prompt(prompt: str) -> str:
        SAVED_PROMPT_FILE.write_text(prompt, encoding="utf-8")
        speak_back("Prompt saved.")
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
            "You have two jobs:\n"
            "1. PHOTO: The moment you hear 'I'm ready', call take_photo immediately "
            "and count down out loud at the same time: '3... 2... 1... smile!'\n"
            "2. TRANSCRIBE: When the user dictates a prompt and signals they're done "
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
        async def handle_custom_event(event: dict) -> None:
            event_type = event.get("type")
            payload = event.get("payload", {}) or {}

            if event_type == "voice_control":
                action = payload.get("action")
                if action == "start_transcription":
                    await agent.simple_response(
                        "Voice mode started. Say I'm ready to capture a photo, then dictate your prompt."
                    )
                elif action == "stop_transcription":
                    await agent.simple_response("Voice mode stopped.")

        try:
            maybe_coro = call.on("custom", handle_custom_event)
            _ = maybe_coro
        except Exception:
            pass

        await agent.simple_response(
            "Ready. Say 'I'm ready' for a photo countdown, "
            "or dictate a prompt and say 'save that' when done."
        )
        await agent.finish()


if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
