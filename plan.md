# Anki Popup Lookup — Context & Plan cho Claude Code

## Mục tiêu
Xây dựng một Anki Desktop add-on (Python) cho phép người dùng:
- **Double-click vào 1 từ** trong card → hiện popover gồm: định nghĩa, phiên âm, nút audio
- **Bôi đen nhiều từ / đoạn** → hiện popover chỉ có bản dịch tiếng Việt

---

## Kiến thức nền cần biết

### Anki Add-on là gì
- Là Python package, KHÔNG phải browser extension
- Anki Desktop được build bằng Python + PyQt6, add-on hook thẳng vào internal API
- Add-on được load từ thư mục `addons21/` trên máy user
- Entry point là `__init__.py`, Anki tự import khi khởi động
- Card render trong Chromium WebView → có thể inject HTML/CSS/JS vào card

### Cách Anki load add-on
```
addons21/
└── anki_popup_lookup/     ← tên thư mục = tên add-on
    ├── __init__.py         ← Anki import cái này đầu tiên
    └── manifest.json       ← metadata
```

### Hook quan trọng nhất
```python
from aqt import gui_hooks

# Inject JS vào mỗi card khi render
def on_card_show(output, card, context):
    output.body += "<script src='/_addons/anki_popup_lookup/web/popup.js'></script>"

gui_hooks.card_will_show.append(on_card_show)
```

### Giao tiếp Python ↔ JS
JS trong WebView không thể gọi Python trực tiếp. Dùng pycmd:
- JS gọi `pycmd("lookup:hello")` → Python bắt qua `gui_hooks.webview_did_receive_js_message`
- Python trả kết quả về JS bằng `mw.web.eval(f"updatePopover({json_data})")`

---

## API Stack (tất cả miễn phí)

| Chức năng | API / Lib | Online/Offline | Ghi chú |
|-----------|-----------|---------------|---------|
| Định nghĩa + phiên âm | `dictionaryapi.dev` | Online | Free, không cần API key, trả về đầy đủ |
| Audio phát âm | URL có sẵn trong response dictionaryapi.dev | Online | Hosted trên Google CDN |
| TTS fallback | `Web Speech API` (browser built-in) | Offline | Khi không có audio URL |
| Dịch đoạn | `argostranslate` (Python lib) | **Offline hoàn toàn** | Cài 1 lần ~100MB, không cần internet |

### dictionaryapi.dev response structure
```json
[{
  "word": "hello",
  "phonetic": "/həˈloʊ/",
  "phonetics": [{"text": "/həˈloʊ/", "audio": "https://...mp3"}],
  "meanings": [{
    "partOfSpeech": "noun",
    "definitions": [{"definition": "...", "example": "..."}]
  }]
}]
```

### Cài argostranslate
```python
# scripts/install_langpack.py — chạy 1 lần để cài EN→VI pack
import argostranslate.package
argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()
pkg = next(p for p in available if p.from_code == "en" and p.to_code == "vi")
argostranslate.package.install_from_path(pkg.download())
print("Done!")
```

---

## Kiến trúc thư mục — Feature-based

```
anki_popup_lookup/
│
├── manifest.json
├── config.json
│
├── __init__.py                    ← entry point, chỉ import + đăng ký hooks
│
├── features/
│   ├── lookup/
│   │   ├── __init__.py
│   │   ├── handler.py             ← nhận từ, gọi dictionary service, trả JSON về JS
│   │   └── parser.py              ← parse response từ dictionaryapi.dev
│   │
│   ├── translate/
│   │   ├── __init__.py
│   │   └── handler.py             ← nhận phrase, gọi argostranslate
│   │
│   └── audio/
│       ├── __init__.py
│       └── handler.py             ← trả audio URL, fallback về Web Speech API
│
├── services/
│   ├── dictionary_api.py          ← HTTP call tới dictionaryapi.dev
│   ├── translation_service.py     ← wrap argostranslate
│   └── tts_service.py
│
├── web/
│   ├── popup.js                   ← bắt mouseup, detect word vs phrase, gọi pycmd
│   ├── popup.css
│   └── popup.html                 ← template HTML của popover
│
├── scripts/
│   ├── verify.py                  ← verification script (xem phần cuối)
│   └── install_langpack.py        ← cài EN→VI language pack cho argostranslate
│
└── tests/
    ├── test_lookup.py
    ├── test_translate.py
    ├── test_parser.py
    └── mock_responses/
        ├── word_hello.json
        └── word_serendipity.json
```

