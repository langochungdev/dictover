from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en"


def fetch_definition(word: str, timeout: int = 5) -> list[dict]:
    normalized = (word or "").strip().lower()
    if not normalized:
        raise LookupError("Missing word")

    url = f"{API_ENDPOINT}/{quote(normalized)}"
    request = Request(url, headers={"User-Agent": "anki-popup-lookup/1.0"})

    try:
        with urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
    except HTTPError as error:
        if error.code == 404:
            raise LookupError("Word not found") from error
        raise RuntimeError("Dictionary API request failed") from error
    except URLError as error:
        raise RuntimeError("Dictionary API unavailable") from error

    parsed = json.loads(payload)
    if not isinstance(parsed, list) or not parsed:
        raise LookupError("Invalid dictionary response")

    return parsed
