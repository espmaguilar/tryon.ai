import os
import re
import json
import time
import threading
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from dotenv import load_dotenv
from getstream import Stream


base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

SAVED_PROMPT_FILE = base_dir / "saved_prompt.txt"
WEBHOOK_PORT = 8765

_transcript_event = threading.Event()
_transcript_text: dict[str, str | None] = {"value": None}


class _WebhookHandler(BaseHTTPRequestHandler):
    """Receives the call.transcription_ready event from GetStream."""

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        event = json.loads(self.rfile.read(length))

        if event.get("type") == "call.transcription_ready":
            url = event.get("call_transcription", {}).get("url", "")
            if url:
                vtt = urllib.request.urlopen(url).read().decode("utf-8")
                lines = []
                for line in vtt.splitlines():
                    line = line.strip()
                    if line and "WEBVTT" not in line and "-->" not in line:
                        clean = re.sub(r"<[^>]+>", "", line)
                        if clean:
                            lines.append(clean)
                _transcript_text["value"] = " ".join(lines)
                _transcript_event.set()

        self.send_response(200)
        self.end_headers()

    def log_message(self, *_):
        pass


def main():
    api_key = os.getenv("STREAM_API_KEY")
    api_secret = os.getenv("STREAM_API_SECRET")
    webhook_url = os.getenv("WEBHOOK_URL")  # e.g. https://xxxx.ngrok.io

    client = Stream(api_key=api_key, api_secret=api_secret)

    call_id = f"voice-{int(time.time())}"
    user_id = "voice-user"

    client.upsert_users([{"id": user_id, "name": "Voice User", "role": "user"}])
    token = client.create_token(user_id=user_id)

    call = client.video.call("default", call_id)
    call.get_or_create(data={"created_by_id": user_id})
    call.start_transcription()

    print("\n[VoiceAgent] ── Session started ──")
    print(f"  Call ID : {call_id}")
    print(f"  API Key : {api_key}")
    print(f"  Token   : {token}")
    print("\nJoin the call with these credentials and speak your prompt.")

    if webhook_url:
        server = HTTPServer(("", WEBHOOK_PORT), _WebhookHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"[VoiceAgent] Webhook listener on port {WEBHOOK_PORT}")
    else:
        print("[VoiceAgent] WEBHOOK_URL not set — transcript auto-save disabled.")
        print("             Set WEBHOOK_URL in .env and point your GetStream dashboard webhook here.")

    print("\nPress Enter when done speaking...\n")
    input()

    call.stop_transcription()
    print("[VoiceAgent] Transcription stopped. Waiting for transcript...")

    if webhook_url and _transcript_event.wait(timeout=60):
        text = _transcript_text["value"]
        SAVED_PROMPT_FILE.write_text(text, encoding="utf-8")
        print(f"\n[SAVED PROMPT]\n{text}")
        print(f"\n[VoiceAgent] Saved to: {SAVED_PROMPT_FILE}")
    else:
        SAVED_PROMPT_FILE.write_text(f"PENDING:{call_id}", encoding="utf-8")
        print(f"[VoiceAgent] Transcript pending. Call ID saved to {SAVED_PROMPT_FILE}")
        print(f"             Configure WEBHOOK_URL in .env to receive it automatically.")


if __name__ == "__main__":
    main()
