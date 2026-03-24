from __future__ import annotations


def has_native_tts_fallback(audio_url: str) -> bool:
    return not bool((audio_url or "").strip())
