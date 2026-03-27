from __future__ import annotations

import html
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en"
WIKTIONARY_ENDPOINT = "https://en.wiktionary.org/api/rest_v1/page/definition"
WIKTIONARY_ACTION_ENDPOINT = "https://{domain}.wiktionary.org/w/api.php"
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
WIKITEXT_TEMPLATE_PATTERN = re.compile(r"\{\{[^{}]*\}\}")
WIKITEXT_LINK_WITH_LABEL_PATTERN = re.compile(r"\[\[[^\]|]+\|([^\]]+)\]\]")
WIKITEXT_LINK_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")
WIKITEXT_FORMATTING_PATTERN = re.compile(r"'{2,}")
AUDIO_TEMPLATE_PATTERN = re.compile(r"\{\{\s*audio\s*\|([^}]*)\}\}", re.IGNORECASE)
MEDIA_FILENAME_PATTERN = re.compile(r"([^|{}]+\.(?:ogg|oga|mp3|wav))", re.IGNORECASE)
LANGUAGE_TO_WIKTIONARY_KEY = {
    "en": "en",
    "zh-CN": "zh",
    "ja": "ja",
    "ko": "ko",
    "ru": "ru",
    "fi": "fi",
    "de": "de",
    "fr": "fr",
    "vi": "vi",
}
LANGUAGE_TO_WIKTIONARY_DOMAIN = {
    "en": "en",
    "zh-CN": "zh",
    "ja": "ja",
    "ko": "ko",
    "ru": "ru",
    "fi": "fi",
    "de": "de",
    "fr": "fr",
    "vi": "vi",
}


def _normalize_source_language(source_language: str) -> str:
    normalized = str(source_language or "en").strip()
    return normalized if normalized in LANGUAGE_TO_WIKTIONARY_KEY else "en"


def _request_json(url: str, timeout: int) -> object:
    request = Request(url, headers={"User-Agent": "anki-popup-lookup/1.0"})
    with urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _clean_text(value: str) -> str:
    without_tags = HTML_TAG_PATTERN.sub("", value)
    unescaped = html.unescape(without_tags)
    compact = re.sub(r"\s+", " ", unescaped)
    return compact.strip()


def _fetch_dictionaryapi(word: str, timeout: int) -> list[dict]:
    url = f"{API_ENDPOINT}/{quote(word)}"
    try:
        parsed = _request_json(url, timeout)
    except HTTPError as error:
        if error.code == 404:
            raise LookupError("Word not found") from error
        raise RuntimeError("Dictionary API request failed") from error
    except URLError as error:
        raise RuntimeError("Dictionary API unavailable") from error

    if not isinstance(parsed, list) or not parsed:
        raise RuntimeError("Invalid dictionary response")
    return parsed


def _resolve_wiktionary_entries(parsed: dict, source_language: str, allow_cross_language: bool) -> list[dict]:
    preferred_key = LANGUAGE_TO_WIKTIONARY_KEY.get(source_language, "en")
    if isinstance(parsed.get(preferred_key), list) and parsed[preferred_key]:
        return parsed[preferred_key]

    if "-" in source_language:
        short_key = source_language.split("-", 1)[0]
        if isinstance(parsed.get(short_key), list) and parsed[short_key]:
            return parsed[short_key]

    if not allow_cross_language:
        return []

    if isinstance(parsed.get("en"), list) and parsed["en"]:
        return parsed["en"]

    for key, value in parsed.items():
        if key == "other":
            continue
        if isinstance(value, list) and value:
            return value

    return []


def _clean_wikitext_line(value: str) -> str:
    text = str(value or "")

    while True:
        reduced = WIKITEXT_TEMPLATE_PATTERN.sub(" ", text)
        if reduced == text:
            break
        text = reduced

    text = WIKITEXT_LINK_WITH_LABEL_PATTERN.sub(r"\1", text)
    text = WIKITEXT_LINK_PATTERN.sub(r"\1", text)
    text = WIKITEXT_FORMATTING_PATTERN.sub("", text)
    text = re.sub(r"\[[^\]]+\]", " ", text)
    return _clean_text(text)


