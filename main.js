const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { createCursor } = require("ghost-cursor");
const fs = require('fs');
const { solveSimpleSlider } = require('./autoSlider');


function getBrowserExecutablePath() {
  try {
    const isPackaged = app.isPackaged;
    const browsersPath = isPackaged
      ? path.join(process.resourcesPath, 'playwright-browsers')
      : path.join(__dirname, 'playwright-browsers ');

    if (fs.existsSync(browsersPath)) {
      const dirs = fs.readdirSync(browsersPath);
      const chromiumDir = dirs.find(d => d.startsWith('chromium-'));
      if (chromiumDir) {
        const bundledPath64 = path.join(browsersPath, chromiumDir, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(bundledPath64)) return bundledPath64;

        const bundledPath = path.join(browsersPath, chromiumDir, 'chrome-win', 'chrome.exe');
        if (fs.existsSync(bundledPath)) return bundledPath;
      }
    }
  } catch (e) {
    console.error('Error finding bundled browser:', e);
  }

  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

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

  const { url, threads, headless, slowMo, timeout, proxyList, accountList, loginSelectors, outputDir, keepOpen } = config;

  if (outputDir) {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(path.join(outputDir, 'success.txt'), '', 'utf8');
      fs.writeFileSync(path.join(outputDir, 'error.txt'), '', 'utf8');
    } catch (e) {
      console.error('Error creating output dir:', e);
    }
  }

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

  function generateRandomPassword() {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const num = '0123456789';
    const special = '@';

    const length = Math.floor(Math.random() * (16 - 8 + 1)) + 8;

    let pwd = [
      lower[Math.floor(Math.random() * lower.length)],
      upper[Math.floor(Math.random() * upper.length)],
      num[Math.floor(Math.random() * num.length)],
      special
    ];

    const allChars = lower + upper + num + special;
    for (let i = pwd.length; i < length; i++) {
      pwd.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }

    for (let i = pwd.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }

    return pwd.join('');
  }

  const queue = accountList ? [...accountList] : [];
  let processedCount = 0;

  const runThread = async (threadId) => {
    const staggerDelay = (threadId - 1) * Math.floor(Math.random() * (6000 - 3000 + 1) + 3000);
    if (staggerDelay > 0) {
      sendLog(`[Thread ${threadId}] ⏳ Chờ giãn cách ${Math.round(staggerDelay / 1000)}s trước khi mở trình duyệt...`, 'info');
      await new Promise(res => setTimeout(res, staggerDelay));
    }

    while (queue.length > 0 && isRunning) {
      const account = queue.shift();
      if (!account) break;
      const currentIndex = processedCount++;

      const safeUsername = account.username ? account.username.replace(/[^a-z0-9]/gi, '_') : 'unknown';
      const userDataDir = path.join(app.getPath('userData'), 'automation_profiles', `profile_${safeUsername}`);
      const isNewProfile = !fs.existsSync(userDataDir);

      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      const fingerprintFile = path.join(userDataDir, 'fingerprint.json');
      let fp = {};
      if (fs.existsSync(fingerprintFile)) {
        try { fp = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8')); } catch (e) { }
      }

      if (!fp.userAgent) {
        const viewports = [
          { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1536, height: 864 },
          { width: 1920, height: 1080 }, { width: 2560, height: 1440 }
        ];
        const uas = [
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ];

        fp = {
          viewport: viewports[Math.floor(Math.random() * viewports.length)],
          userAgent: uas[Math.floor(Math.random() * uas.length)],
          hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
          deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
          canvasNoise: {
            r: Math.floor(Math.random() * 5), g: Math.floor(Math.random() * 5),
            b: Math.floor(Math.random() * 5), a: (Math.random() * 0.05).toFixed(3)
          }
        };
        fs.writeFileSync(fingerprintFile, JSON.stringify(fp, null, 2), 'utf8');
        sendLog(`[Thread ${threadId}] 🛡️ Tạo mới Fingerprint Ảo (Màn hình: ${fp.viewport.width}x${fp.viewport.height})`);
      } else {
        sendLog(`[Thread ${threadId}] 🛡️ Load lại Fingerprint cũ (Màn hình: ${fp.viewport.width}x${fp.viewport.height})`);
      }

      const browserPath = getBrowserExecutablePath();
      const launchOptions = {
        headless: false, // Bắt buộc chạy Headful theo đề xuất 4
        slowMo,
        executablePath: browserPath,
        viewport: null, // Để null để trình duyệt tự lấy size cửa sổ thực tế
        // Không set cứng userAgent để Chrome tự động khớp User-Agent với Sec-CH-UA (Client Hints)
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          `--window-size=${fp.viewport.width},${fp.viewport.height}`,
          '--disable-features=IsolateOrigins,site-per-process' // Hỗ trợ iframe Datadome
        ],
        ignoreDefaultArgs: ['--enable-automation']
      };

      if (proxyList && proxyList.length > 0) {
        const raw = proxyList[currentIndex % proxyList.length];
        const proxy = parseProxy(raw);
        if (proxy) {
          launchOptions.proxy = proxy;
          sendLog(`[Thread ${threadId}] Proxy: ${raw}`);
        }
      }

      sendLog(`[Thread ${threadId}] Account: ${account.username}`);

      let context;
      try {
        context = await chromium.launchPersistentContext(userDataDir, launchOptions);
        activeContexts.push(context);

        // Đã xóa addInitScript vì dùng Object.defineProperty đè phần cứng sẽ bị DataDome vạch trần ngay lập tức.
        
        const pageGarena = context.pages()[0] || await context.newPage();
        const delayRand = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));

        const safeGoto = async (pageObj, targetUrl, options, retries = 3) => {
          for (let i = 1; i <= retries; i++) {
            try {
              await pageObj.goto(targetUrl, options);
              return;
            } catch (err) {
              if (i === retries) throw err;
              sendLog(`[Thread ${threadId}] ⚠️ Lỗi tải trang (Lần ${i}): ${err.message}. Đang thử lại...`, 'warning');
              await delayRand(3000, 6000);
            }
          }
        };

        if (isNewProfile) {
          sendLog(`[Thread ${threadId}] 🆕 Profile MỚI: Bắt đầu quá trình nuôi 3-5 phút...`, 'warning');
          try {
            const warmUpTimeMs = Math.floor(Math.random() * (300000 - 180000 + 1)) + 180000;
            const startTime = Date.now();

            const sites = [
              'https://www.google.com', 'https://www.youtube.com', 'https://coccoc.com',
              'https://vnexpress.net', 'https://dantri.com.vn', 'https://tuoitre.vn',
              'https://thanhnien.vn', 'https://vietnamnet.vn', 'https://24h.com.vn',
              'https://kenh14.vn', 'https://vtv.vn', 'https://shopee.vn',
              'https://tiki.vn', 'https://www.lazada.vn', 'https://thegioididong.com',
              'https://cellphones.com.vn', 'https://tinhte.vn', 'https://fptshop.com.vn',
              'https://thethao247.vn', 'https://bongda24h.vn', 'https://zingmp3.vn',
              'https://www.reddit.com', 'https://medium.com'
            ];

            while (Date.now() - startTime < warmUpTimeMs) {
              const randomSite = sites[Math.floor(Math.random() * sites.length)];
              const timeRemaining = Math.round((warmUpTimeMs - (Date.now() - startTime)) / 1000);
              sendLog(`[Thread ${threadId}] 🏃 Đọc báo ${randomSite} (Còn ~${timeRemaining}s)...`);

              await pageGarena.goto(randomSite, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => { });

              await delayRand(5000, 15000);
              await pageGarena.evaluate(() => window.scrollBy(0, Math.random() * 1000 + 500)).catch(() => { });
              await delayRand(3000, 8000);
            }
            sendLog(`[Thread ${threadId}] ✅ Đã nuôi xong Profile mới!`, 'success');
          } catch (e) {
            sendLog(`[Thread ${threadId}] ⚠️ Lỗi trong quá trình nuôi (Bỏ qua)...`);
          }
        } else {
          sendLog(`[Thread ${threadId}] 🔄 Profile CŨ (Đã có Trust): Chỉ warm-up nhanh vài giây...`);
          try {
            await pageGarena.goto('https://www.google.com', { timeout: 15000, waitUntil: 'domcontentloaded' });
            await delayRand(1500, 3000);
          } catch (e) { }
        }

        sendLog(`[Thread ${threadId}] Mở ${url}...`);
        await safeGoto(pageGarena, url, { timeout, waitUntil: 'networkidle' });

        if (url.includes('garena.com')) {
          let currentUrl = pageGarena.url();
          if (!currentUrl.includes('universal/login') && currentUrl.includes('garena.com')) {
            sendLog(`[Thread ${threadId}] ⚠️ Session cũ đang đăng nhập sẵn! Tiến hành dọn dẹp...`);

            const dangXuatKhuVucCu = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();
            try {
              await dangXuatKhuVucCu.waitFor({ state: 'visible', timeout: 5000 });
              await dangXuatKhuVucCu.hover();
              await dangXuatKhuVucCu.click({ delay: 100 });
              sendLog(`[Thread ${threadId}] 🚪 Đã chủ động đăng xuất tài khoản cũ kẹt lại.`);
              await delayRand(3000, 5000);

              sendLog(`[Thread ${threadId}] 🔄 Tải lại trang Login chuẩn...`);
              await safeGoto(pageGarena, url, { timeout, waitUntil: 'networkidle' });
            } catch (errClose) {
              sendLog(`[Thread ${threadId}] ❌ Không đăng xuất được bằng UI, tiến hành xóa cứng cookie...`);
              await context.clearCookies();
              await safeGoto(pageGarena, url, { timeout, waitUntil: 'networkidle' });
            }
          }

          const title = await pageGarena.title();
          sendLog(`[Thread ${threadId}] ✅ Màn hình Login đã sẵn sàng! Title: "${title}"`);
        }

        if (account && loginSelectors && (loginSelectors.username || loginSelectors.password)) {
          const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

          let loginAttempts = 0;
          let loggedIn = false;

          while (loginAttempts < 2 && !loggedIn) {
            loginAttempts++;
            sendLog(`[Thread ${threadId}] Bắt đầu quy trình đăng nhập (Lần ${loginAttempts}/2)...`);

            if (loginSelectors.username && account.username) {
              await pageGarena.waitForSelector(loginSelectors.username, { timeout: 10000 });
              await pageGarena.locator(loginSelectors.username).click({ delay: rand(80, 200) });
              await pageGarena.waitForTimeout(rand(200, 400));

              await pageGarena.locator(loginSelectors.username).fill('');
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

              await pageGarena.locator(loginSelectors.password).fill('');
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
              await pageGarena.waitForTimeout(rand(2000, 4000));
            }

            // ── CẬP NHẬT: PHÁT HIỆN TẦNG SÂU DATADOME QUA TEXT HƯỚNG DẪN CHUẨN XÁC ──
            sendLog(`[Thread ${threadId}] 🔍 Đang quét kiểm tra hệ thống bảo mật DataDome...`);

            const captchaVisible = await Promise.any([
              pageGarena.waitForSelector('text="Slide right to secure your access"', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
              pageGarena.waitForSelector('text="Kéo sang phải"', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
              pageGarena.waitForSelector('div[class*="captcha"]', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
              pageGarena.waitForSelector('iframe', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
            ]);

            if (captchaVisible) {
              sendLog(`[Thread ${threadId}] ⚠️ Phát hiện cấu trúc Captcha đã hiển thị! Đang xử lý kéo...`, 'warning');

              const autoSolved = await solveSimpleSlider(pageGarena, sendLog, threadId);

              if (!autoSolved) {
                sendLog(`[Thread ${threadId}] ⚠️ Auto-Slider thất bại. Vui lòng TỰ GIẢI Captcha trên trình duyệt...`, 'warning');
                sendLog(`[Thread ${threadId}] ⏳ Đang chờ bạn giải captcha (tối đa 5 phút)...`, 'info');
                try {
                  // Chờ DataDome iframe biến mất (đúng cách) thay vì chờ text trong main frame
                  await pageGarena.waitForFunction(() => {
                    const frames = Array.from(document.querySelectorAll('iframe'));
                    const ddFrame = frames.find(f =>
                      f.src && (
                        f.src.includes('datadome') ||
                        f.src.includes('captcha-delivery') ||
                        f.src.includes('geo.captcha')
                      )
                    );
                    // Captcha đã giải xong nếu iframe biến mất hoặc ẩn đi
                    return !ddFrame || ddFrame.offsetParent === null || ddFrame.style.display === 'none';
                  }, { timeout: 300000 });
                  sendLog(`[Thread ${threadId}] ✅ Captcha đã được giải phóng. Tiến hành kiểm tra kết quả...`, 'info');
                  await pageGarena.waitForTimeout(3000);
                } catch (e) {
                  throw new Error("Hết thời gian chờ (5 phút) không thấy giải Captcha.");
                }
              } else {
                await pageGarena.waitForTimeout(2500);
              }
            } else {
              sendLog(`[Thread ${threadId}] Không dính Captcha ở lượt này.`);
            }

            // ── KIỂM TRA KẾT QUẢ ĐĂNG NHẬP CHỐNG VĂN NGƯỢC LOGIN ──
            sendLog(`[Thread ${threadId}] ⏳ Đang chờ hệ thống chuyển hướng và xác thực...`);
            try {
              await pageGarena.waitForURL(/account\.garena\.com/, { timeout: 12000 });
            } catch (e) { }

            await pageGarena.waitForTimeout(2500);

            let bodyText = await pageGarena.locator('body').innerText().catch(() => '');
            let urlNow = pageGarena.url();

            if (bodyText.toLowerCase().includes('captcha blocked') || bodyText.toLowerCase().includes('vui lòng tắt trình chặn quảng cáo')) {
                sendLog(`[Thread ${threadId}] ⚠️ Bị lỗi "CAPTCHA blocked" do Proxy. Tự động bypass: Click lại Đăng nhập...`, 'warning');
                
                if (loginSelectors.submit) {
                    // Bấm lại nút Đăng nhập lần 2 (Workaround)
                    await pageGarena.locator(loginSelectors.submit).hover();
                    await pageGarena.waitForTimeout(Math.floor(Math.random() * (400 - 150 + 1)) + 150);
                    await pageGarena.locator(loginSelectors.submit).click({ delay: Math.floor(Math.random() * (200 - 100 + 1)) + 100 });
                    
                    sendLog(`[Thread ${threadId}] Đã click Submit lần 2 để ép qua lỗi DNS. Đang chờ...`);
                    await pageGarena.waitForTimeout(Math.floor(Math.random() * (5000 - 3500 + 1)) + 3500); // Tăng thời gian chờ thêm 1 chút
                    
                    // Lấy lại dữ liệu trang mới sau khi click
                    bodyText = await pageGarena.locator('body').innerText().catch(() => '');
                    urlNow = pageGarena.url();
                }
            }

            const botKeywords = ['bất thường', 'phát hiện', 'suspicious', 'bị khóa', 'locked', 'khóa tài khoản'];
            const isBotDetected = botKeywords.some(kw => bodyText.toLowerCase().includes(kw));
            if (isBotDetected) {
              throw new Error("Tài khoản bị chặn / Màn hình báo Bot");
            }

            const isLoginStillVisible = await pageGarena.locator(loginSelectors.username).isVisible().catch(() => false);

            if (urlNow.includes('account.garena.com') && !isLoginStillVisible) {
              loggedIn = true;
              sendLog(`[Thread ${threadId}] 🎉 ĐĂNG NHẬP THÀNH CÔNG THỰC TẾ!`, 'success');
            } else {
              if (loginAttempts >= 2) {
                throw new Error(`Đăng nhập thất bại sau 2 lần thử (URL kẹt ở: ${urlNow})`);
              } else {
                sendLog(`[Thread ${threadId}] 🔄 Bị từ chối hoặc văng về trang Login. Đang làm sạch session để đăng nhập lại lần 2...`, 'warning');
                await context.clearCookies().catch(() => { });
                await safeGoto(pageGarena, url, { timeout, waitUntil: 'networkidle' });
                await pageGarena.waitForTimeout(3000);
              }
            }
          }
        }

        let generatedPassword = '';
        if (url.includes('garena.com')) {
          const emailUser = account ? account.email : '';
          const emailPass = account ? account.apppassword : '';
          const garenaPass = account ? account.password : '';

          const securityUrl = 'https://account.garena.com/security';
          sendLog(`[Thread ${threadId}] 🔄 Chuyển sang trang Bảo mật...`);
          await safeGoto(pageGarena, securityUrl, { timeout, waitUntil: 'networkidle' });
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
            throw new Error('Đăng nhập thất bại hoặc bị văng (Không tìm thấy nút Thay đổi Mật khẩu).');
          }

          const emailDomain = emailUser.split('@')[1]?.toLowerCase() || '';
          let previousLatestId = null;
          let pageMail = null;

          if (emailDomain === 'fviainboxes.com') {
            const emailPrefix = emailUser.split('@')[0];

            sendLog(`[Thread ${threadId}] 🌐 Mở tab fviainboxes.com để lấy cookie vượt Cloudflare...`);
            pageMail = await context.newPage();
            await safeGoto(pageMail, 'https://fviainboxes.com/', { timeout: 30000, waitUntil: 'domcontentloaded' });
            await delayRand(3000, 4000);

            try {
              const preListRes = await context.request.get(`https://fviainboxes.com/messages?username=${emailPrefix}&domain=fviainboxes.com&_=${Date.now()}`);
              const preListText = await preListRes.text();
              const preListData = JSON.parse(preListText);
              if (preListData && preListData.result && preListData.result.length > 0) {
                previousLatestId = preListData.result[0].id;
              }
            } catch (e) { }
          }

          sendLog(`[Thread ${threadId}] 🔍 Định vị chính xác ID '#J-getotp-trigger'...`);
          const layMaButton = pageGarena.locator('#J-getotp-trigger').first();

          await layMaButton.waitFor({ state: 'visible', timeout: 10000 });

          sendLog(`[Thread ${threadId}] 🖱️ Bắt đầu fake thao tác chuột bằng ghost-cursor...`);
          // Note: ghost-cursor được thiết kế cho Puppeteer, khi chạy với Playwright có thể cần truyền cursor builder riêng.
          // Để fix lỗi 'this.page.browser is not a function', ta truyền context thay vì page hoặc dùng cách truyền thống hơn nếu lỗi.
          let cursor;
          try {
              cursor = createCursor(pageGarena);
          } catch(e) {
              // Fallback nếu ghost-cursor không tương thích phiên bản Playwright hiện tại
              cursor = null;
          }
          await delayRand(400, 800);
          
          if (cursor) {
              await cursor.click('#J-getotp-trigger').catch(async () => {
                  await layMaButton.click({ delay: Math.floor(Math.random() * 120) + 80 });
              });
          } else {
               // Fake chuột thủ công nâng cao như phiên bản trước (Fallback)
              const box = await layMaButton.boundingBox();
              if (box) {
                  const startX = box.x - (Math.random() * 100 + 50);
                  const startY = box.y + (Math.random() * 50 - 25);
                  await pageGarena.mouse.move(startX, startY, { steps: 10 + Math.floor(Math.random() * 5) });
                  await delayRand(150, 300);
                  const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
                  const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
                  await pageGarena.mouse.move(targetX, targetY, { steps: 10 + Math.floor(Math.random() * 10) });
              } else {
                  await layMaButton.hover();
              }
              await delayRand(200, 400);
              await layMaButton.click({ delay: Math.floor(Math.random() * 100) + 80 });
          }
          sendLog(`[Thread ${threadId}] 📩 Đã kích hoạt bấm nút "Lấy mã" chuẩn xác qua ID.`);
          await delayRand(2000, 3000);

          let otpCode = '';

          if (emailDomain === 'otpgmail.com' || emailDomain === 'gmail.com') {
            sendLog(`[Thread ${threadId}] 🌐 Đang mở Tab mới để vào Unlimitmail...`);
            const pageMail = await context.newPage();
            await safeGoto(pageMail, 'https://unlimitmail.com/en/email', { timeout, waitUntil: 'networkidle' });
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

            sendLog(`[Thread ${threadId}] ⏳ Chờ 4-6s hòm thư Unlimitmail đồng bộ nhận OTP...`);
            await delayRand(4000, 6000);

            sendLog(`[Thread ${threadId}] 🔍 Đang trích xuất mã OTP từ class code-cell...`);
            await pageMail.waitForSelector('.code-cell', { timeout: 15000 });

            otpCode = await pageMail.locator('.code-cell').innerText();
            otpCode = otpCode.trim();

            if (!otpCode || !/^\d{8}$/.test(otpCode)) {
              throw new Error(`Không lấy được mã OTP hợp lệ (Yêu cầu hệ thống phải có 8 chữ số). Dữ liệu cào được: "${otpCode}"`);
            }

            sendLog(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`, 'success');
            await pageMail.close();
          } else if (emailDomain === 'fextemp.com') {
            sendLog(`[Thread ${threadId}] 🌐 Đang xử lý email fextemp.com qua tempmail.plus...`);
            const pageMail = await context.newPage();
            await safeGoto(pageMail, 'https://tempmail.plus/en/#!', { timeout, waitUntil: 'networkidle' });
            await delayRand(2000, 4000);

            const emailPrefix = emailUser.split('@')[0];

            sendLog(`[Thread ${threadId}] 📬 Điền prefix email vào ô pre_button...`);
            await pageMail.waitForSelector('#pre_button', { timeout: 15000 });
            await pageMail.locator('#pre_button').click({ delay: Math.floor(Math.random() * 100) + 50 });
            await delayRand(200, 400);
            await pageMail.locator('#pre_button').fill(emailPrefix);
            await delayRand(500, 1000);

            sendLog(`[Thread ${threadId}] 🖱 Bấm mở dropdown domain...`);
            await pageMail.locator('#domain').click({ delay: Math.floor(Math.random() * 100) + 50 });
            await delayRand(500, 1000);

            sendLog(`[Thread ${threadId}] 🖱 Tìm và chọn domain ${emailDomain}...`);
            const domainItem = pageMail.locator(`.dropdown-menu button:has-text("${emailDomain}")`).first();
            await domainItem.scrollIntoViewIfNeeded();
            await domainItem.click({ delay: Math.floor(Math.random() * 100) + 50 });
            await delayRand(2000, 4000);

            sendLog(`[Thread ${threadId}] ⏳ Chờ 8-10s để hộp thư đồng bộ...`);
            await delayRand(8000, 10000);

            sendLog(`[Thread ${threadId}] 🔍 Mở email đầu tiên trong inbox...`);
            await pageMail.waitForSelector('.inbox .mail', { timeout: 30000 });
            await pageMail.locator('.inbox .mail').first().click({ delay: Math.floor(Math.random() * 100) + 50 });

            sendLog(`[Thread ${threadId}] ⏳ Đợi 3-5s để nội dung email load...`);
            await delayRand(3000, 5000);

            sendLog(`[Thread ${threadId}] 🔍 Trích xuất mã OTP...`);
            await pageMail.waitForSelector('#info', { timeout: 15000 });
            const mailBodyText = await pageMail.locator('#info').innerText();
            const otpMatch = mailBodyText.match(/\b\d{8}\b/);

            if (!otpMatch) {
              throw new Error(`Không tìm thấy mã OTP hợp lệ trong nội dung thư Fextemp. Nội dung: "${mailBodyText.substring(0, 100)}..."`);
            }
            otpCode = otpMatch[0];

            sendLog(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`, 'success');
            await pageMail.close();
          } else if (emailDomain === 'fviainboxes.com') {
            sendLog(`[Thread ${threadId}] 🌐 Đang xử lý email fviainboxes.com (API Direct Mode)...`);
            const emailPrefix = emailUser.split('@')[0];

            sendLog(`[Thread ${threadId}] ⏳ Chờ 3-5s để Garena gửi email OTP...`);
            await delayRand(3000, 5000);

            let foundId = null;

            for (let i = 1; i <= 6; i++) {
              sendLog(`[Thread ${threadId}] 🔍 Lấy danh sách email qua API (Thử lần ${i})...`);
              const listRes = await context.request.get(`https://fviainboxes.com/messages?username=${emailPrefix}&domain=fviainboxes.com&_=${Date.now()}`);
              const listText = await listRes.text();

              try {
                const listData = JSON.parse(listText);
                if (listData && listData.result && listData.result.length > 0) {
                  const currentLatestId = listData.result[0].id;

                  let isNewMail = false;
                  if (previousLatestId !== null) {
                    isNewMail = (currentLatestId !== previousLatestId);
                  } else {
                    const ageInSeconds = Math.abs(Math.floor(Date.now() / 1000) - listData.result[0].createdAt);
                    isNewMail = (ageInSeconds < 120);
                  }

                  if (isNewMail) {
                    foundId = currentLatestId;
                    sendLog(`[Thread ${threadId}] ⚡ Đã thấy email MỚI TINH với ID: ${foundId}`);
                    break;
                  } else {
                    sendLog(`[Thread ${threadId}] ⚠️ Hộp thư chưa có mail mới (Vẫn là mail cũ). Đang đợi...`);
                  }
                }
              } catch (e) { }

              if (i < 6) {
                sendLog(`[Thread ${threadId}] ⏳ Chưa thấy email mới, chờ thêm 5s...`);
                await delayRand(5000, 7000);
              }
            }

            if (!foundId) {
              throw new Error('Timeout: Không nhận được email mã OTP từ fviainboxes');
            }

            sendLog(`[Thread ${threadId}] 🔍 Đang kéo nội dung email qua API...`);
            const msgRes = await context.request.get(`https://fviainboxes.com/message?username=${emailPrefix}&domain=fviainboxes.com&id=${foundId}`);
            const msgText = await msgRes.text();

            let plainText = msgText;
            try {
              const msgData = JSON.parse(msgText);
              let rawHtml = "";
              if (typeof msgData === 'string') {
                rawHtml = msgData;
              } else {
                rawHtml = msgData.html || msgData.body || msgData.content || msgText;
              }
              plainText = rawHtml.replace(/<[^>]*>?/gm, '');
            } catch (e) {
              plainText = msgText.replace(/<[^>]*>?/gm, '');
            }

            const otpMatch = plainText.match(/\b\d{8}\b/);

            if (!otpMatch) {
              if (pageMail) await pageMail.close().catch(() => { });
              throw new Error(`Không tìm thấy mã OTP hợp lệ trong thư. Nội dung: "${plainText.substring(0, 100)}..."`);
            }
            otpCode = otpMatch[0];

            sendLog(`[Thread ${threadId}] 🎫 Lấy OTP qua API thành công: [${otpCode}]`, 'success');
            if (pageMail) await pageMail.close().catch(() => { });
          } else {
            throw new Error(`Domain email không được hỗ trợ: ${emailDomain}`);
          }

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

          generatedPassword = generateRandomPassword();
          sendLog(`[Thread ${threadId}] 🔑 Mật khẩu mới được tạo tự động: ${generatedPassword}`, 'success');

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
          await pageGarena.locator(newPassSelector).pressSequentially(generatedPassword, { delay: Math.floor(Math.random() * 150) + 100 });
          await delayRand(1000, 2000);

          sendLog(`[Thread ${threadId}] ⌨️ Đang xác nhận lại mật khẩu mới...`);
          await pageGarena.locator(confirmPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
          await delayRand(300, 500);
          await pageGarena.locator(confirmPassSelector).pressSequentially(generatedPassword, { delay: Math.floor(Math.random() * 120) + 80 });

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
            await safeGoto(pageGarena, 'https://account.garena.com/', { timeout, waitUntil: 'networkidle' });
          }

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
        const finalTitle = generatedPassword ? `${title} (Pass mới: ${generatedPassword})` : title;
        const result = {
          thread: threadId, url, title: finalTitle, status: 'SUCCESS',
          account: account ? account.username : '',
          oldAccountStr: account ? `${account.username}|${account.password}|${account.email}|${account.apppassword}` : '',
          newAccountStr: account ? `${account.username}|${generatedPassword}|${account.email}|${account.apppassword}` : '',
          time: new Date().toLocaleString('vi-VN'),
        };
        results.push(result);

        if (outputDir) {
          if (result.status === 'SUCCESS' && result.newAccountStr) {
            try { fs.appendFileSync(path.join(outputDir, 'success.txt'), result.newAccountStr + '\n', 'utf8'); } catch (e) { }
          } else if (result.status === 'FAILED') {
            try { fs.appendFileSync(path.join(outputDir, 'error.txt'), (result.oldAccountStr || result.account) + '\n', 'utf8'); } catch (e) { }
          }
        }

        sendLog(`[Thread ${threadId}] OK — "${finalTitle}"`, 'success');
        event.reply('thread-done', { threadId, status: 'success' });
      } catch (err) {
        const result = {
          thread: threadId, url, status: 'FAILED', error: err.message,
          account: account ? account.username : '',
          oldAccountStr: account ? `${account.username}|${account.password}|${account.email}|${account.apppassword}` : '',
          time: new Date().toLocaleString('vi-VN'),
        };
        results.push(result);
        sendLog(`[Thread ${threadId}] FAILED — ${err.message}`, 'error');
        event.reply('thread-done', { threadId, status: 'error' });
      } finally {
        if (!keepOpen) {
          if (context) await context.close();
          activeContexts = activeContexts.filter(c => c !== context);
          sendLog(`[Thread ${threadId}] Đóng phiên của ${account.username}.`);
        } else {
          sendLog(`[Thread ${threadId}] Giữ trình duyệt mở.`);
        }
      }

      await new Promise(res => setTimeout(res, 2000));
    }
  };

  const tasks = Array.from({ length: Math.min(threads, accountList ? accountList.length : 1) }, (_, i) => runThread(i + 1));
  await Promise.allSettled(tasks);

  const success = results.filter(r => r.status === 'SUCCESS').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  sendLog(`Hoàn thành — Thành công: ${success} | Thất bại: ${failed}`, 'success');

  isRunning = false;
  event.reply('run-done', { success, failed, results });
});

ipcMain.on('stop-run', async () => {
  for (const context of activeContexts) {
    try { await context.close(); } catch { }
  }
  activeContexts = [];
  isRunning = false;
  if (mainWindow) mainWindow.webContents.send('log', { msg: 'Đã dừng tất cả luồng.', type: 'warning', time: new Date().toLocaleTimeString('vi-VN') });
  if (mainWindow) mainWindow.webContents.send('run-done', { stopped: true });
});

ipcMain.on('clear-profiles', (event) => {
  const profilesDir = path.join(app.getPath('userData'), 'automation_profiles');
  try {
    if (fs.existsSync(profilesDir)) {
      fs.rmSync(profilesDir, { recursive: true, force: true });
      event.reply('clear-profiles-done', { success: true, msg: `Đã xóa toàn bộ profiles tại:\n${profilesDir}` });
    } else {
      event.reply('clear-profiles-done', { success: true, msg: 'Không có profiles nào để xóa.' });
    }
  } catch (err) {
    event.reply('clear-profiles-done', { success: false, msg: `Lỗi khi xóa profiles: ${err.message}` });
  }
});