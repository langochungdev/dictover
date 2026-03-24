from __future__ import annotations

import json
import importlib
import sys
import threading
from pathlib import Path
from urllib.parse import unquote

from aqt import gui_hooks, mw

ADDON_PACKAGE = "anki_popup_lookup"
ADDON_DIR = Path(__file__).resolve().parent
ADDON_PARENT_DIR = ADDON_DIR.parent
ADDON_VENDOR_DIR = ADDON_DIR / "_vendor"
ASSET_VERSION = "20260324e"
ASSET_CSS_PATH = f"/_addons/{ADDON_PACKAGE}/web/popup.css?v={ASSET_VERSION}"
ASSET_JS_PATH = f"/_addons/{ADDON_PACKAGE}/web/popup.js?v={ASSET_VERSION}"

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
}

_resource_download_lock = threading.Lock()


def _get_runtime_config() -> dict:
    try:
        config = mw.addonManager.getConfig(__name__)
    except Exception:
        return {}

    if not isinstance(config, dict):
        return {}
    return config


def _get_setup_service():
    try:
        return importlib.import_module(f"{ADDON_PACKAGE}.services.setup_service")
    except Exception:
        return None


def _runtime_settings_from_config(config: dict) -> dict[str, bool]:
    return {
        "enable_lookup": bool(config.get("enable_lookup", DEFAULT_RUNTIME_SETTINGS["enable_lookup"])),
        "enable_translate": bool(
            config.get("enable_translate", DEFAULT_RUNTIME_SETTINGS["enable_translate"])
        ),
        "enable_audio": bool(config.get("enable_audio", DEFAULT_RUNTIME_SETTINGS["enable_audio"])),
    }


def _save_runtime_settings(partial_settings: dict[str, bool]) -> dict[str, bool]:
    config = _get_runtime_config()
    merged = _runtime_settings_from_config(config)

    for key in DEFAULT_RUNTIME_SETTINGS:
        if key in partial_settings:
            merged[key] = bool(partial_settings[key])

    config.update(merged)
    try:
        mw.addonManager.writeConfig(__name__, config)
    except Exception as error:
        print(f"[{ADDON_PACKAGE}] Cannot save runtime settings: {error}")

    return merged


def _build_settings_payload() -> dict:
    config = _get_runtime_config()
    translation = _load_translation_config()
    settings = _runtime_settings_from_config(config)

    resources = {
        "argostranslate": False,
        "language_pack": False,
    }

    setup_service = _get_setup_service()
    if setup_service is not None:
        try:
            resources = setup_service.get_resource_status(
                translation["source_language"],
                translation["target_language"],
            )
        except Exception:
            pass

    return {
        "type": "settings_state",
        "settings": settings,
        "languages": translation,
        "resources": resources,
    }


