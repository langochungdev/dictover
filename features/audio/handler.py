from __future__ import annotations

from typing import Any


def handle_audio(parsed_lookup: dict[str, Any]) -> dict[str, str]:
    audio_url = str(parsed_lookup.get("audio_url") or "").strip()
    if audio_url:
        return {"type": "audio", "audio_url": audio_url, "fallback": ""}

    return {
        "type": "audio",
        "audio_url": "",
        "fallback": "speechSynthesis",
    }
