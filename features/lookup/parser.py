from __future__ import annotations

from typing import Any


def parse_response(data: list[dict[str, Any]], max_definitions: int = 3) -> dict[str, Any]:
    if not data:
        raise ValueError("Empty dictionary response")

    entry = data[0] if isinstance(data[0], dict) else {}
    word = str(entry.get("word") or "").strip()

    phonetics = entry.get("phonetics") or []
    phonetic = str(entry.get("phonetic") or "").strip()
    if not phonetic:
        for item in phonetics:
            text = str(item.get("text") or "").strip() if isinstance(item, dict) else ""
            if text:
                phonetic = text
                break

    audio_url = ""
    for item in phonetics:
        if not isinstance(item, dict):
            continue
        audio = str(item.get("audio") or "").strip()
        if audio:
            audio_url = audio
            break

    meanings_output: list[dict[str, Any]] = []
    meanings = entry.get("meanings") or []
    for meaning in meanings:
        if not isinstance(meaning, dict):
            continue
        part_of_speech = str(meaning.get("partOfSpeech") or "").strip()

        definitions_output: list[dict[str, str]] = []
        raw_definitions = meaning.get("definitions") or []
        for definition in raw_definitions[:max_definitions]:
            if not isinstance(definition, dict):
                continue
            definition_text = str(definition.get("definition") or "").strip()
            if not definition_text:
                continue
            example_text = str(definition.get("example") or "").strip()
            definitions_output.append(
                {
                    "definition": definition_text,
                    "example": example_text,
                }
            )

        if definitions_output:
            meanings_output.append(
                {
                    "partOfSpeech": part_of_speech,
                    "definitions": definitions_output,
                }
            )

    return {
        "word": word,
        "phonetic": phonetic,
        "audio_url": audio_url,
        "meanings": meanings_output,
    }