---

## GUI Spec

### Popover — tra từ đơn
```
┌─────────────────────────────────────┐
│  serendipity              [✕]       │
│  /ˌser.ənˈdɪp.ɪ.ti/   [🔊 Audio]  │
│ ─────────────────────────────────── │
│  noun                               │
│  The occurrence of events by        │
│  chance in a happy way.             │
│                                     │
│  Example: "A happy serendipity      │
│  brought them together."            │
└─────────────────────────────────────┘
```

### Popover — dịch đoạn
```
┌─────────────────────────────────────┐
│  Dịch                     [✕]       │
│ ─────────────────────────────────── │
│  "The quick brown fox..."           │
│                                     │
│  ➜ "Con cáo nhanh nhẹn..."          │
└─────────────────────────────────────┘
```

### Loading / Error
```
┌───────────────────────┐    ┌───────────────────────┐
│  serendipity   [✕]    │    │  xyz123        [✕]    │
│  ⏳ đang tra...        │    │  ⚠ Không tìm thấy    │
└───────────────────────┘    └───────────────────────┘
```

### Style requirements
- Popover xuất hiện gần vị trí con trỏ (dùng `mouseup` event để lấy tọa độ)
- Click ra ngoài → tự đóng
- Font nhỏ gọn, không che card
- CSS thuần, không dùng framework

---

## Logic chính

### popup.js
```javascript
document.addEventListener('mouseup', function(e) {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (!text) return;

  const wordCount = text.split(/\s+/).length;
  showPopover(e.clientX, e.clientY, { loading: true, word: text });

  if (wordCount === 1) {
    pycmd('lookup:' + text);
  } else {
    pycmd('translate:' + text);
  }
});

// Python gọi: mw.web.eval(f"updatePopover({json_data})")
function updatePopover(data) { /* render theo data.type: 'lookup' hoặc 'translate' */ }
```

### __init__.py
```python
from aqt import gui_hooks, mw
import json

def on_card_show(output, card, context):
    output.body += "<link rel='stylesheet' href='/_addons/anki_popup_lookup/web/popup.css'>"
    output.body += "<script src='/_addons/anki_popup_lookup/web/popup.js'></script>"

def on_js_message(handled, message, context):
    if message.startswith("lookup:"):
        word = message[7:]
        from features.lookup.handler import handle_lookup
        result = handle_lookup(word)
        mw.web.eval(f"updatePopover({json.dumps(result)})")
        return (True, None)

    if message.startswith("translate:"):
        phrase = message[10:]
        from features.translate.handler import handle_translate
        result = handle_translate(phrase)
        mw.web.eval(f"updatePopover({json.dumps(result)})")
        return (True, None)

    return handled

gui_hooks.card_will_show.append(on_card_show)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
```

### JSON format trả về JS

Lookup:
```json
{
  "type": "lookup",
  "word": "hello",
  "phonetic": "/həˈloʊ/",
  "audio_url": "https://...mp3",
  "meanings": [
    {
      "partOfSpeech": "exclamation",
      "definitions": [
        {"definition": "Used as a greeting.", "example": "Hello there!"}
      ]
    }
  ]
}
```

Translate:
```json
{
  "type": "translate",
  "original": "The quick brown fox",
  "translated": "Con cáo nhanh nhẹn"
}
```

Error:
```json
{
  "type": "error",
  "message": "Không tìm thấy từ này"
}
```

---

## manifest.json
```json
{
  "package": "anki_popup_lookup",
  "name": "Popup Lookup — Definition & Translation",
  "mod": 0,
  "min_point_version": 231000,
  "max_point_version": null,
  "conflicts": [],
  "tags": ["lookup", "dictionary", "translation"]
}
```

## config.json
```json
{
  "source_language": "en",
  "target_language": "vi",
  "show_example": true,
  "max_definitions": 3
}
```

---

## Hướng dẫn test local (cho user sau khi nhận file)

```bash
# Mac/Linux — symlink để dev không cần copy
ln -s /path/to/anki_popup_lookup \
  ~/Library/Application\ Support/Anki2/addons21/anki_popup_lookup

# Windows (cmd as Admin)
mklink /D "%APPDATA%\Anki2\addons21\anki_popup_lookup" "C:\dev\anki_popup_lookup"
```

