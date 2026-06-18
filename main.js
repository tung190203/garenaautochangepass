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

  if (outputFile) {
    try { fs.writeFileSync(outputFile, '', 'utf8'); } catch(e) {}
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
    
    const length = Math.floor(Math.random() * (16 - 8 + 1)) + 8; // 8 to 16
    
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
    
    // Shuffle array
    for (let i = pwd.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }
    
    return pwd.join('');
  }

  const runThread = async (threadId) => {
    // ── GIÃN CÁCH KHỞI ĐỘNG CÁC LUỒNG (Chống dính Captcha do spam request cùng 1 mili-giây) ──
    const staggerDelay = (threadId - 1) * Math.floor(Math.random() * (6000 - 3000 + 1) + 3000); // Mỗi luồng chờ từ 3s - 6s nhân lên
    if (staggerDelay > 0) {
      sendLog(`[Thread ${threadId}] ⏳ Chờ giãn cách ${Math.round(staggerDelay/1000)}s trước khi mở trình duyệt...`, 'info');
      await new Promise(res => setTimeout(res, staggerDelay));
    }

    const userDataDir = path.join(__dirname, 'automation_profiles', `thread_${threadId}`);
    const isNewProfile = !fs.existsSync(userDataDir);

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

      // ── BƯỚC WARM-UP (NUÔI THREAD TRÁNH CAPTCHA) ──
      if (isNewProfile) {
        sendLog(`[Thread ${threadId}] 🆕 Profile MỚI: Bắt đầu quá trình nuôi 3-5 phút...`, 'warning');
        try {
          const warmUpTimeMs = Math.floor(Math.random() * (300000 - 180000 + 1)) + 180000; // 180s - 300s (3 đến 5 phút)
          const startTime = Date.now();
          
          // DANH SÁCH LINK ĐÃ ĐƯỢC MỞ RỘNG (Đa dạng thể loại: Báo chí, TMĐT, Công nghệ, Giải trí)
          const sites = [
            // Công cụ tìm kiếm & Hệ sinh thái
            'https://www.google.com', 
            'https://www.youtube.com', 
            'https://coccoc.com',
            // Báo chí & Tin tức tổng hợp
            'https://vnexpress.net', 
            'https://dantri.com.vn', 
            'https://tuoitre.vn', 
            'https://thanhnien.vn', 
            'https://vietnamnet.vn', 
            'https://24h.com.vn', 
            'https://kenh14.vn',
            'https://vtv.vn',
            // Thương mại điện tử (Tạo cookie mua sắm tăng Trust rất tốt)
            'https://shopee.vn', 
            'https://tiki.vn', 
            'https://www.lazada.vn',
            // Công nghệ & Điện máy
            'https://thegioididong.com', 
            'https://cellphones.com.vn', 
            'https://tinhte.vn', 
            'https://fptshop.com.vn',
            // Thể thao & Giải trí
            'https://thethao247.vn', 
            'https://bongda24h.vn', 
            'https://zingmp3.vn',
            // Cộng đồng quốc tế phổ biến
            'https://www.reddit.com',
            'https://medium.com'
          ];
          
          while (Date.now() - startTime < warmUpTimeMs) {
            const randomSite = sites[Math.floor(Math.random() * sites.length)];
            const timeRemaining = Math.round((warmUpTimeMs - (Date.now() - startTime)) / 1000);
            sendLog(`[Thread ${threadId}] 🏃 Đọc báo ${randomSite} (Còn ~${timeRemaining}s)...`);
            
            // Truy cập trang web ngẫu nhiên
            await pageGarena.goto(randomSite, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
            
            // Giả lập hành vi người dùng: Đọc, Cuộn trang, Đọc tiếp
            await delayRand(5000, 15000); // Lướt đọc 5-15s
            await pageGarena.evaluate(() => window.scrollBy(0, Math.random() * 1000 + 500)).catch(() => {});
            await delayRand(3000, 8000); // Đọc tiếp sau khi scroll
          }
          sendLog(`[Thread ${threadId}] ✅ Đã nuôi xong Profile mới!`, 'success');
        } catch(e) {
          sendLog(`[Thread ${threadId}] ⚠️ Lỗi trong quá trình nuôi (Bỏ qua)...`);
        }
      } else {
        sendLog(`[Thread ${threadId}] 🔄 Profile CŨ (Đã có Trust): Chỉ warm-up nhanh vài giây...`);
        try {
          await pageGarena.goto('https://www.google.com', { timeout: 15000, waitUntil: 'domcontentloaded' });
          await delayRand(1500, 3000);
        } catch(e) {}
      }

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
      let generatedPassword = '';
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
        const emailDomain = emailUser.split('@')[1]?.toLowerCase() || '';
        let previousLatestId = null;
        let pageMail = null;

        if (emailDomain === 'fviainboxes.com') {
            const emailPrefix = emailUser.split('@')[0];
            
            sendLog(`[Thread ${threadId}] 🌐 Mở tab fviainboxes.com để lấy cookie vượt Cloudflare...`);
            pageMail = await context.newPage();
            await pageMail.goto('https://fviainboxes.com/', { timeout: 30000, waitUntil: 'domcontentloaded' });
            await delayRand(3000, 4000);
            
            try {
                const preListRes = await context.request.get(`https://fviainboxes.com/messages?username=${emailPrefix}&domain=fviainboxes.com&_=${Date.now()}`);
                const preListText = await preListRes.text();
                const preListData = JSON.parse(preListText);
                if (preListData && preListData.result && preListData.result.length > 0) {
                    previousLatestId = preListData.result[0].id;
                }
            } catch (e) {}
        }

        sendLog(`[Thread ${threadId}] 🔍 Định vị chính xác ID '#J-getotp-trigger'...`);
        const layMaButton = pageGarena.locator('#J-getotp-trigger').first();
        
        await layMaButton.waitFor({ state: 'visible', timeout: 10000 });
        await layMaButton.hover();
        await delayRand(300, 600);
        
        await layMaButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
        sendLog(`[Thread ${threadId}] 📩 Đã kích hoạt bấm nút "Lấy mã" chuẩn xác qua ID.`);
        await delayRand(2000, 3000);

        // ── 4. PHÂN NHÁNH LẤY OTP THEO DOMAIN ──
        let otpCode = '';

        if (emailDomain === 'otpgmail.com' || emailDomain === 'gmail.com') {
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
            await pageMail.goto('https://tempmail.plus/en/#!', { timeout, waitUntil: 'networkidle' });
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

            sendLog(`[Thread ${threadId}] ⏳ Chờ 10-15s để hộp thư đồng bộ...`);
            await delayRand(10000, 15000);
            
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
            let mailBodyText = "";
            
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
                            // Fallback: Nếu không lấy được mốc ID lúc nãy, dùng mốc thời gian < 120s
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
                } catch (e) {}

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
                plainText = rawHtml.replace(/<[^>]*>?/gm, ''); // Xóa toàn bộ thẻ HTML
            } catch (e) {
                plainText = msgText.replace(/<[^>]*>?/gm, '');
            }
            
            const otpMatch = plainText.match(/\b\d{8}\b/);

            if (!otpMatch) {
                if (pageMail) await pageMail.close().catch(()=>{});
                throw new Error(`Không tìm thấy mã OTP hợp lệ trong thư. Nội dung: "${plainText.substring(0, 100)}..."`);
            }
            otpCode = otpMatch[0];

            sendLog(`[Thread ${threadId}] 🎫 Lấy OTP qua API thành công: [${otpCode}]`, 'success');
            if (pageMail) await pageMail.close().catch(()=>{});
        } else {
            throw new Error(`Domain email không được hỗ trợ: ${emailDomain}`);
        }

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
      const finalTitle = generatedPassword ? `${title} (Pass mới: ${generatedPassword})` : title;
      const result = {
        thread: threadId, url, title: finalTitle, status: 'SUCCESS',
        account: account ? account.username : '',
        oldAccountStr: account ? `${account.username}|${account.password}|${account.email}|${account.apppassword}` : '',
        newAccountStr: account ? `${account.username}|${generatedPassword}|${account.email}|${account.apppassword}` : '',
        time: new Date().toLocaleString('vi-VN'),
      };
      results.push(result);
      
      if (outputFile && result.newAccountStr) {
        try { fs.appendFileSync(outputFile, result.newAccountStr + '\n', 'utf8'); } catch(e) {}
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
        sendLog(`[Thread ${threadId}] Đóng.`);
      } else {
        sendLog(`[Thread ${threadId}] Giữ trình duyệt mở.`);
      }
    }
  };

  const tasks = Array.from({ length: threads }, (_, i) => runThread(i + 1));
  await Promise.allSettled(tasks);

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