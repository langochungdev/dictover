from __future__ import annotations

import json
import importlib
import re
import sys
import hashlib
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen

from aqt import gui_hooks, mw

ADDON_MODULE = __name__.split(".", 1)[0]
ADDON_DIR = Path(__file__).resolve().parent
ADDON_PARENT_DIR = ADDON_DIR.parent
ADDON_VENDOR_DIR = ADDON_DIR / "_vendor"
ADDON_WEB_ID = mw.addonManager.addonFromModule(__name__) or ADDON_MODULE
ASSET_VERSION = "20260328i"
ASSET_CSS_PATH = f"/_addons/{ADDON_WEB_ID}/web/popup.css?v={ASSET_VERSION}"
ASSET_JS_PATH = f"/_addons/{ADDON_WEB_ID}/web/popup.js?v={ASSET_VERSION}"

if str(ADDON_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_DIR))
if str(ADDON_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_PARENT_DIR))
if ADDON_VENDOR_DIR.exists() and str(ADDON_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_VENDOR_DIR))

mw.addonManager.setWebExports(
    __name__,
    r"(web|assets)/.*\.(css|js|html|png|jpg|jpeg|gif|webp|svg)",
)

DEFAULT_RUNTIME_SETTINGS = {
    "enable_lookup": True,
    "enable_translate": True,
    "enable_audio": True,
    "auto_play_audio": False,
    "popover_trigger_mode": "auto",
    "popover_shortcut": "Shift",
    "popover_open_panel_mode": "none",
    "popover_definition_language_mode": "output",
}

INSTALL_PING_URL = "https://langochung.me/api/ping/dictover"
INSTALL_PING_MARKER = ADDON_DIR / ".install_ping_v1.json"
INSTALL_PING_STATE_KEY = "_install_ping"

_MESSAGE_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="apl-worker")
IMAGE_SEARCH_PAGE_SIZE_DEFAULT = 24
IMAGE_SEARCH_PAGE_SIZE_MAX = 40
IMAGE_SEARCH_TIMEOUT_SECONDS = 12
_DDG_VQD_CACHE: dict[str, str] = {}


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


def _normalize_panel_open_mode(value: object) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"details", "images"}:
        return mode
    return "none"


