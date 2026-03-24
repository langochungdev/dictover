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
    },
  };

  const resourceProgress = {
    argostranslate: { progress: 0, status: "idle", message: "" },
    language_pack: { progress: 0, status: "idle", message: "" },
  };

  let settingsMessage = "";
  const SETTINGS_REQUEST_COOLDOWN_MS = 3000;

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
    if (!popoverEl) return;
    popoverEl.remove();
    popoverEl = null;
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
    const detailsBody = container.querySelector(".apl-details-body");
    if (detailsToggle && detailsBody) {
      detailsToggle.addEventListener("click", function (event) {
        event.preventDefault();
        const isOpen = detailsToggle.getAttribute("aria-expanded") === "true";
        detailsToggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
        detailsBody.hidden = isOpen;
        refreshPopoverPosition();
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
      const translated = escapeHtml(data.translated || "") || firstDefinitionText(meanings);
      const pos = firstPartOfSpeech(meanings);
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";

      return (
        '<div class="apl-body apl-lookup-compact">' +
        '<div class="apl-lookup-top">' +
        '<div class="apl-lookup-en">' +
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
        '<div class="apl-phonetic">' +
        phonetic +
        "</div>" +
        '<div class="apl-pos-inline">' +
        pos +
        "</div>" +
        "</div>" +
        '<div class="apl-details">' +
        '<button class="apl-details-toggle" type="button" aria-expanded="false">Xem them dinh nghia va vi du</button>' +
        '<div class="apl-details-body" hidden>' +
        renderMeanings(meanings) +
        "</div>" +
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

    popoverEl.innerHTML = renderState(data);
    bindPopoverActions(popoverEl);
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
  }

  function refreshPopoverPosition() {
    if (!popoverEl) {
      return;
    }
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
  }

  function updateSettingsState(data) {
    const incomingSettings = data.settings || {};
    const incomingLanguages = data.languages || {};
    const incomingResources = data.resources || {};

    toolSettings.enable_lookup = Boolean(
      incomingSettings.enable_lookup !== false
    );
    toolSettings.enable_translate = Boolean(
      incomingSettings.enable_translate !== false
    );
    toolSettings.enable_audio = Boolean(incomingSettings.enable_audio !== false);

    settingsState.languages = {
      source_language: String(incomingLanguages.source_language || "en"),
      target_language: String(incomingLanguages.target_language || "vi"),
    };

    settingsState.resources = {
      argostranslate: Boolean(incomingResources.argostranslate),
      language_pack: Boolean(incomingResources.language_pack),
    };

    if (settingsState.resources.argostranslate) {
      resourceProgress.argostranslate = {
        progress: 100,
        status: "success",
        message: "Da san sang",
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
    const installed = Boolean(settingsState.resources[resourceId]);
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
      '<div class="apl-settings-section-title">Bat/tat cong cu</div>' +
      '<label class="apl-settings-toggle">' +
      '<input type="checkbox" data-setting="enable_lookup"' +
      (toolSettings.enable_lookup ? " checked" : "") +
      ">" +
      '<span>Tra tu don</span>' +
      "</label>" +
      '<label class="apl-settings-toggle">' +
      '<input type="checkbox" data-setting="enable_translate"' +
      (toolSettings.enable_translate ? " checked" : "") +
      ">" +
      '<span>Dich doan van</span>' +
      "</label>" +
      '<label class="apl-settings-toggle">' +
      '<input type="checkbox" data-setting="enable_audio"' +
      (toolSettings.enable_audio ? " checked" : "") +
      ">" +
      '<span>Audio</span>' +
      "</label>" +
      "</div>" +
      '<div class="apl-settings-section">' +
      '<div class="apl-settings-section-title">Tai tai nguyen</div>' +
      resourcesHtml +
      "</div>" +
      errorHtml +
      '<div class="apl-settings-actions">' +
      '<button class="apl-button apl-settings-refresh" type="button">Refresh</button>' +
      '<button class="apl-button apl-settings-save" type="button">Luu</button>' +
      "</div>" +
      "</div>" +
      "</div>";

    bindSettingsActions();
    settingsModalWarm = true;
  }

  function bindSettingsActions() {
    const overlay = settingsModalEl.querySelector(".apl-settings-overlay");
    const closeButton = settingsModalEl.querySelector(".apl-settings-close");
    const saveButton = settingsModalEl.querySelector(".apl-settings-save");
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

    if (saveButton) {
      saveButton.addEventListener("click", function () {
        saveSettings();
      });
    }

    if (refreshButton) {
      refreshButton.addEventListener("click", function () {
        requestSettings(true);
      });
    }

    const toggles = settingsModalEl.querySelectorAll("input[data-setting]");
    toggles.forEach(function (toggle) {
      toggle.addEventListener("change", function () {
        const key = toggle.getAttribute("data-setting");
        if (!key) {
          return;
        }
        toolSettings[key] = Boolean(toggle.checked);
      });
    });

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

  ensureSettingsTrigger();
  requestSettings(false);

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(function () {
      if (!settingsModalEl) {
        settingsModalEl = document.createElement("div");
        settingsModalEl.className = "apl-settings-root apl-settings-root--hidden";
        document.body.appendChild(settingsModalEl);
      }

      if (!settingsModalWarm) {
        renderSettingsModal();
      }
    });
  }

  pushDebug("popup.js da duoc load.");

  window.showPopover = showPopover;
  window.updatePopover = updatePopover;
  window.aplEnsureSettingsTrigger = ensureSettingsTrigger;
  window.aplDebugDump = function () {
    return debugLines.join("\n");
  };
})();
