from __future__ import annotations

import json
import importlib
import sys
import hashlib
import threading
import time
import uuid
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
ASSET_VERSION = "20260325h"
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

INSTALL_PING_URL = "https://langochung.me/api/ping/dictover"
INSTALL_PING_MARKER = ADDON_DIR / ".install_ping_v1.json"
INSTALL_PING_STATE_KEY = "_install_ping"

_MESSAGE_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="apl-worker")


def _write_install_ping_marker(payload: dict[str, object]) -> None:
    marker_tmp = INSTALL_PING_MARKER.with_suffix(".json.tmp")
    marker_tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    marker_tmp.replace(INSTALL_PING_MARKER)


def _read_install_ping_marker() -> dict[str, object]:
    try:
        payload = json.loads(INSTALL_PING_MARKER.read_text(encoding="utf-8"))
    except Exception:
        return {}

    if not isinstance(payload, dict):
        return {}
    return payload


def _is_install_ping_disabled() -> bool:
    payload = _load_raw_config_file()
    raw_value = payload.get("disable_install_ping") if isinstance(payload, dict) else None
    return _coerce_bool(raw_value, False)


def _read_install_ping_state() -> dict[str, object]:
    config = _get_runtime_config()
    if not isinstance(config, dict):
        return {}

    state = config.get(INSTALL_PING_STATE_KEY)
    if isinstance(state, dict):
        return state
    return {}


def _write_install_ping_state(state: dict[str, object]) -> None:
    config = _get_runtime_config()
    config[INSTALL_PING_STATE_KEY] = state
    try:
        mw.addonManager.writeConfig(__name__, config)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot persist install ping state: {error}")


def _is_install_ping_attempted(state: dict[str, object]) -> bool:
    raw = state.get("attempted")
    if isinstance(raw, bool):
        return raw
    text = str(raw or "").strip().lower()
    return text in {"1", "true", "yes", "on"}


def _mark_install_ping_attempted(marker_payload: dict[str, object], status: str = "pending") -> None:
    state = _read_install_ping_state()
    state.update(
        {
            "attempted": True,
            "install_id": str(marker_payload.get("install_id") or state.get("install_id") or ""),
            "created_at": int(marker_payload.get("created_at") or state.get("created_at") or int(time.time())),
            "status": str(status or state.get("status") or "pending"),
            "updated_at": int(time.time()),
        }
    )
    _write_install_ping_state(state)


def _send_install_ping_once(marker_payload: dict[str, object]) -> None:
    payload = {
        "event": "install",
        "addon_module": ADDON_MODULE,
        "addon_web_id": str(ADDON_WEB_ID),
        "install_id": str(marker_payload.get("install_id", "")),
        "created_at": int(marker_payload.get("created_at", 0) or 0),
        "sent_at": int(time.time()),
    }

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        INSTALL_PING_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "anki-popup-lookup-install-ping/1.0",
        },
        method="POST",
    )

    ok = False
    status = 0
    error_message = ""
    try:
        with urlopen(request, timeout=8) as response:
            status = int(getattr(response, "status", 200) or 200)
            ok = 200 <= status < 300
    except Exception as error:
        error_message = str(error)

    marker_payload["sent_at"] = int(time.time())
    marker_payload["status"] = "ok" if ok else "error"
    marker_payload["http_status"] = status
    marker_payload["error"] = error_message

    try:
        _write_install_ping_marker(marker_payload)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot update install ping marker: {error}")

    state = _read_install_ping_state()
    state.update(
        {
            "attempted": True,
            "install_id": str(marker_payload.get("install_id") or state.get("install_id") or ""),
            "created_at": int(marker_payload.get("created_at") or state.get("created_at") or int(time.time())),
            "sent_at": int(marker_payload.get("sent_at") or int(time.time())),
            "status": "ok" if ok else "error",
            "http_status": status,
            "error": error_message,
            "updated_at": int(time.time()),
        }
    )
    _write_install_ping_state(state)


