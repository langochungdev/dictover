from unittest.mock import patch

from features.translate.handler import handle_translate
from services.tts_service import normalize_tts_language
from services.translation_service import (
    detect_chinese_variant,
    normalize_detected_language,
)


def test_handle_translate_success():
    with patch("services.translation_service.translate_text") as mocked_translate:
        mocked_translate.return_value = "Xin chao"
        result = handle_translate("Hello")

    assert result["type"] == "translate"
    assert result["original"] == "Hello"
    assert result["translated"] == "Xin chao"


def test_handle_translate_auto_detect_traditional_chinese_audio_lang():
    with patch("services.translation_service.detect_language", return_value="zh-Hant"):
        with patch("services.translation_service.translate_text", return_value="hello"):
            result = handle_translate("現在")

    assert result["audio_lang"] == "zh-TW"


def test_handle_translate_reject_too_long_input():
    result = handle_translate("a" * 2001)

    assert result["type"] == "error"
    assert result["message"] == "Doan van qua dai de dich."


def test_chinese_variant_detection_by_characters():
    assert detect_chinese_variant("現在") == "zh-TW"
    assert detect_chinese_variant("现在") == "zh-CN"


def test_normalize_detected_language_keeps_chinese_variant():
    assert normalize_detected_language("zh-Hant") == "zh-TW"
    assert normalize_detected_language("zh-Hans") == "zh-CN"
    assert normalize_detected_language("zh", sample_text="現在") == "zh-TW"


def test_tts_language_normalization_for_chinese_variants():
    assert normalize_tts_language("zh-HK") == "zh-TW"
    assert normalize_tts_language("zh-SG") == "zh-CN"
