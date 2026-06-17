const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile('ui/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: Window controls ----
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ---- IPC: Run automation ----
let isRunning = false;
let activeContexts = []; 

ipcMain.on('start-run', async (event, config) => {
  if (isRunning) return;
  isRunning = true;
  activeContexts = [];

  const { url, threads, headless, slowMo, timeout, proxyList, accountList, loginSelectors, outputFile, keepOpen } = config;

  const results = [];
  const sendLog = (msg, type = 'info') => {
    event.reply('log', { msg, type, time: new Date().toLocaleTimeString('vi-VN') });
  };

  sendLog(`Khởi động ${threads} luồng an toàn...`, 'success');
  if (proxyList && proxyList.length > 0)
    sendLog(`Proxy: ${proxyList.length} proxy — xoay vòng theo thread`, 'info');
  if (accountList && accountList.length > 0)
    sendLog(`Tài khoản: ${accountList.length} tài khoản — xoay vòng theo thread`, 'info');

  function parseProxy(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (/^(https?|socks[45]):\/\/.+@.+/.test(raw)) {
      const u = new URL(raw);
      const proxy = { server: `${u.protocol}//${u.host}` };
      if (u.username) proxy.username = decodeURIComponent(u.username);
      if (u.password) proxy.password = decodeURIComponent(u.password);
      return proxy;
    }
    if (/^(https?|socks[45]):\/\//.test(raw)) return { server: raw };
    const parts = raw.split(':');
    if (parts.length === 4) return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
    if (parts.length === 2) return { server: `http://${raw}` };
    return { server: raw };
  }

  const runThread = async (threadId) => {
    const userDataDir = path.join(__dirname, 'automation_profiles', `thread_${threadId}`);

    const launchOptions = {
      headless,
      slowMo,
      viewport: null, 
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized' 
      ],
      ignoreDefaultArgs: ['--enable-automation']
    };

    if (proxyList && proxyList.length > 0) {
      const raw = proxyList[(threadId - 1) % proxyList.length];
      const proxy = parseProxy(raw);
      if (proxy) { 
        launchOptions.proxy = proxy; 
        sendLog(`[Thread ${threadId}] Proxy: ${raw}`); 
      }
    }

    const account = (accountList && accountList.length > 0)
      ? accountList[(threadId - 1) % accountList.length]
      : null;
    if (account) sendLog(`[Thread ${threadId}] Account: ${account.username}`);

    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      activeContexts.push(context);
      
      const pageGarena = context.pages()[0] || await context.newPage();
      const delayRand = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));

      sendLog(`[Thread ${threadId}] Mở ${url}...`);
      await pageGarena.goto(url, { timeout, waitUntil: 'networkidle' });

      // ── KIỂM TRA SESSION CŨ DÀNH RIÊNG CHO GARENA ──
      if (url.includes('garena.com')) {
        let currentUrl = pageGarena.url();
        if (!currentUrl.includes('universal/login') && currentUrl.includes('garena.com')) {
            sendLog(`[Thread ${threadId}] ⚠️ Session cũ đang đăng nhập sẵn! Tiến hành dọn dẹp...`);
            
            // CẬP NHẬT: Thay đổi selector dọn dẹp ban đầu sang class chuẩn
            const dangXuatKhuVucCu = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();
            try {
                await dangXuatKhuVucCu.waitFor({ state: 'visible', timeout: 5000 });
                await dangXuatKhuVucCu.hover();
                await dangXuatKhuVucCu.click({ delay: 100 });
                sendLog(`[Thread ${threadId}] 🚪 Đã chủ động đăng xuất tài khoản cũ kẹt lại.`);
                await delayRand(3000, 5000);
                
                sendLog(`[Thread ${threadId}] 🔄 Tải lại trang Login chuẩn...`);
                await pageGarena.goto(url, { timeout, waitUntil: 'networkidle' });
            } catch (errClose) {
                sendLog(`[Thread ${threadId}] ❌ Không đăng xuất được bằng UI, tiến hành xóa cứng cookie...`);
                await context.clearCookies(); 
                await pageGarena.goto(url, { timeout, waitUntil: 'networkidle' });
            }
        }

        const title = await pageGarena.title();
        sendLog(`[Thread ${threadId}] ✅ Màn hình Login đã sẵn sàng! Title: "${title}"`);
      }

      // ── Điền form đăng nhập giả lập hành vi con người ──
      if (account && loginSelectors && (loginSelectors.username || loginSelectors.password)) {
        const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

        if (loginSelectors.username && account.username) {
          await pageGarena.waitForSelector(loginSelectors.username, { timeout: 10000 });
          await pageGarena.locator(loginSelectors.username).click({ delay: rand(80, 200) });
          await pageGarena.waitForTimeout(rand(200, 500));
          
          await pageGarena.locator(loginSelectors.username).pressSequentially(account.username, {
            delay: rand(80, 180) 
          });
          sendLog(`[Thread ${threadId}] Đã điền username: ${account.username}`);
        }
        
        await pageGarena.waitForTimeout(rand(1000, 2200));
        
        if (loginSelectors.password && account.password) {
          await pageGarena.waitForSelector(loginSelectors.password, { timeout: 10000 });
          await pageGarena.locator(loginSelectors.password).click({ delay: rand(80, 200) });
          await pageGarena.waitForTimeout(rand(200, 400));
          
          await pageGarena.locator(loginSelectors.password).pressSequentially(account.password, {
            delay: rand(100, 250) 
          });
          sendLog(`[Thread ${threadId}] Đã điền password`);
        }
        
        if (loginSelectors.submit) {
          await pageGarena.waitForTimeout(rand(800, 1800)); 
          
          await pageGarena.locator(loginSelectors.submit).hover();
          await pageGarena.waitForTimeout(rand(150, 400));
          
          await pageGarena.locator(loginSelectors.submit).click({ delay: rand(100, 200) });
          sendLog(`[Thread ${threadId}] Đã click Submit`);
          await pageGarena.waitForTimeout(rand(4000, 6000)); 
        }
      }

      // ── TIẾN TRÌNH XỬ LÝ CHUYỂN ĐỔI THÔNG TIN GARENA ──
      if (url.includes('garena.com')) {
        const emailUser = account ? account.email : '';
        const emailPass = account ? account.apppassword : '';
        const garenaPass = account ? account.password : '';
        
        // ── 2. CHUYỂN TRANG BẢO MẬT & CLICK THAY ĐỔI MẬT KHẨU ──
        const securityUrl = 'https://account.garena.com/security';
        sendLog(`[Thread ${threadId}] 🔄 Chuyển sang trang Bảo mật...`);
        await pageGarena.goto(securityUrl, { timeout, waitUntil: 'networkidle' });
        await delayRand(1500, 3000);

        sendLog(`[Thread ${threadId}] 🔍 Tìm nút menu "Thay đổi Mật khẩu"...`);
        const changePasswordButton = pageGarena.locator("a.aside-nav__link:has-text('Thay đổi')").first();

        try {
            await changePasswordButton.waitFor({ state: 'visible', timeout: 10000 });
            await changePasswordButton.hover();
            await delayRand(300, 700);
            await changePasswordButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
            sendLog(`[Thread ${threadId}] 🎉 Đã click nút menu "Thay đổi Mật khẩu"!`);
            await delayRand(4000, 6000);
        } catch (err) {
            sendLog(`[Thread ${threadId}] ⚠️ Không thấy nút menu "Thay đổi Mật khẩu".`);
        }

        // ── 3. BẤM NÚT LẤY MÃ TRÊN GARENA (ĐÃ UPDATE CLICK THEO ID) ──
        sendLog(`[Thread ${threadId}] 🔍 Định vị chính xác ID '#J-getotp-trigger'...`);
        const layMaButton = pageGarena.locator('#J-getotp-trigger').first();
        
        await layMaButton.waitFor({ state: 'visible', timeout: 10000 });
        await layMaButton.hover();
        await delayRand(300, 600);
        
        await layMaButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
        sendLog(`[Thread ${threadId}] 📩 Đã kích hoạt bấm nút "Lấy mã" chuẩn xác qua ID.`);
        await delayRand(2000, 3000);

        // ── 4. MỞ TAB MỚI TRUY CẬP UNLIMITMAIL ──
        sendLog(`[Thread ${threadId}] 🌐 Đang mở Tab mới để vào Unlimitmail...`);
        const pageMail = await context.newPage();
        await pageMail.goto('https://unlimitmail.com/en/email', { timeout, waitUntil: 'networkidle' });
        await delayRand(2000, 4000);

        const rawMailInput = `${emailUser}|${emailPass}`;
        sendLog(`[Thread ${threadId}] 📬 Điền thông tin vào ô qcList...`);
        await pageMail.waitForSelector('#qcList', { timeout: 15000 });
        await pageMail.locator('#qcList').click();
        await delayRand(300, 600);
        
        await pageMail.locator('#qcList').fill(rawMailInput);
        await delayRand(800, 1500);

        sendLog(`[Thread ${threadId}] 🚀 Bấm Submit Mail...`);
        await pageMail.waitForSelector('#qcSubmit', { timeout: 10000 });
        await pageMail.locator('#qcSubmit').click({ delay: Math.floor(Math.random() * 100) + 50 });

        sendLog(`[Thread ${threadId}] ⏳ Chờ 10 giây hòm thư Unlimitmail đồng bộ nhận OTP...`);
        await delayRand(8000, 12000);

        // ── 5. CÀO MÃ OTP THỰC TẾ & KIỂM TRA ĐIỀU KIỆN 8 SỐ ──
        sendLog(`[Thread ${threadId}] 🔍 Đang trích xuất mã OTP từ class code-cell...`);
        await pageMail.waitForSelector('.code-cell', { timeout: 15000 });
        
        let otpCode = await pageMail.locator('.code-cell').innerText();
        otpCode = otpCode.trim();

        if (!otpCode || !/^\d{8}$/.test(otpCode)) {
            throw new Error(`Không lấy được mã OTP hợp lệ (Yêu cầu hệ thống phải có 8 chữ số). Dữ liệu cào được: "${otpCode}"`);
        }

        sendLog(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`, 'success');
        await pageMail.close();

        // ── 6. QUAY LẠI TAB GARENA ĐỂ ĐIỀN OTP ──
        sendLog(`[Thread ${threadId}] 🔄 Quay lại Tab Garena để điền mã xác thực...`);
        const otpInputSelector = 'input[placeholder*="mã xác thực"], input[placeholder*="Mã xác thực"]';
        
        await pageGarena.waitForSelector(otpInputSelector, { timeout: 15000 });
        await pageGarena.locator(otpInputSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
        await delayRand(400, 800);

        await pageGarena.locator(otpInputSelector).pressSequentially(otpCode, { delay: Math.floor(Math.random() * 100) + 50 });
        await delayRand(1500, 2500);

        const xacNhanButton = pageGarena.getByRole('button', { name: 'XÁC NHẬN' }).first();
        await xacNhanButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
        sendLog(`[Thread ${threadId}] 🔥 Hoàn thành toàn bộ quy trình xác thực OTP!`);

        await delayRand(3000, 5000);
        sendLog(`[Thread ${threadId}] 🔐 Đang chờ màn hình đổi mật khẩu hiển thị...`);
        
        const newPasswordFromUI = config.newPasswordFromUI || "Matkhaumoi@2026"; 

        const currentPassSelector = 'input[placeholder="Mật khẩu hiện tại"]';
        const newPassSelector = '#J-form-newpwd';
        const confirmPassSelector = 'input[placeholder="Xác nhận Mật khẩu mới"]';

        await pageGarena.waitForSelector(currentPassSelector, { timeout: 15000 });
        await delayRand(1000, 2000);

        sendLog(`[Thread ${threadId}] ⌨️ Đang nhập mật khẩu hiện tại...`);
        await pageGarena.locator(currentPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
        await delayRand(300, 500);
        await pageGarena.locator(currentPassSelector).pressSequentially(garenaPass, { delay: Math.floor(Math.random() * 120) + 80 });
        await delayRand(1000, 2000);

        sendLog(`[Thread ${threadId}] ⌨️ Đang nhập mật khẩu mới...`);
        await pageGarena.locator(newPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
        await delayRand(300, 500);
        await pageGarena.locator(newPassSelector).pressSequentially(newPasswordFromUI, { delay: Math.floor(Math.random() * 150) + 100 });
        await delayRand(1000, 2000);

        sendLog(`[Thread ${threadId}] ⌨️ Đang xác nhận lại mật khẩu mới...`);
        await pageGarena.locator(confirmPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
        await delayRand(300, 500);
        await pageGarena.locator(confirmPassSelector).pressSequentially(newPasswordFromUI, { delay: Math.floor(Math.random() * 120) + 80 });

        await delayRand(1500, 3000);
        sendLog(`[Thread ${threadId}] 💾 Bấm nút "Thay đổi"...`);
        
        const thayDoiButton = pageGarena.getByRole('button', { name: 'Thay đổi' }).first();
        await thayDoiButton.hover();
        await delayRand(200, 500);
        await thayDoiButton.click({ delay: Math.floor(Math.random() * 100) + 50 });

        sendLog(`[Thread ${threadId}] 🎉 Đã hoàn tất quá trình đổi mật khẩu!`);
        await delayRand(8000, 10000);
        
        const currentUrlAfterChange = pageGarena.url();
        if (!currentUrlAfterChange.includes('https://account.garena.com/security') && currentUrlAfterChange.includes('garena.com')) {
          sendLog(`[Thread ${threadId}] 🔄 Trình duyệt tự chuyển hướng về: ${currentUrlAfterChange}`);
        } else {
          sendLog(`[Thread ${threadId}] 🔄 Chủ động chuyển hướng về trang chủ account.garena.com...`);
          await pageGarena.goto('https://account.garena.com/', { timeout, waitUntil: 'networkidle' });
        }
        
        // CẬP NHẬT: Thay đổi selector đăng xuất UI ở luồng chính sang class chuẩn đích danh
        sendLog(`[Thread ${threadId}] 🔍 Đang tìm nút "Đăng xuất" qua class chuẩn...`);
        const dangXuatButton = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();
        
        await dangXuatButton.waitFor({ state: 'visible', timeout: 15000 });
        await dangXuatButton.hover();
        await delayRand(300, 700);
        
        await dangXuatButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
        sendLog(`[Thread ${threadId}] 🚪 Đã click nút "Đăng xuất" thành công.`, 'success');

        sendLog(`[Thread ${threadId}] ⏳ Đang dọn dẹp phiên làm việc (Chờ 3-5s)...`);
        await delayRand(3000, 5000);

        sendLog(`[Thread ${threadId}] ✨ Hoàn thành 1 chu kỳ xử lý tài khoản thành công!`, 'success');
      }

      const title = await pageGarena.title();
      const result = {
        thread: threadId, url, title, status: 'SUCCESS',
        account: account ? account.username : '',
        time: new Date().toLocaleString('vi-VN'),
      };
      results.push(result);
      sendLog(`[Thread ${threadId}] OK — "${title}"`, 'success');
      event.reply('thread-done', { threadId, status: 'success' });
    } catch (err) {
      const result = {
        thread: threadId, url, status: 'FAILED', error: err.message,
        account: account ? account.username : '',
        time: new Date().toLocaleString('vi-VN'),
      };
      results.push(result);
      sendLog(`[Thread ${threadId}] FAILED — ${err.message}`, 'error');
      event.reply('thread-done', { threadId, status: 'error' });
    } finally {
      if (!keepOpen) {
        if (context) await context.close();
        activeContexts = activeContexts.filter(c => c !== context);
        sendLog(`[Thread ${threadId}] Đóng.`);
      } else {
        sendLog(`[Thread ${threadId}] Giữ trình duyệt mở.`);
      }
    }
  };

  const tasks = Array.from({ length: threads }, (_, i) => runThread(i + 1));
  await Promise.allSettled(tasks);

  if (outputFile) {
    const lines = results.map(r =>
      r.status === 'SUCCESS'
        ? `[${r.time}] Thread ${r.thread} | ✅ SUCCESS | ${r.url} | Title: ${r.title}`
        : `[${r.time}] Thread ${r.thread} | ❌ FAILED  | ${r.url} | Error: ${r.error}`
    );
    const content = `=== KẾT QUẢ CHẠY - ${new Date().toLocaleString('vi-VN')} ===\n\n` + lines.join('\n') + '\n';
    fs.writeFileSync(outputFile, content, 'utf8');
    sendLog(`Xuất kết quả → ${outputFile}`, 'success');
  }

  const success = results.filter(r => r.status === 'SUCCESS').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  sendLog(`Hoàn thành — Thành công: ${success} | Thất bại: ${failed}`, 'success');

  isRunning = false;
  event.reply('run-done', { success, failed, results });
});

ipcMain.on('stop-run', async () => {
  for (const context of activeContexts) {
    try { await context.close(); } catch {}
  }
  activeContexts = [];
  isRunning = false;
  if (mainWindow) mainWindow.webContents.send('log', { msg: 'Đã dừng tất cả luồng.', type: 'warning', time: new Date().toLocaleTimeString('vi-VN') });
  if (mainWindow) mainWindow.webContents.send('run-done', { stopped: true });
});