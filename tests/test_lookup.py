from unittest.mock import patch

from features.lookup.handler import handle_lookup


def test_handle_lookup_success():
    with patch("services.dictionary_api.fetch_definition") as mocked_fetch:
        mocked_fetch.return_value = [
            {
                "word": "test",
                "phonetic": "/tɛst/",
                "phonetics": [
                    {"text": "/tɛst/", "audio": "https://example.com/test.mp3"}
                ],
                "meanings": [
                    {
                        "partOfSpeech": "noun",
                        "definitions": [
                            {"definition": "A procedure", "example": "Run a test"}
                        ],
                    }
                ],
            }
        ]

        result = handle_lookup("test")

    assert result["type"] == "lookup"
    assert result["word"] == "test"
    assert result["audio_url"] == "https://example.com/test.mp3"


def test_handle_lookup_fallback_to_google_translation_when_not_found():
    with patch(
        "services.dictionary_api.fetch_definition",
        side_effect=LookupError("Word not found"),
    ):
        with patch(
            "services.translation_service.translate_text", return_value="xin chao"
        ):
            with patch(
                "services.tts_service.build_google_tts_url",
                return_value="https://example.com/tts.mp3",
            ):
                result = handle_lookup("hello")

    assert result["type"] == "lookup"
    assert result["word"] == "hello"
    assert result["translated"] == "xin chao"
    assert result["audio_url"] == "https://example.com/tts.mp3"
    assert result["definition_display"] == "xin chao"
    assert len(result["meanings"]) == 1


def test_handle_lookup_not_found_when_google_fallback_fails():
    with patch(
        "services.dictionary_api.fetch_definition",
        side_effect=LookupError("Word not found"),
    ):
        with patch(
            "services.translation_service.translate_text",
            side_effect=RuntimeError("translate failed"),
        ):
            result = handle_lookup("hello")

    assert result["type"] == "error"
    assert result["message"] == "Khong tim thay tu nay."


def test_handle_lookup_auto_detects_traditional_chinese_variant():
    with patch("services.translation_service.detect_language", return_value="zh"):
        with patch("services.dictionary_api.fetch_definition") as mocked_fetch:
            mocked_fetch.return_value = [
                {
                    "word": "現在",
                    "phonetic": "",
                    "phonetics": [],
                    "meanings": [
                        {
                            "partOfSpeech": "noun",
                            "definitions": [{"definition": "current", "example": ""}],
                        }
                    ],
                }
            ]
            with patch(
                "services.translation_service.translate_text", return_value="hien tai"
            ):
                with patch(
                    "services.tts_service.build_google_tts_url",
                    return_value="https://example.com/tts.mp3",
                ):
                    result = handle_lookup("現在")

    assert result["type"] == "lookup"
    assert result["audio_lang"] == "zh-TW"


def test_handle_lookup_reject_too_long_input():
    result = handle_lookup("a" * 201)

    assert result["type"] == "error"
    assert result["message"] == "Tu can tra qua dai."
