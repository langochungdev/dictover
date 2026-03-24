from __future__ import annotations

import importlib
import json
import os
import shutil
import site
import subprocess
import sys
import sysconfig
import threading
import time
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.json"
ADDON_ROOT = Path(__file__).resolve().parents[1]
VENDOR_PATH = ADDON_ROOT / "_vendor"

DEFAULT_SETUP_CONFIG: dict[str, bool] = {
    "auto_setup_on_startup": True,
    "auto_install_argostranslate": True,
    "auto_install_language_pack": True,
}

_SETUP_COOLDOWN_SECONDS = 30
_PIP_INSTALL_TIMEOUT_SECONDS = 180
_LANGUAGE_PACK_TIMEOUT_SECONDS = 300
_setup_lock = threading.Lock()
_last_error_time = 0.0
_last_error_message = ""


def is_setup_running() -> bool:
    return _setup_lock.locked()


def load_setup_config() -> dict[str, bool]:
    if not CONFIG_PATH.exists():
        return DEFAULT_SETUP_CONFIG.copy()

    try:
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return DEFAULT_SETUP_CONFIG.copy()

    if not isinstance(payload, dict):
        return DEFAULT_SETUP_CONFIG.copy()

    merged = DEFAULT_SETUP_CONFIG.copy()
    for key, default in DEFAULT_SETUP_CONFIG.items():
        merged[key] = bool(payload.get(key, default))
    return merged


def _import_argos_modules_with_error():
    try:
        argos_translate = importlib.import_module("argostranslate.translate")
        argos_package = importlib.import_module("argostranslate.package")
        return argos_translate, argos_package, ""
    except Exception as error:
        return None, None, f"{type(error).__name__}: {error}"


def _import_argos_modules():
    argos_translate, argos_package, _ = _import_argos_modules_with_error()
    return argos_translate, argos_package


def _append_sys_path(path: str | None) -> None:
    if not path:
        return
    normalized = str(Path(path))
    if normalized and normalized not in sys.path and Path(normalized).exists():
        sys.path.insert(0, normalized)


def _refresh_python_paths() -> None:
    """Add likely install locations so newly pip-installed modules are importable immediately."""
    _append_sys_path(str(VENDOR_PATH))

    try:
        _append_sys_path(site.getusersitepackages())
    except Exception:
        pass

    try:
        for path in site.getsitepackages():
            _append_sys_path(path)
    except Exception:
        pass

    for key in ["purelib", "platlib"]:
        try:
            _append_sys_path(sysconfig.get_paths().get(key))
        except Exception:
            pass


def _import_argos_modules_with_refresh():
    for module_name in ["argostranslate", "argostranslate.translate", "argostranslate.package", "ctranslate2"]:
        if module_name in sys.modules:
            sys.modules.pop(module_name, None)

    modules = _import_argos_modules()
    if modules[0] is not None and modules[1] is not None:
        return modules

    importlib.invalidate_caches()
    _refresh_python_paths()
    return _import_argos_modules()


def _is_pair_installed(argos_translate, source_language: str, target_language: str) -> bool:
    installed_languages = argos_translate.get_installed_languages()
    source = next((lang for lang in installed_languages if lang.code == source_language), None)
    if source is None:
        return False

    if hasattr(source, "get_translation_languages"):
        try:
            for target in source.get_translation_languages():
                if getattr(target, "code", "") == target_language:
                    return True
        except Exception:
            pass

    translations = getattr(source, "translations_from", None)
    if isinstance(translations, list):
        for translation in translations:
            to_language = getattr(translation, "to_lang", None)
            if getattr(to_language, "code", "") == target_language:
                return True

    get_translation = getattr(source, "get_translation", None)
    if callable(get_translation):
        target = next((lang for lang in installed_languages if lang.code == target_language), None)
        if target is not None:
            try:
                translation = get_translation(target)
                if translation is not None:
                    return True
            except Exception:
                pass

    return False


def _is_runtime_translation_ok(argos_translate, source_language: str, target_language: str) -> bool:
    try:
        probe = argos_translate.translate("hello", source_language, target_language)
        return bool((probe or "").strip())
    except Exception:
        return False


def _install_argostranslate_dependency(
    *,
    force_reinstall: bool = False,
    clean_target: bool = False,
) -> tuple[bool, str]:
    env = os.environ.copy()
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PYTHONUTF8", "1")

    if clean_target and VENDOR_PATH.exists():
        try:
            shutil.rmtree(VENDOR_PATH)
        except Exception:
            # When Anki is running, compiled DLLs can be locked. Continue with a
            # force reinstall instead of failing hard on cleanup.
            pass

    VENDOR_PATH.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
    ]
    if force_reinstall:
        command.extend(["--force-reinstall", "--no-cache-dir"])
    command.extend([
        "--target",
        str(VENDOR_PATH),
        "argostranslate",
    ])

    try:
        process = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=_PIP_INSTALL_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return (
            False,
            "Het thoi gian cai ArgosTranslate. Vui long thu lai.",
        )

    if process.returncode == 0:
        return True, ""

    output = (process.stderr or process.stdout or "").strip()
    return False, output or "pip install argostranslate failed"


