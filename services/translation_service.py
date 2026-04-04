from __future__ import annotations

import json
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen

REQUEST_TIMEOUT_SECONDS = 2.5
REQUEST_RETRY_COUNT = 2
REQUEST_RETRY_DELAY_SECONDS = 0.3

TRADITIONAL_ONLY_CHARS = frozenset(
    "萬與專業東絲兩嚴喪個豐為麗舉麼義烏樂喬習鄉書買亂爭於虧雲亞產畝親褻複見覺觀說讀變讓護邊現這還體龍"
)
SIMPLIFIED_ONLY_CHARS = frozenset(
    "万与专业东丝两严丧个丰为丽举么义乌乐乔习乡书买乱争于亏云亚产亩亲亵复见觉观说读变让护边现这还体龙"
)
SUPPORTED_NON_ZH_LANGUAGES = {"en", "ja", "ko", "ru", "fi", "de", "fr", "vi"}


def detect_chinese_variant(text: str) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return "zh-CN"

    traditional_hits = sum(1 for char in normalized if char in TRADITIONAL_ONLY_CHARS)
    simplified_hits = sum(1 for char in normalized if char in SIMPLIFIED_ONLY_CHARS)

    if traditional_hits > simplified_hits:
        return "zh-TW"
    return "zh-CN"


def normalize_detected_language(
    detected_language: str, sample_text: str = "", default_language: str = "en"
) -> str:
    detected = str(detected_language or "").strip().replace("_", "-")
    lowered = detected.lower()

    if lowered in {"zh-tw", "zh-hk", "zh-mo", "zh-hant"}:
        return "zh-TW"
    if lowered in {"zh-cn", "zh-sg", "zh-my", "zh-hans"}:
        return "zh-CN"
    if lowered.startswith("zh"):
        return detect_chinese_variant(sample_text)

    if lowered in SUPPORTED_NON_ZH_LANGUAGES:
        return lowered

    fallback = str(default_language or "en").strip()
    if fallback in SUPPORTED_NON_ZH_LANGUAGES | {"zh-CN", "zh-TW"}:
        return fallback
    return "en"


def _translate_payload(text: str, source_language: str, target_language: str) -> list:
    query = quote(text)
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl={source_language}&tl={target_language}&dt=t&q={query}"
    )

    last_error: Exception | None = None
    for attempt in range(REQUEST_RETRY_COUNT + 1):
        try:
            with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = response.read().decode("utf-8", errors="ignore")
            data = json.loads(payload)
            if not isinstance(data, list) or not data:
                raise RuntimeError("online translator returned an unexpected response")
            return data
        except (URLError, TimeoutError, OSError) as error:
            last_error = error
            if attempt >= REQUEST_RETRY_COUNT:
                break
            time.sleep(REQUEST_RETRY_DELAY_SECONDS * (attempt + 1))

    raise RuntimeError(f"online translator request failed: {last_error}")


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


def translate_text(
    text: str, source_language: str = "en", target_language: str = "vi"
) -> str:
    if not (text or "").strip():
        raise ValueError("Missing text")

    return _translate_online(text, source_language, target_language)
