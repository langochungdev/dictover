(function () {
  if (window.__aplPopupToolsInitialized) {
    if (typeof window.aplEnsureSettingsTrigger === "function") {
      window.aplEnsureSettingsTrigger();
    }
    return;
  }
  window.__aplPopupToolsInitialized = true;

  let popoverEl = null;
  let debugPanelEl = null;
  let debugLogEl = null;
  let settingsTriggerEl = null;
  let settingsModalEl = null;
  let settingsModalWarm = false;
  let settingsLoaded = false;
  let settingsRequestPending = false;
  let settingsLastRequestedAt = 0;
  let settingsSaveGuardSnapshot = null;
  let settingsSaveGuardUntil = 0;
  let settingsTriggerHideTimerId = null;
  let settingsTriggerBootVisibleDone = false;
  let settingsTriggerHoverListenerBound = false;
  let settingsProgressTickerId = null;
  let subPanelEl = null;
  let pendingCommandToken = 0;
  let pendingSelectionAction = null;
  let activeCommandMeta = null;
  let pendingNativeAudioFallback = null;
  let activeHtmlAudioElements = [];
  let lastLookupDetails = null;
  let lastAnchor = { x: 24, y: 24 };
  let pendingTimer = null;
  const debugLines = [];

  const toolSettings = {
    enable_lookup: true,
    enable_translate: true,
    enable_audio: true,
  };

  const settingsState = {
    languages: { source_language: "auto", target_language: "vi" },
    popover: {
      trigger_mode: "auto",
      shortcut_combo: "Shift",
      auto_play_audio: false,
    },
    resources: {
      mode: "api_only",
      status_unknown: false,
    },
  };

  const resourceProgress = {
    argostranslate: { progress: 0, status: "idle", message: "", startedAt: 0, startedPerf: 0 },
    language_pack: { progress: 0, status: "idle", message: "", startedAt: 0, startedPerf: 0 },
  };

  let settingsMessage = "";
  const SETTINGS_REQUEST_COOLDOWN_MS = 3000;
  const SETTINGS_SAVE_GUARD_MS = 3000;
  const SETTINGS_TRIGGER_BOOT_VISIBLE_MS = 10000;
  const SETTINGS_TRIGGER_HOTZONE_TOP_PX = 120;
  const SETTINGS_TRIGGER_HOTZONE_RIGHT_PX = 120;
  const DEFAULT_SHORTCUT_COMBO = "Shift";
  const SUPPORTED_LANGUAGES = [
    { code: "en", label: "English" },
    { code: "zh-CN", label: "Chinese" },
    { code: "ja", label: "Japanese" },
    { code: "ko", label: "Korean" },
    { code: "ru", label: "Russian" },
    { code: "fi", label: "Finnish" },
    { code: "de", label: "German" },
    { code: "fr", label: "French" },
    { code: "vi", label: "Vietnamese" },
  ];
  const AUTO_DETECT_LANGUAGE = { code: "auto", label: "Auto Detect" };
  const SETTINGS_UI_COPY = {
    en: {
      input_language: "Input language",
      output_language: "Output language",
      swap_languages_aria: "Swap input and output language",
      trigger_auto: "auto translate when selecting text",
      trigger_shortcut: "translate when pressing shortcut",
      shortcut_label: "Shortcut",
      shortcut_placeholder: "Press shortcut",
      shortcut_hint:
        "Select this field and press a key or key combination, for example: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "auto play audio",
    },
    vi: {
      input_language: "Ngôn ngữ vào",
      output_language: "Ngôn ngữ ra",
      swap_languages_aria: "Đổi qua lại ngôn ngữ vào và ra",
      trigger_auto: "tự động dịch khi bôi",
      trigger_shortcut: "dịch khi bấm phím",
      shortcut_label: "Phím tắt",
      shortcut_placeholder: "Nhấn tổ hợp phím",
      shortcut_hint: "Chọn ô rồi nhấn trực tiếp phím hoặc tổ hợp phím, ví dụ: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "tự động phát audio",
    },
    "zh-CN": {
      input_language: "输入语言",
      output_language: "输出语言",
      swap_languages_aria: "交换输入和输出语言",
      trigger_auto: "选中文本后自动翻译",
      trigger_shortcut: "按快捷键时翻译",
      shortcut_label: "快捷键",
      shortcut_placeholder: "按下快捷键",
      shortcut_hint: "点击此输入框后直接按键或组合键，例如：Shift、Alt+1、Ctrl+Shift+L。",
      auto_play_audio: "自动播放音频",
    },
    ja: {
      input_language: "入力言語",
      output_language: "出力言語",
      swap_languages_aria: "入力言語と出力言語を入れ替える",
      trigger_auto: "テキスト選択時に自動翻訳",
      trigger_shortcut: "ショートカットキーで翻訳",
      shortcut_label: "ショートカット",
      shortcut_placeholder: "ショートカットを押す",
      shortcut_hint: "この欄を選択してキーまたはキーの組み合わせを押してください。例: Shift、Alt+1、Ctrl+Shift+L。",
      auto_play_audio: "音声を自動再生",
    },
    ko: {
      input_language: "입력 언어",
      output_language: "출력 언어",
      swap_languages_aria: "입력 언어와 출력 언어 바꾸기",
      trigger_auto: "텍스트를 선택하면 자동 번역",
      trigger_shortcut: "단축키를 누르면 번역",
      shortcut_label: "단축키",
      shortcut_placeholder: "단축키를 누르세요",
      shortcut_hint: "이 입력칸을 선택한 뒤 키 또는 키 조합을 눌러 주세요. 예: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "오디오 자동 재생",
    },
    ru: {
      input_language: "Язык ввода",
      output_language: "Язык вывода",
      swap_languages_aria: "Поменять местами язык ввода и вывода",
      trigger_auto: "автоперевод при выделении текста",
      trigger_shortcut: "перевод по горячей клавише",
      shortcut_label: "Горячая клавиша",
      shortcut_placeholder: "Нажмите сочетание клавиш",
      shortcut_hint: "Выберите это поле и нажмите клавишу или сочетание клавиш, например: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "автовоспроизведение аудио",
    },
    fi: {
      input_language: "Syottokieli",
      output_language: "Kohdekieli",
      swap_languages_aria: "Vaihda syotto- ja kohdekieli keskenaan",
      trigger_auto: "kaanna automaattisesti tekstia valittaessa",
      trigger_shortcut: "kaanna pikanappaimella",
      shortcut_label: "Pikanappain",
      shortcut_placeholder: "Paina pikanappainta",
      shortcut_hint: "Valitse tama kentta ja paina nappainta tai nappainyhdistelmaa, esimerkiksi: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "toista audio automaattisesti",
    },
    de: {
      input_language: "Eingabesprache",
      output_language: "Zielsprache",
      swap_languages_aria: "Eingabe- und Zielsprache tauschen",
      trigger_auto: "automatisch beim Markieren ubersetzen",
      trigger_shortcut: "beim Drucken des Kurzbefehls ubersetzen",
      shortcut_label: "Kurzbefehl",
      shortcut_placeholder: "Kurzbefehl drucken",
      shortcut_hint: "Wahlen Sie dieses Feld und drucken Sie eine Taste oder Tastenkombination, z. B.: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "Audio automatisch abspielen",
    },
    fr: {
      input_language: "Langue source",
      output_language: "Langue cible",
      swap_languages_aria: "Inverser la langue source et la langue cible",
      trigger_auto: "traduction automatique lors de la selection du texte",
      trigger_shortcut: "traduire avec le raccourci clavier",
      shortcut_label: "Raccourci",
      shortcut_placeholder: "Appuyez sur le raccourci",
      shortcut_hint:
        "Selectionnez ce champ puis appuyez sur une touche ou combinaison, par exemple: Shift, Alt+1, Ctrl+Shift+L.",
      auto_play_audio: "lecture audio automatique",
    },
  };
  const RESOURCE_TIMEOUT_SECONDS = {
    argostranslate: 75,
    language_pack: 300,
  };
  const detailsToggleLabels = {
    closed: "▸",
    open: "▾",
  };
  const AUDIO_ICON_SVG =
    '<svg class="apl-audio-icon" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<g fill="none" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6.5 8.5v4"/>' +
    '<path d="M8.5 6.5v9"/>' +
    '<path d="M10.5 9.5v2"/>' +
    '<path d="M12.5 7.5v6.814"/>' +
    '<path d="M14.5 4.5v12"/>' +
    "</g></svg>";
  const DEBUG_PANEL_ALWAYS_VISIBLE =
    window.__aplDebugPanelAlwaysVisible === true ||
    String(window.__aplDebugPanelAlwaysVisible || "").toLowerCase() === "true";

  function now() {
    return new Date().toLocaleTimeString();
  }

  function pushDebug(line) {
    const record = "[" + now() + "] " + line;
    debugLines.push(record);
    if (debugLines.length > 120) {
      debugLines.shift();
    }
    if (debugLogEl) {
      debugLogEl.value = debugLines.join("\n");
      debugLogEl.scrollTop = debugLogEl.scrollHeight;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sendPycmd(command) {
    if (typeof window.pycmd !== "function") {
      pushDebug("window.pycmd unavailable");
      return false;
    }

    try {
      window.pycmd(command);
      return true;
    } catch (error) {
      pushDebug("pycmd error: " + String(error));
      return false;
    }
  }

  function normalizeSelection() {
    const selection = window.getSelection();
    if (!selection) return "";
    return selection.toString().replace(/\s+/g, " ").trim();
  }

  function getSelectionAnchorPoint(fallbackX, fallbackY) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { x: fallbackX, y: fallbackY };
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      return { x: fallbackX, y: fallbackY };
    }

    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.bottom),
    };
  }

  function getWordCount(text) {
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  function registerActiveHtmlAudio(audio) {
    if (!audio) {
      return;
    }

    activeHtmlAudioElements.push(audio);

    function cleanup() {
      activeHtmlAudioElements = activeHtmlAudioElements.filter(function (item) {
        return item !== audio;
      });
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
    }

    audio.addEventListener("ended", cleanup);
    audio.addEventListener("error", cleanup);
  }

  function stopAllAudioPlayback() {
    pendingNativeAudioFallback = null;

    if (window.speechSynthesis && typeof window.speechSynthesis.cancel === "function") {
      window.speechSynthesis.cancel();
    }

    activeHtmlAudioElements.forEach(function (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (error) {
        pushDebug("audio.stop html failed: " + String(error));
      }
    });
    activeHtmlAudioElements = [];

    sendPycmd("audio:stop");
  }

  function closePopover() {
    stopAllAudioPlayback();
    closeSubPanel();
    if (!popoverEl) return;
    popoverEl.remove();
    popoverEl = null;
  }

  function syncDetailsToggleState(expanded) {
    if (!popoverEl) {
      return;
    }

    const detailsToggle = popoverEl.querySelector(".apl-lookup-definition-toggle");
    if (!detailsToggle) {
      return;
    }

    detailsToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    const iconEl = detailsToggle.querySelector(".apl-definition-toggle-icon");
    if (iconEl) {
      iconEl.textContent = expanded ? detailsToggleLabels.open : detailsToggleLabels.closed;
    }
  }

  function closeSubPanel() {
    if (subPanelEl) {
      subPanelEl.remove();
      subPanelEl = null;
    }
    syncDetailsToggleState(false);
  }

  function closeSettingsModal() {
    if (!settingsModalEl) {
      return;
    }
    settingsModalEl.classList.add("apl-settings-root--hidden");
    stopSettingsProgressTicker();
  }

  function stopSettingsProgressTicker() {
    if (settingsProgressTickerId !== null) {
      window.clearInterval(settingsProgressTickerId);
      settingsProgressTickerId = null;
    }
  }

  function hasActiveResourceDownload() {
    return ["argostranslate", "language_pack"].some(function (resourceId) {
      expireStalledDownload(resourceId);
      const progress = resourceProgress[resourceId] || {};
      return progress.status === "downloading";
    });
  }

  function ensureSettingsProgressTicker() {
    if (!hasActiveResourceDownload()) {
      stopSettingsProgressTicker();
      return;
    }

    if (!settingsModalEl || settingsModalEl.classList.contains("apl-settings-root--hidden")) {
      stopSettingsProgressTicker();
      return;
    }

    if (settingsProgressTickerId !== null) {
      return;
    }

    settingsProgressTickerId = window.setInterval(function () {
      if (!settingsModalEl || settingsModalEl.classList.contains("apl-settings-root--hidden")) {
        stopSettingsProgressTicker();
        return;
      }
      if (!hasActiveResourceDownload()) {
        stopSettingsProgressTicker();
        return;
      }
      renderSettingsModal();
    }, 1000);
  }

  function stripElapsedSuffix(message) {
    return String(message || "").replace(/\s*\(\d+s\)\s*$/, "").trim();
  }

  function formatProgressMessage(progress) {
    const base = stripElapsedSuffix(progress && progress.message ? progress.message : "");
    if (!base) {
      return "";
    }

    if (!progress || progress.status !== "downloading") {
      return base;
    }

    const startedAt = Number(progress && progress.startedAt ? progress.startedAt : 0);
    const startedPerf = Number(progress && progress.startedPerf ? progress.startedPerf : 0);
    if (!startedAt && !startedPerf) {
      return base;
    }

    let elapsedSeconds = 0;
    if (startedPerf && typeof performance !== "undefined" && typeof performance.now === "function") {
      elapsedSeconds = Math.max(0, Math.floor((performance.now() - startedPerf) / 1000));
    } else {
      elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    }
    return base + " (" + elapsedSeconds + "s)";
  }

  function expireStalledDownload(resourceId) {
    const progress = resourceProgress[resourceId] || {};
    if (progress.status !== "downloading") {
      return false;
    }

    const startedAt = Number(progress.startedAt || 0);
    if (!startedAt) {
      return false;
    }

    const timeoutSeconds = Number(RESOURCE_TIMEOUT_SECONDS[resourceId] || 120);
    const startedPerf = Number(progress.startedPerf || 0);
    let elapsedSeconds = 0;
    if (startedPerf && typeof performance !== "undefined" && typeof performance.now === "function") {
      elapsedSeconds = Math.max(0, Math.floor((performance.now() - startedPerf) / 1000));
    } else {
      elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    }
    if (elapsedSeconds <= timeoutSeconds) {
      return false;
    }

    resourceProgress[resourceId] = {
      progress: 0,
      status: "error",
      message: "Qua thoi gian cho. Bam Tai lai.",
      startedAt: startedAt,
      startedPerf: startedPerf,
    };
    return true;
  }

  function ensureDebugPanel() {
    if (debugPanelEl) {
      return;
    }

    const panel = document.createElement("div");
    panel.className = "apl-debug-panel";
    panel.innerHTML =
      '<div class="apl-debug-header">APL Debug (Shift de an/hien)</div>' +
      '<textarea class="apl-debug-log" readonly></textarea>' +
      '<div class="apl-debug-actions">' +
      '<button class="apl-button apl-debug-copy" type="button">Copy</button>' +
      '<button class="apl-button apl-debug-clear" type="button">Clear</button>' +
      '<button class="apl-close apl-debug-close" type="button" aria-label="Close">x</button>' +
      "</div>";

    document.body.appendChild(panel);
    debugPanelEl = panel;
    debugLogEl = panel.querySelector(".apl-debug-log");

    panel.querySelector(".apl-debug-copy").addEventListener("click", function () {
      const text = debugLines.join("\n");
      if (!text) {
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function (error) {
          pushDebug("Copy loi: " + String(error));
        });
        return;
      }

      if (debugLogEl) {
        debugLogEl.focus();
        debugLogEl.select();
        document.execCommand("copy");
      }
    });

    panel.querySelector(".apl-debug-clear").addEventListener("click", function () {
      debugLines.length = 0;
      if (debugLogEl) {
        debugLogEl.value = "";
      }
    });

    panel.querySelector(".apl-debug-close").addEventListener("click", function () {
      debugPanelEl.classList.remove("apl-debug-panel--show");
    });
  }

  function toggleDebugPanel() {
    ensureDebugPanel();
    debugPanelEl.classList.toggle("apl-debug-panel--show");
  }

  function ensureDebugPanelVisible() {
    ensureDebugPanel();
    debugPanelEl.classList.add("apl-debug-panel--show");
  }

  function shortenForLog(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength) + "...";
  }

  function buildAlternativeAudioUrl(audioUrl) {
    const url = String(audioUrl || "").trim();
    if (!url) {
      return "";
    }

    if (url.indexOf("translate.googleapis.com/translate_tts") >= 0) {
      return url
        .replace("translate.googleapis.com/translate_tts", "translate.google.com/translate_tts")
        .replace("client=gtx", "client=tw-ob");
    }

    if (url.indexOf("translate.google.com/translate_tts") >= 0) {
      return url
        .replace("translate.google.com/translate_tts", "translate.googleapis.com/translate_tts")
        .replace("client=tw-ob", "client=gtx");
    }

    return "";
  }

  function requestNativeAudioPlayback(audioUrl) {
    const url = String(audioUrl || "").trim();
    if (!url) {
      pushDebug("audio.native skipped (empty url)");
      return false;
    }

    const sent = sendPycmd("audio:play:" + encodeURIComponent(url));
    if (sent) {
      pushDebug("audio.native request sent");
      return true;
    }
    pushDebug("audio.native request failed to send");
    return false;
  }

  function armPendingTimeout(command, text) {
    clearPendingTimeout();
    pendingTimer = window.setTimeout(function () {
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Khong nhan duoc phan hoi tu Python sau 3s.",
      });
      pushDebug("timeout command=" + command + " text=" + text);
    }, 3000);
  }

  function clearPendingTimeout() {
    if (pendingTimer !== null) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function placePopover(el, x, y) {
    const margin = 12;
    const width = el.offsetWidth || 320;
    const height = el.offsetHeight || 220;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const offset = 10;

    const roomRight = viewportWidth - (x + offset) - margin;
    const roomLeft = x - offset - margin;
    const roomBottom = viewportHeight - (y + offset) - margin;
    const roomTop = y - offset - margin;

    const horizontal = roomRight >= width || roomRight >= roomLeft ? "right" : "left";
    const vertical = roomBottom >= height || roomBottom >= roomTop ? "bottom" : "top";

    let left = horizontal === "right" ? x + offset : x - width - offset;
    let top = vertical === "bottom" ? y + offset : y - height - offset;

    const maxX = viewportWidth - width - margin;
    const maxY = viewportHeight - height - margin;
    left = Math.max(margin, Math.min(left, maxX));
    top = Math.max(margin, Math.min(top, maxY));

    el.style.left = left + "px";
    el.style.top = top + "px";
    el.setAttribute("data-side", vertical);
    el.setAttribute("data-align", horizontal);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function getSubPanelCandidates(mainRect, panelWidth, panelHeight, gap) {
    return [
      { placement: "right-top", left: mainRect.right + gap, top: mainRect.top },
      { placement: "right-bottom", left: mainRect.right + gap, top: mainRect.bottom - panelHeight },
      { placement: "left-top", left: mainRect.left - panelWidth - gap, top: mainRect.top },
      { placement: "left-bottom", left: mainRect.left - panelWidth - gap, top: mainRect.bottom - panelHeight },
      { placement: "bottom-left", left: mainRect.left, top: mainRect.bottom + gap },
      { placement: "bottom-right", left: mainRect.right - panelWidth, top: mainRect.bottom + gap },
      { placement: "top-left", left: mainRect.left, top: mainRect.top - panelHeight - gap },
      { placement: "top-right", left: mainRect.right - panelWidth, top: mainRect.top - panelHeight - gap },
    ];
  }

  function candidateOverflow(left, top, panelWidth, panelHeight, margin, viewportWidth, viewportHeight) {
    const overflowLeft = Math.max(0, margin - left);
    const overflowTop = Math.max(0, margin - top);
    const overflowRight = Math.max(0, left + panelWidth + margin - viewportWidth);
    const overflowBottom = Math.max(0, top + panelHeight + margin - viewportHeight);
    return overflowLeft + overflowTop + overflowRight + overflowBottom;
  }

  function distanceToMain(mainRect, left, top, panelWidth, panelHeight) {
    const mainCenterX = mainRect.left + mainRect.width / 2;
    const mainCenterY = mainRect.top + mainRect.height / 2;
    const panelCenterX = left + panelWidth / 2;
    const panelCenterY = top + panelHeight / 2;
    return Math.hypot(mainCenterX - panelCenterX, mainCenterY - panelCenterY);
  }

  function placeSubPanel(panel) {
    if (!panel || !popoverEl) {
      return;
    }

    const margin = 12;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const mainRect = popoverEl.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 320;
    const panelHeight = panel.offsetHeight || 260;
    const candidates = getSubPanelCandidates(mainRect, panelWidth, panelHeight, gap);

    let best = null;
    candidates.forEach(function (candidate) {
      const overflow = candidateOverflow(candidate.left, candidate.top, panelWidth, panelHeight, margin, viewportWidth, viewportHeight);
      const distance = distanceToMain(mainRect, candidate.left, candidate.top, panelWidth, panelHeight);
      const score = overflow * 10000 + distance;

      if (!best || score < best.score) {
        best = {
          left: candidate.left,
          top: candidate.top,
          placement: candidate.placement,
          score: score,
        };
      }
    });

    const maxX = Math.max(margin, viewportWidth - panelWidth - margin);
    const maxY = Math.max(margin, viewportHeight - panelHeight - margin);
    panel.style.left = clamp(best ? best.left : mainRect.right + gap, margin, maxX) + "px";
    panel.style.top = clamp(best ? best.top : mainRect.top, margin, maxY) + "px";
    panel.setAttribute("data-placement", best ? best.placement : "right-top");
    fitSubPanelToViewport(panel);
  }

  function fitSubPanelToViewport(panel) {
    if (!panel) {
      return;
    }

    const margin = 12;
    const rect = panel.getBoundingClientRect();
    const availableHeight = Math.max(120, window.innerHeight - margin * 2);
    const constrainedHeight = Math.max(120, Math.min(rect.height || availableHeight, availableHeight));

    panel.style.setProperty("--apl-subpanel-max-height", constrainedHeight + "px");
    fitSubPanelText(panel);
  }

  function fitSubPanelText(panel) {
    const body = panel ? panel.querySelector(".apl-subpanel-body") : null;
    if (!body) {
      return;
    }

    const baseElement = popoverEl || document.body;
    const computed = window.getComputedStyle(baseElement);
    const parsed = parseFloat(computed.fontSize || "");
    const resolvedFontSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
    body.style.fontSize = resolvedFontSize + "px";
    panel.style.setProperty("--apl-subpanel-font-size", resolvedFontSize + "px");
  }

  function openSubPanel(container) {
    const source = container.querySelector(".apl-details-source");
    if (!source) {
      return;
    }

    closeSubPanel();

    const panel = document.createElement("div");
    panel.className = "apl-subpanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.innerHTML =
      '<div class="apl-subpanel-body">' +
      source.innerHTML +
      "</div>";

    document.body.appendChild(panel);
    subPanelEl = panel;
    placeSubPanel(panel);
    syncDetailsToggleState(true);
  }


  function showPopover(x, y, state) {
    lastAnchor = { x: x || lastAnchor.x, y: y || lastAnchor.y };
    closePopover();

    const root = document.createElement("div");
    root.className = "apl-popover";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");

    root.innerHTML = renderState(state || { loading: true, word: "Lookup" });
    document.body.appendChild(root);
    placePopover(root, lastAnchor.x, lastAnchor.y);

    bindPopoverActions(root);

    popoverEl = root;
  }

  function bindPopoverActions(container) {
    const closeButton = container.querySelector(".apl-close");
    if (closeButton) {
      closeButton.addEventListener("click", closePopover);
    }

    const audioButton = container.querySelector(".apl-audio");
    if (audioButton && !audioButton.hasAttribute("disabled")) {
      audioButton.addEventListener("click", function () {
        const audioUrl = audioButton.getAttribute("data-audio") || "";
        const word = audioButton.getAttribute("data-word") || "";
        const lang = audioButton.getAttribute("data-lang") || "";
        playAudio(audioUrl, word, lang);
      });
    }

    const definitionToggle = container.querySelector(".apl-lookup-definition-toggle");
    if (definitionToggle) {
      definitionToggle.addEventListener("click", function (event) {
        event.preventDefault();
        const isOpen = definitionToggle.getAttribute("aria-expanded") === "true";
        if (isOpen) {
          closeSubPanel();
          return;
        }
        openSubPanel(container);
      });
    }
  }

  function playAudio(audioUrl, word, lang) {
    function fallbackSpeech() {
      if (!window.speechSynthesis || !word) {
        pushDebug("audio.fallback speechSynthesis unavailable");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(word);
      if (lang) {
        utterance.lang = String(lang);
      }
      pushDebug(
        "audio.fallback speechSynthesis lang=" +
          (utterance.lang || "") +
          " voices=" +
          String((window.speechSynthesis.getVoices() || []).length)
      );
      window.speechSynthesis.speak(utterance);
    }

    if (!toolSettings.enable_audio) {
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Audio dang tat trong Settings.",
      });
      return;
    }

    if (audioUrl) {
      pushDebug(
        "audio.play attempt url=" +
          shortenForLog(audioUrl, 180) +
          " lang=" +
          (lang || "")
      );
      const audio = new Audio(audioUrl);
      audio.play().then(function () {
      registerActiveHtmlAudio(audio);
        pushDebug("audio.play success");
      }).catch(function (error) {
        pushDebug("audio.play failed: " + String(error && error.message ? error.message : error));

        const alternativeUrl = buildAlternativeAudioUrl(audioUrl);
        if (alternativeUrl) {
          pushDebug("audio.play retry altUrl=" + shortenForLog(alternativeUrl, 180));
          const alternativeAudio = new Audio(alternativeUrl);
          registerActiveHtmlAudio(alternativeAudio);
          alternativeAudio.play().then(function () {
            pushDebug("audio.play alt success");
          }).catch(function (altError) {
            pushDebug(
              "audio.play alt failed: " +
                String(altError && altError.message ? altError.message : altError)
            );

            pendingNativeAudioFallback = {
              word: String(word || ""),
              lang: String(lang || ""),
              createdAt: Date.now(),
            };

            if (!requestNativeAudioPlayback(alternativeUrl)) {
              fallbackSpeech();
              pendingNativeAudioFallback = null;
            }
          });
          return;
        }

        pendingNativeAudioFallback = {
          word: String(word || ""),
          lang: String(lang || ""),
          createdAt: Date.now(),
        };
        if (!requestNativeAudioPlayback(audioUrl)) {
          fallbackSpeech();
          pendingNativeAudioFallback = null;
        }
      });
      return;
    }

    pushDebug("audio.play no-url -> speech fallback");
    fallbackSpeech();
  }

  function maybeAutoPlayAudio(data) {
    if (!data || !settingsState.popover.auto_play_audio || !toolSettings.enable_audio) {
      return;
    }

    if (data.type === "lookup") {
      playAudio(
        String(data.audio_url || ""),
        String(data.word || ""),
        String(data.audio_lang || settingsState.languages.source_language || "")
      );
      return;
    }

    if (data.type === "translate") {
      playAudio(
        String(data.audio_url || ""),
        String(data.original || ""),
        String(data.audio_lang || settingsState.languages.source_language || "")
      );
    }
  }

  function renderMeanings(meanings) {
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return '<div class="apl-error">Khong tim thay dinh nghia.</div>';
    }

    return meanings
      .map(function (meaning) {
        const rawPart = String(meaning.partOfSpeech || "").trim();
        const part = rawPart && rawPart.toLowerCase() !== "unknown" ? escapeHtml(rawPart) : "";
        const defs = Array.isArray(meaning.definitions) ? meaning.definitions : [];
        const defsHtml = defs
          .map(function (item) {
            const definition = escapeHtml(item.definition || "");
            const example = escapeHtml(item.example || "");
            return (
              '<div class="apl-def">' +
              definition +
              (example ? '<div class="apl-example">Example: "' + example + '"</div>' : "") +
              "</div>"
            );
          })
          .join("");

        return (
          '<div class="apl-meaning">' +
          (part
            ? '<div class="apl-pos">' +
              part +
              "</div>"
            : "") +
          defsHtml +
          "</div>"
        );
      })
      .join("");
  }

  function firstPartOfSpeech(meanings) {
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return "";
    }
    const first = String((meanings[0] || {}).partOfSpeech || "").trim();
    if (!first || first.toLowerCase() === "unknown") {
      return "";
    }
    return escapeHtml(first);
  }

  function firstDefinitionText(meanings) {
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return "";
    }
    const firstMeaning = meanings[0] || {};
    const defs = firstMeaning.definitions || [];
    if (!Array.isArray(defs) || defs.length === 0) {
      return "";
    }
    return escapeHtml(defs[0].definition || "");
  }

  function renderState(data) {
    if (data && data.loading) {
      return (
        '<div class="apl-header">' +
        '<span>' +
        escapeHtml(data.word || "Lookup") +
        "</span>" +
        '<button class="apl-close" type="button" aria-label="Close">x</button>' +
        "</div>" +
        '<div class="apl-body"><div class="apl-loading">Dang tra...</div></div>'
      );
    }

    if (data && data.type === "error") {
      return (
        '<div class="apl-header">' +
        '<span>Lookup</span>' +
        '<button class="apl-close" type="button" aria-label="Close">x</button>' +
        "</div>" +
        '<div class="apl-body"><div class="apl-error">' +
        escapeHtml(data.message || "Co loi xay ra") +
        "</div></div>"
      );
    }

    if (data && data.type === "translate") {
      const original = escapeHtml(data.original || "");
      const translated = escapeHtml(data.translated || "");
      const audio = escapeHtml(data.audio_url || "");
      const audioLang = escapeHtml(data.audio_lang || settingsState.languages.source_language || "");
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";
      return (
        '<div class="apl-body apl-translate-compact">' +
        '<div class="apl-translate-top">' +
        '<div class="apl-translate-en">' +
        original +
        "</div>" +
        '<button class="apl-button apl-audio" type="button" aria-label="Play audio" data-word="' +
        original +
        '" data-audio="' +
        audio +
        '" data-lang="' +
        audioLang +
        '"' +
        audioDisabled +
        ">" +
        AUDIO_ICON_SVG +
        "</button>" +
        "</div>" +
        '<div class="apl-translate-vi">' +
        translated +
        "</div>" +
        "</div>"
      );
    }

    if (data && data.type === "lookup") {
      const word = escapeHtml(data.word || "");
      const phonetic = escapeHtml(data.phonetic || "");
      const audio = escapeHtml(data.audio_url || "");
      const audioLang = escapeHtml(data.audio_lang || settingsState.languages.source_language || "");
      const meanings = data.meanings || [];
      const translated = escapeHtml(data.translated || "");
      const englishDefinition = firstDefinitionText(meanings);
      const pos = firstPartOfSpeech(meanings);
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";
      lastLookupDetails = renderMeanings(meanings);

      return (
        '<div class="apl-body apl-lookup-compact">' +
        '<div class="apl-lookup-headerline">' +
        '<div class="apl-lookup-headertext">' +
        '<span class="apl-lookup-word">' +
        word +
        "</span>" +
        '<span class="apl-lookup-phonetic-inline">' +
        phonetic +
        "</span>" +
        '<span class="apl-pos-inline">' +
        pos +
        "</span>" +
        '<button class="apl-button apl-audio apl-audio-mini" type="button" data-word="' +
        word +
        '" data-audio="' +
        audio +
        '" data-lang="' +
        audioLang +
        '"' +
        audioDisabled +
        ' aria-label="Play audio">' +
        AUDIO_ICON_SVG +
        "</button>" +
        "</div>" +
        "</div>" +
        '<div class="apl-lookup-vi">' +
        translated +
        "</div>" +
        '<button class="apl-lookup-definition-toggle" type="button" aria-expanded="false">' +
        '<span class="apl-definition-toggle-icon">' +
        detailsToggleLabels.closed +
        "</span>" +
        '<span class="apl-lookup-definition">' +
        englishDefinition +
        "</span>" +
        "</button>" +
        '<div class="apl-details-source" hidden>' +
        lastLookupDetails +
        "</div>" +
        "</div>"
      );
    }

    return (
      '<div class="apl-header">' +
      '<span>Lookup</span>' +
      '<button class="apl-close" type="button" aria-label="Close">x</button>' +
      "</div>" +
      '<div class="apl-body"><div class="apl-loading">Dang cho du lieu...</div></div>'
    );
  }

  function updatePopover(data) {
    clearPendingTimeout();

    if (!data || typeof data !== "object") {
      return;
    }

    if (data.type === "settings_state") {
      settingsRequestPending = false;
      updateSettingsState(data);
      return;
    }

    if (data.type === "settings_resource_progress") {
      const resourceId = data.resource || "";
      const previous = resourceProgress[resourceId] || {};
      const nextStatus = String(data.status || "idle");
      const incomingStartedAt = Number(data.started_at_ms || 0);
      const startedAt =
        nextStatus === "downloading"
          ? Number(
              incomingStartedAt ||
                (previous.status === "downloading" && previous.startedAt ? previous.startedAt : Date.now())
            )
          : 0;
      const startedPerf =
        nextStatus === "downloading"
          ? Number(
              previous.status === "downloading" && previous.startedPerf
                ? previous.startedPerf
                : typeof performance !== "undefined" && typeof performance.now === "function"
                  ? performance.now()
                  : 0
            )
          : 0;

      resourceProgress[resourceId] = {
        progress: Number(data.progress || 0),
        status: nextStatus,
        message: String(data.message || ""),
        startedAt: startedAt,
        startedPerf: startedPerf,
      };
      renderSettingsModal();
      return;
    }

    if (data.type === "audio_native_result") {
      const ok = Boolean(data.ok);
      pushDebug(
        "audio.native result ok=" +
          (ok ? "yes" : "no") +
          " message=" +
          String(data.message || "")
      );
      if (!ok && pendingNativeAudioFallback) {
        const fallbackAge = Date.now() - Number(pendingNativeAudioFallback.createdAt || 0);
        if (fallbackAge <= 10000) {
          playAudio(
            "",
            String(pendingNativeAudioFallback.word || ""),
            String(pendingNativeAudioFallback.lang || "")
          );
        }
        pendingNativeAudioFallback = null;
      }
      if (ok) {
        pendingNativeAudioFallback = null;
      }
      if (!ok) {
        ensureDebugPanelVisible();
      }
      return;
    }

    if (data.type === "settings_error") {
      settingsMessage = String(data.message || "Co loi xay ra.");
      renderSettingsModal();
      return;
    }

    if (
      data.type === "error" &&
      activeCommandMeta &&
      activeCommandMeta.commandType === "lookup" &&
      activeCommandMeta.auto_lookup_fallback &&
      !activeCommandMeta.fallback_attempted
    ) {
      activeCommandMeta.fallback_attempted = true;
      showPopover(activeCommandMeta.anchor.x, activeCommandMeta.anchor.y, {
        loading: true,
        word: activeCommandMeta.text,
      });
      sendCommand("translate", activeCommandMeta.text, activeCommandMeta.anchor, {
        auto_lookup_fallback: false,
      });
      return;
    }

    pushDebug("Nhan response tu Python: " + JSON.stringify(data));
    pendingCommandToken += 1;
    activeCommandMeta = null;

    if (!popoverEl) {
      showPopover(lastAnchor.x, lastAnchor.y, data);
      maybeAutoPlayAudio(data);
      return;
    }

    closeSubPanel();
    popoverEl.innerHTML = renderState(data);
    bindPopoverActions(popoverEl);
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
    maybeAutoPlayAudio(data);
  }

  function refreshPopoverPosition() {
    if (!popoverEl) {
      return;
    }
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
    if (subPanelEl) {
      placeSubPanel(subPanelEl);
    }
  }

  function updateSettingsState(data) {
    const incomingLanguages = data.languages || {};
    const incomingSettings = data.settings || {};
    const nowTs = Date.now();

    const incomingState = {
      source_language: String(incomingLanguages.source_language || "auto"),
      target_language: String(incomingLanguages.target_language || "vi"),
      trigger_mode: incomingSettings.popover_trigger_mode === "shortcut" ? "shortcut" : "auto",
      shortcut_combo: normalizeShortcutCombo(incomingSettings.popover_shortcut || DEFAULT_SHORTCUT_COMBO),
      auto_play_audio: Boolean(incomingSettings.auto_play_audio),
    };
    pushDebug(
      "settings_state recv src=" +
        incomingState.source_language +
        " tgt=" +
        incomingState.target_language +
        " mode=" +
        incomingState.trigger_mode +
        " shortcut=" +
        incomingState.shortcut_combo +
        " autoPlay=" +
        String(incomingState.auto_play_audio)
    );

    if (settingsSaveGuardSnapshot && nowTs <= settingsSaveGuardUntil) {
      const mismatch =
        incomingState.source_language !== settingsSaveGuardSnapshot.source_language ||
        incomingState.target_language !== settingsSaveGuardSnapshot.target_language ||
        incomingState.trigger_mode !== settingsSaveGuardSnapshot.trigger_mode ||
        incomingState.shortcut_combo !== settingsSaveGuardSnapshot.shortcut_combo ||
        incomingState.auto_play_audio !== settingsSaveGuardSnapshot.auto_play_audio;

      if (mismatch) {
        pushDebug("Bo qua settings_state cu vi khong khop state vua luu.");
        return;
      }
    }

    if (settingsSaveGuardSnapshot && nowTs > settingsSaveGuardUntil) {
      settingsSaveGuardSnapshot = null;
      settingsSaveGuardUntil = 0;
    }

    toolSettings.enable_lookup = Boolean(incomingSettings.enable_lookup !== false);
    toolSettings.enable_translate = Boolean(incomingSettings.enable_translate !== false);
    toolSettings.enable_audio = Boolean(incomingSettings.enable_audio !== false);

    settingsState.popover = {
      trigger_mode: incomingState.trigger_mode,
      shortcut_combo: incomingState.shortcut_combo,
      auto_play_audio: incomingState.auto_play_audio,
    };

    if (settingsState.popover.trigger_mode === "auto") {
      pendingSelectionAction = null;
    }

    settingsState.languages = {
      source_language: incomingState.source_language,
      target_language: incomingState.target_language,
    };

    settingsState.resources = {
      mode: "api_only",
      status_unknown: false,
    };

    settingsLoaded = true;

    if (settingsModalEl && !settingsModalEl.classList.contains("apl-settings-root--hidden")) {
      renderSettingsModal();
      syncSettingsFormIfOpen();
    } else if (settingsModalEl) {
      renderSettingsModal();
    }
  }

  function requestSettings(force) {
    const nowTs = Date.now();

    if (!force) {
      if (settingsRequestPending) {
        return;
      }
      if (nowTs - settingsLastRequestedAt < SETTINGS_REQUEST_COOLDOWN_MS) {
        return;
      }
    }

    settingsRequestPending = true;
    settingsLastRequestedAt = nowTs;
    pushDebug("settings:get sent force=" + String(Boolean(force)));
    sendPycmd("settings:get");
  }

  function saveSettings() {
    pushDebug(
      "settings:save sent src=" +
        settingsState.languages.source_language +
        " tgt=" +
        settingsState.languages.target_language +
        " mode=" +
        settingsState.popover.trigger_mode +
        " shortcut=" +
        settingsState.popover.shortcut_combo +
        " autoPlay=" +
        String(Boolean(settingsState.popover.auto_play_audio))
    );
    const payload = encodeURIComponent(
      JSON.stringify({
        enable_lookup: toolSettings.enable_lookup,
        enable_translate: toolSettings.enable_translate,
        enable_audio: toolSettings.enable_audio,
        auto_play_audio: settingsState.popover.auto_play_audio,
        popover_trigger_mode: settingsState.popover.trigger_mode,
        popover_shortcut: settingsState.popover.shortcut_combo,
        languages: {
          source_language: settingsState.languages.source_language,
          target_language: settingsState.languages.target_language,
        },
      })
    );

    sendPycmd("settings:save:" + payload);
  }

  function startResourceDownload(resourceId) {
    resourceProgress[resourceId] = {
      progress: 5,
      status: "downloading",
      message: "Dang bat dau...",
      startedAt: Date.now(),
      startedPerf: typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0,
    };
    settingsMessage = "";
    renderSettingsModal();
    sendPycmd("settings:download:" + encodeURIComponent(resourceId));
  }

  function showSettingsTrigger() {
    if (!settingsTriggerEl) {
      return;
    }
    settingsTriggerEl.classList.remove("apl-settings-trigger--hidden");
  }

  function hideSettingsTrigger() {
    if (!settingsTriggerEl) {
      return;
    }
    settingsTriggerEl.classList.add("apl-settings-trigger--hidden");
  }

  function isPointerInSettingsHotzone(clientX, clientY) {
    const viewportWidth =
      window.innerWidth ||
      (document.documentElement && document.documentElement.clientWidth) ||
      0;

    const nearTop = clientY >= 0 && clientY <= SETTINGS_TRIGGER_HOTZONE_TOP_PX;
    const nearRight = viewportWidth > 0 && viewportWidth - clientX <= SETTINGS_TRIGGER_HOTZONE_RIGHT_PX;
    return nearTop && nearRight;
  }

  function handleSettingsTriggerPointerMove(event) {
    if (!settingsTriggerBootVisibleDone) {
      return;
    }

    if (isPointerInSettingsHotzone(event.clientX, event.clientY)) {
      showSettingsTrigger();
      return;
    }

    hideSettingsTrigger();
  }

  function bindSettingsTriggerHoverReveal() {
    if (settingsTriggerHoverListenerBound) {
      return;
    }

    document.addEventListener("mousemove", handleSettingsTriggerPointerMove);
    settingsTriggerHoverListenerBound = true;
  }

  function runSettingsTriggerStartupVisibility() {
    showSettingsTrigger();

    if (settingsTriggerBootVisibleDone) {
      return;
    }

    if (settingsTriggerHideTimerId !== null) {
      window.clearTimeout(settingsTriggerHideTimerId);
    }

    settingsTriggerHideTimerId = window.setTimeout(function () {
      hideSettingsTrigger();
      settingsTriggerBootVisibleDone = true;
      settingsTriggerHideTimerId = null;
      bindSettingsTriggerHoverReveal();
    }, SETTINGS_TRIGGER_BOOT_VISIBLE_MS);
  }

  function ensureSettingsTrigger() {
    if (window.__aplIsDeckBrowser !== true) {
      const staleButtons = document.querySelectorAll(".apl-settings-trigger");
      staleButtons.forEach(function (button) {
        button.remove();
      });
      settingsTriggerEl = null;
      return;
    }

    let isTopWindow = false;
    try {
      isTopWindow = window.top === window;
    } catch (error) {
      isTopWindow = false;
    }

    if (!isTopWindow) {
      const childButtons = document.querySelectorAll(".apl-settings-trigger");
      childButtons.forEach(function (button) {
        button.remove();
      });
      settingsTriggerEl = null;
      return;
    }

    const existing = document.querySelectorAll(".apl-settings-trigger");
    if (existing.length > 0) {
      settingsTriggerEl = existing[0];
      for (let i = 1; i < existing.length; i += 1) {
        existing[i].remove();
      }
      runSettingsTriggerStartupVisibility();
      return;
    }

    const trigger = document.createElement("button");
    trigger.id = "apl-settings-trigger";
    trigger.className = "apl-settings-trigger";
    trigger.type = "button";
    trigger.textContent = "setting";
    trigger.setAttribute("aria-label", "Open Popup Lookup settings");

    trigger.addEventListener("click", function () {
      openSettingsModal();
    });

    document.body.appendChild(trigger);
    settingsTriggerEl = trigger;
    runSettingsTriggerStartupVisibility();
  }

  function resourceLabel(resourceId) {
    if (resourceId === "argostranslate") {
      return "ArgosTranslate";
    }

    if (resourceId === "language_pack") {
      return (
        "Language pack " +
        settingsState.languages.source_language +
        " -> " +
        settingsState.languages.target_language
      );
    }

    return resourceId;
  }

  function resourceStatusText(resourceId) {
    if (settingsState.resources.status_unknown) {
      return "Khong ro";
    }

    const installed = Boolean(settingsState.resources[resourceId]);
    const runtimeBroken =
      resourceId === "argostranslate" &&
      installed &&
      !Boolean(settingsState.resources.argos_runtime_ok);

    if (runtimeBroken) {
      return "Loi runtime";
    }

    if (installed) {
      return "Da cai";
    }

    const progress = resourceProgress[resourceId] || { status: "idle" };
    if (progress.status === "downloading") {
      return "Dang tai";
    }

    if (progress.status === "error") {
      return "Loi";
    }

    return "Chua cai";
  }

  function resourceButtonText(resourceId) {
    const installed = Boolean(settingsState.resources[resourceId]);
    const runtimeBroken =
      resourceId === "argostranslate" &&
      installed &&
      !Boolean(settingsState.resources.argos_runtime_ok);

    if (runtimeBroken) {
      return "Tai lai";
    }

    if (settingsState.resources.status_unknown) {
      return "Tai";
    }

    if (installed) {
      return "Da cai";
    }

    const progress = resourceProgress[resourceId] || { status: "idle" };
    if (progress.status === "downloading") {
      return "Dang tai...";
    }

    return "Tai";
  }

  function resourceButtonDisabled(resourceId) {
    const installed = Boolean(settingsState.resources[resourceId]);
    const runtimeBroken =
      resourceId === "argostranslate" &&
      installed &&
      !Boolean(settingsState.resources.argos_runtime_ok);

    if (runtimeBroken) {
      return false;
    }

    if (installed) {
      return true;
    }

    const progress = resourceProgress[resourceId] || { status: "idle" };
    return progress.status === "downloading";
  }

  function resourceProgressValue(resourceId) {
    const installed = Boolean(settingsState.resources[resourceId]);
    if (installed) {
      return 100;
    }

    const progress = resourceProgress[resourceId];
    if (!progress) {
      return 0;
    }

    const value = Number(progress.progress || 0);
    return Math.max(0, Math.min(100, value));
  }

  function languageSelectHtml(selectClass, selectedCode, includeAutoDetect) {
    const hasSelectedCode = SUPPORTED_LANGUAGES.some(function (item) {
      return item.code === selectedCode;
    });
    const resolvedSelectedCode = hasSelectedCode
      ? selectedCode
      : includeAutoDetect
        ? AUTO_DETECT_LANGUAGE.code
        : "en";

    const autoDetectOption = includeAutoDetect
      ? '<option value="' + AUTO_DETECT_LANGUAGE.code + '"' +
        (resolvedSelectedCode === AUTO_DETECT_LANGUAGE.code ? " selected" : "") +
        ">" +
        escapeHtml(AUTO_DETECT_LANGUAGE.label) +
        "</option>"
      : "";

    const options = SUPPORTED_LANGUAGES
      .map(function (item) {
        const selected = item.code === resolvedSelectedCode ? " selected" : "";
        return '<option value="' + escapeHtml(item.code) + '"' + selected + ">" + escapeHtml(item.label) + "</option>";
      })
      .join("");

    return '<select class="' + selectClass + '">' + autoDetectOption + options + "</select>";
  }

  function triggerModeChecked(mode) {
    return settingsState.popover.trigger_mode === mode ? " checked" : "";
  }

  function getSettingsUiCopy() {
    const targetLanguage = String(settingsState.languages.target_language || "en");

    if (SETTINGS_UI_COPY[targetLanguage]) {
      return SETTINGS_UI_COPY[targetLanguage];
    }

    if (targetLanguage.toLowerCase().indexOf("zh") === 0) {
      return SETTINGS_UI_COPY["zh-CN"];
    }

    if (targetLanguage.toLowerCase().indexOf("vi") === 0) {
      return SETTINGS_UI_COPY.vi;
    }

    return SETTINGS_UI_COPY.en;
  }

  function renderSettingsModal() {
    if (!settingsModalEl) {
      return;
    }

    const uiCopy = getSettingsUiCopy();

    const errorHtml = settingsMessage
      ? '<div class="apl-settings-error">' + escapeHtml(settingsMessage) + "</div>"
      : "";

    const shortcutDisabledAttr =
      settingsState.popover.trigger_mode === "shortcut" ? "" : " disabled";

    settingsModalEl.innerHTML =
      '<div class="apl-settings-overlay" role="dialog" aria-modal="true">' +
      '<div class="apl-settings-modal">' +
      '<div class="apl-settings-section">' +
      '<div class="apl-settings-language-row">' +
      '<label class="apl-settings-field"><span>' +
      escapeHtml(uiCopy.input_language) +
      "</span>" +
      languageSelectHtml("apl-settings-source-language", settingsState.languages.source_language, true) +
      "</label>" +
      '<button class="apl-button apl-settings-swap-languages" type="button" aria-label="' +
      escapeHtml(uiCopy.swap_languages_aria) +
      '">↔</button>' +
      '<label class="apl-settings-field"><span>' +
      escapeHtml(uiCopy.output_language) +
      "</span>" +
      languageSelectHtml("apl-settings-target-language", settingsState.languages.target_language, false) +
      "</label>" +
      "</div>" +
      "</div>" +
      '<div class="apl-settings-section">' +
      '<label class="apl-settings-radio"><input class="apl-settings-trigger-mode" type="radio" name="apl-trigger-mode" value="auto"' +
      triggerModeChecked("auto") +
      "> " +
      escapeHtml(uiCopy.trigger_auto) +
      "</label>" +
      '<div class="apl-settings-radio-shortcut-row">' +
      '<label class="apl-settings-radio apl-settings-radio--inline"><input class="apl-settings-trigger-mode" type="radio" name="apl-trigger-mode" value="shortcut"' +
      triggerModeChecked("shortcut") +
      "> " +
      escapeHtml(uiCopy.trigger_shortcut) +
      "</label>" +
      '<div class="apl-settings-shortcut-group">' +
      '<label class="apl-settings-field apl-settings-field--shortcut-inline"><span>' +
      escapeHtml(uiCopy.shortcut_label) +
      "</span>" +
      '<input class="apl-settings-shortcut-input" type="text" readonly value="' +
      escapeHtml(settingsState.popover.shortcut_combo) +
      '"' +
      shortcutDisabledAttr +
      ' placeholder="' +
      escapeHtml(uiCopy.shortcut_placeholder) +
      '" />' +
      "</label>" +
      "</div>" +
      "</div>" +
      '<div class="apl-settings-shortcut-group">' +
      '<div class="apl-settings-hint">' +
      escapeHtml(uiCopy.shortcut_hint) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="apl-settings-section">' +
      '<label class="apl-settings-toggle"><input class="apl-settings-auto-play-audio" type="checkbox"' +
      (settingsState.popover.auto_play_audio ? " checked" : "") +
      '"> ' +
      escapeHtml(uiCopy.auto_play_audio) +
      "</label>" +
      "</div>" +
      errorHtml +
      "</div>" +
      "</div>";

    bindSettingsActions();
    settingsModalWarm = true;
    ensureSettingsProgressTicker();
  }

  function normalizeShortcutCombo(inputValue) {
    const raw = String(inputValue || "").trim();
    if (!raw) {
      return DEFAULT_SHORTCUT_COMBO;
    }

    const tokens = raw
      .split("+")
      .map(function (token) {
        return token.trim().toLowerCase();
      })
      .filter(Boolean);

    if (tokens.length === 0) {
      return DEFAULT_SHORTCUT_COMBO;
    }

    const modifierOrder = ["ctrl", "alt", "shift", "meta"];
    const modifierLabel = {
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      meta: "Meta",
    };

    const modifiers = [];
    let keyPart = "";

    tokens.forEach(function (token) {
      if (modifierOrder.indexOf(token) >= 0) {
        if (modifiers.indexOf(token) === -1) {
          modifiers.push(token);
        }
        return;
      }

      if (!keyPart) {
        keyPart = token;
      }
    });

    if (!keyPart) {
      modifiers.sort(function (a, b) {
        return modifierOrder.indexOf(a) - modifierOrder.indexOf(b);
      });

      const modifierOnly = modifiers
        .map(function (token) {
          return modifierLabel[token] || token;
        })
        .join("+");

      return modifierOnly || DEFAULT_SHORTCUT_COMBO;
    }

    let finalKey = keyPart;
    if (/^digit\d$/i.test(keyPart)) {
      finalKey = keyPart.slice(-1);
    } else if (/^key[a-z]$/i.test(keyPart)) {
      finalKey = keyPart.slice(-1).toUpperCase();
    } else {
      finalKey = keyPart.length === 1 ? keyPart.toUpperCase() : keyPart.toUpperCase();
    }

    modifiers.sort(function (a, b) {
      return modifierOrder.indexOf(a) - modifierOrder.indexOf(b);
    });

    const prefix = modifiers
      .map(function (token) {
        return modifierLabel[token] || token;
      })
      .join("+");

    return prefix ? prefix + "+" + finalKey : finalKey;
  }

  function readSettingsFormValues() {
    const sourceSelect = settingsModalEl.querySelector(".apl-settings-source-language");
    const targetSelect = settingsModalEl.querySelector(".apl-settings-target-language");
    const triggerModeInput = settingsModalEl.querySelector(".apl-settings-trigger-mode:checked");
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");
    const autoPlayInput = settingsModalEl.querySelector(".apl-settings-auto-play-audio");

    const sourceLanguage = sourceSelect ? String(sourceSelect.value || "auto") : settingsState.languages.source_language;
    const targetLanguage = targetSelect ? String(targetSelect.value || "vi") : settingsState.languages.target_language;
    const triggerMode = triggerModeInput ? String(triggerModeInput.value || "auto") : settingsState.popover.trigger_mode;
    const shortcutCombo = normalizeShortcutCombo(shortcutInput ? shortcutInput.value : settingsState.popover.shortcut_combo);
    const autoPlayAudio = Boolean(autoPlayInput && autoPlayInput.checked);

    return {
      source_language: sourceLanguage,
      target_language: targetLanguage,
      trigger_mode: triggerMode === "shortcut" ? "shortcut" : "auto",
      shortcut_combo: shortcutCombo,
      auto_play_audio: autoPlayAudio,
    };
  }

  function applySettingsFormValues(nextValues) {
    settingsState.languages.source_language = nextValues.source_language;
    settingsState.languages.target_language = nextValues.target_language;
    settingsState.popover.trigger_mode = nextValues.trigger_mode;
    settingsState.popover.shortcut_combo = nextValues.shortcut_combo;
    settingsState.popover.auto_play_audio = nextValues.auto_play_audio;
  }

  function syncSettingsFormIfOpen() {
    if (!settingsModalEl || settingsModalEl.classList.contains("apl-settings-root--hidden")) {
      return false;
    }

    const sourceSelect = settingsModalEl.querySelector(".apl-settings-source-language");
    const targetSelect = settingsModalEl.querySelector(".apl-settings-target-language");
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");
    const autoPlayInput = settingsModalEl.querySelector(".apl-settings-auto-play-audio");
    const autoMode = settingsModalEl.querySelector(
      '.apl-settings-trigger-mode[value="auto"]'
    );
    const shortcutMode = settingsModalEl.querySelector(
      '.apl-settings-trigger-mode[value="shortcut"]'
    );

    if (sourceSelect) {
      sourceSelect.value = settingsState.languages.source_language;
    }
    if (targetSelect) {
      targetSelect.value = settingsState.languages.target_language;
    }
    if (shortcutInput) {
      shortcutInput.value = settingsState.popover.shortcut_combo;
      shortcutInput.disabled = settingsState.popover.trigger_mode !== "shortcut";
    }
    if (autoPlayInput) {
      autoPlayInput.checked = settingsState.popover.auto_play_audio;
      pushDebug(
        "syncSettingsFormIfOpen autoPlay state=" +
          String(settingsState.popover.auto_play_audio) +
          " uiChecked=" +
          String(Boolean(autoPlayInput.checked))
      );
    }
    if (autoMode) {
      autoMode.checked = settingsState.popover.trigger_mode === "auto";
    }
    if (shortcutMode) {
      shortcutMode.checked = settingsState.popover.trigger_mode === "shortcut";
    }

    return true;
  }

  function bindSettingsActions() {
    const overlay = settingsModalEl.querySelector(".apl-settings-overlay");
    const closeButton = settingsModalEl.querySelector(".apl-settings-close");
    const sourceSelect = settingsModalEl.querySelector(".apl-settings-source-language");
    const targetSelect = settingsModalEl.querySelector(".apl-settings-target-language");
    const autoPlayInput = settingsModalEl.querySelector(".apl-settings-auto-play-audio");
    const swapButton = settingsModalEl.querySelector(".apl-settings-swap-languages");
    const triggerModeInputs = settingsModalEl.querySelectorAll(".apl-settings-trigger-mode");
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");

    function persistSettingsNow() {
      const values = readSettingsFormValues();
      applySettingsFormValues(values);
      settingsSaveGuardSnapshot = {
        source_language: settingsState.languages.source_language,
        target_language: settingsState.languages.target_language,
        trigger_mode: settingsState.popover.trigger_mode,
        shortcut_combo: settingsState.popover.shortcut_combo,
        auto_play_audio: settingsState.popover.auto_play_audio,
      };
      settingsSaveGuardUntil = Date.now() + SETTINGS_SAVE_GUARD_MS;
      settingsMessage = "";
      saveSettings();
    }

    if (overlay) {
      overlay.addEventListener("mousedown", function (event) {
        if (event.target === overlay) {
          closeSettingsModal();
        }
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", function () {
        closeSettingsModal();
      });
    }

    if (swapButton) {
      swapButton.addEventListener("click", function () {
        if (!sourceSelect || !targetSelect) {
          return;
        }
        const previousSource = String(sourceSelect.value || "auto");
        sourceSelect.value = String(targetSelect.value || "vi");
        targetSelect.value = previousSource === "auto" ? "en" : previousSource;
        persistSettingsNow();
        renderSettingsModal();
        syncSettingsFormIfOpen();
      });
    }

    if (sourceSelect) {
      sourceSelect.addEventListener("change", persistSettingsNow);
    }

    if (targetSelect) {
      targetSelect.addEventListener("change", function () {
        persistSettingsNow();
        renderSettingsModal();
        syncSettingsFormIfOpen();
      });
    }

    if (autoPlayInput) {
      autoPlayInput.addEventListener("change", persistSettingsNow);
    }

    triggerModeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        const values = readSettingsFormValues();
        applySettingsFormValues(values);

        if (shortcutInput) {
          shortcutInput.disabled = settingsState.popover.trigger_mode !== "shortcut";
        }

        pushDebug(
          "trigger_mode changed -> " +
            settingsState.popover.trigger_mode +
            " keep autoPlay=" +
            String(settingsState.popover.auto_play_audio)
        );
        persistSettingsNow();
      });
    });

    if (shortcutInput) {
      shortcutInput.disabled = settingsState.popover.trigger_mode !== "shortcut";

      shortcutInput.addEventListener("keydown", function (event) {
        if (shortcutInput.disabled) {
          return;
        }

        if (event.key === "Tab") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const nextShortcut = normalizeEventShortcutCombo(event);
        if (!nextShortcut) {
          return;
        }

        shortcutInput.value = normalizeShortcutCombo(nextShortcut);
        persistSettingsNow();
      });

      shortcutInput.addEventListener("blur", function () {
        if (shortcutInput.disabled) {
          return;
        }

        shortcutInput.value = normalizeShortcutCombo(shortcutInput.value || DEFAULT_SHORTCUT_COMBO);
        persistSettingsNow();
      });
    }
  }

  function openSettingsModal() {
    if (!settingsModalEl) {
      settingsModalEl = document.createElement("div");
      settingsModalEl.className = "apl-settings-root apl-settings-root--hidden";
      document.body.appendChild(settingsModalEl);
    }

    // Always rebuild modal from current state to avoid stale checkbox DOM.
    renderSettingsModal();

    settingsModalEl.classList.remove("apl-settings-root--hidden");
    syncSettingsFormIfOpen();
    pushDebug(
      "openSettingsModal autoPlay state=" +
        String(settingsState.popover.auto_play_audio)
    );

    if (!settingsLoaded) {
      requestSettings(true);
    }
  }

  function sendCommand(commandType, text, anchor, options) {
    pendingCommandToken += 1;
    const commandToken = pendingCommandToken;
    const resolvedAnchor = anchor || lastAnchor;
    lastAnchor = { x: resolvedAnchor.x || lastAnchor.x, y: resolvedAnchor.y || lastAnchor.y };
    activeCommandMeta = {
      token: commandToken,
      commandType: commandType,
      text: text,
      anchor: { x: lastAnchor.x, y: lastAnchor.y },
      auto_lookup_fallback: Boolean(options && options.auto_lookup_fallback),
      fallback_attempted: false,
    };

    const payload = commandType + ":" + encodeURIComponent(text);
    const sent = sendPycmd(payload);
    if (!sent) {
      activeCommandMeta = null;
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Khong goi duoc pycmd.",
      });
      return;
    }

    armPendingTimeout(commandType, text);
  }

  function buildSelectionAction(text, anchor) {
    const wordCount = getWordCount(text);
    const sourceIsAuto = settingsState.languages.source_language === "auto";
    const shouldUseTranslate = wordCount > 1;

    if (shouldUseTranslate && !toolSettings.enable_translate) {
      showPopover(anchor.x, anchor.y, {
        type: "error",
        message: "Tinh nang dich doan dang tat trong Settings.",
      });
      return null;
    }

    if (!shouldUseTranslate && sourceIsAuto) {
      if (toolSettings.enable_lookup) {
        return {
          commandType: "lookup",
          text: text,
          anchor: anchor,
          auto_lookup_fallback: toolSettings.enable_translate,
        };
      }

      if (toolSettings.enable_translate) {
        return {
          commandType: "translate",
          text: text,
          anchor: anchor,
          auto_lookup_fallback: false,
        };
      }

      showPopover(anchor.x, anchor.y, {
        type: "error",
        message: "Tinh nang tra tu va dich dang tat trong Settings.",
      });
      return null;
    }

    if (!shouldUseTranslate && !toolSettings.enable_lookup) {
      showPopover(anchor.x, anchor.y, {
        type: "error",
        message: "Tinh nang tra tu dang tat trong Settings.",
      });
      return null;
    }

    return {
      commandType: shouldUseTranslate ? "translate" : "lookup",
      text: text,
      anchor: anchor,
      auto_lookup_fallback: false,
    };
  }

  function executeSelectionAction(action) {
    if (!action) {
      return;
    }

    showPopover(action.anchor.x, action.anchor.y, { loading: true, word: action.text });
    sendCommand(action.commandType, action.text, action.anchor, {
      auto_lookup_fallback: Boolean(action.auto_lookup_fallback),
    });
  }

  function keyFromEvent(event) {
    const rawCode = String(event.code || "");
    const rawKey = String(event.key || "");

    if (rawKey === "Shift" || rawKey === "Control" || rawKey === "Alt" || rawKey === "Meta") {
      return "";
    }

    if (/^Digit\d$/.test(rawCode)) {
      return rawCode.slice(-1);
    }

    if (/^Key[A-Z]$/.test(rawCode)) {
      return rawCode.slice(-1);
    }

    if (rawKey.length === 1) {
      return rawKey.toUpperCase();
    }

    return rawKey.toUpperCase();
  }

  function normalizeEventShortcutCombo(event) {
    const parts = [];

    if (event.ctrlKey) {
      parts.push("Ctrl");
    }
    if (event.altKey) {
      parts.push("Alt");
    }
    if (event.shiftKey) {
      parts.push("Shift");
    }
    if (event.metaKey) {
      parts.push("Meta");
    }

    const key = keyFromEvent(event);
    if (!key) {
      return parts.join("+");
    }

    parts.push(key);
    return parts.join("+");
  }

  function isShortcutTriggerEvent(event) {
    const expected = normalizeShortcutCombo(settingsState.popover.shortcut_combo);
    const actual = normalizeEventShortcutCombo(event);
    return expected === actual;
  }

  document.addEventListener("mouseup", function (event) {
    if (settingsModalEl && settingsModalEl.contains(event.target)) {
      return;
    }

    if (subPanelEl && subPanelEl.contains(event.target)) {
      return;
    }

    if (popoverEl && popoverEl.contains(event.target)) {
      return;
    }

    const text = normalizeSelection();
    if (!text) {
      pendingSelectionAction = null;
      return;
    }

    const anchor = getSelectionAnchorPoint(event.clientX, event.clientY);
    const action = buildSelectionAction(text, anchor);
    if (!action) {
      pendingSelectionAction = null;
      return;
    }

    if (settingsState.popover.trigger_mode === "shortcut") {
      pendingSelectionAction = action;
      pushDebug("Dang cho phim tat: " + settingsState.popover.shortcut_combo);
      return;
    }

    pendingSelectionAction = null;
    executeSelectionAction(action);
  });

  document.addEventListener("mousedown", function (event) {
    if (settingsModalEl && settingsModalEl.contains(event.target)) {
      return;
    }

    if (subPanelEl && subPanelEl.contains(event.target)) {
      return;
    }

    if (!popoverEl) return;
    if (popoverEl.contains(event.target)) return;
    closePopover();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      pendingSelectionAction = null;
      closeSettingsModal();
      closeSubPanel();
      closePopover();
      return;
    }

    const settingsModalVisible =
      settingsModalEl && !settingsModalEl.classList.contains("apl-settings-root--hidden");
    if (settingsModalVisible) {
      return;
    }

    if (settingsState.popover.trigger_mode !== "shortcut") {
      return;
    }

    if (!pendingSelectionAction) {
      return;
    }

    if (!isShortcutTriggerEvent(event)) {
      return;
    }

    event.preventDefault();
    const actionToRun = pendingSelectionAction;
    pendingSelectionAction = null;
    executeSelectionAction(actionToRun);
  });

  window.addEventListener("error", function (event) {
    pushDebug("window.error: " + String(event.message || event.error || "unknown"));
  });

  window.addEventListener("unhandledrejection", function (event) {
    pushDebug("unhandledrejection: " + String(event.reason || "unknown"));
  });

  window.addEventListener("resize", refreshPopoverPosition);
  window.addEventListener("scroll", refreshPopoverPosition, true);

  ensureSettingsTrigger();
  window.setTimeout(function () {
    requestSettings(true);
  }, 350);

  if (DEBUG_PANEL_ALWAYS_VISIBLE) {
    ensureDebugPanelVisible();
    pushDebug("Debug panel auto-opened for startup tracing.");
  }

  pushDebug("popup.js da duoc load.");

  window.showPopover = showPopover;
  window.updatePopover = updatePopover;
  window.aplEnsureSettingsTrigger = ensureSettingsTrigger;
  window.aplDebugDump = function () {
    return debugLines.join("\n");
  };
})();