def _ensure_install_ping_once() -> None:
    if _is_install_ping_disabled():
        return

    install_ping_state = _read_install_ping_state()
    if _is_install_ping_attempted(install_ping_state):
        return

    marker_payload: dict[str, object]

    if INSTALL_PING_MARKER.exists():
        existing = _read_install_ping_marker()
        status = str(existing.get("status", "")).strip().lower()
        if status == "ok":
            _mark_install_ping_attempted(existing, status="ok")
            return

        marker_payload = {
            "version": 1,
            "install_id": str(existing.get("install_id") or uuid.uuid4().hex),
            "created_at": int(existing.get("created_at") or int(time.time())),
            "status": "pending",
        }
    else:
        marker_payload = {
            "version": 1,
            "install_id": uuid.uuid4().hex,
            "created_at": int(time.time()),
            "status": "pending",
        }

    try:
        _write_install_ping_marker(marker_payload)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot create install ping marker: {error}")
        return

    # Mark as attempted before background send so addon updates do not ping again.
    _mark_install_ping_attempted(marker_payload, status="pending")

    threading.Thread(
        target=_send_install_ping_once,
        args=(marker_payload,),
        name="apl-install-ping",
        daemon=True,
    ).start()


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


def _coerce_bool(value: object, default: bool) -> bool:
    if value is None:
        return bool(default)

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off", ""}:
        return False

    return bool(default)


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


def _write_raw_config_file(payload: dict[str, object]) -> None:
    config_path = ADDON_DIR / "config.json"
    temp_path = config_path.with_suffix(".json.tmp")

    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    temp_path.write_text(serialized, encoding="utf-8")
    try:
        temp_path.replace(config_path)
    except Exception:
        # Fallback for intermittent Windows replace/lock issues.
        config_path.write_text(serialized, encoding="utf-8")
        if temp_path.exists():
            temp_path.unlink()


