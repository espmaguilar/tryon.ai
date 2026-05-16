import asyncio
import time
import uuid
from pathlib import Path
from typing import Any


class NanoBananaProcessor:
    """
    Lightweight try-on processor for vision-agents pipeline.

    Design:
    - `process(frame)` is called on each incoming video frame from GetStream.
    - We cache the latest frame for snapshot-based try-on generation.
    - `generate_tryon()` runs on demand (LLM function or external trigger) to avoid
      expensive per-frame generation.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "nano-banana-2",
        output_dir: str | Path = "outputs",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.call: Any | None = None
        self.merchandise_image: str | None = None
        self.latest_frame: Any | None = None

        self._inflight_lock = asyncio.Lock()

    def attach_call(self, call: Any) -> None:
        self.call = call

    async def process(self, frame: Any) -> Any:
        # Keep video pipeline real-time: store frame and return immediately.
        self.latest_frame = frame
        return frame

    async def set_merchandise(self, image_path_or_url: str) -> str:
        self.merchandise_image = image_path_or_url.strip()
        return self.merchandise_image

    async def clear_merchandise(self) -> None:
        self.merchandise_image = None

    async def generate_tryon(self) -> dict[str, Any]:
        start = time.perf_counter()

        if self.latest_frame is None:
            return {
                "status": "error",
                "reason": "no_frame_available",
                "message": "No video frame has been received yet.",
            }

        if not self.merchandise_image:
            return {
                "status": "error",
                "reason": "missing_merchandise",
                "message": "Please set a merchandise image first.",
            }

        if self._inflight_lock.locked():
            return {
                "status": "busy",
                "message": "A try-on generation is already in progress.",
            }

        async with self._inflight_lock:
            job_id = str(uuid.uuid4())
            result = await self._run_tryon(job_id)

            latency_ms = int((time.perf_counter() - start) * 1000)
            result["job_id"] = job_id
            result["latency_ms"] = latency_ms
            return result

    async def emit_result(self, result: dict[str, Any]) -> None:
        if self.call is None:
            return

        payload = {
            "event": "mirror_update",
            "job_id": result.get("job_id"),
            "status": result.get("status", "unknown"),
            "image_url": result.get("image_url"),
            "latency_ms": result.get("latency_ms"),
            "reason": result.get("reason"),
            "message": result.get("message"),
        }

        try:
            maybe_coro = self.call.send_custom_event("mirror_update", payload)
            if asyncio.iscoroutine(maybe_coro):
                await maybe_coro
        except Exception:
            # Non-fatal: keep agent stable even if custom events are unsupported.
            pass

    async def _run_tryon(self, job_id: str) -> dict[str, Any]:
        """
        Placeholder integration point for Nano Banana model invocation.

        For now this returns a mock result so end-to-end event flow can be tested.
        Replace this body with your production Nano Banana API call.
        """
        if not self.api_key:
            return {
                "status": "mock",
                "image_url": self.merchandise_image,
                "message": "NANO_BANANA_API_KEY is not set; returning mock mirror result.",
            }

        # Production hook:
        # 1) Convert `self.latest_frame` to image bytes/file.
        # 2) Send frame + merchandise image to Nano Banana API.
        # 3) Persist returned image URL/path and return it.
        #
        # Until an SDK/API contract is finalized, return a deterministic placeholder.
        output_file = self.output_dir / f"tryon_{job_id}.txt"
        output_file.write_text(
            "Nano Banana API hook pending.\n"
            f"merchandise={self.merchandise_image}\n"
            f"model={self.model}\n",
            encoding="utf-8",
        )

        return {
            "status": "pending_api_hook",
            "image_url": str(output_file),
            "message": "API key detected. Wire your Nano Banana request in _run_tryon().",
        }