def _normalize_definition_language_mode(value: object) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"input", "english"}:
        return mode
    return "output"


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
        "popover_open_panel_mode": _normalize_panel_open_mode(
            _get_value("popover_open_panel_mode")
            if _get_value("popover_open_panel_mode") is not None
            else DEFAULT_RUNTIME_SETTINGS["popover_open_panel_mode"]
        ),
        "popover_definition_language_mode": _normalize_definition_language_mode(
            _get_value("popover_definition_language_mode")
            if _get_value("popover_definition_language_mode") is not None
            else DEFAULT_RUNTIME_SETTINGS["popover_definition_language_mode"]
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

    if "popover_open_panel_mode" in partial_settings:
        merged["popover_open_panel_mode"] = _normalize_panel_open_mode(
            partial_settings["popover_open_panel_mode"]
        )

    if "popover_definition_language_mode" in partial_settings:
        merged["popover_definition_language_mode"] = _normalize_definition_language_mode(
            partial_settings["popover_definition_language_mode"]
        )

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
    defaults = {"source_language": "auto", "target_language": "vi"}

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

    current_payload["source_language"] = str(source_language or "auto")
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
        payload["source_language"] = str(source_language or "auto")
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
    addon_web_id_json = json.dumps(str(ADDON_WEB_ID), ensure_ascii=False)
    context_flag_tag = (
        "<script>window.__aplIsDeckBrowser=false;"
        f"window.__aplDebugPanelAlwaysVisible={debug_flag};"
        f"window.__aplAddonWebId={addon_web_id_json};"
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
    addon_web_id_json = json.dumps(str(ADDON_WEB_ID), ensure_ascii=False)
    context_flag_tag = (
        "<script>window.__aplIsDeckBrowser=true;"
        f"window.__aplDebugPanelAlwaysVisible={debug_flag};"
        f"window.__aplAddonWebId={addon_web_id_json};"
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


def _normalize_image_query(value: object) -> str:
    compact = " ".join(str(value or "").split()).strip()
    if not compact:
        return ""
    words = compact.split(" ")[:8]
    return " ".join(words)[:80].strip()


def _coerce_int(value: object, default: int) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return int(default)


def _load_json_from_url(url: str, timeout_seconds: float = IMAGE_SEARCH_TIMEOUT_SECONDS) -> dict[str, object]:
    request = Request(
        url,
        headers={
            "User-Agent": "anki-popup-lookup/1.0",
            "Accept": "application/json",
        },
    )

    with urlopen(request, timeout=timeout_seconds) as response:
        raw = response.read()
        encoding = "utf-8"
        content_type = str(response.headers.get("Content-Type", ""))
        if "charset=" in content_type:
            encoding = content_type.split("charset=", 1)[-1].split(";", 1)[0].strip() or "utf-8"
        payload = json.loads(raw.decode(encoding, errors="replace"))

    if not isinstance(payload, dict):
        return {}
    return payload


def _load_google_cse_credentials() -> tuple[str, str]:
    raw = _load_raw_config_file()
    if not isinstance(raw, dict):
        return ("", "")

    api_key = str(raw.get("google_cse_api_key", "")).strip()
    cx = str(raw.get("google_cse_cx", "")).strip()
    return (api_key, cx)


def _duckduckgo_get_vqd(query: str) -> tuple[str, str]:
    safe_query = _normalize_image_query(query)
    if not safe_query:
        return ("", "")

    cached = _DDG_VQD_CACHE.get(safe_query)
    if cached:
        return (cached, "")

    url = "https://duckduckgo.com/?q=" + quote(safe_query) + "&iax=images&ia=images"
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )

    try:
        with urlopen(request, timeout=IMAGE_SEARCH_TIMEOUT_SECONDS) as response:
            html = response.read().decode("utf-8", errors="replace")
    except Exception as error:
        return ("", f"ddg_token_fetch_failed: {error}")

    match = re.search(r'vqd="([^"]+)"', html)
    if not match:
        return ("", "ddg_token_not_found")

    vqd = str(match.group(1) or "").strip()
    if not vqd:
        return ("", "ddg_token_empty")

    _DDG_VQD_CACHE[safe_query] = vqd
    return (vqd, "")


def _duckduckgo_search_images(query: str, page: int, page_size: int) -> tuple[list[dict[str, str]], int | None, str]:
    safe_query = _normalize_image_query(query)
    if not safe_query:
        return ([], None, "")

    safe_page = max(1, _coerce_int(page, 1))
    safe_page_size = max(6, min(IMAGE_SEARCH_PAGE_SIZE_MAX, _coerce_int(page_size, IMAGE_SEARCH_PAGE_SIZE_DEFAULT)))
    offset = (safe_page - 1) * safe_page_size

    vqd, token_error = _duckduckgo_get_vqd(safe_query)
    if token_error:
        return ([], None, token_error)

    url = (
        "https://duckduckgo.com/i.js?l=us-en&o=json"
        + "&q="
        + quote(safe_query)
        + "&vqd="
        + quote(vqd)
        + "&f=,,,&p=1"
        + "&s="
        + str(offset)
    )

    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://duckduckgo.com/",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        },
    )

    try:
        with urlopen(request, timeout=IMAGE_SEARCH_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
            payload = json.loads(raw)
    except Exception as error:
        return ([], None, f"ddg_fetch_failed: {error}")

    if not isinstance(payload, dict):
        return ([], None, "ddg_invalid_payload")

    results = payload.get("results")
    if not isinstance(results, list):
        return ([], None, "")

    options: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        src = str(item.get("image", "")).strip()
        if not src:
            continue
        page_url = str(item.get("url", "")).strip() or src
        title = str(item.get("title", "")).strip() or str(item.get("source", "")).strip() or "Image"
        options.append(
            {
                "src": src,
                "source": "DuckDuckGo",
                "title": title,
                "pageUrl": page_url,
            }
        )

    has_next = bool(str(payload.get("next", "")).strip())
    next_page = safe_page + 1 if has_next and options else None
    return (options, next_page, "")


def _google_cse_search_images(query: str, page: int, page_size: int) -> tuple[list[dict[str, str]], int | None, str]:
    safe_query = _normalize_image_query(query)
    if not safe_query:
        return ([], None, "")

    api_key, cx = _load_google_cse_credentials()
    if not api_key or not cx:
        return ([], None, "google_cse_not_configured")

    safe_page = max(1, _coerce_int(page, 1))
    safe_page_size = max(1, min(10, _coerce_int(page_size, 10)))
    start_index = (safe_page - 1) * safe_page_size + 1

    if start_index > 91:
        return ([], None, "")

    url = (
        "https://www.googleapis.com/customsearch/v1?searchType=image"
        + "&key="
        + quote(api_key)
        + "&cx="
        + quote(cx)
        + "&q="
        + quote(safe_query)
        + "&safe=active"
        + "&hl=en"
        + "&num="
        + str(safe_page_size)
        + "&start="
        + str(start_index)
    )

    try:
        payload = _load_json_from_url(url)
    except Exception as error:
        return ([], None, f"google_cse_fetch_failed: {error}")

    if "error" in payload:
        err_payload = payload.get("error")
        if isinstance(err_payload, dict):
            message = str(err_payload.get("message", "")).strip()
            return ([], None, f"google_cse_error: {message}" if message else "google_cse_error")
        return ([], None, "google_cse_error")

    items = payload.get("items")
    if not isinstance(items, list):
        return ([], None, "")

    options: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        src = str(item.get("link", "")).strip()
        if not src:
            continue
        image_payload = item.get("image")
        if isinstance(image_payload, dict):
            context_link = str(image_payload.get("contextLink", "")).strip()
        else:
            context_link = ""

        options.append(
            {
                "src": src,
                "source": "Google",
                "title": str(item.get("title", "")).strip() or "Image",
                "pageUrl": context_link or src,
            }
        )

    next_page = None
    queries_payload = payload.get("queries")
    if isinstance(queries_payload, dict):
        next_pages = queries_payload.get("nextPage")
        if isinstance(next_pages, list) and next_pages:
            next_page = safe_page + 1

    return (options, next_page, "")


def _wikipedia_search_images(query: str, page: int, page_size: int) -> tuple[list[dict[str, str]], int | None, str]:
    safe_query = _normalize_image_query(query)
    if not safe_query:
        return ([], None, "")

    safe_page = max(1, _coerce_int(page, 1))
    safe_page_size = max(6, min(IMAGE_SEARCH_PAGE_SIZE_MAX, _coerce_int(page_size, IMAGE_SEARCH_PAGE_SIZE_DEFAULT)))
    offset = (safe_page - 1) * safe_page_size

    url = (
        "https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search"
        + "&gsrlimit="
        + str(safe_page_size)
        + "&gsroffset="
        + str(offset)
        + "&gsrsearch="
        + quote(safe_query)
        + "&prop=pageimages|info&piprop=thumbnail&pithumbsize=960&inprop=url"
    )

    try:
        payload = _load_json_from_url(url)
    except Exception as error:
        return ([], None, f"wikipedia_fetch_failed: {error}")

    query_payload = payload.get("query")
    if not isinstance(query_payload, dict):
        return ([], None, "")

    pages = query_payload.get("pages")
    if not isinstance(pages, dict):
        pages = {}

    options: list[dict[str, str]] = []
    for page_data in pages.values():
        if not isinstance(page_data, dict):
            continue
        thumb = page_data.get("thumbnail")
        if not isinstance(thumb, dict):
            continue
        src = str(thumb.get("source", "")).strip()
        if not src:
            continue
        title = str(page_data.get("title", "")).replace("_", " ").strip()
        page_url = str(page_data.get("fullurl", "")).strip() or src
        options.append(
            {
                "src": src,
                "source": "Wikipedia",
                "title": title or "Image",
                "pageUrl": page_url,
            }
        )

    next_page = None
    continuation = payload.get("continue")
    if isinstance(continuation, dict) and continuation.get("gsroffset") is not None:
        next_page = safe_page + 1

    return (options, next_page, "")


def _wikipedia_exact_title_images(query: str) -> tuple[list[dict[str, str]], str]:
    safe_query = _normalize_image_query(query)
    if not safe_query:
        return ([], "")

    url = (
        "https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json"
        + "&titles="
        + quote(safe_query)
        + "&prop=pageimages|info&piprop=thumbnail&pithumbsize=960&inprop=url"
    )

    try:
        payload = _load_json_from_url(url)
    except Exception as error:
        return ([], f"wikipedia_exact_failed: {error}")

    query_payload = payload.get("query")
    if not isinstance(query_payload, dict):
        return ([], "")

    pages = query_payload.get("pages")
    if not isinstance(pages, dict):
        return ([], "")

    options: list[dict[str, str]] = []
    for page_data in pages.values():
        if not isinstance(page_data, dict):
            continue
        thumb = page_data.get("thumbnail")
        if not isinstance(thumb, dict):
            continue
        src = str(thumb.get("source", "")).strip()
        if not src:
            continue
        title = str(page_data.get("title", "")).replace("_", " ").strip()
        page_url = str(page_data.get("fullurl", "")).strip() or src
        options.append(
            {
                "src": src,
                "source": "Wikipedia",
                "title": title or "Image",
                "pageUrl": page_url,
            }
        )

    return (options, "")


def _normalize_for_match(value: object) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def _image_relevance_score(query: str, item: dict[str, str]) -> int:
    normalized_query = _normalize_for_match(query)
    normalized_title = _normalize_for_match(item.get("title", ""))
    source = str(item.get("source", "")).strip().lower()

    if not normalized_query:
        return 0

    score = 0
    if normalized_title == normalized_query:
        score += 1000
    if normalized_title.startswith(normalized_query):
        score += 260
    if normalized_query in normalized_title:
        score += 180

    query_tokens = [token for token in normalized_query.split(" ") if token]
    title_tokens = set(token for token in normalized_title.split(" ") if token)
    overlap = sum(1 for token in query_tokens if token in title_tokens)
    score += overlap * 45

    if source == "wikipedia":
        score += 35

    return score


def _rank_image_options(query: str, options: list[dict[str, str]]) -> list[dict[str, str]]:
    scored: list[tuple[int, int, dict[str, str]]] = []
    for index, item in enumerate(options):
        score = _image_relevance_score(query, item)
        scored.append((score, -index, item))

    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [row[2] for row in scored]


def _merge_image_options(primary: list[dict[str, str]], fallback: list[dict[str, str]]) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    seen: set[str] = set()

    def _append(items: list[dict[str, str]]) -> None:
        for item in items:
            src = str(item.get("src", "")).strip()
            if not src or src in seen:
                continue
            seen.add(src)
            output.append(
                {
                    "src": src,
                    "source": str(item.get("source", "Web") or "Web"),
                    "title": str(item.get("title", "Image") or "Image"),
                    "pageUrl": str(item.get("pageUrl", src) or src),
                }
            )

    _append(primary)
    _append(fallback)
    return output


def _run_image_search_message(payload_raw: str, context: object) -> None:
    try:
        payload = json.loads(payload_raw) if payload_raw else {}
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    query = _normalize_image_query(payload.get("query", ""))
    page = max(1, _coerce_int(payload.get("page", 1), 1))
    page_size = max(
        6,
        min(IMAGE_SEARCH_PAGE_SIZE_MAX, _coerce_int(payload.get("page_size", IMAGE_SEARCH_PAGE_SIZE_DEFAULT), IMAGE_SEARCH_PAGE_SIZE_DEFAULT)),
    )
    request_seq = max(0, _coerce_int(payload.get("request_seq", 0), 0))

    options: list[dict[str, str]] = []
    next_page: int | None = None
    errors: list[str] = []

    if query:
        ddg_options, ddg_next_page, ddg_error = _duckduckgo_search_images(query, page, page_size)
        if ddg_error:
            errors.append(ddg_error)

        options = ddg_options
        next_page = ddg_next_page

        if not options:
            google_options, google_next_page, google_error = _google_cse_search_images(
                query,
                page,
                min(10, page_size),
            )

            if google_error and google_error != "google_cse_not_configured":
                errors.append(google_error)

            if google_options:
                options = google_options
                next_page = google_next_page

        if not options:
            wikipedia_options, wikipedia_next_page, wikipedia_error = _wikipedia_search_images(query, page, page_size)
            options = wikipedia_options
            next_page = wikipedia_next_page
            if wikipedia_error:
                errors.append(wikipedia_error)

            if page == 1 and len(options) < 8:
                exact_options, exact_error = _wikipedia_exact_title_images(query)
                options = _merge_image_options(exact_options, options)
                if exact_error:
                    errors.append(exact_error)

        options = _rank_image_options(query, options)

    _send_to_webview(
        context,
        {
            "type": "image_search_result",
            "query": query,
            "page": page,
            "next_page": int(next_page or 0),
            "has_more": bool(next_page),
            "request_seq": request_seq,
            "options": options,
            "error": "; ".join([item for item in errors if item]),
        },
    )


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


def _run_audio_stop_message() -> None:
    ok, message = _stop_native_audio_playback()
    if not ok and "no native stop api available" not in message.lower():
        print(f"[{ADDON_MODULE}] Cannot stop native audio: {message}")


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


def _stop_native_audio_playback() -> tuple[bool, str]:
    try:
        from aqt import sound as aqt_sound
    except Exception as error:
        return (False, f"cannot import aqt.sound: {error}")

    av_player = getattr(aqt_sound, "av_player", None)
    module_stop = getattr(aqt_sound, "stop", None)

    def _stop_on_main() -> tuple[bool, str]:
        used = False
        try:
            if av_player is not None:
                stop_and_clear = getattr(av_player, "stop_and_clear_queue", None)
                if callable(stop_and_clear):
                    stop_and_clear()
                    used = True

                clear_queue = getattr(av_player, "clear_queue", None)
                if callable(clear_queue):
                    clear_queue()
                    used = True

                stop = getattr(av_player, "stop", None)
                if callable(stop):
                    stop()
                    used = True

            if callable(module_stop):
                module_stop()
                used = True
        except Exception as error:
            return (False, f"native stop failed: {error}")

        if used:
            return (True, "native audio stopped")
        return (False, "no native stop API available")

    taskman = getattr(mw, "taskman", None)
    if taskman is None:
        return _stop_on_main()

    holder: dict[str, object] = {"result": (False, "unknown")}
    done = threading.Event()

    def _runner() -> None:
        try:
            holder["result"] = _stop_on_main()
        finally:
            done.set()

    taskman.run_on_main(_runner)
    if not done.wait(timeout=10):
        return (False, "native stop timeout")
    result = holder.get("result")
    if isinstance(result, tuple) and len(result) == 2:
        return result  # type: ignore[return-value]
    return (False, "native stop result unavailable")


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
            source_language = str(incoming_languages.get("source_language", "auto") or "auto")
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

    if message.startswith("image:search:"):
        payload_raw = unquote(message[len("image:search:") :]).strip()
        _MESSAGE_EXECUTOR.submit(_run_image_search_message, payload_raw, context)
        return (True, None)

    if message.startswith("audio:play:"):
        audio_url = unquote(message[len("audio:play:") :]).strip()
        _MESSAGE_EXECUTOR.submit(_run_audio_message, audio_url, context)
        return (True, None)

    if message == "audio:stop":
        _MESSAGE_EXECUTOR.submit(_run_audio_stop_message)
        return (True, None)

    return handled


gui_hooks.card_will_show.append(on_card_show)
gui_hooks.webview_will_set_content.append(on_webview_will_set_content)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
_ensure_install_ping_once()
