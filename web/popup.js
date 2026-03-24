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
  let subPanelEl = null;
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
      argostranslate: false,
      language_pack: false,
      argos_runtime_ok: false,
      status_unknown: true,
    },
  };

  const resourceProgress = {
    argostranslate: { progress: 0, status: "idle", message: "" },
    language_pack: { progress: 0, status: "idle", message: "" },
  };

  let settingsMessage = "";
  const SETTINGS_REQUEST_COOLDOWN_MS = 3000;
  const detailsToggleLabels = {
    closed: "Xem them",
    open: "An",
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

    const detailsToggle = popoverEl.querySelector(".apl-details-toggle");
    if (!detailsToggle) {
      return;
    }

    detailsToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    detailsToggle.textContent = expanded ? detailsToggleLabels.open : detailsToggleLabels.closed;
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

    const maxFont = 14;
    const minFont = 8;
    const step = 0.5;
    let fontSize = maxFont;

    body.style.fontSize = fontSize + "px";
    while (fontSize > minFont && body.scrollHeight > body.clientHeight) {
      fontSize = Math.max(minFont, fontSize - step);
      body.style.fontSize = fontSize + "px";
    }

    panel.style.setProperty("--apl-subpanel-font-size", fontSize + "px");
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

    const detailsToggle = container.querySelector(".apl-details-toggle");
    if (detailsToggle) {
      detailsToggle.addEventListener("click", function (event) {
        event.preventDefault();
        const isOpen = detailsToggle.getAttribute("aria-expanded") === "true";
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
        '<div class="apl-lookup-top">' +
        '<div class="apl-lookup-word">' +
        word +
        "</div>" +
        '<button class="apl-button apl-audio" type="button" data-word="' +
        word +
        '" data-audio="' +
        audio +
        '"' +
        audioDisabled +
        ">Audio</button>" +
        "</div>" +
        '<div class="apl-lookup-vi">' +
        translated +
        "</div>" +
        '<div class="apl-lookup-meta">' +
        '<div class="apl-lookup-meta-left">' +
        '<div class="apl-phonetic">' +
        phonetic +
        "</div>" +
        '<div class="apl-pos-inline">' +
        pos +
        "</div>" +
        "</div>" +
        '<button class="apl-details-toggle" type="button" aria-expanded="false">' +
        detailsToggleLabels.closed +
        "</button>" +
        "</div>" +
        '<div class="apl-lookup-definition">' +
        englishDefinition +
        "</div>" +
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
      resourceProgress[resourceId] = {
        progress: Number(data.progress || 0),
        status: String(data.status || "idle"),
        message: String(data.message || ""),
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
    const incomingResources = data.resources || {};

    // Tool toggles are intentionally fixed on; settings modal no longer exposes them.
    toolSettings.enable_lookup = true;
    toolSettings.enable_translate = true;
    toolSettings.enable_audio = true;

    settingsState.languages = {
      source_language: String(incomingLanguages.source_language || "en"),
      target_language: String(incomingLanguages.target_language || "vi"),
    };

    settingsState.resources = {
      argostranslate: Boolean(incomingResources.argostranslate),
      language_pack: Boolean(incomingResources.language_pack),
      argos_runtime_ok: Boolean(incomingResources.argos_runtime_ok),
      status_unknown: Boolean(incomingResources.status_unknown),
    };

    if (settingsState.resources.argostranslate && settingsState.resources.argos_runtime_ok) {
      resourceProgress.argostranslate = {
        progress: 100,
        status: "success",
        message: "Da san sang",
      };
    } else if (settingsState.resources.argostranslate && !settingsState.resources.argos_runtime_ok) {
      resourceProgress.argostranslate = {
        progress: 0,
        status: "error",
        message: "Da cai nhung khong khoi tao duoc",
      };
    }

    if (settingsState.resources.language_pack) {
      resourceProgress.language_pack = {
        progress: 100,
        status: "success",
        message: "Da san sang",
      };
    }

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
    };
    settingsMessage = "";
    renderSettingsModal();
    sendPycmd("settings:download:" + encodeURIComponent(resourceId));
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
      return;
    }

    const existing = document.querySelectorAll(".apl-settings-trigger");
    if (existing.length > 0) {
      settingsTriggerEl = existing[0];
      for (let i = 1; i < existing.length; i += 1) {
        existing[i].remove();
      }
      return;
    }

    const trigger = document.createElement("button");
    trigger.id = "apl-settings-trigger";
    trigger.className = "apl-settings-trigger";
    trigger.type = "button";
    trigger.textContent = "Tools!";
    trigger.setAttribute("aria-label", "Open Popup Lookup settings");

    trigger.addEventListener("click", function () {
      openSettingsModal();
    });

    document.body.appendChild(trigger);
    settingsTriggerEl = trigger;
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

    const resourceIds = ["argostranslate", "language_pack"];

    const resourcesHtml = resourceIds
      .map(function (resourceId) {
        const progress = resourceProgress[resourceId] || {
          progress: 0,
          status: "idle",
          message: "",
        };
        const status = resourceStatusText(resourceId);
        const label = resourceLabel(resourceId);
        const buttonText = resourceButtonText(resourceId);
        const disabled = resourceButtonDisabled(resourceId) ? " disabled" : "";
        const progressValue = resourceProgressValue(resourceId);
        const progressMessage = escapeHtml(progress.message || "");

        return (
          '<div class="apl-settings-resource" data-resource="' +
          resourceId +
          '">' +
          '<div class="apl-settings-resource-top">' +
          '<div class="apl-settings-resource-name">' +
          escapeHtml(label) +
          "</div>" +
          '<div class="apl-settings-resource-status">' +
          escapeHtml(status) +
          "</div>" +
          "</div>" +
          '<div class="apl-settings-progress">' +
          '<div class="apl-settings-progress-value" style="width:' +
          String(progressValue) +
          '%"></div>' +
          "</div>" +
          '<div class="apl-settings-resource-message">' +
          progressMessage +
          "</div>" +
          '<button class="apl-button apl-settings-download" type="button" data-resource="' +
          resourceId +
          '"' +
          disabled +
          ">" +
          escapeHtml(buttonText) +
          "</button>" +
          "</div>"
        );
      })
      .join("");

    const errorHtml = settingsMessage
      ? '<div class="apl-settings-error">' + escapeHtml(settingsMessage) + "</div>"
      : "";

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
      '<div class="apl-settings-section-title">Tai tai nguyen</div>' +
      resourcesHtml +
      "</div>" +
      errorHtml +
      '<div class="apl-settings-actions">' +
      '<button class="apl-button apl-settings-refresh" type="button">Refresh</button>' +
      "</div>" +
      "</div>" +
      "</div>";

    bindSettingsActions();
    settingsModalWarm = true;
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

    const downloadButtons = settingsModalEl.querySelectorAll(".apl-settings-download");
    downloadButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const resourceId = button.getAttribute("data-resource");
        if (!resourceId) {
          return;
        }
        startResourceDownload(resourceId);
      });
    });
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
      sendCommand("lookup", text);
      return;
    }

    sendCommand("translate", text);
  });

  function sendCommand(commandType, text) {
    const payload = commandType + ":" + encodeURIComponent(text);
    const sent = sendPycmd(payload);
    if (!sent) {
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Khong goi duoc pycmd. Bam Shift de mo debug.",
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
    if (event.key === "Shift" && !event.repeat) {
      toggleDebugPanel();
      return;
    }

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
