from features.lookup.parser import parse_response


def test_parse_response_minimal_payload():
    payload = [
        {
            "word": "hello",
            "phonetics": [{"text": "/həˈloʊ/", "audio": "https://example.com/hello.mp3"}],
            "meanings": [
                {
                    "partOfSpeech": "exclamation",
                    "definitions": [{"definition": "Used as greeting.", "example": "Hello!"}],
                }
            ],
        }
    ]

    result = parse_response(payload)

    assert result["word"] == "hello"
    assert result["phonetic"] == "/həˈloʊ/"
    assert result["audio_url"] == "https://example.com/hello.mp3"
    assert result["meanings"][0]["partOfSpeech"] == "exclamation"