def _run_resource_download(resource_id: str, context: object) -> None:
    if not _resource_download_lock.acquire(blocking=False):
        _send_to_webview(
            context,
            {
                "type": "settings_resource_progress",
                "resource": resource_id,
                "progress": 0,
                "status": "error",
                "message": "Dang co tac vu tai khac. Vui long doi xong.",
            },
        )
        return

    try:
        setup_service = _get_setup_service()
        translation = _load_translation_config()
        source_language = translation["source_language"]
        target_language = translation["target_language"]

        if setup_service is None:
            _send_to_webview(
                context,
                {
                    "type": "settings_resource_progress",
                    "resource": resource_id,
                    "progress": 0,
                    "status": "error",
                    "message": "Khong the khoi tao setup service.",
                },
            )
            return

        _send_to_webview(
            context,
            {
                "type": "settings_resource_progress",
                "resource": resource_id,
                "progress": 8,
                "status": "downloading",
                "message": "Dang bat dau...",
            },
        )

        if resource_id == "argostranslate":
            _send_to_webview(
                context,
                {
                    "type": "settings_resource_progress",
                    "resource": resource_id,
                    "progress": 35,
                    "status": "downloading",
                    "message": "Dang cai thu vien ArgosTranslate...",
                },
            )
            ok, message = setup_service.ensure_translation_ready(
                source_language=source_language,
                target_language=target_language,
                auto_install_dependency=True,
                auto_install_language_pack=False,
                require_language_pair=False,
            )
        elif resource_id == "language_pack":
            _send_to_webview(
                context,
                {
                    "type": "settings_resource_progress",
                    "resource": resource_id,
                    "progress": 25,
                    "status": "downloading",
                    "message": "Dang kiem tra thu vien ArgosTranslate...",
                },
            )
            ok, message = setup_service.ensure_translation_ready(
                source_language=source_language,
                target_language=target_language,
                auto_install_dependency=True,
                auto_install_language_pack=True,
            )
        else:
            _send_to_webview(
                context,
                {
                    "type": "settings_resource_progress",
                    "resource": resource_id,
                    "progress": 0,
                    "status": "error",
                    "message": f"Tai nguyen khong hop le: {resource_id}",
                },
            )
            return

        if ok:
            _send_to_webview(
                context,
                {
                    "type": "settings_resource_progress",
                    "resource": resource_id,
                    "progress": 100,
                    "status": "success",
                    "message": "Tai xong.",
                },
            )
            _send_to_webview(context, _build_settings_payload())
            return

        _send_to_webview(
            context,
            {
                "type": "settings_resource_progress",
                "resource": resource_id,
                "progress": 0,
                "status": "error",
                "message": message or "Tai that bai.",
            },
        )
        _send_to_webview(context, _build_settings_payload())
    finally:
        _resource_download_lock.release()


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


def _start_auto_setup_if_needed() -> None:
    setup_service = _get_setup_service()
    if setup_service is None:
        print(f"[{ADDON_PACKAGE}] setup service unavailable")
        return

    config = setup_service.load_setup_config()
    if not config.get("auto_setup_on_startup", True):
        return

    languages = _load_translation_config()

    def _bootstrap() -> None:
        ok, message = setup_service.bootstrap_from_config(
            source_language=languages["source_language"],
            target_language=languages["target_language"],
        )
        if ok:
            print(f"[{ADDON_PACKAGE}] Auto setup completed.")
            return

        if message:
            print(f"[{ADDON_PACKAGE}] Auto setup skipped: {message}")

    threading.Thread(target=_bootstrap, name="apl-auto-setup", daemon=True).start()


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
            print(f"[{ADDON_PACKAGE}] Cannot update webview: {error}")

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
            f"{ADDON_PACKAGE}.features.lookup.handler"
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
            f"{ADDON_PACKAGE}.features.translate.handler"
        )
        handle_translate = handler_module.handle_translate
        result = handle_translate(phrase)
    except Exception as error:
        result = {
            "type": "error",
            "message": f"Translate handler error: {error}",
        }

    _send_to_webview(context, result)


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

        _save_runtime_settings(payload)
        _send_to_webview(context, _build_settings_payload())
        return (True, None)

    if message.startswith("settings:download:"):
        resource_id = unquote(message[len("settings:download:") :]).strip()
        threading.Thread(
            target=_run_resource_download,
            args=(resource_id, context),
            name=f"apl-download-{resource_id}",
            daemon=True,
        ).start()
        return (True, None)

    if message.startswith("lookup:"):
        word = unquote(message[7:]).strip()
        threading.Thread(
            target=_run_lookup_message,
            args=(word, context),
            name="apl-lookup",
            daemon=True,
        ).start()
        return (True, None)

    if message.startswith("translate:"):
        phrase = unquote(message[10:]).strip()
        threading.Thread(
            target=_run_translate_message,
            args=(phrase, context),
            name="apl-translate",
            daemon=True,
        ).start()
        return (True, None)

    return handled


gui_hooks.card_will_show.append(on_card_show)
gui_hooks.webview_will_set_content.append(on_webview_will_set_content)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
_start_auto_setup_if_needed()
