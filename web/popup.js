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
  let subPanelType = "";
  let pendingCommandToken = 0;
  let pendingSelectionAction = null;
  let activeCommandMeta = null;
  let pendingNativeAudioFallback = null;
  let activeHtmlAudioElements = [];
  let lastLookupDetails = null;
  let imagePanelRequestSeq = 0;
  let imagePanelLoaderEl = null;
  let imagePanelRevealSeq = 0;
  const imageSearchCache = new Map();
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
      auto_play_audio_mode: "off",
      hide_home_settings_button: false,
      panel_open_mode: "none",
      definition_language_mode: "output",
    },
    resources: {
      mode: "api_only",
      status_unknown: false,
    },
    addon_version: String(window.__aplAddonVersion || "").trim() || "unknown",
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
  const DEFAULT_AUTO_PLAY_AUDIO_MODE = "off";
  const DEFAULT_PANEL_OPEN_MODE = "none";
  const DEFAULT_DEFINITION_LANGUAGE_MODE = "output";
  const SETTINGS_PANEL_MODE_COPY = {
    en: {
      title: "Panel on popover",
      none: "none",
      details: "show detail panel",
      images: "show image panel",
    },
    "zh-CN": {
      title: "Popover 显示面板",
      none: "不显示",
      details: "显示详情面板",
      images: "显示图片面板",
    },
    ja: {
      title: "ポップオーバー表示パネル",
      none: "なし",
      details: "詳細パネルを表示",
      images: "画像パネルを表示",
    },
    ko: {
      title: "팝오버 표시 패널",
      none: "표시 안 함",
      details: "상세 패널 표시",
      images: "이미지 패널 표시",
    },
    ru: {
      title: "Панель в поповере",
      none: "не показывать",
      details: "показывать панель деталей",
      images: "показывать панель изображений",
    },
    fi: {
      title: "Paneeli ponnahdusikkunassa",
      none: "ei nayteta",
      details: "nayta tietopaneeli",
      images: "nayta kuvapaneeli",
    },
    de: {
      title: "Panel im Popover",
      none: "nicht anzeigen",
      details: "Detailpanel anzeigen",
      images: "Bildpanel anzeigen",
    },
    fr: {
      title: "Panneau dans le popover",
      none: "ne pas afficher",
      details: "afficher le panneau detail",
      images: "afficher le panneau image",
    },
    vi: {
      title: "Panel khi hiện popover",
      none: "không",
      details: "hiện panel chi tiết",
      images: "hiện panel ảnh",
    },
  };
  const SETTINGS_DEFINITION_MODE_COPY = {
    en: {
      title: "Definition language",
      output: "output language",
      input: "input language",
      english: "English",
    },
    "zh-CN": {
      title: "释义语言",
      output: "输出语言",
      input: "输入语言",
      english: "英语",
    },
    ja: {
      title: "定義の言語",
      output: "出力言語",
      input: "入力言語",
      english: "英語",
    },
    ko: {
      title: "정의 언어",
      output: "출력 언어",
      input: "입력 언어",
      english: "영어",
    },
    ru: {
      title: "Язык определения",
      output: "язык вывода",
      input: "язык ввода",
      english: "английский",
    },
    fi: {
      title: "Maaritelman kieli",
      output: "kohdekieli",
      input: "lahdekieli",
      english: "englanti",
    },
    de: {
      title: "Sprache der Definition",
      output: "Ausgabesprache",
      input: "Eingabesprache",
      english: "Englisch",
    },
    fr: {
      title: "Langue de la definition",
      output: "langue de sortie",
      input: "langue d'entree",
      english: "anglais",
    },
    vi: {
      title: "Ngôn ngữ định nghĩa",
      output: "ngôn ngữ đầu ra",
      input: "ngôn ngữ đầu vào",
      english: "tiếng Anh",
    },
  };
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
      hide_home_settings_button: "Hide settings button on home",
      auto_play_audio_title: "Auto play audio",
      auto_play_audio_mode_off: "Do not auto play",
      auto_play_audio_mode_word: "Auto play for single word only",
      auto_play_audio_mode_all: "Auto play for word and sentence",
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
      hide_home_settings_button: "Ẩn nút settings ở home",
      auto_play_audio_title: "Tự động phát audio",
      auto_play_audio_mode_off: "Không tự phát",
      auto_play_audio_mode_word: "Chỉ tự phát khi tra 1 từ",
      auto_play_audio_mode_all: "Tự phát cho từ và câu",
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
      hide_home_settings_button: "隐藏首页设置按钮",
      auto_play_audio_title: "自动播放音频",
      auto_play_audio_mode_off: "不自动播放",
      auto_play_audio_mode_word: "仅单词时自动播放",
      auto_play_audio_mode_all: "单词和句子都自动播放",
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
      hide_home_settings_button: "ホームで設定ボタンを隠す",
      auto_play_audio_title: "音声の自動再生",
      auto_play_audio_mode_off: "自動再生しない",
      auto_play_audio_mode_word: "単語1語のときだけ自動再生",
      auto_play_audio_mode_all: "単語と文の両方を自動再生",
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
      hide_home_settings_button: "홈에서 설정 버튼 숨기기",
      auto_play_audio_title: "오디오 자동 재생",
      auto_play_audio_mode_off: "자동 재생 안 함",
      auto_play_audio_mode_word: "단어 1개일 때만 자동 재생",
      auto_play_audio_mode_all: "단어와 문장 모두 자동 재생",
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
      hide_home_settings_button: "Скрыть кнопку настроек на главной",
      auto_play_audio_title: "Автовоспроизведение аудио",
      auto_play_audio_mode_off: "Не воспроизводить автоматически",
      auto_play_audio_mode_word: "Автовоспроизведение только для одного слова",
      auto_play_audio_mode_all: "Автовоспроизведение для слова и предложения",
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
      hide_home_settings_button: "Piilota asetuspainike etusivulla",
      auto_play_audio_title: "Toista audio automaattisesti",
      auto_play_audio_mode_off: "Ei automaattista toistoa",
      auto_play_audio_mode_word: "Toista automaattisesti vain yhdelle sanalle",
      auto_play_audio_mode_all: "Toista automaattisesti sanalle ja lauseelle",
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
      hide_home_settings_button: "Settings-Button auf Home ausblenden",
      auto_play_audio_title: "Audio automatisch abspielen",
      auto_play_audio_mode_off: "Nicht automatisch abspielen",
      auto_play_audio_mode_word: "Nur bei einem einzelnen Wort automatisch abspielen",
      auto_play_audio_mode_all: "Bei Wort und Satz automatisch abspielen",
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
      hide_home_settings_button: "Masquer le bouton des reglages sur l'accueil",
      auto_play_audio_title: "Lecture audio automatique",
      auto_play_audio_mode_off: "Ne pas lire automatiquement",
      auto_play_audio_mode_word: "Lire automatiquement uniquement pour un mot",
      auto_play_audio_mode_all: "Lire automatiquement pour mot et phrase",
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
  const IMAGE_PAGE_SIZE = 24;
  const IMAGE_SCROLL_THRESHOLD_PX = 260;
  const IMAGE_CACHE_TTL_MS = 8 * 60 * 1000;
  const IMAGE_FETCH_TIMEOUT_MS = 2200;
  const IMAGE_PRELOAD_MIN_COUNT = 4;
  const IMAGE_PRELOAD_TIMEOUT_MS = 5000;
  const COMMAND_RESPONSE_SOFT_TIMEOUT_MS = 8000;
  const IMAGE_PRELOAD_MAX_PAGES = 4;
  const AUDIO_ICON_SVG =
    '<svg class="apl-audio-icon" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<g fill="none" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6.5 8.5v4"/>' +
    '<path d="M8.5 6.5v9"/>' +
    '<path d="M10.5 9.5v2"/>' +
    '<path d="M12.5 7.5v6.814"/>' +
    '<path d="M14.5 4.5v12"/>' +
    "</g></svg>";
  const IMAGE_ICON_SVG =
    '<svg class="apl-image-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
    '<rect x="2.8" y="4" width="14.4" height="12" rx="2"/>' +
    '<circle cx="7.2" cy="8" r="1.3"/>' +
    '<path d="M4.8 14l3.6-3.8 2.8 2.8 2.4-2.3 2.4 3.3"/>' +
    "</g></svg>";
  const SETTINGS_ICON_SVG =
    '<svg class="apl-settings-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<path d="M8.2 2.6h3.6l.5 2.1a5.6 5.6 0 0 1 1.2.7l2-.8 1.8 3.1-1.5 1.5c.1.4.1.8.1 1.2s0 .8-.1 1.2l1.5 1.5-1.8 3.1-2-.8a5.6 5.6 0 0 1-1.2.7l-.5 2.1H8.2l-.5-2.1a5.6 5.6 0 0 1-1.2-.7l-2 .8-1.8-3.1L4.2 12a6 6 0 0 1-.1-1.2c0-.4 0-.8.1-1.2L2.7 8.1l1.8-3.1 2 .8a5.6 5.6 0 0 1 1.2-.7zm1.8 5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
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

  function getAddonAssetUrl(relativePath) {
    const cleaned = String(relativePath || "").replace(/^\/+/, "");
    if (!cleaned) {
      return "";
    }

    const addonWebId = String(window.__aplAddonWebId || "").trim();
    if (!addonWebId) {
      return "/" + cleaned;
    }

    return "/_addons/" + encodeURIComponent(addonWebId) + "/" + cleaned;
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

  function isSingleWordText(text) {
    return getWordCount(String(text || "").trim()) === 1;
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

  function syncImageToggleState(expanded) {
    if (!popoverEl) {
      return;
    }

    const imageToggle = popoverEl.querySelector(".apl-image-toggle");
    if (!imageToggle) {
      return;
    }

    imageToggle.setAttribute("aria-pressed", expanded ? "true" : "false");
    if (expanded) {
      imageToggle.classList.add("apl-image-toggle--active");
    } else {
      imageToggle.classList.remove("apl-image-toggle--active");
    }
  }

  function closeSubPanel() {
    imagePanelRevealSeq += 1;
    removeImagePanelLoader();

    if (subPanelEl) {
      if (subPanelEl.__aplImageRevealTimerId) {
        window.clearTimeout(subPanelEl.__aplImageRevealTimerId);
        subPanelEl.__aplImageRevealTimerId = 0;
      }
      subPanelEl.remove();
      subPanelEl = null;
    }
    subPanelType = "";
    syncDetailsToggleState(false);
    syncImageToggleState(false);
  }

  function removeImagePanelLoader() {
    if (!imagePanelLoaderEl) {
      return;
    }

    imagePanelLoaderEl.remove();
    imagePanelLoaderEl = null;
  }

  function placeImagePanelLoader(loader, panel) {
    if (!loader || !popoverEl) {
      return;
    }

    if (!panel) {
      placeSubPanel(loader);
      return;
    }

    const margin = 12;
    const gap = 8;
    const popoverRect = popoverEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const placement = String(panel.getAttribute("data-placement") || "");
    const loaderWidth = loader.offsetWidth || 180;
    const loaderHeight = loader.offsetHeight || 48;
    const maxX = Math.max(margin, window.innerWidth - loaderWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - loaderHeight - margin);
    let direction = placement.split("-")[0];

    if (["right", "left", "top", "bottom"].indexOf(direction) === -1) {
      if (panelRect.left >= popoverRect.right) {
        direction = "right";
      } else if (panelRect.right <= popoverRect.left) {
        direction = "left";
      } else if (panelRect.top >= popoverRect.bottom) {
        direction = "bottom";
      } else {
        direction = "top";
      }
    }

    const alignRight = placement.indexOf("-right") >= 0;
    const alignBottom = placement.indexOf("-bottom") >= 0;

    let rawLeft = popoverRect.right + gap;
    let rawTop = popoverRect.top;

    if (direction === "right") {
      rawLeft = popoverRect.right + gap;
      rawTop = alignBottom ? popoverRect.bottom - loaderHeight : popoverRect.top;
    } else if (direction === "left") {
      rawLeft = popoverRect.left - loaderWidth - gap;
      rawTop = alignBottom ? popoverRect.bottom - loaderHeight : popoverRect.top;
    } else if (direction === "bottom") {
      rawTop = popoverRect.bottom + gap;
      rawLeft = alignRight ? popoverRect.right - loaderWidth : popoverRect.left;
    } else {
      rawTop = popoverRect.top - loaderHeight - gap;
      rawLeft = alignRight ? popoverRect.right - loaderWidth : popoverRect.left;
    }

    loader.style.left = clamp(rawLeft, margin, maxX) + "px";
    loader.style.top = clamp(rawTop, margin, maxY) + "px";
    loader.setAttribute("data-placement", placement || direction + "-top");
  }

  function showImagePanelLoader(panel) {
    removeImagePanelLoader();

    const loader = document.createElement("div");
    loader.className = "apl-image-preload-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.innerHTML = renderLoadingDots("Dang tai hinh anh");

    document.body.appendChild(loader);
    imagePanelLoaderEl = loader;
    placeImagePanelLoader(loader, panel || subPanelEl);
  }

  function waitForFirstImageThumbs(panel, minCount) {
    const thumbs = panel ? panel.querySelectorAll(".apl-image-thumb") : null;
    const targetCount = Math.min(
      Math.max(0, Number(minCount || 0)),
      thumbs ? thumbs.length : 0
    );

    if (!thumbs || targetCount <= 0) {
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      let settled = 0;
      let finished = false;
      const timerId = window.setTimeout(function () {
        if (finished) {
          return;
        }
        finished = true;
        resolve();
      }, IMAGE_PRELOAD_TIMEOUT_MS);

      function markSettled() {
        settled += 1;
        if (finished || settled < targetCount) {
          return;
        }
        finished = true;
        window.clearTimeout(timerId);
        resolve();
      }

      for (let index = 0; index < targetCount; index += 1) {
        const image = thumbs[index];
        if (!image) {
          markSettled();
          continue;
        }

        if (image.complete) {
          markSettled();
          continue;
        }

        image.addEventListener("load", markSettled, { once: true });
        image.addEventListener("error", markSettled, { once: true });
      }
    });
  }

  function revealImageSubPanel(panel) {
    if (!panel || panel !== subPanelEl || subPanelType !== "images") {
      return;
    }

    if (panel.__aplImageRevealTimerId) {
      window.clearTimeout(panel.__aplImageRevealTimerId);
      panel.__aplImageRevealTimerId = 0;
    }

    panel.classList.remove("apl-subpanel--pending");
    panel.removeAttribute("aria-hidden");
    panel.__aplImagePanelRevealed = true;
    removeImagePanelLoader();
    placeImageSubPanel(panel);
  }

  function maybeRevealPendingImagePanel(panel, query) {
    if (!panel || panel !== subPanelEl || subPanelType !== "images") {
      return;
    }

    if (panel.__aplImagePanelRevealed) {
      return;
    }

    const normalized = normalizeImageQuery(query);
    const items = Array.isArray(panel.__aplImageItems) ? panel.__aplImageItems : [];
    const itemCount = items.length;
    const hasMore = panel.getAttribute("data-image-has-more") === "1";
    const isLoading = panel.getAttribute("data-image-loading") === "1";
    const preloadPages = Math.max(0, Number(panel.__aplImagePreloadPages || 0));

    if (itemCount < IMAGE_PRELOAD_MIN_COUNT && hasMore && !isLoading && preloadPages < IMAGE_PRELOAD_MAX_PAGES) {
      loadNextImagePage(panel, normalized);
      return;
    }

    if (itemCount === 0) {
      if (isLoading) {
        return;
      }
      revealImageSubPanel(panel);
      return;
    }

    if (itemCount < IMAGE_PRELOAD_MIN_COUNT && hasMore && isLoading) {
      return;
    }

    const revealToken = ++imagePanelRevealSeq;
    panel.__aplImageRevealToken = revealToken;

    waitForFirstImageThumbs(panel, IMAGE_PRELOAD_MIN_COUNT).then(function () {
      if (!panel || panel !== subPanelEl || subPanelType !== "images") {
        return;
      }
      if (panel.__aplImagePanelRevealed) {
        return;
      }
      if (Number(panel.__aplImageRevealToken || 0) !== revealToken) {
        return;
      }
      revealImageSubPanel(panel);
    });
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
      pendingTimer = null;
      pushDebug("slow response command=" + command + " text=" + text);
    }, COMMAND_RESPONSE_SOFT_TIMEOUT_MS);
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

  function placeImageSubPanel(panel) {
    if (!panel || !popoverEl) {
      return;
    }
    panel.style.removeProperty("width");
    panel.style.removeProperty("height");
    panel.style.removeProperty("max-height");
    placeSubPanel(panel);
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
    panel.setAttribute("data-panel-type", "definition");
    subPanelEl = panel;
    subPanelType = "definition";
    placeSubPanel(panel);
    syncDetailsToggleState(true);
    syncImageToggleState(false);
  }

  function normalizeImageQuery(value) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) {
      return "";
    }

    const words = compact.split(" ").slice(0, 8);
    return words.join(" ").slice(0, 80).trim();
  }

  function resolveImageQuery(data) {
    if (!data || typeof data !== "object") {
      return "";
    }

    if (data.type === "lookup") {
      return normalizeImageQuery(data.word || "");
    }

    if (data.type === "translate") {
      return normalizeImageQuery(data.original || "");
    }

    return "";
  }

  function getCachedImageRecord(query) {
    const record = imageSearchCache.get(query);
    if (!record) {
      return null;
    }

    if (Date.now() - Number(record.cachedAt || 0) > IMAGE_CACHE_TTL_MS) {
      imageSearchCache.delete(query);
      return null;
    }

    return {
      options: Array.isArray(record.options) ? record.options : [],
      nextPage:
        Number(record.nextPage || 0) > 0
          ? Number(record.nextPage)
          : null,
    };
  }

  function setCachedImageRecord(query, options, nextPage) {
    imageSearchCache.set(query, {
      cachedAt: Date.now(),
      options: Array.isArray(options) ? options : [],
      nextPage: Number(nextPage || 0) > 0 ? Number(nextPage) : null,
    });
  }

  function renderImageCards(options, query, startIndex) {
    const list = Array.isArray(options) ? options : [];
    const offset = Math.max(0, Number(startIndex || 0));
    return list
      .map(function (item, index) {
        const src = escapeHtml(item.src || "");
        const link = escapeHtml(item.pageUrl || item.src || "");
        const title = escapeHtml(item.title || query || "Image");
        const absoluteIndex = offset + index;
        const loadingMode = absoluteIndex < 4 ? "eager" : "lazy";
        const fetchPriority = absoluteIndex < 4 ? "high" : "low";

        return (
          '<a class="apl-image-card" href="' +
          link +
          '" target="_blank" rel="noopener noreferrer">' +
          '<img class="apl-image-thumb" src="' +
          src +
          '" alt="' +
          title +
          '" loading="' +
          loadingMode +
          '" decoding="async" fetchpriority="' +
          fetchPriority +
          '" />' +
          "</a>"
        );
      })
      .join("");
  }

  function panelRequestMatches(panel, requestSeq, query) {
    if (!panel || !subPanelEl || panel !== subPanelEl) {
      return false;
    }
    if (subPanelType !== "images") {
      return false;
    }
    if (panel.getAttribute("data-image-request-seq") !== String(requestSeq)) {
      return false;
    }
    return panel.getAttribute("data-image-query") === query;
  }

  function ensureImageResultsStructure(panel) {
    const target = panel ? panel.querySelector(".apl-image-results") : null;
    if (!target) {
      return null;
    }

    let grid = target.querySelector(".apl-image-grid");
    let status = target.querySelector(".apl-image-status");

    if (!grid || !status) {
      target.innerHTML = '<div class="apl-image-grid"></div><div class="apl-image-status" hidden></div>';
      grid = target.querySelector(".apl-image-grid");
      status = target.querySelector(".apl-image-status");
    }

    return {
      target: target,
      grid: grid,
      status: status,
    };
  }

  function setImageStatus(panel, message, isError) {
    const structure = ensureImageResultsStructure(panel);
    if (!structure || !structure.status) {
      return;
    }

    const text = String(message || "").trim();
    if (!text) {
      structure.status.setAttribute("hidden", "hidden");
      structure.status.textContent = "";
      structure.status.classList.remove("apl-image-status--error");
      return;
    }

    structure.status.textContent = text;
    structure.status.removeAttribute("hidden");
    if (isError) {
      structure.status.classList.add("apl-image-status--error");
    } else {
      structure.status.classList.remove("apl-image-status--error");
    }
  }

  function appendImageCards(panel, query, options, reset) {
    const structure = ensureImageResultsStructure(panel);
    if (!structure || !structure.grid) {
      return 0;
    }

    if (reset || !panel.__aplImageSeen || !panel.__aplImageItems) {
      panel.__aplImageSeen = Object.create(null);
      panel.__aplImageItems = [];
      structure.grid.innerHTML = "";
    }

    const seen = panel.__aplImageSeen;
    const items = panel.__aplImageItems;
    const incoming = Array.isArray(options) ? options : [];
    const unique = [];

    incoming.forEach(function (item) {
      const src = String(item && item.src ? item.src : "").trim();
      if (!src || seen[src]) {
        return;
      }
      seen[src] = true;
      const normalizedItem = {
        src: src,
        source: String(item.source || "Web"),
        title: String(item.title || query || "Image"),
        pageUrl: String(item.pageUrl || src),
      };
      unique.push(normalizedItem);
      items.push(normalizedItem);
    });

    if (unique.length === 0) {
      return 0;
    }

    structure.grid.insertAdjacentHTML("beforeend", renderImageCards(unique, query, items.length - unique.length));
    return unique.length;
  }

  function resetImagePanelState(panel, query) {
    panel.setAttribute("data-image-query", query);
    panel.setAttribute("data-image-next-page", "1");
    panel.setAttribute("data-image-has-more", "1");
    panel.setAttribute("data-image-loading", "0");
    panel.__aplImagePreloadPages = 0;
    panel.__aplImagePanelRevealed = false;
    panel.__aplImageRevealToken = 0;
    appendImageCards(panel, query, [], true);
    setImageStatus(panel, "", false);
  }

  function requestImageSearchViaPython(query, page, requestSeq) {
    const payload = {
      query: String(query || ""),
      page: Math.max(1, Number(page || 1)),
      page_size: IMAGE_PAGE_SIZE,
      request_seq: Math.max(0, Number(requestSeq || 0)),
    };

    return sendPycmd("image:search:" + encodeURIComponent(JSON.stringify(payload)));
  }

  function loadNextImagePage(panel, query) {
    const normalized = normalizeImageQuery(query);
    if (!normalized) {
      return;
    }

    if (!panel || panel !== subPanelEl || subPanelType !== "images") {
      return;
    }

    if (panel.getAttribute("data-image-loading") === "1") {
      return;
    }

    if (panel.getAttribute("data-image-has-more") === "0") {
      return;
    }

    const page = Math.max(1, Number(panel.getAttribute("data-image-next-page") || "1"));
    const requestSeq = ++imagePanelRequestSeq;
    panel.setAttribute("data-image-request-seq", String(requestSeq));
    panel.setAttribute("data-image-loading", "1");
    setImageStatus(panel, "", false);

    const sent = requestImageSearchViaPython(normalized, page, requestSeq);
    if (!sent) {
      panel.setAttribute("data-image-loading", "0");
      setImageStatus(panel, "Khong gui duoc yeu cau tim anh.", true);
      maybeRevealPendingImagePanel(panel, normalized);
      pushDebug("image.search send failed");
    }
  }

  function requestAndRenderImageOptions(panel, query, forceRefresh) {
    const normalized = normalizeImageQuery(query);
    if (!normalized) {
      resetImagePanelState(panel, "");
      return;
    }

    if (forceRefresh) {
      imageSearchCache.delete(normalized);
    }

    resetImagePanelState(panel, normalized);

    if (!forceRefresh) {
      const cached = getCachedImageRecord(normalized);
      if (cached && Array.isArray(cached.options) && cached.options.length > 0) {
        appendImageCards(panel, normalized, cached.options, true);
        panel.setAttribute("data-image-next-page", cached.nextPage ? String(cached.nextPage) : "1");
        panel.setAttribute("data-image-has-more", cached.nextPage ? "1" : "0");
        panel.setAttribute("data-image-loading", "0");
        maybeRevealPendingImagePanel(panel, normalized);
        return;
      }
    }

    loadNextImagePage(panel, normalized);
  }

  function handleImageSearchResult(data) {
    const query = normalizeImageQuery(data && data.query ? data.query : "");
    const requestSeq = String(Math.max(0, Number(data && data.request_seq ? data.request_seq : 0)));
    const panel = subPanelEl;

    if (!panel || subPanelType !== "images") {
      return;
    }

    if (!query || panel.getAttribute("data-image-query") !== query) {
      return;
    }

    if (panel.getAttribute("data-image-request-seq") !== requestSeq) {
      return;
    }

    const options = Array.isArray(data && data.options ? data.options : [])
      ? data.options
      : [];
    panel.__aplImagePreloadPages = Math.max(0, Number(panel.__aplImagePreloadPages || 0)) + 1;
    const countBefore = Array.isArray(panel.__aplImageItems) ? panel.__aplImageItems.length : 0;
    const added = appendImageCards(panel, query, options, false);

    const nextPage = Math.max(0, Number(data && data.next_page ? data.next_page : 0));
    const hasMore = Boolean(data && data.has_more) && nextPage > 0;

    panel.setAttribute("data-image-loading", "0");
    panel.setAttribute("data-image-next-page", nextPage > 0 ? String(nextPage) : panel.getAttribute("data-image-next-page") || "1");
    panel.setAttribute("data-image-has-more", hasMore ? "1" : "0");
    setImageStatus(panel, "", false);

    if (added === 0 && countBefore > 0 && !hasMore) {
      panel.setAttribute("data-image-has-more", "0");
    }

    const backendError = String(data && data.error ? data.error : "").trim();
    if (backendError) {
      pushDebug("image.search backend: " + backendError);
    }

    setCachedImageRecord(
      query,
      Array.isArray(panel.__aplImageItems) ? panel.__aplImageItems : [],
      hasMore ? nextPage : null
    );

    maybeRevealPendingImagePanel(panel, query);
  }

  function openImageSubPanel(container, query, forceRefresh) {
    const normalized = normalizeImageQuery(query);
    if (!normalized) {
      return;
    }

    closeSubPanel();

    const panel = document.createElement("div");
    panel.className = "apl-subpanel apl-subpanel--images";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("data-panel-type", "images");
    panel.setAttribute("data-image-query", normalized);
    panel.classList.add("apl-subpanel--pending");
    panel.innerHTML =
      '<div class="apl-subpanel-body apl-image-subpanel-body">' +
      '<div class="apl-image-results">' +
      '<div class="apl-image-grid"></div>' +
      '<div class="apl-image-status" hidden></div>' +
      "</div>" +
      "</div>";

    document.body.appendChild(panel);
    subPanelEl = panel;
    subPanelType = "images";
    placeImageSubPanel(panel);
    showImagePanelLoader(panel);
    syncDetailsToggleState(false);
    syncImageToggleState(true);

    panel.__aplImageRevealTimerId = window.setTimeout(function () {
      if (!panel || panel !== subPanelEl || subPanelType !== "images") {
        return;
      }
      if (panel.__aplImagePanelRevealed) {
        return;
      }
      if (panel.getAttribute("data-image-loading") === "1") {
        return;
      }
      revealImageSubPanel(panel);
    }, IMAGE_PRELOAD_TIMEOUT_MS + 1200);

    const resultNode = panel.querySelector(".apl-image-results");
    if (resultNode) {
      resultNode.addEventListener("scroll", function () {
        if (!subPanelEl || subPanelEl !== panel || subPanelType !== "images") {
          return;
        }
        if (resultNode.scrollTop + resultNode.clientHeight + IMAGE_SCROLL_THRESHOLD_PX < resultNode.scrollHeight) {
          return;
        }
        loadNextImagePage(panel, normalized);
      });
    }

    requestAndRenderImageOptions(panel, normalized, Boolean(forceRefresh));
  }

  function autoOpenImagePanel(container, data) {
    const query = resolveImageQuery(data);
    if (!query) {
      return;
    }

    const alreadyOpen =
      Boolean(subPanelEl) &&
      subPanelType === "images" &&
      subPanelEl.getAttribute("data-image-query") === query;

    if (alreadyOpen) {
      syncImageToggleState(true);
      return;
    }

    openImageSubPanel(container, query, false);
  }

  function autoOpenDetailsPanel(container, data) {
    if (!container || !data || data.type !== "lookup") {
      return;
    }

    const source = container.querySelector(".apl-details-source");
    if (!source || !String(source.innerHTML || "").trim()) {
      return;
    }

    const alreadyOpen = Boolean(subPanelEl) && subPanelType === "definition";
    if (alreadyOpen) {
      syncDetailsToggleState(true);
      syncImageToggleState(false);
      return;
    }

    openSubPanel(container);
  }

  function autoOpenConfiguredPanel(container, data) {
    const mode = normalizePanelOpenMode(settingsState.popover.panel_open_mode);
    if (mode === "details") {
      autoOpenDetailsPanel(container, data);
      return;
    }

    if (mode === "images") {
      autoOpenImagePanel(container, data);
    }
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

    const imageToggle = container.querySelector(".apl-image-toggle");
    if (imageToggle) {
      imageToggle.addEventListener("click", function (event) {
        event.preventDefault();
        const query = normalizeImageQuery(imageToggle.getAttribute("data-query") || "");
        if (!query) {
          return;
        }

        const isOpen =
          Boolean(subPanelEl) &&
          subPanelType === "images" &&
          subPanelEl.getAttribute("data-image-query") === query;

        if (isOpen) {
          closeSubPanel();
          return;
        }

        openImageSubPanel(container, query, false);
      });
    }

    const quickSettingsButtons = container.querySelectorAll(".apl-open-settings");
    quickSettingsButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        openSettingsModal();
      });
    });
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
    if (!data || !toolSettings.enable_audio) {
      return;
    }

    const autoPlayMode = normalizeAutoPlayAudioMode(settingsState.popover.auto_play_audio_mode);
    if (autoPlayMode === DEFAULT_AUTO_PLAY_AUDIO_MODE) {
      return;
    }

    const dataType = String(data.type || "");
    if (dataType !== "lookup" && dataType !== "translate") {
      return;
    }

    const sourceText =
      dataType === "lookup"
        ? String(data.word || "")
        : String(data.original || "");

    if (autoPlayMode === "word" && !isSingleWordText(sourceText)) {
      return;
    }

    playAudio(
      String(data.audio_url || ""),
      sourceText,
      String(data.audio_lang || settingsState.languages.source_language || "")
    );
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

  function renderLoadingDots(ariaLabel) {
    return (
      '<div class="apl-loading" role="status" aria-live="polite" aria-label="' +
      escapeHtml(ariaLabel || "Loading") +
      '">' +
      '<span class="apl-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
      "</div>"
    );
  }

  function renderState(data) {
    if (data && data.loading) {
      return (
        '<div class="apl-body apl-body--loading-only">' +
        renderLoadingDots("Dang tra") +
        "</div>"
      );
    }

    if (data && data.type === "error") {
      return (
        '<div class="apl-header">' +
        '<span>Lookup</span>' +
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
      const imageQuery = escapeHtml(resolveImageQuery(data));
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";
      const shouldHideActionsUntilHover = /\s/.test((data.original || "").trim());
      const translateBodyClass = shouldHideActionsUntilHover
        ? "apl-body apl-translate-compact apl-translate-hover-actions"
        : "apl-body apl-translate-compact";
      return (
        '<div class="' +
        translateBodyClass +
        '">' +
        '<div class="apl-translate-vi apl-translate-vi--primary">' +
        translated +
        "</div>" +
        '<div class="apl-inline-actions apl-translate-inline-actions">' +
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
        '<button class="apl-button apl-image-toggle" type="button" aria-label="Open image panel" aria-pressed="false" data-query="' +
        imageQuery +
        '">' +
        IMAGE_ICON_SVG +
        "</button>" +
        '<button class="apl-button apl-popover-settings apl-open-settings" type="button" aria-label="Open settings">' +
        SETTINGS_ICON_SVG +
        "</button>" +
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
      const displayDefinition = data.definition_display
        ? escapeHtml(data.definition_display)
        : data.definition_translated
          ? escapeHtml(data.definition_translated)
        : englishDefinition;
      const summaryMeaning = translated || displayDefinition || englishDefinition;
      const pos = firstPartOfSpeech(meanings);
      const imageQuery = escapeHtml(resolveImageQuery(data));
      const audioDisabled = toolSettings.enable_audio ? "" : " disabled";
      lastLookupDetails = renderMeanings(meanings);

      return (
        '<div class="apl-body apl-lookup-compact">' +
        '<div class="apl-lookup-headerline">' +
        '<div class="apl-lookup-headertext">' +
        '<span class="apl-lookup-summary">' +
        summaryMeaning +
        "</span>" +
        '<span class="apl-lookup-phonetic-inline">' +
        phonetic +
        "</span>" +
        '<span class="apl-pos-inline">' +
        pos +
        "</span>" +
        '<div class="apl-inline-actions">' +
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
        '<button class="apl-button apl-image-toggle apl-audio-mini" type="button" aria-label="Open image panel" aria-pressed="false" data-query="' +
        imageQuery +
        '">' +
        IMAGE_ICON_SVG +
        "</button>" +
        '<button class="apl-button apl-popover-settings apl-audio-mini apl-open-settings" type="button" aria-label="Open settings">' +
        SETTINGS_ICON_SVG +
        "</button>" +
        "</div>" +
        "</div>" +
        "</div>" +
        '<button class="apl-lookup-definition-toggle" type="button" aria-expanded="false">' +
        '<span class="apl-definition-toggle-icon">' +
        detailsToggleLabels.closed +
        "</span>" +
        '<span class="apl-lookup-definition">' +
        displayDefinition +
        "</span>" +
        "</button>" +
        '<div class="apl-details-source" hidden>' +
        lastLookupDetails +
        "</div>" +
        "</div>"
      );
    }

    return (
      '<div class="apl-body apl-body--loading-only">' +
      renderLoadingDots("Dang cho du lieu") +
      "</div>"
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

    if (data.type === "image_search_result") {
      handleImageSearchResult(data);
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
      autoOpenConfiguredPanel(popoverEl, data);
      maybeAutoPlayAudio(data);
      return;
    }

    closeSubPanel();
    popoverEl.innerHTML = renderState(data);
    bindPopoverActions(popoverEl);
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
    autoOpenConfiguredPanel(popoverEl, data);
    maybeAutoPlayAudio(data);
  }

  function refreshPopoverPosition() {
    if (!popoverEl) {
      return;
    }
    placePopover(popoverEl, lastAnchor.x, lastAnchor.y);
    if (subPanelEl) {
      if (subPanelType === "images") {
        placeImageSubPanel(subPanelEl);
        if (imagePanelLoaderEl) {
          placeImagePanelLoader(imagePanelLoaderEl, subPanelEl);
        }
      } else {
        placeSubPanel(subPanelEl);
        if (imagePanelLoaderEl) {
          placeSubPanel(imagePanelLoaderEl);
        }
      }
    } else if (imagePanelLoaderEl) {
      placeSubPanel(imagePanelLoaderEl);
    }
  }

  function handleGlobalScrollForPopover(event) {
    if (subPanelType === "images" && !imagePanelLoaderEl) {
      return;
    }

    refreshPopoverPosition();
  }

  function updateSettingsState(data) {
    const incomingLanguages = data.languages || {};
    const incomingSettings = data.settings || {};
    const nowTs = Date.now();
    const previousTargetLanguage = settingsState.languages.target_language;

    const incomingState = {
      source_language: String(incomingLanguages.source_language || "auto"),
      target_language: String(incomingLanguages.target_language || "vi"),
      trigger_mode: incomingSettings.popover_trigger_mode === "shortcut" ? "shortcut" : "auto",
      shortcut_combo: normalizeShortcutCombo(incomingSettings.popover_shortcut || DEFAULT_SHORTCUT_COMBO),
      auto_play_audio_mode: normalizeAutoPlayAudioMode(
        incomingSettings.auto_play_audio_mode,
        incomingSettings.auto_play_audio
      ),
      hide_home_settings_button: Boolean(incomingSettings.hide_home_settings_button),
      panel_open_mode: normalizePanelOpenMode(incomingSettings.popover_open_panel_mode),
      definition_language_mode: normalizeDefinitionLanguageMode(incomingSettings.popover_definition_language_mode),
    };
    const incomingAddonVersion = normalizeAddonVersion(
      data.addon_version || settingsState.addon_version || window.__aplAddonVersion
    );
    pushDebug(
      "settings_state recv src=" +
        incomingState.source_language +
        " tgt=" +
        incomingState.target_language +
        " mode=" +
        incomingState.trigger_mode +
        " shortcut=" +
        incomingState.shortcut_combo +
        " autoPlayMode=" +
        incomingState.auto_play_audio_mode +
        " hideSettingsButton=" +
        String(incomingState.hide_home_settings_button) +
        " panelMode=" +
        incomingState.panel_open_mode +
        " definitionMode=" +
        incomingState.definition_language_mode
    );

    if (settingsSaveGuardSnapshot && nowTs <= settingsSaveGuardUntil) {
      const mismatch =
        incomingState.source_language !== settingsSaveGuardSnapshot.source_language ||
        incomingState.target_language !== settingsSaveGuardSnapshot.target_language ||
        incomingState.trigger_mode !== settingsSaveGuardSnapshot.trigger_mode ||
        incomingState.shortcut_combo !== settingsSaveGuardSnapshot.shortcut_combo ||
        incomingState.auto_play_audio_mode !== settingsSaveGuardSnapshot.auto_play_audio_mode ||
        incomingState.hide_home_settings_button !== settingsSaveGuardSnapshot.hide_home_settings_button ||
        incomingState.panel_open_mode !== settingsSaveGuardSnapshot.panel_open_mode ||
        incomingState.definition_language_mode !== settingsSaveGuardSnapshot.definition_language_mode;

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
      auto_play_audio_mode: incomingState.auto_play_audio_mode,
      hide_home_settings_button: incomingState.hide_home_settings_button,
      panel_open_mode: incomingState.panel_open_mode,
      definition_language_mode: incomingState.definition_language_mode,
    };

    if (settingsState.popover.trigger_mode === "auto") {
      pendingSelectionAction = null;
    }

    settingsState.languages = {
      source_language: incomingState.source_language,
      target_language: incomingState.target_language,
    };
    settingsState.addon_version = incomingAddonVersion;

    settingsState.resources = {
      mode: "api_only",
      status_unknown: false,
    };

    settingsLoaded = true;
    applySettingsTriggerVisibility();

    const shouldRebuildSettingsModal =
      previousTargetLanguage !== settingsState.languages.target_language;

    if (settingsModalEl && !settingsModalEl.classList.contains("apl-settings-root--hidden")) {
      if (shouldRebuildSettingsModal) {
        renderSettingsModal();
      }
      syncSettingsFormIfOpen();
    } else if (settingsModalEl && shouldRebuildSettingsModal) {
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
        " autoPlayMode=" +
        settingsState.popover.auto_play_audio_mode +
        " hideSettingsButton=" +
        String(settingsState.popover.hide_home_settings_button) +
        " panelMode=" +
        settingsState.popover.panel_open_mode +
        " definitionMode=" +
        settingsState.popover.definition_language_mode
    );
    const payload = encodeURIComponent(
      JSON.stringify({
        enable_lookup: toolSettings.enable_lookup,
        enable_translate: toolSettings.enable_translate,
        enable_audio: toolSettings.enable_audio,
        auto_play_audio_mode: settingsState.popover.auto_play_audio_mode,
        auto_play_audio:
          normalizeAutoPlayAudioMode(settingsState.popover.auto_play_audio_mode) !==
          DEFAULT_AUTO_PLAY_AUDIO_MODE,
        hide_home_settings_button: settingsState.popover.hide_home_settings_button,
        popover_trigger_mode: settingsState.popover.trigger_mode,
        popover_shortcut: settingsState.popover.shortcut_combo,
        popover_open_panel_mode: settingsState.popover.panel_open_mode,
        popover_definition_language_mode: settingsState.popover.definition_language_mode,
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

    if (settingsState.popover.hide_home_settings_button) {
      settingsTriggerEl.style.display = "none";
      return;
    }

    settingsTriggerEl.style.display = "";
    settingsTriggerEl.classList.remove("apl-settings-trigger--hidden");
  }

  function hideSettingsTrigger() {
    if (!settingsTriggerEl) {
      return;
    }

    if (settingsState.popover.hide_home_settings_button) {
      settingsTriggerEl.style.display = "none";
      return;
    }

    settingsTriggerEl.classList.add("apl-settings-trigger--hidden");
  }

  function applySettingsTriggerVisibility() {
    if (!settingsTriggerEl) {
      return;
    }

    if (settingsState.popover.hide_home_settings_button) {
      settingsTriggerEl.style.display = "none";
      return;
    }

    settingsTriggerEl.style.display = "";
    if (!settingsTriggerBootVisibleDone) {
      runSettingsTriggerStartupVisibility();
      return;
    }

    showSettingsTrigger();
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
    if (settingsState.popover.hide_home_settings_button) {
      hideSettingsTrigger();
      return;
    }

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
    if (settingsState.popover.hide_home_settings_button) {
      hideSettingsTrigger();
      return;
    }

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

  function configureSettingsTriggerButton(button) {
    if (!button) {
      return;
    }

    button.setAttribute("aria-label", "Open DictOver settings");
    button.innerHTML =
      '<span class="apl-settings-trigger-text">DictOver</span>' +
      '<span class="apl-settings-trigger-icon" aria-hidden="true">&#9881;</span>';
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
      configureSettingsTriggerButton(settingsTriggerEl);
      for (let i = 1; i < existing.length; i += 1) {
        existing[i].remove();
      }
      runSettingsTriggerStartupVisibility();
      applySettingsTriggerVisibility();
      return;
    }

    const trigger = document.createElement("button");
    trigger.id = "apl-settings-trigger";
    trigger.className = "apl-settings-trigger";
    trigger.type = "button";
    configureSettingsTriggerButton(trigger);

    trigger.addEventListener("click", function () {
      openSettingsModal();
    });

    document.body.appendChild(trigger);
    settingsTriggerEl = trigger;
    runSettingsTriggerStartupVisibility();
    applySettingsTriggerVisibility();
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

  function normalizeAutoPlayAudioMode(value, legacyAutoPlayValue) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "word" || normalized === "all") {
      return normalized;
    }
    if (normalized === "off") {
      return DEFAULT_AUTO_PLAY_AUDIO_MODE;
    }

    if (typeof legacyAutoPlayValue === "boolean") {
      return legacyAutoPlayValue ? "all" : DEFAULT_AUTO_PLAY_AUDIO_MODE;
    }

    if (legacyAutoPlayValue !== null && typeof legacyAutoPlayValue !== "undefined") {
      const legacyAsText = String(legacyAutoPlayValue).trim().toLowerCase();
      if (legacyAsText === "1" || legacyAsText === "true" || legacyAsText === "yes" || legacyAsText === "on") {
        return "all";
      }
      if (legacyAsText === "0" || legacyAsText === "false" || legacyAsText === "no" || legacyAsText === "off") {
        return DEFAULT_AUTO_PLAY_AUDIO_MODE;
      }
    }

    return DEFAULT_AUTO_PLAY_AUDIO_MODE;
  }

  function autoPlayAudioModeChecked(mode) {
    return normalizeAutoPlayAudioMode(settingsState.popover.auto_play_audio_mode) === mode ? " checked" : "";
  }

  function normalizeAddonVersion(value) {
    const normalized = String(value || "").trim();
    return normalized || "unknown";
  }

  function normalizePanelOpenMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "details" || normalized === "images") {
      return normalized;
    }
    return DEFAULT_PANEL_OPEN_MODE;
  }

  function panelOpenModeChecked(mode) {
    return normalizePanelOpenMode(settingsState.popover.panel_open_mode) === mode ? " checked" : "";
  }

  function normalizeDefinitionLanguageMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "input" || normalized === "english") {
      return normalized;
    }
    return DEFAULT_DEFINITION_LANGUAGE_MODE;
  }

  function definitionLanguageModeChecked(mode) {
    return normalizeDefinitionLanguageMode(settingsState.popover.definition_language_mode) === mode ? " checked" : "";
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

  function resolveCopyByTargetLanguage(copyMap) {
    const rawLanguage = String(settingsState.languages.target_language || "en");
    if (copyMap[rawLanguage]) {
      return copyMap[rawLanguage];
    }

    const normalized = rawLanguage.toLowerCase();
    if (normalized.indexOf("zh") === 0 && copyMap["zh-CN"]) {
      return copyMap["zh-CN"];
    }
    if (normalized.indexOf("vi") === 0 && copyMap.vi) {
      return copyMap.vi;
    }
    if (normalized.indexOf("ja") === 0 && copyMap.ja) {
      return copyMap.ja;
    }
    if (normalized.indexOf("ko") === 0 && copyMap.ko) {
      return copyMap.ko;
    }
    if (normalized.indexOf("ru") === 0 && copyMap.ru) {
      return copyMap.ru;
    }
    if (normalized.indexOf("fi") === 0 && copyMap.fi) {
      return copyMap.fi;
    }
    if (normalized.indexOf("de") === 0 && copyMap.de) {
      return copyMap.de;
    }
    if (normalized.indexOf("fr") === 0 && copyMap.fr) {
      return copyMap.fr;
    }

    return copyMap.en;
  }

  function getPanelModeUiCopy() {
    return resolveCopyByTargetLanguage(SETTINGS_PANEL_MODE_COPY);
  }

  function getDefinitionModeUiCopy() {
    return resolveCopyByTargetLanguage(SETTINGS_DEFINITION_MODE_COPY);
  }

  function renderSettingsModal() {
    if (!settingsModalEl) {
      return;
    }

    const uiCopy = getSettingsUiCopy();
    const panelCopy = getPanelModeUiCopy();
    const definitionCopy = getDefinitionModeUiCopy();
    const avatarUrl = escapeHtml(getAddonAssetUrl("assets/avt-cat.jpg"));
    const desktopIconUrl = escapeHtml(getAddonAssetUrl("assets/dictover-desktop.png"));
    const addonVersion = escapeHtml(normalizeAddonVersion(settingsState.addon_version));

    const errorHtml = settingsMessage
      ? '<div class="apl-settings-error">' + escapeHtml(settingsMessage) + "</div>"
      : "";

    const shortcutDisabledAttr =
      settingsState.popover.trigger_mode === "shortcut" ? "" : " disabled";

    settingsModalEl.innerHTML =
      '<div class="apl-settings-overlay" role="dialog" aria-modal="true">' +
      '<div class="apl-settings-modal">' +
      '<div class="apl-settings-header">' +
      '<div class="apl-settings-brand">' +
      '<a class="apl-settings-avatar-link" href="https://langochung.me" target="_blank" rel="noopener noreferrer" aria-label="Open langochung.me">' +
      '<img class="apl-settings-avatar" src="' +
      avatarUrl +
      '" alt="Cat avatar" />' +
      "</a>" +
      '<div class="apl-settings-brand-meta">' +
      '<a class="apl-settings-site-link" href="https://langochung.me" target="_blank" rel="noopener noreferrer">langochung.me</a>' +
      '<span class="apl-settings-version">DictOver v' + addonVersion + "</span>" +
      '<span class="apl-settings-support-note">&lt;- báo lỗi và yêu cầu feature qua chatbox icon con mèo</span>' +
      "</div>" +
      "</div>" +
      '<button class="apl-button apl-settings-close" type="button" aria-label="Close settings">✕</button>' +
      "</div>" +
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
      '<div class="apl-settings-panel-definition-layout">' +
      '<div class="apl-settings-panel-definition-column">' +
      '<div class="apl-settings-section-title">' +
      escapeHtml(panelCopy.title) +
      "</div>" +
      '<label class="apl-settings-radio"><input class="apl-settings-panel-open-mode" type="radio" name="apl-panel-open-mode" value="none"' +
      panelOpenModeChecked("none") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(panelCopy.none) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-panel-open-mode" type="radio" name="apl-panel-open-mode" value="details"' +
      panelOpenModeChecked("details") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(panelCopy.details) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-panel-open-mode" type="radio" name="apl-panel-open-mode" value="images"' +
      panelOpenModeChecked("images") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(panelCopy.images) +
      "</span>" +
      "</label>" +
      "</div>" +
      '<div class="apl-settings-panel-definition-column apl-settings-panel-definition-column--right">' +
      '<div class="apl-settings-section-title">' +
      escapeHtml(definitionCopy.title) +
      "</div>" +
      '<label class="apl-settings-radio"><input class="apl-settings-definition-language-mode" type="radio" name="apl-definition-language-mode" value="output"' +
      definitionLanguageModeChecked("output") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(definitionCopy.output) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-definition-language-mode" type="radio" name="apl-definition-language-mode" value="input"' +
      definitionLanguageModeChecked("input") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(definitionCopy.input) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-definition-language-mode" type="radio" name="apl-definition-language-mode" value="english"' +
      definitionLanguageModeChecked("english") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(definitionCopy.english) +
      "</span>" +
      "</label>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="apl-settings-section">' +
      '<div class="apl-settings-audio-home-layout">' +
      '<div class="apl-settings-audio-home-column">' +
      '<div class="apl-settings-section-title">' +
      escapeHtml(uiCopy.auto_play_audio_title) +
      "</div>" +
      '<label class="apl-settings-radio"><input class="apl-settings-auto-play-audio-mode" type="radio" name="apl-auto-play-audio-mode" value="off"' +
      autoPlayAudioModeChecked("off") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(uiCopy.auto_play_audio_mode_off) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-auto-play-audio-mode" type="radio" name="apl-auto-play-audio-mode" value="word"' +
      autoPlayAudioModeChecked("word") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(uiCopy.auto_play_audio_mode_word) +
      "</span>" +
      "</label>" +
      '<label class="apl-settings-radio"><input class="apl-settings-auto-play-audio-mode" type="radio" name="apl-auto-play-audio-mode" value="all"' +
      autoPlayAudioModeChecked("all") +
      '"><span class="apl-settings-radio-label">' +
      escapeHtml(uiCopy.auto_play_audio_mode_all) +
      "</span>" +
      "</label>" +
      "</div>" +
      '<div class="apl-settings-home-toggle-column">' +
      '<label class="apl-settings-toggle apl-settings-toggle--inline"><input class="apl-settings-hide-home-settings-button" type="checkbox"' +
      (settingsState.popover.hide_home_settings_button ? " checked" : "") +
      '"> ' +
      escapeHtml(uiCopy.hide_home_settings_button) +
      "</label>" +
      "</div>" +
      "</div>" +
      "</div>" +
      errorHtml +
      '<a class="apl-settings-desktop-link" href="https://dictover.langochung.me" target="_blank" rel="noopener noreferrer" aria-label="Open DictOver Desktop">' +
      '<img class="apl-settings-desktop-icon" src="' +
      desktopIconUrl +
      '" alt="DictOver Desktop" />' +
      "</a>" +
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
    const panelModeInput = settingsModalEl.querySelector(".apl-settings-panel-open-mode:checked");
    const autoPlayAudioModeInput = settingsModalEl.querySelector(
      ".apl-settings-auto-play-audio-mode:checked"
    );
    const definitionLanguageModeInput = settingsModalEl.querySelector(
      ".apl-settings-definition-language-mode:checked"
    );
    const hideHomeSettingsButtonInput = settingsModalEl.querySelector(
      ".apl-settings-hide-home-settings-button"
    );
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");

    const sourceLanguage = sourceSelect ? String(sourceSelect.value || "auto") : settingsState.languages.source_language;
    const targetLanguage = targetSelect ? String(targetSelect.value || "vi") : settingsState.languages.target_language;
    const triggerMode = triggerModeInput ? String(triggerModeInput.value || "auto") : settingsState.popover.trigger_mode;
    const panelOpenMode = panelModeInput
      ? normalizePanelOpenMode(panelModeInput.value)
      : normalizePanelOpenMode(settingsState.popover.panel_open_mode);
    const definitionLanguageMode = definitionLanguageModeInput
      ? normalizeDefinitionLanguageMode(definitionLanguageModeInput.value)
      : normalizeDefinitionLanguageMode(settingsState.popover.definition_language_mode);
    const shortcutCombo = normalizeShortcutCombo(shortcutInput ? shortcutInput.value : settingsState.popover.shortcut_combo);
    const autoPlayAudioMode = autoPlayAudioModeInput
      ? normalizeAutoPlayAudioMode(autoPlayAudioModeInput.value)
      : normalizeAutoPlayAudioMode(settingsState.popover.auto_play_audio_mode);
    const hideHomeSettingsButton = hideHomeSettingsButtonInput
      ? Boolean(hideHomeSettingsButtonInput.checked)
      : Boolean(settingsState.popover.hide_home_settings_button);

    return {
      source_language: sourceLanguage,
      target_language: targetLanguage,
      trigger_mode: triggerMode === "shortcut" ? "shortcut" : "auto",
      shortcut_combo: shortcutCombo,
      auto_play_audio_mode: autoPlayAudioMode,
      hide_home_settings_button: hideHomeSettingsButton,
      panel_open_mode: panelOpenMode,
      definition_language_mode: definitionLanguageMode,
    };
  }

  function applySettingsFormValues(nextValues) {
    settingsState.languages.source_language = nextValues.source_language;
    settingsState.languages.target_language = nextValues.target_language;
    settingsState.popover.trigger_mode = nextValues.trigger_mode;
    settingsState.popover.shortcut_combo = nextValues.shortcut_combo;
    settingsState.popover.auto_play_audio_mode = normalizeAutoPlayAudioMode(nextValues.auto_play_audio_mode);
    settingsState.popover.hide_home_settings_button = Boolean(nextValues.hide_home_settings_button);
    settingsState.popover.panel_open_mode = normalizePanelOpenMode(nextValues.panel_open_mode);
    settingsState.popover.definition_language_mode = normalizeDefinitionLanguageMode(
      nextValues.definition_language_mode
    );
  }

  function syncSettingsFormIfOpen() {
    if (!settingsModalEl || settingsModalEl.classList.contains("apl-settings-root--hidden")) {
      return false;
    }

    const sourceSelect = settingsModalEl.querySelector(".apl-settings-source-language");
    const targetSelect = settingsModalEl.querySelector(".apl-settings-target-language");
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");
    const hideHomeSettingsButtonInput = settingsModalEl.querySelector(
      ".apl-settings-hide-home-settings-button"
    );
    const autoPlayAudioModeInputs = settingsModalEl.querySelectorAll(
      ".apl-settings-auto-play-audio-mode"
    );
    const panelModeInputs = settingsModalEl.querySelectorAll(".apl-settings-panel-open-mode");
    const definitionLanguageModeInputs = settingsModalEl.querySelectorAll(
      ".apl-settings-definition-language-mode"
    );
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
    autoPlayAudioModeInputs.forEach(function (input) {
      input.checked =
        normalizeAutoPlayAudioMode(input.value) ===
        normalizeAutoPlayAudioMode(settingsState.popover.auto_play_audio_mode);
    });
    if (hideHomeSettingsButtonInput) {
      hideHomeSettingsButtonInput.checked = Boolean(settingsState.popover.hide_home_settings_button);
    }
    if (autoMode) {
      autoMode.checked = settingsState.popover.trigger_mode === "auto";
    }
    if (shortcutMode) {
      shortcutMode.checked = settingsState.popover.trigger_mode === "shortcut";
    }
    panelModeInputs.forEach(function (input) {
      input.checked = normalizePanelOpenMode(input.value) === normalizePanelOpenMode(settingsState.popover.panel_open_mode);
    });
    definitionLanguageModeInputs.forEach(function (input) {
      input.checked =
        normalizeDefinitionLanguageMode(input.value) ===
        normalizeDefinitionLanguageMode(settingsState.popover.definition_language_mode);
    });

    return true;
  }

  function bindSettingsActions() {
    const overlay = settingsModalEl.querySelector(".apl-settings-overlay");
    const closeButton = settingsModalEl.querySelector(".apl-settings-close");
    const sourceSelect = settingsModalEl.querySelector(".apl-settings-source-language");
    const targetSelect = settingsModalEl.querySelector(".apl-settings-target-language");
    const hideHomeSettingsButtonInput = settingsModalEl.querySelector(
      ".apl-settings-hide-home-settings-button"
    );
    const autoPlayAudioModeInputs = settingsModalEl.querySelectorAll(
      ".apl-settings-auto-play-audio-mode"
    );
    const swapButton = settingsModalEl.querySelector(".apl-settings-swap-languages");
    const triggerModeInputs = settingsModalEl.querySelectorAll(".apl-settings-trigger-mode");
    const panelModeInputs = settingsModalEl.querySelectorAll(".apl-settings-panel-open-mode");
    const definitionLanguageModeInputs = settingsModalEl.querySelectorAll(
      ".apl-settings-definition-language-mode"
    );
    const shortcutInput = settingsModalEl.querySelector(".apl-settings-shortcut-input");

    function persistSettingsNow() {
      const values = readSettingsFormValues();
      applySettingsFormValues(values);
      applySettingsTriggerVisibility();
      settingsSaveGuardSnapshot = {
        source_language: settingsState.languages.source_language,
        target_language: settingsState.languages.target_language,
        trigger_mode: settingsState.popover.trigger_mode,
        shortcut_combo: settingsState.popover.shortcut_combo,
        auto_play_audio_mode: settingsState.popover.auto_play_audio_mode,
        hide_home_settings_button: settingsState.popover.hide_home_settings_button,
        panel_open_mode: settingsState.popover.panel_open_mode,
        definition_language_mode: settingsState.popover.definition_language_mode,
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

    autoPlayAudioModeInputs.forEach(function (input) {
      input.addEventListener("change", persistSettingsNow);
    });

    if (hideHomeSettingsButtonInput) {
      hideHomeSettingsButtonInput.addEventListener("change", persistSettingsNow);
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
            " keep autoPlayMode=" +
            settingsState.popover.auto_play_audio_mode
        );
        persistSettingsNow();
      });
    });

    panelModeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        persistSettingsNow();
      });
    });

    definitionLanguageModeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
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
      "openSettingsModal autoPlayMode=" +
        settingsState.popover.auto_play_audio_mode
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
  window.addEventListener("scroll", handleGlobalScrollForPopover, true);

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