def _build_wikimedia_audio_url(file_name: str) -> str:
    cleaned = str(file_name or "").strip()
    if not cleaned:
        return ""
    normalized_name = cleaned.replace(" ", "_")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(normalized_name)}"


def _extract_audio_url_from_wikitext(wikitext: str) -> str:
    for match in AUDIO_TEMPLATE_PATTERN.findall(str(wikitext or "")):
        media_match = MEDIA_FILENAME_PATTERN.search(match)
        if not media_match:
            continue
        return _build_wikimedia_audio_url(media_match.group(1))
    return ""


def _extract_audio_url_from_wiktionary_rest(entries: list[dict]) -> str:
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        pronunciations = entry.get("pronunciations")
        if not isinstance(pronunciations, list):
            continue
        for item in pronunciations:
            if not isinstance(item, dict):
                continue
            audio = str(item.get("audio") or "").strip()
            if audio:
                return audio
    return ""


def _extract_first_audio_from_entries(entries: list[dict]) -> str:
    if not entries:
        return ""
    first_entry = entries[0] if isinstance(entries[0], dict) else {}
    phonetics = first_entry.get("phonetics") if isinstance(first_entry, dict) else []
    if not isinstance(phonetics, list):
        return ""
    for item in phonetics:
        if not isinstance(item, dict):
            continue
        audio = str(item.get("audio") or "").strip()
        if audio:
            return audio
    return ""


def _extract_wiktionary_wikitext(payload: dict) -> str:
    query = payload.get("query") if isinstance(payload, dict) else None
    pages = query.get("pages") if isinstance(query, dict) else None
    if not isinstance(pages, dict) or not pages:
        return ""

    first_page = next(iter(pages.values()))
    if not isinstance(first_page, dict) or "missing" in first_page:
        return ""

    revisions = first_page.get("revisions")
    if not isinstance(revisions, list) or not revisions:
        return ""

    first_revision = revisions[0]
    if not isinstance(first_revision, dict):
        return ""

    slots = first_revision.get("slots")
    if isinstance(slots, dict):
        main = slots.get("main")
        if isinstance(main, dict):
            return str(main.get("*") or "")

    return str(first_revision.get("*") or "")


def _fetch_wiktionary_action(word: str, source_language: str, timeout: int) -> list[dict]:
    domain = LANGUAGE_TO_WIKTIONARY_DOMAIN.get(source_language, "en")
    url = (
        f"{WIKTIONARY_ACTION_ENDPOINT.format(domain=domain)}"
        f"?action=query&format=json&prop=revisions&rvslots=main&rvprop=content&titles={quote(word)}"
    )

    try:
        parsed = _request_json(url, timeout)
    except HTTPError as error:
        if error.code == 404:
            raise LookupError("Word not found") from error
        raise RuntimeError("Wiktionary action request failed") from error
    except URLError as error:
        raise RuntimeError("Wiktionary action unavailable") from error

    wikitext = _extract_wiktionary_wikitext(parsed)
    if not wikitext:
        raise LookupError("Word not found")

    audio_url = _extract_audio_url_from_wikitext(wikitext)

    meanings: list[dict] = []
    current_pos = "unknown"
    current_definitions: list[dict] = []

    for raw_line in wikitext.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith("=") and line.endswith("="):
            if current_definitions:
                meanings.append({"partOfSpeech": current_pos, "definitions": current_definitions})
                current_definitions = []

            heading = _clean_wikitext_line(line.strip("= "))
            current_pos = heading or "unknown"
            continue

        if line.startswith("#:") or line.startswith("#*") or line.startswith("#;"):
            continue

        if not line.startswith("#"):
            continue

        definition_text = _clean_wikitext_line(line.lstrip("# "))
        if not definition_text:
            continue
        current_definitions.append({"definition": definition_text, "example": ""})

    if current_definitions:
        meanings.append({"partOfSpeech": current_pos, "definitions": current_definitions})

    meanings = [item for item in meanings if item.get("definitions")]
    if not meanings:
        raise LookupError("Word not found")

    phonetics = [{"audio": audio_url}] if audio_url else []
    return [{"word": word, "phonetics": phonetics, "meanings": meanings}]


