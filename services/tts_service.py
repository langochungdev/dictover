from __future__ import annotations

from urllib.parse import quote


GOOGLE_TTS_ENDPOINT = "https://translate.googleapis.com/translate_tts"
SUPPORTED_TTS_LANGUAGES = {
    "en",
    "zh-CN",
    "zh-TW",
    "ja",
    "ko",
    "ru",
    "fi",
    "de",
    "fr",
    "vi",
}


def normalize_tts_language(language: str) -> str:
    code = str(language or "").strip().replace("_", "-")
    lowered = code.lower()
    if lowered in {"zh-tw", "zh-hk", "zh-mo", "zh-hant"}:
        return "zh-TW"
    if lowered.startswith("zh"):
        return "zh-CN"
    return code if code in SUPPORTED_TTS_LANGUAGES else "en"


def build_google_tts_url(text: str, language: str) -> str:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return ""

    lang = normalize_tts_language(language)
    query = quote(normalized_text)
    return f"{GOOGLE_TTS_ENDPOINT}?ie=UTF-8&client=gtx&tl={quote(lang)}&q={query}"


def has_native_tts_fallback(audio_url: str) -> bool:
    return not bool((audio_url or "").strip())
