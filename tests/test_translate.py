from unittest.mock import patch

from features.translate.handler import handle_translate


def test_handle_translate_success():
    with patch("services.translation_service.translate_text") as mocked_translate:
        mocked_translate.return_value = "Xin chao"
        result = handle_translate("Hello")

    assert result["type"] == "translate"
    assert result["original"] == "Hello"
    assert result["translated"] == "Xin chao"
