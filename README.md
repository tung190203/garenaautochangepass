# AutoTool Pro — Hướng dẫn sử dụng

## Yêu cầu hệ thống

| Thứ | Phiên bản |
|-----|-----------|
| Node.js | >= 18.x |
| npm | >= 9.x |

---

## Cài đặt lần đầu

```bash
# 1. Di chuyển vào thư mục project
cd changepassgarenatool

# 2. Cài dependencies
npm install

# 3. Cài Chromium cho Playwright (chỉ cần làm 1 lần)
npx playwright install chromium
```

---

## Chạy ở chế độ Development

```bash
npm start
```

> Lệnh này mở cửa sổ Electron ngay lập tức.  
> Khi chỉnh sửa file trong `ui/` (HTML, CSS, JS), nhấn **Ctrl+R** (hoặc **Cmd+R** trên Mac) trong cửa sổ app để reload lại giao diện.  
> Khi chỉnh sửa `main.js`, cần tắt app và chạy lại `npm start`.

### Bật DevTools (debug giao diện)

Mở file `main.js`, thêm dòng sau vào hàm `createWindow()`:

```js
mainWindow.webContents.openDevTools();
```

---

## Build thành file cài đặt

### Build cho macOS (`.dmg`)

```bash
npm run build:mac
```

Kết quả xuất ra thư mục `dist/`:
- `AutoTool Pro-1.0.0.dmg` — file cài đặt kéo thả vào Applications
- `AutoTool Pro-1.0.0-mac.zip` — bản portable

### Build cho Windows (`.exe`)

> **Lưu ý:** Build `.exe` từ macOS yêu cầu cài thêm Wine hoặc build trên máy Windows thực.

```bash
npm run build:win
```

Kết quả xuất ra thư mục `dist/`:
- `AutoTool Pro Setup 1.0.0.exe` — installer đầy đủ
- `AutoTool Pro 1.0.0.exe` — bản portable (không cần cài đặt)

### Build cả hai cùng lúc

```bash
npm run build:all
```

---

## Cấu trúc thư mục

```
changepassgarenatool/
│
├── main.js              ← Electron main process (backend logic)
│                           Xử lý: tạo cửa sổ, chạy Playwright, IPC
│
├── package.json         ← Cấu hình project, scripts, build config
│
├── ui/
│   ├── index.html       ← Giao diện chính
│   ├── style.css        ← CSS toàn bộ giao diện
│   └── renderer.js      ← Frontend JS (tương tác UI, gửi lệnh sang main)
│
├── assets/              ← Icon app (icon.png / icon.icns / icon.ico)
│
└── output/              ← File kết quả .txt xuất ra đây
```

---

## Luồng hoạt động

```
[renderer.js]  →  ipcRenderer.send('start-run', config)
                        ↓
[main.js]      →  ipcMain.on('start-run', ...)  →  Playwright chạy
                        ↓
[main.js]      →  event.reply('log', ...)        →  Hiển thị log
[main.js]      →  event.reply('thread-done', ...)→  Cập nhật thread pill
[main.js]      →  event.reply('run-done', ...)   →  Kết thúc
```

---

## Thêm logic tự động hóa

Mở file `main.js`, tìm đoạn comment và thêm code vào đó:

```js
// ---- Thêm logic xử lý của bạn vào đây ----
await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });

// Ví dụ: click một button
await page.click('#some-button');

// Ví dụ: điền form
await page.fill('#username', 'my_user');
await page.fill('#password', 'my_pass');
await page.click('[type="submit"]');

// Ví dụ: chờ phần tử xuất hiện
await page.waitForSelector('.success-message');

// Ví dụ: lấy text
const text = await page.textContent('.result');
sendLog(`[Thread ${threadId}] Kết quả: ${text}`, 'success');
```

---

## Thêm Proxy cho từng thread

Trong `main.js`, phần `launchOptions`, proxy đã được xử lý tự động từ cấu hình UI.  
Nếu muốn dùng proxy riêng cho từng thread (ví dụ mỗi thread 1 proxy), sửa hàm `runThread`:

```js
const proxyList = [
  'http://proxy1:port',
  'http://proxy2:port',
  'http://proxy3:port',
];

const runThread = async (threadId) => {
  const launchOptions = {
    headless,
    proxy: { server: proxyList[(threadId - 1) % proxyList.length] }
  };
  // ...
};
```

---

## Xuất kết quả

File `.txt` được xuất tự động vào `output/result.txt` (có thể đổi đường dẫn trong tab **Cấu hình**).

Định dạng mỗi dòng:
```
[dd/mm/yyyy, hh:mm:ss] T1 | SUCCESS | https://google.com | Google
[dd/mm/yyyy, hh:mm:ss] T2 | FAILED  | https://... | Error message
```

---

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|----------|
| `Cannot find module 'playwright'` | Chưa cài dependencies | Chạy `npm install` |
| `Executable doesn't exist` | Chưa cài Chromium | Chạy `npx playwright install chromium` |
| `Unsupported engine` khi build | Node.js quá cũ | Nâng cấp Node lên >= 18 |
| App bị blank khi mở | Đường dẫn `ui/index.html` sai | Kiểm tra `mainWindow.loadFile(...)` trong `main.js` |
