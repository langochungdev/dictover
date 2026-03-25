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
  let settingsRequestPending = false;
  let settingsLastRequestedAt = 0;
  let settingsTriggerHideTimerId = null;
  let settingsTriggerBootVisibleDone = false;
  let settingsTriggerHoverListenerBound = false;
  let settingsProgressTickerId = null;
  let subPanelEl = null;
  let pendingCommandToken = 0;
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
    languages: { source_language: "en", target_language: "vi" },
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
  const SETTINGS_TRIGGER_BOOT_VISIBLE_MS = 10000;
  const SETTINGS_TRIGGER_HOTZONE_TOP_PX = 120;
  const SETTINGS_TRIGGER_HOTZONE_RIGHT_PX = 120;
  const RESOURCE_TIMEOUT_SECONDS = {
    argostranslate: 75,
    language_pack: 300,
  };
  const detailsToggleLabels = {
    closed: "▸",
    open: "▾",
  };

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

  function closePopover() {
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
        playAudio(audioUrl, word);
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

  function playAudio(audioUrl, word) {
    if (!toolSettings.enable_audio) {
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Audio dang tat trong Settings.",
      });
      return;
    }

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(function () {
        if (window.speechSynthesis && word) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
        }
      });
      return;
    }

    if (window.speechSynthesis && word) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
    }
  }

  function renderMeanings(meanings) {
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return '<div class="apl-error">Khong tim thay dinh nghia.</div>';
    }

    return meanings
      .map(function (meaning) {
        const part = escapeHtml(meaning.partOfSpeech || "unknown");
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
          '<div class="apl-pos">' +
          part +
          "</div>" +
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
    return escapeHtml(meanings[0].partOfSpeech || "");
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
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";
      return (
        '<div class="apl-body apl-translate-compact">' +
        '<div class="apl-translate-top">' +
        '<div class="apl-translate-en">' +
        original +
        "</div>" +
        '<button class="apl-button apl-audio" type="button" data-word="' +
        original +
        '" data-audio=""' +
        audioDisabled +
        ">Audio</button>" +
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
        '"' +
        audioDisabled +
        ' aria-label="Play audio">🔊</button>' +
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

    if (data.type === "settings_error") {
      settingsMessage = String(data.message || "Co loi xay ra.");
      renderSettingsModal();
      return;
    }

    pushDebug("Nhan response tu Python: " + JSON.stringify(data));
    pendingCommandToken += 1;

    if (!popoverEl) {
      showPopover(lastAnchor.x, lastAnchor.y, data);
      return;
    }

    closeSubPanel();
    popoverEl.innerHTML = renderState(data);
    bindPopoverActions(popoverEl);
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
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

    // Tool toggles are intentionally fixed on; settings modal no longer exposes them.
    toolSettings.enable_lookup = true;
    toolSettings.enable_translate = true;
    toolSettings.enable_audio = true;

    settingsState.languages = {
      source_language: String(incomingLanguages.source_language || "en"),
      target_language: String(incomingLanguages.target_language || "vi"),
    };

    settingsState.resources = {
      mode: "api_only",
      status_unknown: false,
    };

    renderSettingsModal();
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
    sendPycmd("settings:get");
  }

  function saveSettings() {
    const payload = encodeURIComponent(
      JSON.stringify({
        enable_lookup: toolSettings.enable_lookup,
        enable_translate: toolSettings.enable_translate,
        enable_audio: toolSettings.enable_audio,
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
    let isTopWindow = false;
    try {
      isTopWindow = window.top === window;
    } catch (error) {
      isTopWindow = true;
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

  function renderSettingsModal() {
    if (!settingsModalEl) {
      return;
    }

    const errorHtml = settingsMessage
      ? '<div class="apl-settings-error">' + escapeHtml(settingsMessage) + "</div>"
      : "";

    const modeHtml =
      '<div class="apl-settings-resource">' +
      '<div class="apl-settings-resource-top">' +
      '<div class="apl-settings-resource-name">Che do dich</div>' +
      '<div class="apl-settings-resource-status">API online</div>' +
      "</div>" +
      '<div class="apl-settings-resource-message">Khong can cai ArgosTranslate hoac language pack offline.</div>' +
      "</div>";

    settingsModalEl.innerHTML =
      '<div class="apl-settings-overlay" role="dialog" aria-modal="true" aria-labelledby="apl-settings-title">' +
      '<div class="apl-settings-modal">' +
      '<div class="apl-settings-header">' +
      '<div class="apl-settings-title-wrap">' +
      '<div class="apl-settings-subtitle">Popup Lookup</div>' +
      '<h3 class="apl-settings-title" id="apl-settings-title">Settings</h3>' +
      "</div>" +
      '<button class="apl-close apl-settings-close" type="button" aria-label="Close">x</button>' +
      "</div>" +
      '<div class="apl-settings-section">' +
      '<div class="apl-settings-section-title">Translation</div>' +
      modeHtml +
      "</div>" +
      errorHtml +
      '<div class="apl-settings-actions">' +
      '<button class="apl-button apl-settings-refresh" type="button">Refresh</button>' +
      "</div>" +
      "</div>" +
      "</div>";

    bindSettingsActions();
    settingsModalWarm = true;
    ensureSettingsProgressTicker();
  }

  function bindSettingsActions() {
    const overlay = settingsModalEl.querySelector(".apl-settings-overlay");
    const closeButton = settingsModalEl.querySelector(".apl-settings-close");
    const refreshButton = settingsModalEl.querySelector(".apl-settings-refresh");

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

    if (refreshButton) {
      refreshButton.addEventListener("click", function () {
        requestSettings(true);
      });
    }

  }

  function openSettingsModal() {
    if (!settingsModalEl) {
      settingsModalEl = document.createElement("div");
      settingsModalEl.className = "apl-settings-root apl-settings-root--hidden";
      document.body.appendChild(settingsModalEl);
    }

    if (!settingsModalWarm) {
      renderSettingsModal();
    }

    settingsModalEl.classList.remove("apl-settings-root--hidden");
    requestSettings(false);
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
      return;
    }

    const wordCount = getWordCount(text);
    const anchor = getSelectionAnchorPoint(event.clientX, event.clientY);

    if (wordCount === 1 && !toolSettings.enable_lookup) {
      showPopover(anchor.x, anchor.y, {
        type: "error",
        message: "Tinh nang tra tu dang tat trong Settings.",
      });
      return;
    }

    if (wordCount > 1 && !toolSettings.enable_translate) {
      showPopover(anchor.x, anchor.y, {
        type: "error",
        message: "Tinh nang dich doan dang tat trong Settings.",
      });
      return;
    }

    showPopover(anchor.x, anchor.y, { loading: true, word: text });

    if (wordCount === 1) {
      sendCommand("lookup", text, anchor);
      return;
    }

    sendCommand("translate", text, anchor);
  });

  function sendCommand(commandType, text, anchor) {
    pendingCommandToken += 1;
    const resolvedAnchor = anchor || lastAnchor;
    lastAnchor = { x: resolvedAnchor.x || lastAnchor.x, y: resolvedAnchor.y || lastAnchor.y };

    const payload = commandType + ":" + encodeURIComponent(text);
    const sent = sendPycmd(payload);
    if (!sent) {
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Khong goi duoc pycmd.",
      });
      return;
    }

    armPendingTimeout(commandType, text);
  }

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
      closeSettingsModal();
      closeSubPanel();
      closePopover();
    }
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
    requestSettings(false);
  }, 350);

  pushDebug("popup.js da duoc load.");

  window.showPopover = showPopover;
  window.updatePopover = updatePopover;
  window.aplEnsureSettingsTrigger = ensureSettingsTrigger;
  window.aplDebugDump = function () {
    return debugLines.join("\n");
  };
})();
