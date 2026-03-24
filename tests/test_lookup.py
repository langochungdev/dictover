from unittest.mock import patch

from features.lookup.handler import handle_lookup


def test_handle_lookup_success():
    with patch("services.dictionary_api.fetch_definition") as mocked_fetch:
        mocked_fetch.return_value = [
            {
                "word": "test",
                "phonetic": "/tɛst/",
                "phonetics": [{"text": "/tɛst/", "audio": "https://example.com/test.mp3"}],
                "meanings": [
                    {
                        "partOfSpeech": "noun",
                        "definitions": [{"definition": "A procedure", "example": "Run a test"}],
                    }
                ],
            }
        ]

        result = handle_lookup("test")

    assert result["type"] == "lookup"
    assert result["word"] == "test"
    assert result["audio_url"] == "https://example.com/test.mp3"
