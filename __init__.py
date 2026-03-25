from __future__ import annotations

import json
import importlib
import sys
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen

from aqt import gui_hooks, mw

ADDON_MODULE = __name__.split(".", 1)[0]
ADDON_DIR = Path(__file__).resolve().parent
ADDON_PARENT_DIR = ADDON_DIR.parent
ADDON_VENDOR_DIR = ADDON_DIR / "_vendor"
ADDON_WEB_ID = mw.addonManager.addonFromModule(__name__) or ADDON_MODULE
ASSET_VERSION = "20260325e"
ASSET_CSS_PATH = f"/_addons/{ADDON_WEB_ID}/web/popup.css?v={ASSET_VERSION}"
ASSET_JS_PATH = f"/_addons/{ADDON_WEB_ID}/web/popup.js?v={ASSET_VERSION}"

if str(ADDON_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_DIR))
if str(ADDON_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_PARENT_DIR))
if ADDON_VENDOR_DIR.exists() and str(ADDON_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_VENDOR_DIR))

mw.addonManager.setWebExports(__name__, r"web/.*\.(css|js|html)")

DEFAULT_RUNTIME_SETTINGS = {
    "enable_lookup": True,
    "enable_translate": True,
    "enable_audio": True,
    "auto_play_audio": False,
    "popover_trigger_mode": "auto",
    "popover_shortcut": "Alt+1",
}

_MESSAGE_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="apl-worker")


def _get_runtime_config() -> dict:
    try:
        config = mw.addonManager.getConfig(__name__)
    except Exception:
        return {}

    if not isinstance(config, dict):
        return {}
    return config


def _normalize_trigger_mode(value: object) -> str:
    return "shortcut" if str(value).strip().lower() == "shortcut" else "auto"


def _normalize_shortcut(value: object) -> str:
    shortcut = str(value or "").strip()
    return shortcut or str(DEFAULT_RUNTIME_SETTINGS["popover_shortcut"])


def _load_raw_config_file() -> dict[str, object]:
    config_path = ADDON_DIR / "config.json"
    if not config_path.exists():
        return {}

    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    if not isinstance(payload, dict):
        return {}

    return payload


def _runtime_settings_from_config(config: dict) -> dict[str, object]:
    raw_config_file = _load_raw_config_file()

    def _get_value(key: str):
        if key in config:
            return config.get(key)
        return raw_config_file.get(key)

    return {
        "enable_lookup": bool(_get_value("enable_lookup") if _get_value("enable_lookup") is not None else DEFAULT_RUNTIME_SETTINGS["enable_lookup"]),
        "enable_translate": bool(
            _get_value("enable_translate") if _get_value("enable_translate") is not None else DEFAULT_RUNTIME_SETTINGS["enable_translate"]
        ),
        "enable_audio": bool(_get_value("enable_audio") if _get_value("enable_audio") is not None else DEFAULT_RUNTIME_SETTINGS["enable_audio"]),
        "auto_play_audio": bool(
            _get_value("auto_play_audio") if _get_value("auto_play_audio") is not None else DEFAULT_RUNTIME_SETTINGS["auto_play_audio"]
        ),
        "popover_trigger_mode": _normalize_trigger_mode(
            _get_value("popover_trigger_mode")
            if _get_value("popover_trigger_mode") is not None
            else DEFAULT_RUNTIME_SETTINGS["popover_trigger_mode"]
        ),
        "popover_shortcut": _normalize_shortcut(
            _get_value("popover_shortcut")
            if _get_value("popover_shortcut") is not None
            else DEFAULT_RUNTIME_SETTINGS["popover_shortcut"]
        ),
    }


def _save_runtime_settings(partial_settings: dict[str, object]) -> dict[str, object]:
    config = _get_runtime_config()
    merged = _runtime_settings_from_config(config)

    for key in ["enable_lookup", "enable_translate", "enable_audio", "auto_play_audio"]:
        if key in partial_settings:
            merged[key] = bool(partial_settings[key])

    if "popover_trigger_mode" in partial_settings:
        merged["popover_trigger_mode"] = _normalize_trigger_mode(
            partial_settings["popover_trigger_mode"]
        )

    if "popover_shortcut" in partial_settings:
        merged["popover_shortcut"] = _normalize_shortcut(partial_settings["popover_shortcut"])

    config.update(merged)
    try:
        mw.addonManager.writeConfig(__name__, config)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot save runtime settings: {error}")

    return merged


def _build_settings_payload() -> dict:
    config = _get_runtime_config()
    translation = _load_translation_config()
    settings = _runtime_settings_from_config(config)

    return {
        "type": "settings_state",
        "settings": settings,
        "languages": translation,
        "resources": {
            "mode": "api_only",
            "status_unknown": False,
        },
    }