def _install_language_pack(argos_package, source_language: str, target_language: str) -> tuple[bool, str]:
    result: dict[str, object] = {"ok": False, "message": "Unknown error"}

    def _worker() -> None:
        try:
            argos_package.update_package_index()
            available = argos_package.get_available_packages()
        except Exception as error:
            result["ok"] = False
            result["message"] = f"Cannot update Argos index: {error}"
            return

        package = next(
            (
                pkg
                for pkg in available
                if pkg.from_code == source_language and pkg.to_code == target_language
            ),
            None,
        )
        if package is None:
            result["ok"] = False
            result["message"] = f"Cannot find Argos package {source_language}->{target_language}"
            return

        try:
            package_path = package.download()
            argos_package.install_from_path(package_path)
            result["ok"] = True
            result["message"] = ""
        except Exception as error:
            result["ok"] = False
            result["message"] = f"Cannot install Argos package {source_language}->{target_language}: {error}"

    thread = threading.Thread(target=_worker, name="apl-install-langpack", daemon=True)
    thread.start()
    thread.join(_LANGUAGE_PACK_TIMEOUT_SECONDS)

    if thread.is_alive():
        return False, "Het thoi gian tai/cai language pack. Vui long thu lai."

    return bool(result.get("ok", False)), str(result.get("message", ""))


def ensure_translation_ready(
    source_language: str,
    target_language: str,
    auto_install_dependency: bool,
    auto_install_language_pack: bool,
    require_language_pair: bool = True,
    force_retry: bool = False,
    lock_timeout_seconds: float | None = None,
) -> tuple[bool, str]:
    global _last_error_time, _last_error_message

    if lock_timeout_seconds is None:
        acquired = _setup_lock.acquire(blocking=True)
    else:
        acquired = _setup_lock.acquire(timeout=max(0.0, float(lock_timeout_seconds)))

    if not acquired:
        return (
            False,
            "Dang co tien trinh cai dat Argos khac dang chay. Vui long doi xong roi bam Tai lai.",
        )

    try:
        now = time.time()
        if (
            not force_retry
            and _last_error_message
            and now - _last_error_time < _SETUP_COOLDOWN_SECONDS
        ):
            return False, _last_error_message

        argos_translate, argos_package = _import_argos_modules()
        if argos_translate is None or argos_package is None:
            argos_translate, argos_package = _import_argos_modules_with_refresh()

        if argos_translate is None or argos_package is None:
            if not auto_install_dependency:
                return False, "argostranslate is not installed"

            ok, message = _install_argostranslate_dependency()
            if not ok:
                _last_error_time = now
                _last_error_message = message
                return False, message

            argos_translate, argos_package = _import_argos_modules_with_refresh()
            if argos_translate is None or argos_package is None:
                repair_ok, repair_message = _install_argostranslate_dependency(
                    force_reinstall=True,
                    clean_target=False,
                )
                if repair_ok:
                    argos_translate, argos_package = _import_argos_modules_with_refresh()

            if argos_translate is None or argos_package is None:
                _, _, import_error = _import_argos_modules_with_error()
                _last_error_time = now
                _last_error_message = (
                    "ArgosTranslate da cai xong nhung Anki khong nap duoc thu vien. "
                    "Thu xoa thu muc _vendor trong addon, mo lai Anki va bam tai lai. "
                    f"Chi tiet import: {import_error or 'unknown'}"
                )
                if repair_message:
                    _last_error_message = f"{_last_error_message} | Cai lai: {repair_message}"
                return False, _last_error_message

        if not require_language_pair:
            _last_error_message = ""
            _last_error_time = 0.0
            return True, ""

        if _is_pair_installed(argos_translate, source_language, target_language):
            return True, ""

        if not auto_install_language_pack:
            return False, f"Missing Argos language pack {source_language}->{target_language}"

        ok, message = _install_language_pack(argos_package, source_language, target_language)
        if not ok:
            _last_error_time = now
            _last_error_message = message
            return False, message

        if not _is_pair_installed(argos_translate, source_language, target_language):
            _last_error_time = now
            _last_error_message = (
                f"Argos language pack {source_language}->{target_language} is still unavailable"
            )
            return False, _last_error_message

        _last_error_message = ""
        _last_error_time = 0.0
        return True, ""
    finally:
        _setup_lock.release()


def bootstrap_from_config(source_language: str, target_language: str) -> tuple[bool, str]:
    config = load_setup_config()
    if not config.get("auto_setup_on_startup", True):
        return False, "auto setup is disabled"

    return ensure_translation_ready(
        source_language=source_language,
        target_language=target_language,
        auto_install_dependency=config.get("auto_install_argostranslate", True),
        auto_install_language_pack=config.get("auto_install_language_pack", True),
    )


def get_resource_status(source_language: str, target_language: str) -> dict[str, bool]:
    argos_translate, argos_package = _import_argos_modules()
    if argos_translate is None or argos_package is None:
        # Status checks should still find modules installed in delayed paths
        # (usersite/site-packages) without requiring a manual restart cycle.
        argos_translate, argos_package = _import_argos_modules_with_refresh()
    dependency_installed = argos_translate is not None and argos_package is not None
    language_pack_installed = False
    runtime_translation_ok = False

    if dependency_installed:
        try:
            language_pack_installed = _is_pair_installed(
                argos_translate,
                source_language,
                target_language,
            )
            if language_pack_installed:
                runtime_translation_ok = _is_runtime_translation_ok(
                    argos_translate,
                    source_language,
                    target_language,
                )
        except Exception:
            language_pack_installed = False
            runtime_translation_ok = False

    return {
        "argostranslate": dependency_installed,
        "language_pack": language_pack_installed,
        "argos_runtime_ok": runtime_translation_ok,
    }
