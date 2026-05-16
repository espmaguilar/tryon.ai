import asyncio
import base64
import io
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from PIL import Image


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
        model: str = "gemini-2.5-flash-image",
        output_dir: str | Path = "outputs",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.call: Any | None = None
        self.merchandise_image: str | None = None
        self.pose_image: str | None = None
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

    async def set_pose_image(self, image_path_or_url: str) -> str:
        self.pose_image = image_path_or_url.strip()
        return self.pose_image

    async def clear_merchandise(self) -> None:
        self.merchandise_image = None

    async def clear_pose_image(self) -> None:
        self.pose_image = None

    async def generate_tryon(self) -> dict[str, Any]:
        start = time.perf_counter()

        if self.pose_image is None and self.latest_frame is None:
            return {
                "status": "error",
                "reason": "no_pose_or_frame_available",
                "message": "No captured pose image or video frame has been received yet.",
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

    @staticmethod
    def _is_url(value: str) -> bool:
        return value.startswith("http://") or value.startswith("https://")

    @staticmethod
    def _decode_maybe_base64(data: bytes | str) -> bytes:
        if isinstance(data, bytes):
            return data
        try:
            return base64.b64decode(data, validate=True)
        except Exception:
            return data.encode("utf-8")

    def _read_image_bytes_from_path_or_url(self, source: str) -> bytes:
        if self._is_url(source):
            with urllib.request.urlopen(source, timeout=20) as response:
                return response.read()
        return Path(source).read_bytes()

    def _image_bytes_from_frame(self, frame: Any) -> bytes:
        if isinstance(frame, (bytes, bytearray, memoryview)):
            return bytes(frame)

        if isinstance(frame, Image.Image):
            image = frame.convert("RGB")
        elif hasattr(frame, "to_ndarray"):
            ndarray = frame.to_ndarray(format="rgb24")
            image = Image.fromarray(ndarray).convert("RGB")
        elif hasattr(frame, "__array_interface__") or hasattr(frame, "shape"):
            image = Image.fromarray(frame).convert("RGB")
        else:
            raise ValueError(f"Unsupported frame type for image conversion: {type(frame)}")

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    @staticmethod
    def _extract_inline_image_bytes(response: Any) -> bytes | None:
        candidates = getattr(response, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            parts = getattr(content, "parts", None) or []
            for part in parts:
                inline_data = getattr(part, "inline_data", None)
                if not inline_data:
                    continue
                data = getattr(inline_data, "data", None)
                if data:
                    decoded = NanoBananaProcessor._decode_maybe_base64(data)
                    if decoded.startswith(b"\x89PNG") or decoded.startswith(b"\xff\xd8\xff"):
                        return decoded

        generated_images = getattr(response, "generated_images", None) or []
        for image_obj in generated_images:
            image = getattr(image_obj, "image", None)
            image_bytes = getattr(image, "image_bytes", None) if image else None
            if image_bytes:
                decoded = NanoBananaProcessor._decode_maybe_base64(image_bytes)
                if decoded.startswith(b"\x89PNG") or decoded.startswith(b"\xff\xd8\xff"):
                    return decoded
        return None

    async def _run_tryon(self, job_id: str) -> dict[str, Any]:
        """
        Real try-on invocation via Google GenAI image model.

        Input A: captured pose image (or latest frame fallback)
        Input B: selected merchandise image
        Output: generated try-on image saved locally and returned as image_url
        """
        if not self.api_key:
            return {
                "status": "error",
                "reason": "missing_api_key",
                "message": "GOOGLE_API_KEY is not set.",
            }

        try:
            if self.pose_image is not None:
                pose_source = self.pose_image
                base_image_bytes = await asyncio.to_thread(
                    self._read_image_bytes_from_path_or_url, self.pose_image
                )
            else:
                pose_source = "latest_frame"
                base_image_bytes = await asyncio.to_thread(
                    self._image_bytes_from_frame, self.latest_frame
                )

            garment_image_bytes = await asyncio.to_thread(
                self._read_image_bytes_from_path_or_url, self.merchandise_image
            )

            prompt = (
                "Virtual mirror try-on edit. Preserve the exact same person, face, pose, body proportions, camera "
                "angle, lighting, and full background from image 1. Replace only the worn clothing on the person so "
                "it matches the garment from image 2 with realistic fit and texture. Do not alter identity or scene. "
                "Return one photorealistic edited image."
            )

            client = genai.Client(api_key=self.api_key)
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=self.model,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=base_image_bytes, mime_type="image/png"),
                    types.Part.from_bytes(data=garment_image_bytes, mime_type="image/png"),
                ],
            )

            image_bytes = self._extract_inline_image_bytes(response)
            if not image_bytes:
                return {
                    "status": "error",
                    "reason": "no_image_in_model_response",
                    "message": "Model response did not include an edited image.",
                }

            output_file = self.output_dir / f"tryon_{job_id}.png"
            output_file.write_bytes(image_bytes)

            return {
                "status": "success",
                "image_url": str(output_file),
                "message": f"Try-on image generated from {pose_source}.",
            }
        except Exception as exc:
            return {
                "status": "error",
                "reason": "tryon_generation_failed",
                "message": f"Try-on generation failed: {exc}",
            }
