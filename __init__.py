from __future__ import annotations

import json
import importlib
import sys
from pathlib import Path
from urllib.parse import unquote

from aqt import gui_hooks, mw

ADDON_PACKAGE = "anki_popup_lookup"
ADDON_DIR = Path(__file__).resolve().parent
ADDON_PARENT_DIR = ADDON_DIR.parent

if str(ADDON_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_DIR))
if str(ADDON_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_PARENT_DIR))

mw.addonManager.setWebExports(__name__, r"web/.*\.(css|js|html)")


def _send_to_webview(context: object, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False)
    if hasattr(context, "eval"):
        context.eval(f"window.updatePopover({data});")
        return
    web = getattr(context, "web", None)
    if web is not None:
        web.eval(f"window.updatePopover({data});")
        return
    reviewer = getattr(mw, "reviewer", None)
    reviewer_web = getattr(reviewer, "web", None)
    if reviewer_web is not None:
        reviewer_web.eval(f"window.updatePopover({data});")
        return
    if getattr(mw, "web", None) is not None:
        mw.web.eval(f"window.updatePopover({data});")


def on_card_show(html: str, card, context) -> str:
    asset_version = "20260324b"
    css_tag = (
        f"<link rel='stylesheet' href='/_addons/{ADDON_PACKAGE}/web/popup.css?v={asset_version}'>"
    )
    js_tag = f"<script src='/_addons/{ADDON_PACKAGE}/web/popup.js?v={asset_version}'></script>"

    if css_tag in html and js_tag in html:
        return html

    return html + css_tag + js_tag


def on_js_message(handled, message: str, context):
    if message.startswith("lookup:"):
        try:
            handler_module = importlib.import_module(
                f"{ADDON_PACKAGE}.features.lookup.handler"
            )
            handle_lookup = handler_module.handle_lookup
            word = unquote(message[7:]).strip()
            result = handle_lookup(word)
        except Exception as error:
            result = {
                "type": "error",
                "message": f"Lookup handler error: {error}",
            }

        _send_to_webview(context, result)
        return (True, None)

    if message.startswith("translate:"):
        try:
            handler_module = importlib.import_module(
                f"{ADDON_PACKAGE}.features.translate.handler"
            )
            handle_translate = handler_module.handle_translate
            phrase = unquote(message[10:]).strip()
            result = handle_translate(phrase)
        except Exception as error:
            result = {
                "type": "error",
                "message": f"Translate handler error: {error}",
            }

        _send_to_webview(context, result)
        return (True, None)

    return handled


gui_hooks.card_will_show.append(on_card_show)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
