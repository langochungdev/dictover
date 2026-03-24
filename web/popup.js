(function () {
  let popoverEl = null;
  let debugPanelEl = null;
  let debugLogEl = null;
  let lastAnchor = { x: 24, y: 24 };
  let pendingTimer = null;
  let pendingCommand = "";
  const debugLines = [];

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
        pushDebug("Khong co log de copy.");
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            pushDebug("Da copy log vao clipboard.");
          },
          function (error) {
            pushDebug("Copy loi: " + String(error));
          }
        );
        return;
      }

      if (debugLogEl) {
        debugLogEl.focus();
        debugLogEl.select();
        document.execCommand("copy");
        pushDebug("Da copy log bang execCommand(copy).");
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
    pushDebug("Toggle debug panel");
  }

  function armPendingTimeout(command, text) {
    clearPendingTimeout();
    pendingCommand = command;
    pendingTimer = window.setTimeout(function () {
      const hint = "Khong nhan duoc phan hoi tu Python sau 3s.";
      const detail = "cmd=" + command + " text='" + text + "'";
      pushDebug("TIMEOUT: " + detail);
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: hint + " Bam Shift de mo debug va copy loi.",
      });
    }, 3000);
  }

  function clearPendingTimeout() {
    if (pendingTimer !== null) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
      pendingCommand = "";
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

  function normalizeSelection() {
    const selection = window.getSelection();
    if (!selection) return "";
    return selection.toString().replace(/\s+/g, " ").trim();
  }

  function getWordCount(text) {
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  function closePopover() {
    if (!popoverEl) return;
    popoverEl.remove();
    popoverEl = null;
  }

  function placePopover(el, x, y) {
    const margin = 12;
    const width = el.offsetWidth || 320;
    const height = el.offsetHeight || 220;
    const maxX = window.innerWidth - width - margin;
    const maxY = window.innerHeight - height - margin;
    const left = Math.max(margin, Math.min(x + 8, maxX));
    const top = Math.max(margin, Math.min(y + 8, maxY));
    el.style.left = left + "px";
    el.style.top = top + "px";
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

    const closeButton = root.querySelector(".apl-close");
    if (closeButton) {
      closeButton.addEventListener("click", closePopover);
    }

    const audioButton = root.querySelector(".apl-audio");
    if (audioButton) {
      audioButton.addEventListener("click", function () {
        const audioUrl = audioButton.getAttribute("data-audio") || "";
        const word = audioButton.getAttribute("data-word") || "";
        playAudio(audioUrl, word);
      });
    }

    popoverEl = root;
  }

  function playAudio(audioUrl, word) {
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
      return (
        '<div class="apl-body apl-translate-compact">' +
        '<div class="apl-translate-top">' +
        '<div class="apl-translate-en">' +
        original +
        "</div>" +
        '<button class="apl-button apl-audio" type="button" data-word="' +
        original +
        '" data-audio="">Audio</button>' +
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
        '">Audio</button>' +
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
        '<details class="apl-details">' +
        '<summary class="apl-details-summary">Xem them dinh nghia va vi du</summary>' +
        '<div class="apl-details-body">' +
        renderMeanings(meanings) +
        "</div>" +
        "</details>" +
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
    pushDebug("Nhan response tu Python: " + JSON.stringify(data || {}));

    if (!popoverEl) {
      showPopover(lastAnchor.x, lastAnchor.y, data);
      return;
    }

    popoverEl.innerHTML = renderState(data || {});

    const closeButton = popoverEl.querySelector(".apl-close");
    if (closeButton) {
      closeButton.addEventListener("click", closePopover);
    }

    const audioButton = popoverEl.querySelector(".apl-audio");
    if (audioButton) {
      audioButton.addEventListener("click", function () {
        playAudio(
          audioButton.getAttribute("data-audio") || "",
          audioButton.getAttribute("data-word") || ""
        );
      });
    }

    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
  }

  document.addEventListener("mouseup", function (event) {
    if (popoverEl && popoverEl.contains(event.target)) {
      return;
    }

    const text = normalizeSelection();
    if (!text) {
      return;
    }

    const wordCount = getWordCount(text);
    showPopover(event.clientX, event.clientY, { loading: true, word: text });
    pushDebug("Selection: '" + text + "' wordCount=" + String(wordCount));

    if (wordCount === 1) {
      sendCommand("lookup", text);
      return;
    }

    sendCommand("translate", text);
  });

  function sendCommand(commandType, text) {
    const payload = commandType + ":" + encodeURIComponent(text);
    if (typeof window.pycmd !== "function") {
      pushDebug("Loi: window.pycmd khong ton tai.");
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Khong goi duoc pycmd. Bam Shift de mo debug.",
      });
      return;
    }

    try {
      pushDebug("Gui pycmd: " + payload);
      armPendingTimeout(commandType, text);
      window.pycmd(payload);
    } catch (error) {
      clearPendingTimeout();
      pushDebug("Exception pycmd: " + String(error));
      showPopover(lastAnchor.x, lastAnchor.y, {
        type: "error",
        message: "Co loi khi goi pycmd. Bam Shift de copy log.",
      });
    }
  }

  document.addEventListener("mousedown", function (event) {
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
      closePopover();
    }
  });

  window.addEventListener("error", function (event) {
    pushDebug("window.error: " + String(event.message || event.error || "unknown"));
  });

  window.addEventListener("unhandledrejection", function (event) {
    pushDebug("unhandledrejection: " + String(event.reason || "unknown"));
  });

  pushDebug("popup.js da duoc load.");

  window.showPopover = showPopover;
  window.updatePopover = updatePopover;
  window.aplDebugDump = function () {
    return debugLines.join("\n");
  };
})();