def _runtime_settings_from_config(config: dict) -> dict[str, object]:
    raw_config_file = _load_raw_config_file()

    def _get_value(key: str):
        # Keep config.json as source of truth for persisted runtime settings.
        if key in raw_config_file:
            return raw_config_file.get(key)
        if key in config:
            return config.get(key)
        return None

    return {
        "enable_lookup": _coerce_bool(
            _get_value("enable_lookup"),
            bool(DEFAULT_RUNTIME_SETTINGS["enable_lookup"]),
        ),
        "enable_translate": _coerce_bool(
            _get_value("enable_translate"),
            bool(DEFAULT_RUNTIME_SETTINGS["enable_translate"]),
        ),
        "enable_audio": _coerce_bool(
            _get_value("enable_audio"),
            bool(DEFAULT_RUNTIME_SETTINGS["enable_audio"]),
        ),
        "auto_play_audio": _coerce_bool(
            _get_value("auto_play_audio"),
            bool(DEFAULT_RUNTIME_SETTINGS["auto_play_audio"]),
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


def _runtime_settings_from_file_only() -> dict[str, object]:
    return _runtime_settings_from_config({})


def _save_runtime_settings(partial_settings: dict[str, object]) -> dict[str, object]:
    merged = _runtime_settings_from_file_only()

    for key in ["enable_lookup", "enable_translate", "enable_audio", "auto_play_audio"]:
        if key in partial_settings:
            merged[key] = _coerce_bool(partial_settings[key], bool(merged[key]))

    if "popover_trigger_mode" in partial_settings:
        merged["popover_trigger_mode"] = _normalize_trigger_mode(
            partial_settings["popover_trigger_mode"]
        )

    if "popover_shortcut" in partial_settings:
        merged["popover_shortcut"] = _normalize_shortcut(partial_settings["popover_shortcut"])

    return merged


def _build_settings_payload() -> dict:
    translation = _load_translation_config()
    settings = _runtime_settings_from_file_only()

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
    current_payload = _load_raw_config_file()

    current_payload["source_language"] = str(source_language or "en")
    current_payload["target_language"] = str(target_language or "vi")

    try:
        _write_raw_config_file(current_payload)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot save translation config: {error}")


def _save_runtime_settings_to_config_file(runtime_settings: dict[str, object]) -> None:
    payload = _load_raw_config_file()

    for key in DEFAULT_RUNTIME_SETTINGS:
        if key in runtime_settings:
            payload[key] = runtime_settings[key]

    try:
        _write_raw_config_file(payload)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot mirror runtime settings to config file: {error}")


def _save_all_settings_to_config_file(
    runtime_settings: dict[str, object],
    source_language: str | None,
    target_language: str | None,
) -> tuple[bool, str]:
    payload = _load_raw_config_file()

    if source_language is not None:
        payload["source_language"] = str(source_language or "en")
    if target_language is not None:
        payload["target_language"] = str(target_language or "vi")

    for key in DEFAULT_RUNTIME_SETTINGS:
        if key in runtime_settings:
            payload[key] = runtime_settings[key]

    try:
        _write_raw_config_file(payload)
        return (True, "")
    except Exception as error:
        message = f"Cannot save combined settings to config file: {error}"
        print(f"[{ADDON_MODULE}] {message}")
        return (False, message)


def _save_runtime_settings_to_addon_config(runtime_settings: dict[str, object]) -> None:
    config = _get_runtime_config()
    config.update(runtime_settings)
    try:
        mw.addonManager.writeConfig(__name__, config)
    except Exception as error:
        print(f"[{ADDON_MODULE}] Cannot mirror runtime settings to addon config: {error}")


def _is_debug_panel_always_visible() -> bool:
    raw = _load_raw_config_file()
    return _coerce_bool(raw.get("debug_panel_always_visible"), False)


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
    debug_flag = "true" if _is_debug_panel_always_visible() else "false"
    context_flag_tag = (
        "<script>window.__aplIsDeckBrowser=false;"
        f"window.__aplDebugPanelAlwaysVisible={debug_flag};"
        "</script>"
    )
    js_tag = f"<script src='{ASSET_JS_PATH}'></script>"

    output = html
    if css_tag not in output:
        output += css_tag
    if context_flag_tag not in output:
        output += context_flag_tag
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

    head_content = getattr(web_content, "head", None)
    debug_flag = "true" if _is_debug_panel_always_visible() else "false"
    context_flag_tag = (
        "<script>window.__aplIsDeckBrowser=true;"
        f"window.__aplDebugPanelAlwaysVisible={debug_flag};"
        "</script>"
    )
    if isinstance(head_content, str) and context_flag_tag not in head_content:
        web_content.head = head_content + context_flag_tag


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

        source_language: str | None = None
        target_language: str | None = None
        incoming_languages = payload.get("languages", {})
        if isinstance(incoming_languages, dict):
            source_language = str(incoming_languages.get("source_language", "en") or "en")
            target_language = str(incoming_languages.get("target_language", "vi") or "vi")

        saved_settings = _save_runtime_settings(payload)
        saved_ok, save_message = _save_all_settings_to_config_file(
            saved_settings,
            source_language,
            target_language,
        )
        _save_runtime_settings_to_addon_config(saved_settings)

        if not saved_ok:
            _send_to_webview(
                context,
                {
                    "type": "settings_error",
                    "message": "Khong the luu settings vao file config.json.",
                },
            )

        persisted_payload = _build_settings_payload()
        persisted_settings = persisted_payload.get("settings", {}) if isinstance(persisted_payload, dict) else {}
        persisted_auto = False
        if isinstance(persisted_settings, dict):
            persisted_auto = bool(persisted_settings.get("auto_play_audio", False))

        expected_auto = bool(saved_settings.get("auto_play_audio", False))
        if persisted_auto != expected_auto:
            _send_to_webview(
                context,
                {
                    "type": "settings_error",
                    "message": "Luu auto play khong khop voi gia tri mong doi. Vui long thu lai.",
                },
            )

        if not saved_ok and save_message:
            print(f"[{ADDON_MODULE}] save details: {save_message}")

        _send_to_webview(
            context,
            {
                "type": "settings_state",
                "settings": persisted_payload.get("settings", {}),
                "languages": persisted_payload.get("languages", _load_translation_config()),
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
_ensure_install_ping_once()
