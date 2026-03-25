from __future__ import annotations

import json
from urllib.parse import quote
from urllib.request import urlopen

def _translate_payload(text: str, source_language: str, target_language: str) -> list:
    query = quote(text)
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl={source_language}&tl={target_language}&dt=t&q={query}"
    )

    with urlopen(url, timeout=2.5) as response:
        payload = response.read().decode("utf-8", errors="ignore")

    data = json.loads(payload)
    if not isinstance(data, list) or not data:
        raise RuntimeError("online translator returned an unexpected response")
    return data


def _translate_online(text: str, source_language: str, target_language: str) -> str:
    data = _translate_payload(text, source_language, target_language)

    segments = data[0]
    if not isinstance(segments, list):
        raise RuntimeError("online translator returned an unexpected segment format")

    translated_parts: list[str] = []
    for segment in segments:
        if isinstance(segment, list) and segment and isinstance(segment[0], str):
            translated_parts.append(segment[0])

    translated_text = "".join(translated_parts).strip()
    if not translated_text:
        raise RuntimeError("online translator returned an empty translation")

    return translated_text


def detect_language(text: str) -> str:
    if not (text or "").strip():
        raise ValueError("Missing text")

    data = _translate_payload(text, "auto", "en")
    detected = data[2] if len(data) > 2 and isinstance(data[2], str) else ""
    return detected.strip() or "auto"


def translate_text(text: str, source_language: str = "en", target_language: str = "vi") -> str:
    if not (text or "").strip():
        raise ValueError("Missing text")

    return _translate_online(text, source_language, target_language)