Bật DevTools để debug JS — thêm vào `__init__.py`:
```python
import os
os.environ["QTWEBENGINE_REMOTE_DEBUGGING"] = "9222"
```
Sau đó mở Chrome → `chrome://inspect`

---

## PHẦN CUỐI: Verification Script

**Claude Code phải tạo `scripts/verify.py` và chạy nó sau khi build xong.**
**Tương đương "build check" của frontend — pass hết thì add-on sẵn sàng để user test thủ công.**

```python
#!/usr/bin/env python3
"""
verify.py — Chạy sau khi build xong để đảm bảo add-on hoạt động.
Tương đương `npm run build` kiểm tra không có lỗi trước khi ship.
"""
import os, sys, json, zipfile
import unittest.mock as mock

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []
warnings = []

def check(label, fn):
    try:
        fn()
        print(f"✅ {label}")
    except AssertionError as e:
        print(f"❌ {label}: {e}")
        errors.append(label)
    except Exception as e:
        print(f"⚠️  {label} (warning): {e}")
        warnings.append(label)

# 1. Cấu trúc file
def check_files():
    required = [
        "__init__.py", "manifest.json", "config.json",
        "features/lookup/__init__.py", "features/lookup/handler.py", "features/lookup/parser.py",
        "features/translate/__init__.py", "features/translate/handler.py",
        "services/dictionary_api.py", "services/translation_service.py",
        "web/popup.js", "web/popup.css",
        "scripts/install_langpack.py",
    ]
    missing = [f for f in required if not os.path.exists(os.path.join(base, f))]
    assert not missing, f"Thiếu: {missing}"

check("Cấu trúc file đầy đủ", check_files)

# 2. manifest.json
def check_manifest():
    with open(os.path.join(base, "manifest.json")) as f:
        m = json.load(f)
    for key in ["package", "name", "min_point_version"]:
        assert key in m, f"Thiếu key: {key}"

check("manifest.json hợp lệ", check_manifest)

# 3. dictionaryapi.dev (online)
def check_dictionary_api():
    import urllib.request
    url = "https://api.dictionaryapi.dev/api/v2/entries/en/hello"
    with urllib.request.urlopen(url, timeout=5) as r:
        data = json.loads(r.read())
    assert data[0]["word"] == "hello"
    assert "phonetics" in data[0]
    assert "meanings" in data[0]
    audio_urls = [p.get("audio") for p in data[0].get("phonetics", []) if p.get("audio")]
    assert len(audio_urls) > 0, "Không có audio URL trong response"

check("dictionaryapi.dev — định nghĩa + phiên âm + audio", check_dictionary_api)

# 4. Parser
def check_parser():
    sys.path.insert(0, base)
    # Mock aqt trước khi import
    sys.modules.setdefault('aqt', mock.MagicMock())
    sys.modules.setdefault('aqt.utils', mock.MagicMock())
    sys.modules.setdefault('anki', mock.MagicMock())

    from features.lookup.parser import parse_response
    mock_data = [{
        "word": "hello",
        "phonetic": "/həˈloʊ/",
        "phonetics": [{"text": "/həˈloʊ/", "audio": "https://example.com/hello.mp3"}],
        "meanings": [{"partOfSpeech": "exclamation",
                      "definitions": [{"definition": "Used as a greeting.", "example": "Hello!"}]}]
    }]
    result = parse_response(mock_data)
    assert result["word"] == "hello"
    assert result["phonetic"] == "/həˈloʊ/"
    assert result["audio_url"] == "https://example.com/hello.mp3"
    assert len(result["meanings"]) > 0

check("parser.py — parse response đúng format", check_parser)

# 5. argostranslate (offline)
def check_argos():
    import argostranslate.translate
    result = argostranslate.translate.translate("Hello", "en", "vi")
    assert isinstance(result, str) and len(result) > 0

check("argostranslate — dịch offline EN→VI", check_argos)

# 6. Import tất cả module không crash
def check_imports():
    for mod in ['aqt', 'aqt.utils', 'anki']:
        sys.modules.setdefault(mod, mock.MagicMock())
    from features.lookup.handler import handle_lookup
    from features.translate.handler import handle_translate
    from services.dictionary_api import fetch_definition
    from services.translation_service import translate_text

check("Tất cả module import thành công", check_imports)

# 7. handle_lookup trả đúng format
def check_handle_lookup():
    for mod in ['aqt', 'aqt.utils', 'anki']:
        sys.modules.setdefault(mod, mock.MagicMock())

    with mock.patch('services.dictionary_api.fetch_definition') as mock_fetch:
        mock_fetch.return_value = [{
            "word": "test", "phonetic": "/tɛst/",
            "phonetics": [{"text": "/tɛst/", "audio": "https://example.com/test.mp3"}],
            "meanings": [{"partOfSpeech": "noun",
                          "definitions": [{"definition": "A procedure.", "example": "Run a test."}]}]
        }]
        from features.lookup.handler import handle_lookup
        result = handle_lookup("test")
    assert result["type"] == "lookup"
    assert result["word"] == "test"
    assert result["phonetic"] == "/tɛst/"
    assert result["audio_url"] != ""
    assert len(result["meanings"]) > 0

check("handle_lookup — trả về đúng JSON format", check_handle_lookup)

# 8. handle_translate trả đúng format
def check_handle_translate():
    for mod in ['aqt', 'aqt.utils', 'anki']:
        sys.modules.setdefault(mod, mock.MagicMock())

    with mock.patch('services.translation_service.translate_text') as mock_tr:
        mock_tr.return_value = "Xin chào thế giới"
        from features.translate.handler import handle_translate
        result = handle_translate("Hello world")
    assert result["type"] == "translate"
    assert result["original"] == "Hello world"
    assert result["translated"] == "Xin chào thế giới"

check("handle_translate — trả về đúng JSON format", check_handle_translate)

# 9. popup.js có đủ function
def check_popup_js():
    with open(os.path.join(base, "web/popup.js")) as f:
        js = f.read()
    for fn in ["mouseup", "pycmd", "updatePopover", "showPopover"]:
        assert fn in js, f"Thiếu '{fn}' trong popup.js"

check("popup.js — đủ các function cần thiết", check_popup_js)

# 10. Tạo .ankiaddon package
def build_package():
    output_path = os.path.join(os.path.dirname(base), "anki_popup_lookup.ankiaddon")
    exclude_dirs = {'tests', '__pycache__', '.git', 'scripts'}
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file.endswith('.pyc'):
                    continue
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, base)
                zf.write(filepath, arcname)
    assert os.path.exists(output_path)
    print(f"   → {output_path}")

check("Tạo file .ankiaddon thành công", build_package)

# Kết quả
print("\n" + "="*50)
if errors:
    print(f"❌ {len(errors)} lỗi cần fix: {errors}")
    sys.exit(1)
elif warnings:
    print(f"⚠️  Có {len(warnings)} warning (thường do offline hoặc chưa cài langpack)")
    print("✅ Add-on sẵn sàng để test thủ công")
else:
    print("✅ TẤT CẢ PASS — Add-on sẵn sàng để test thủ công")

print("""
Bước tiếp theo cho user:
1. Symlink hoặc copy thư mục vào addons21/
2. Chạy: python scripts/install_langpack.py  (cài EN→VI, 1 lần)
3. Restart Anki
4. Mở 1 card → double-click từ → popover hiện ra
5. Bôi đen đoạn → popover dịch hiện ra
""")
```

---

## Checklist cuối cho Claude Code

- [ ] Tạo đầy đủ tất cả file trong cây thư mục
- [ ] `__init__.py` đăng ký đủ 2 hooks: `card_will_show` và `webview_did_receive_js_message`
- [ ] `popup.js` phân biệt đúng word (1 từ) vs phrase (nhiều từ) qua `wordCount`
- [ ] `popup.js` có `updatePopover(data)` nhận JSON từ Python và render UI theo `data.type`
- [ ] `parser.py` xử lý graceful khi không có audio URL (trả `audio_url: ""`)
- [ ] `translate/handler.py` graceful fallback nếu argostranslate chưa có language pack
- [ ] Tạo `scripts/install_langpack.py`
- [ ] Tạo `scripts/verify.py` với đầy đủ 10 bước kiểm tra
- [ ] **Chạy `python scripts/verify.py`** — tất cả bước phải pass
- [ ] File `anki_popup_lookup.ankiaddon` được tạo ra ở thư mục cha