def _fetch_wiktionary(word: str, source_language: str, timeout: int) -> list[dict]:
    url = f"{WIKTIONARY_ENDPOINT}/{quote(word)}"
    try:
        parsed = _request_json(url, timeout)
    except HTTPError as error:
        if error.code == 404:
            raise LookupError("Word not found") from error
        raise RuntimeError("Wiktionary request failed") from error
    except URLError as error:
        raise RuntimeError("Wiktionary unavailable") from error

    if not isinstance(parsed, dict) or not parsed:
        raise LookupError("Word not found")

    entries = _resolve_wiktionary_entries(
        parsed,
        source_language,
        allow_cross_language=source_language == "en",
    )
    if not entries:
        raise LookupError("Word not found")

    audio_url = _extract_audio_url_from_wiktionary_rest(entries)

    meanings: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        part_of_speech = str(entry.get("partOfSpeech") or "").strip().lower() or "unknown"
        raw_definitions = entry.get("definitions")
        if not isinstance(raw_definitions, list):
            continue

        definitions: list[dict] = []
        for item in raw_definitions:
            if not isinstance(item, dict):
                continue
            definition_text = _clean_text(str(item.get("definition") or ""))
            if not definition_text:
                continue

            example_text = ""
            examples = item.get("examples")
            if isinstance(examples, list) and examples:
                example_text = _clean_text(str(examples[0]))

            definitions.append({"definition": definition_text, "example": example_text})

        if definitions:
            meanings.append({"partOfSpeech": part_of_speech, "definitions": definitions})

    if not meanings:
        raise LookupError("Word not found")

    phonetics = [{"audio": audio_url}] if audio_url else []
    return [{"word": word, "phonetics": phonetics, "meanings": meanings}]


def fetch_definition(word: str, source_language: str = "en", timeout: int = 5) -> list[dict]:
    normalized = (word or "").strip()
    if not normalized:
        raise LookupError("Missing word")

    resolved_source = _normalize_source_language(source_language)
    normalized_for_dictionaryapi = normalized.lower()

    if resolved_source != "en":
        try:
            rest_data = _fetch_wiktionary(normalized, resolved_source, timeout)
            if _extract_first_audio_from_entries(rest_data):
                return rest_data

            try:
                action_data = _fetch_wiktionary_action(normalized, resolved_source, timeout)
            except (LookupError, RuntimeError):
                return rest_data

            action_audio = _extract_first_audio_from_entries(action_data)
            if action_audio:
                first_entry = rest_data[0] if isinstance(rest_data[0], dict) else {}
                first_entry["phonetics"] = [{"audio": action_audio}]
                return rest_data

            return rest_data
        except LookupError as primary_error:
            try:
                return _fetch_wiktionary_action(normalized, resolved_source, timeout)
            except RuntimeError:
                raise primary_error
        except RuntimeError:
            return _fetch_wiktionary_action(normalized, resolved_source, timeout)

    try:
        return _fetch_dictionaryapi(normalized_for_dictionaryapi, timeout)
    except LookupError as primary_error:
        try:
            rest_data = _fetch_wiktionary(normalized, resolved_source, timeout)
            if _extract_first_audio_from_entries(rest_data):
                return rest_data

            try:
                action_data = _fetch_wiktionary_action(normalized, resolved_source, timeout)
            except (LookupError, RuntimeError):
                return rest_data

            action_audio = _extract_first_audio_from_entries(action_data)
            if action_audio:
                first_entry = rest_data[0] if isinstance(rest_data[0], dict) else {}
                first_entry["phonetics"] = [{"audio": action_audio}]
            return rest_data
        except LookupError:
            raise primary_error
        except RuntimeError:
            raise primary_error
    except RuntimeError:
        return _fetch_wiktionary(normalized, resolved_source, timeout)