def _load_translation_config() -> dict[str, str]:
    config_path = ADDON_DIR / "config.json"
    defaults = {"source_language": "en", "target_language": "vi"}

    if not config_path.exists():
        return defaults

    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return defaults

    if not isinstance(payload, dict):
        return defaults

    return {
        "source_language": str(payload.get("source_language", defaults["source_language"])),
        "target_language": str(payload.get("target_language", defaults["target_language"])),
    }


def _save_translation_config(source_language: str, target_language: str) -> None:
    config_path = ADDON_DIR / "config.json"

    current_payload: dict[str, object] = {}
    if config_path.exists():
        try:
            loaded = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                current_payload = loaded
        except Exception:
            current_payload = {}

    current_payload["source_language"] = str(source_language or "en")
    current_payload["target_language"] = str(target_language or "vi")

    try:
        config_path.write_text(
            json.dumps(current_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot save translation config: {error}")


def _save_runtime_settings_to_config_file(runtime_settings: dict[str, object]) -> None:
    config_path = ADDON_DIR / "config.json"
    payload = _load_raw_config_file()

    for key in DEFAULT_RUNTIME_SETTINGS:
        if key in runtime_settings:
            payload[key] = runtime_settings[key]

    try:
        config_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot mirror runtime settings to config file: {error}")


def _send_to_webview(context: object, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False)
    js = f"window.updatePopover({data});"

    def _eval_in_ui_thread() -> None:
        try:
            if hasattr(context, "eval"):
                context.eval(js)
                return

            web = getattr(context, "web", None)
            if web is not None:
                web.eval(js)
                return

            reviewer = getattr(mw, "reviewer", None)
            reviewer_web = getattr(reviewer, "web", None)
            if reviewer_web is not None:
                reviewer_web.eval(js)
                return

            if getattr(mw, "web", None) is not None:
                mw.web.eval(js)
        except Exception as error:
            print(f"[{ADDON_MODULE}] Cannot update webview: {error}")

    taskman = getattr(mw, "taskman", None)
    if taskman is not None:
        taskman.run_on_main(_eval_in_ui_thread)
        return

    _eval_in_ui_thread()


def on_card_show(html: str, card, context) -> str:
    css_tag = f"<link rel='stylesheet' href='{ASSET_CSS_PATH}'>"
    js_tag = f"<script src='{ASSET_JS_PATH}'></script>"

    output = html
    if css_tag not in output:
        output += css_tag
    if js_tag not in output:
        output += js_tag

    return output


def on_webview_will_set_content(web_content, context) -> None:
    deck_browser = getattr(mw, "deckBrowser", None)
    if context is not deck_browser:
        return

    css_list = getattr(web_content, "css", None)
    if isinstance(css_list, list) and ASSET_CSS_PATH not in css_list:
        css_list.append(ASSET_CSS_PATH)

    js_list = getattr(web_content, "js", None)
    if isinstance(js_list, list) and ASSET_JS_PATH not in js_list:
        js_list.append(ASSET_JS_PATH)


def _run_lookup_message(word: str, context: object) -> None:
    try:
        handler_module = importlib.import_module(
            ".features.lookup.handler", package=__name__
        )
        handle_lookup = handler_module.handle_lookup
        result = handle_lookup(word)
    except Exception as error:
        result = {
            "type": "error",
            "message": f"Lookup handler error: {error}",
        }

    _send_to_webview(context, result)


def _run_translate_message(phrase: str, context: object) -> None:
    try:
        handler_module = importlib.import_module(
            ".features.translate.handler", package=__name__
        )
        handle_translate = handler_module.handle_translate
        result = handle_translate(phrase)
    except Exception as error:
        result = {
            "type": "error",
            "message": f"Translate handler error: {error}",
        }

    _send_to_webview(context, result)


def _run_audio_message(audio_url: str, context: object) -> None:
    ok, message = _play_audio_url_native(audio_url)
    _send_to_webview(
        context,
        {
            "type": "audio_native_result",
            "ok": ok,
            "message": message,
            "audio_url": audio_url,
        },
    )


def _play_audio_url_native(audio_url: str) -> tuple[bool, str]:
    url = str(audio_url or "").strip()
    if not url:
        return (False, "missing audio url")

    try:
        request = Request(url, headers={"User-Agent": "anki-popup-lookup/1.0"})
        with urlopen(request, timeout=12) as response:
            payload = response.read()
            content_type = str(response.headers.get("Content-Type", "")).lower()
    except Exception as error:
        return (False, f"download failed: {error}")

    if not payload:
        return (False, "downloaded payload is empty")

    extension = ".mp3"
    parsed_path = urlsplit(url).path
    suffix = Path(parsed_path).suffix.lower()
    if suffix in {".mp3", ".ogg", ".oga", ".wav"}:
        extension = suffix
    elif "ogg" in content_type:
        extension = ".ogg"
    elif "wav" in content_type:
        extension = ".wav"

    temp_dir = ADDON_DIR / "_tmp_audio"
    try:
        temp_dir.mkdir(parents=True, exist_ok=True)
    except Exception as error:
        return (False, f"cannot create temp dir: {error}")

    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
    audio_path = temp_dir / f"apl_tts_{digest}{extension}"

    try:
        audio_path.write_bytes(payload)
    except Exception as error:
        return (False, f"cannot write audio file: {error}")

    try:
        from aqt import sound as aqt_sound
    except Exception as error:
        return (False, f"cannot import aqt.sound: {error}")

    av_player = getattr(aqt_sound, "av_player", None)
    play_fn = getattr(aqt_sound, "play", None)

    def _play_with_av_player() -> bool:
        if av_player is None or not hasattr(av_player, "play_file"):
            return False
        av_player.play_file(str(audio_path))
        return True

    def _play_with_function() -> bool:
        if not callable(play_fn):
            return False
        play_fn(str(audio_path))
        return True

    def _play_on_main() -> tuple[bool, str]:
        try:
            if _play_with_av_player():
                return (True, f"native av_player {audio_path.name}")
            if _play_with_function():
                return (True, f"native play() {audio_path.name}")
            return (False, "no native playback API available")
        except Exception as error:
            return (False, f"native playback failed: {error}")

    taskman = getattr(mw, "taskman", None)
    if taskman is None:
        return _play_on_main()

    holder: dict[str, object] = {"result": (False, "unknown")}
    done = threading.Event()

    def _runner() -> None:
        try:
            holder["result"] = _play_on_main()
        finally:
            done.set()

    taskman.run_on_main(_runner)
    if not done.wait(timeout=10):
        return (False, "native playback timeout")
    result = holder.get("result")
    if isinstance(result, tuple) and len(result) == 2:
        return result  # type: ignore[return-value]
    return (False, "native playback result unavailable")


def on_js_message(handled, message: str, context):
    if message == "settings:get":
        _send_to_webview(context, _build_settings_payload())
        return (True, None)

    if message.startswith("settings:save:"):
        payload_raw = unquote(message[len("settings:save:") :]).strip()
        try:
            payload = json.loads(payload_raw)
        except Exception:
            _send_to_webview(
                context,
                {
                    "type": "settings_error",
                    "message": "Du lieu settings khong hop le.",
                },
            )
            return (True, None)

        if not isinstance(payload, dict):
            _send_to_webview(
                context,
                {
                    "type": "settings_error",
                    "message": "Du lieu settings phai la object.",
                },
            )
            return (True, None)

        incoming_languages = payload.get("languages", {})
        if isinstance(incoming_languages, dict):
            source_language = str(incoming_languages.get("source_language", "en") or "en")
            target_language = str(incoming_languages.get("target_language", "vi") or "vi")
            _save_translation_config(source_language, target_language)

        saved_settings = _save_runtime_settings(payload)
        _save_runtime_settings_to_config_file(saved_settings)
        _send_to_webview(
            context,
            {
                "type": "settings_state",
                "settings": saved_settings,
                "languages": _load_translation_config(),
                "resources": {
                    "mode": "api_only",
                    "status_unknown": False,
                },
            },
        )
        return (True, None)

    if message.startswith("settings:download:"):
        _send_to_webview(
            context,
            {
                "type": "settings_error",
                "message": "Offline translation da bi tat. Add-on hien chi dung API online.",
            },
        )
        return (True, None)

    if message.startswith("lookup:"):
        word = unquote(message[7:]).strip()
        _MESSAGE_EXECUTOR.submit(_run_lookup_message, word, context)
        return (True, None)

    if message.startswith("translate:"):
        phrase = unquote(message[10:]).strip()
        _MESSAGE_EXECUTOR.submit(_run_translate_message, phrase, context)
        return (True, None)

    if message.startswith("audio:play:"):
        audio_url = unquote(message[len("audio:play:") :]).strip()
        _MESSAGE_EXECUTOR.submit(_run_audio_message, audio_url, context)
        return (True, None)

    return handled


gui_hooks.card_will_show.append(on_card_show)
gui_hooks.webview_will_set_content.append(on_webview_will_set_content)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
