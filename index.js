const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { solveSimpleSlider } = require('./autoSlider');

// Đọc cấu hình từ UI (nếu có)
let sharedConfig = {};
try {
  sharedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared_config.json'), 'utf8'));
} catch (e) { }

// ===================== CẤU HÌNH =====================
const CONFIG = {
  TARGET_URL: 'https://sso.garena.com/universal/login?app_id=10100&redirect_uri=https%3A%2F%2Faccount.garena.com%2F&locale=vi-VN',
  THREADS: 1,
  HEADLESS: false,
  TIMEOUT: 40000,
};

// DANH SÁCH TÀI KHOẢN (Định dạng: username|password|email|mailpassword)
const ACCOUNT_LIST = [
  "taikhoanGarena1|matkhauGarena1|email_cua_ban@domain.com|mat_khau_mail_1",
];
// ====================================================

const delayRand = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));

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

async function runThread(threadId) {
  // ── 0. BÓC TÁCH THÔNG TIN TÀI KHOẢN ──
  const rawAccount = ACCOUNT_LIST[(threadId - 1) % ACCOUNT_LIST.length];
  if (!rawAccount) {
    console.log(`[Thread ${threadId}] ❌ Không tìm thấy dữ liệu tài khoản.`);
    return;
  }
  const [garenaUser, garenaPass, emailUser, emailPass] = rawAccount.split('|');

  const userDataDir = path.join(__dirname, 'garena_profiles', `user_thread_${threadId}`);
  const isNewProfile = !fs.existsSync(userDataDir);
  console.log(`[Thread ${threadId}] 🚀 Khởi tạo luồng cho tài khoản: ${garenaUser}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: CONFIG.HEADLESS,
    viewport: { width: 1366, height: 768 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.navigator.chrome = { runtime: {} };
  });

  const pageGarena = context.pages()[0] || await context.newPage();
  let generatedPassword = '';

  const safeGoto = async (pageObj, targetUrl, options, retries = 3) => {
    for (let i = 1; i <= retries; i++) {
      try {
        await pageObj.goto(targetUrl, options);
        return;
      } catch (err) {
        if (i === retries) throw err;
        console.log(`[Thread ${threadId}] ⚠️ Lỗi tải trang (Lần ${i}): ${err.message}. Đang thử lại...`);
        await delayRand(3000, 6000);
      }
    }
  };

  try {
    // ── BƯỚC WARM-UP (NUÔI THREAD TRÁNH CAPTCHA Y HỆT MAIN.JS) ──
    if (isNewProfile) {
      console.log(`[Thread ${threadId}] 🆕 Profile MỚI: Bắt đầu quá trình nuôi 3-5 phút...`);
      try {
        const warmUpTimeMs = Math.floor(Math.random() * (300000 - 180000 + 1)) + 180000;
        const startTime = Date.now();
        const sites = [
          'https://www.google.com', 'https://www.youtube.com', 'https://coccoc.com',
          'https://vnexpress.net', 'https://dantri.com.vn', 'https://tuoitre.vn',
          'https://thanhnien.vn', 'https://vietnamnet.vn', 'https://24h.com.vn',
          'https://shopee.vn', 'https://tiki.vn', 'https://www.lazada.vn',
          'https://thegioididong.com', 'https://cellphones.com.vn', 'https://tinhte.vn'
        ];

        while (Date.now() - startTime < warmUpTimeMs) {
          const randomSite = sites[Math.floor(Math.random() * sites.length)];
          const timeRemaining = Math.round((warmUpTimeMs - (Date.now() - startTime)) / 1000);
          console.log(`[Thread ${threadId}] 🏃 Đọc báo ${randomSite} (Còn ~${timeRemaining}s)...`);

          await pageGarena.goto(randomSite, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => { });
          await delayRand(5000, 15000);
          await pageGarena.evaluate(() => window.scrollBy(0, Math.random() * 1000 + 500)).catch(() => { });
          await delayRand(3000, 8000);
        }
        console.log(`[Thread ${threadId}] ✅ Đã nuôi xong Profile mới!`);
      } catch (e) {
        console.log(`[Thread ${threadId}] ⚠️ Lỗi trong quá trình nuôi (Bỏ qua)...`);
      }
    } else {
      console.log(`[Thread ${threadId}] 🔄 Profile CŨ (Đã có Trust): Chỉ warm-up nhanh vài giây...`);
      try {
        await pageGarena.goto('https://www.google.com', { timeout: 15000, waitUntil: 'domcontentloaded' });
        await delayRand(1500, 3000);
      } catch (e) { }
    }

    // ── 1. ĐĂNG NHẬP GARENA SSO & KIỂM TRA SESSION CŨ ──
    console.log(`[Thread ${threadId}] 🌐 Truy cập Garena SSO...`);
    await safeGoto(pageGarena, CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });

    let currentUrl = pageGarena.url();

    if (!currentUrl.includes('universal/login') && currentUrl.includes('garena.com')) {
      console.log(`[Thread ${threadId}] ⚠️ Phát hiện Session cũ đang đăng nhập sẵn! Tiến hành dọn dẹp...`);

      const dangXuatKhuVucCu = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();
      try {
        await dangXuatKhuVucCu.waitFor({ state: 'visible', timeout: 5000 });
        await dangXuatKhuVucCu.hover();
        await dangXuatKhuVucCu.click({ delay: 100 });
        console.log(`[Thread ${threadId}] 🚪 Đã chủ động đăng xuất tài khoản cũ kẹt lại.`);
        await delayRand(3000, 5000);

        console.log(`[Thread ${threadId}] 🔄 Tải lại trang Login chuẩn...`);
        await safeGoto(pageGarena, CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
      } catch (errClose) {
        console.log(`[Thread ${threadId}] ❌ Không click được Đăng xuất giao diện, tiến hành xóa cứng cookie...`);
        await context.clearCookies();
        await safeGoto(pageGarena, CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
      }
    }

    const title = await pageGarena.title();
    console.log(`[Thread ${threadId}] ✅ Màn hình Login đã sẵn sàng! Title: "${title}"`);

    const usernameSelector = 'input[type="text"]';
    const passwordSelector = 'input[type="password"]';

    let loginAttempts = 0;
    let loggedIn = false;

    while (loginAttempts < 2 && !loggedIn) {
      loginAttempts++;
      console.log(`[Thread ${threadId}] Bắt đầu quy trình đăng nhập (Lần ${loginAttempts}/2)...`);

      await pageGarena.waitForSelector(usernameSelector, { timeout: 10000 });
      await pageGarena.locator(usernameSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
      await delayRand(400, 800);

      console.log(`[Thread ${threadId}] Điền tài khoản...`);
      await pageGarena.locator(usernameSelector).fill('');
      await pageGarena.locator(usernameSelector).pressSequentially(garenaUser, { delay: Math.floor(Math.random() * 120) + 80 });
      await delayRand(1000, 2000);

      await pageGarena.waitForSelector(passwordSelector, { timeout: 10000 });
      await pageGarena.locator(passwordSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
      await delayRand(300, 600);

      console.log(`[Thread ${threadId}] Điền mật khẩu...`);
      await pageGarena.locator(passwordSelector).fill('');
      await pageGarena.locator(passwordSelector).pressSequentially(garenaPass, { delay: Math.floor(Math.random() * 150) + 100 });
      await delayRand(1500, 3000);

      console.log(`[Thread ${threadId}] 🔑 Bấm Đăng nhập...`);
      await pageGarena.locator(passwordSelector).press('Enter');
      await delayRand(2000, 4000);

      // ── ĐÃ ĐỒNG BỘ: CƠ CHẾ PHÁT HIỆN CAPTCHA DATADOME QUA TEXT HƯỚNG DẪN ──
      console.log(`[Thread ${threadId}] 🔍 Đang quét kiểm tra hệ thống bảo mật DataDome...`);

      const isCaptchaTextVisible = await Promise.any([
        pageGarena.waitForSelector('text="Slide right to secure your access"', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
        pageGarena.waitForSelector('text="Kéo sang phải"', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
        pageGarena.waitForSelector('div[class*="captcha"]', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false),
        pageGarena.waitForSelector('iframe', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
      ]);

      if (isCaptchaTextVisible) {
        console.log(`[Thread ${threadId}] ⚠️ Phát hiện Captcha DataDome xuất hiện! Đang gọi hàm tự động kéo...`);

        const sendLogWrapper = (msg) => console.log(msg);
        const autoSolved = await solveSimpleSlider(pageGarena, sendLogWrapper, threadId);

        if (!autoSolved) {
          console.log(`[Thread ${threadId}] ⚠️ Auto-Slider thất bại. Vui lòng TỰ GIẢI Captcha trên trình duyệt...`);
          try {
            await pageGarena.waitForSelector('text="Slide right to secure your access"', { state: 'hidden', timeout: 300000 });
            console.log(`[Thread ${threadId}] ✅ Khung bảo mật đã được giải phóng. Tiến hành kiểm tra kết quả...`);
            await pageGarena.waitForTimeout(3000);
          } catch (e) {
            throw new Error("Hết thời gian chờ (5 phút) không thấy giải Captcha.");
          }
        } else {
          await pageGarena.waitForTimeout(2500);
        }
      } else {
        console.log(`[Thread ${threadId}] Không dính Captcha ở lượt này.`);
      }

      // ── KIỂM TRA KẾT QUẢ ĐĂNG NHẬP CHẮC CHẮN TRÁNH VĂNG LOGIN ──
      console.log(`[Thread ${threadId}] ⏳ Chờ hệ thống xác thực tài khoản...`);
      try {
        await pageGarena.waitForURL(/account\.garena\.com/, { timeout: 12000 });
      } catch (e) { }

      await pageGarena.waitForTimeout(2500);

      const bodyText = await pageGarena.locator('body').innerText().catch(() => '');
      const urlNow = pageGarena.url();

      const botKeywords = ['bất thường', 'phát hiện', 'suspicious', 'bị khóa', 'locked', 'khóa tài khoản'];
      const isBotDetected = botKeywords.some(kw => bodyText.toLowerCase().includes(kw));
      if (isBotDetected) {
        throw new Error("Tài khoản bị chặn / Màn hình báo Bot");
      }

      const isLoginStillVisible = await pageGarena.locator(usernameSelector).isVisible().catch(() => false);

      if (urlNow.includes('account.garena.com') && !isLoginStillVisible) {
        loggedIn = true;
        console.log(`[Thread ${threadId}] 🎉 ĐĂNG NHẬP THÀNH CÔNG THỰC TẾ!`);
      } else {
        if (loginAttempts >= 2) {
          throw new Error(`Đăng nhập thất bại hoàn toàn sau 2 lần thử (URL kẹt: ${urlNow})`);
        } else {
          console.log(`[Thread ${threadId}] 🔄 Bị đẩy ngược về trang Login. Đang dọn dẹp cookie thử lại lần 2...`);
          await context.clearCookies().catch(() => { });
          await safeGoto(pageGarena, CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
          await pageGarena.waitForTimeout(3000);
        }
      }
    } // End of while loop

    // ── 2. CHUYỂN TRANG BẢO MẬT & CLICK Thay đổi Mật khẩu ──
    const securityUrl = 'https://account.garena.com/security';
    console.log(`[Thread ${threadId}] 🔄 Chuyển sang trang Bảo mật...`);
    await safeGoto(pageGarena, securityUrl, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
    await delayRand(1500, 3000);

    console.log(`[Thread ${threadId}] 🔍 Tìm nút menu "Thay đổi Mật khẩu"...`);
    const changePasswordButton = pageGarena.locator("a.aside-nav__link:has-text('Thay đổi')").first();

    try {
      await changePasswordButton.waitFor({ state: 'visible', timeout: 10000 });
      await changePasswordButton.hover();
      await delayRand(300, 700);
      await changePasswordButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
      console.log(`[Thread ${threadId}] 🎉 Đã click nút menu "Thay đổi Mật khẩu"!`);
      await delayRand(4000, 6000);
    } catch (err) {
      console.log(`[Thread ${threadId}] ⚠️ Không thấy nút "Thay đổi Mật khẩu" .`);
      throw new Error('Đăng nhập thất bại hoặc bị văng (Không tìm thấy nút Thay đổi Mật khẩu).');
    }

    // ── 3. BẤM NÚT LẤY MÃ TRÊN GARENA (ĐÃ SỬA NHẮM TRÚNG ID CỨNG) ──
    const emailDomain = emailUser.split('@')[1]?.toLowerCase() || '';
    let previousLatestId = null;
    let pageMail = null;

    if (emailDomain === 'fviainboxes.com') {
      const emailPrefix = emailUser.split('@')[0];

      console.log(`[Thread ${threadId}] 🌐 Mở tab fviainboxes.com để lấy cookie vượt Cloudflare...`);
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

    console.log(`[Thread ${threadId}] 🔍 Nhắm mục tiêu chính xác ID '#J-getotp-trigger'...`);
    const layMaButton = pageGarena.locator('#J-getotp-trigger').first();

    await layMaButton.waitFor({ state: 'visible', timeout: 10000 });
    await layMaButton.hover();
    await delayRand(300, 600);

    await layMaButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
    console.log(`[Thread ${threadId}] 📩 Đã bấm kích hoạt nút "Lấy mã" chuẩn xác.`);
    await delayRand(2000, 3000);

    // ── 4. PHÂN NHÁNH LẤY OTP THEO DOMAIN ──
    let otpCode = '';

    if (emailDomain === 'otpgmail.com' || emailDomain === 'gmail.com') {
      console.log(`[Thread ${threadId}] 🌐 Đang mở Tab mới để vào Unlimitmail...`);
      const pageMail = await context.newPage();
      await safeGoto(pageMail, 'https://unlimitmail.com/en/email', { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
      await delayRand(2000, 4000);

      const rawMailInput = `${emailUser}|${emailPass}`;

      console.log(`[Thread ${threadId}] 📬 Điền thông tin vào ô qcList...`);
      await pageMail.waitForSelector('#qcList', { timeout: 15000 });
      await pageMail.locator('#qcList').click();
      await delayRand(300, 600);

      await pageMail.locator('#qcList').fill(rawMailInput);
      await delayRand(800, 1500);

      console.log(`[Thread ${threadId}] 🚀 Bấm Submit Mail...`);
      await pageMail.waitForSelector('#qcSubmit', { timeout: 10000 });
      await pageMail.locator('#qcSubmit').click({ delay: Math.floor(Math.random() * 100) + 50 });

      console.log(`[Thread ${threadId}] ⏳ Chờ 10 giây hệ thống nhận OTP...`);
      await delayRand(8000, 12000);

      console.log(`[Thread ${threadId}] 🔍 Đang trạng trích xuất mã OTP từ class code-cell...`);
      await pageMail.waitForSelector('.code-cell', { timeout: 15000 });

      otpCode = await pageMail.locator('.code-cell').innerText();
      otpCode = otpCode.trim();

      if (!otpCode || !/^\d{8}$/.test(otpCode)) {
        throw new Error(`Không lấy được mã OTP hợp lệ (Yêu cầu chính xác 8 chữ số). Nội dung cào được: "${otpCode}"`);
      }

      console.log(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`);
      await pageMail.close();
    } else if (emailDomain === 'fextemp.com') {
      console.log(`[Thread ${threadId}] 🌐 Đang xử lý email fextemp.com qua tempmail.plus...`);
      const pageMail = await context.newPage();
      await safeGoto(pageMail, 'https://tempmail.plus/en/#!', { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
      await delayRand(2000, 4000);

      const emailPrefix = emailUser.split('@')[0];

      console.log(`[Thread ${threadId}] 📬 Điền prefix email vào ô pre_button...`);
      await pageMail.waitForSelector('#pre_button', { timeout: 15000 });
      await pageMail.locator('#pre_button').click({ delay: Math.floor(Math.random() * 100) + 50 });
      await delayRand(200, 400);
      await pageMail.locator('#pre_button').fill(emailPrefix);
      await delayRand(500, 1000);

      console.log(`[Thread ${threadId}] 🖱 Bấm mở dropdown domain...`);
      await pageMail.locator('#domain').click({ delay: Math.floor(Math.random() * 100) + 50 });
      await delayRand(500, 1000);

      console.log(`[Thread ${threadId}] 🖱 Tìm và chọn domain ${emailDomain}...`);
      const domainItem = pageMail.locator(`.dropdown-menu button:has-text("${emailDomain}")`).first();
      await domainItem.scrollIntoViewIfNeeded();
      await domainItem.click({ delay: Math.floor(Math.random() * 100) + 50 });
      await delayRand(2000, 4000);

      console.log(`[Thread ${threadId}] ⏳ Chờ 10-15s để hộp thư đồng bộ...`);
      await delayRand(10000, 15000);

      console.log(`[Thread ${threadId}] 🔍 Mở email đầu tiên trong inbox...`);
      await pageMail.waitForSelector('.inbox .mail', { timeout: 30000 });
      await pageMail.locator('.inbox .mail').first().click({ delay: Math.floor(Math.random() * 100) + 50 });

      console.log(`[Thread ${threadId}] ⏳ Đợi 3-5s để nội dung email load...`);
      await delayRand(3000, 5000);

      console.log(`[Thread ${threadId}] 🔍 Trích xuất mã OTP...`);
      await pageMail.waitForSelector('#info', { timeout: 15000 });
      const mailBodyText = await pageMail.locator('#info').innerText();
      const otpMatch = mailBodyText.match(/\b\d{8}\b/);

      if (!otpMatch) {
        throw new Error(`Không tìm thấy mã OTP hợp lệ trong nội dung thư Fextemp. Nội dung: "${mailBodyText.substring(0, 100)}..."`);
      }
      otpCode = otpMatch[0];

      console.log(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`);
      await pageMail.close();
    } else if (emailDomain === 'fviainboxes.com') {
      console.log(`[Thread ${threadId}] 🌐 Đang xử lý email fviainboxes.com (API Direct Mode)...`);
      const emailPrefix = emailUser.split('@')[0];

      console.log(`[Thread ${threadId}] ⏳ Chờ 3-5s để Garena gửi email OTP...`);
      await delayRand(3000, 5000);

      let foundId = null;

      for (let i = 1; i <= 6; i++) {
        console.log(`[Thread ${threadId}] 🔍 Lấy danh sách email qua API (Thử lần ${i})...`);
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
              console.log(`[Thread ${threadId}] ⚡ Đã thấy email MỚI TINH với ID: ${foundId}`);
              break;
            } else {
              console.log(`[Thread ${threadId}] ⚠️ Hộp thư chưa có mail mới (Vẫn là mail cũ). Đang đợi...`);
            }
          }
        } catch (e) { }

        if (i < 6) {
          console.log(`[Thread ${threadId}] ⏳ Chưa thấy email mới, chờ thêm 5s...`);
          await delayRand(5000, 7000);
        }
      }

      if (!foundId) {
        throw new Error('Timeout: Không nhận được email mã OTP từ fviainboxes');
      }

      console.log(`[Thread ${threadId}] 🔍 Đang kéo nội dung email qua API...`);
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

      console.log(`[Thread ${threadId}] 🎫 Lấy OTP qua API thành công: [${otpCode}]`);
      if (pageMail) await pageMail.close().catch(() => { });
    } else {
      throw new Error(`Domain email không được hỗ trợ: ${emailDomain}`);
    }

    // ── 5. QUAY LẠI TAB GARENA ĐỂ ĐIỀN OTP ──
    console.log(`[Thread ${threadId}] 🔄 Quay lại Tab Garena để điền mã xác thực...`);
    const otpInputSelector = 'input[placeholder*="mã xác thực"], input[placeholder*="Mã xác thực"]';

    await pageGarena.waitForSelector(otpInputSelector, { timeout: 15000 });
    await pageGarena.locator(otpInputSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(400, 800);

    await pageGarena.locator(otpInputSelector).pressSequentially(otpCode, { delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(1500, 2500);

    const xacNhanButton = pageGarena.getByRole('button', { name: 'XÁC NHẬN' }).first();
    await xacNhanButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
    console.log(`[Thread ${threadId}] 🔥 Hoàn thành toàn bộ quy trình xác thực OTP!`);

    // ── 6. MÀN HÌNH ĐỔI MẬT KHẨU MỚI ──
    await delayRand(3000, 5000);
    console.log(`[Thread ${threadId}] 🔐 Đang chờ màn hình đổi mật khẩu hiển thị...`);
    generatedPassword = generateRandomPassword();
    console.log(`[Thread ${threadId}] 🔑 Mật khẩu mới được tạo tự động: ${generatedPassword}`);

    const currentPassSelector = 'input[placeholder="Mật khẩu hiện tại"]';
    const newPassSelector = '#J-form-newpwd';
    const confirmPassSelector = 'input[placeholder="Xác nhận Mật khẩu mới"]';

    await pageGarena.waitForSelector(currentPassSelector, { timeout: 15000 });
    await delayRand(1000, 2000);

    console.log(`[Thread ${threadId}] ⌨️ Đang nhập mật khẩu hiện tại...`);
    await pageGarena.locator(currentPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(300, 500);
    await pageGarena.locator(currentPassSelector).pressSequentially(garenaPass, { delay: Math.floor(Math.random() * 120) + 80 });
    await delayRand(1000, 2000);

    console.log(`[Thread ${threadId}] ⌨️ Đang nhập mật khẩu mới...`);
    await pageGarena.locator(newPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(300, 500);
    await pageGarena.locator(newPassSelector).pressSequentially(generatedPassword, { delay: Math.floor(Math.random() * 150) + 100 });
    await delayRand(1000, 2000);

    console.log(`[Thread ${threadId}] ⌨️ Đang xác nhận lại mật khẩu mới...`);
    await pageGarena.locator(confirmPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(300, 500);
    await pageGarena.locator(confirmPassSelector).pressSequentially(generatedPassword, { delay: Math.floor(Math.random() * 120) + 80 });

    // ── 7. BẤM NÚT THAY ĐỔI ──
    await delayRand(1500, 3000);
    console.log(`[Thread ${threadId}] 💾 Bấm nút "Thay đổi"...`);

    const thayDoiButton = pageGarena.getByRole('button', { name: 'Thay đổi' }).first();
    await thayDoiButton.hover();
    await delayRand(200, 500);
    await thayDoiButton.click({ delay: Math.floor(Math.random() * 100) + 50 });

    console.log(`[Thread ${threadId}] 🎉 Đã hoàn tất quá trình đổi mật khẩu!`);

    // ── 8. ĐỢI QUAY VỀ TRANG CHỦ & ĐĂNG XUẤT AN TOÀN ──
    console.log(`[Thread ${threadId}] ⏳ Chờ 8-10 giây để hệ thống xử lý quay về trang chủ...`);
    await delayRand(8000, 10000);

    const currentUrlAfterChange = pageGarena.url();
    if (!currentUrlAfterChange.includes('https://account.garena.com/security') && currentUrlAfterChange.includes('garena.com')) {
      console.log(`[Thread ${threadId}] 🔄 Trình duyệt tự chuyển hướng về: ${currentUrlAfterChange}`);
    } else {
      console.log(`[Thread ${threadId}] 🔄 Chủ động chuyển hướng về trang chủ account.garena.com...`);
      await safeGoto(pageGarena, 'https://account.garena.com/', { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
    }

    console.log(`[Thread ${threadId}] 🔍 Đang tìm nút "Đăng xuất" qua class chuẩn...`);
    const dangXuatButton = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();

    await dangXuatButton.waitFor({ state: 'visible', timeout: 15000 });
    await dangXuatButton.hover();
    await delayRand(300, 700);

    await dangXuatButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
    console.log(`[Thread ${threadId}] 🚪 Đã click nút "Đăng xuất" thành công.`);

    console.log(`[Thread ${threadId}] ⏳ Đang dọn dẹp phiên làm việc (Chờ 3-5s)...`);
    await delayRand(3000, 5000);

    console.log(`[Thread ${threadId}] ✨ Hoàn thành 1 chu kỳ xử lý tài khoản thành công!`);

  } catch (err) {
    console.error(`[Thread ${threadId}] ❌ Lỗi hệ thống: ${err.message}`);
    try {
      await pageGarena.screenshot({ path: path.join(__dirname, `error_thread_${threadId}.png`) });
    } catch { }
  } finally {
    await context.close();
    console.log(`[Thread ${threadId}] 🔒 Đã đóng luồng an toàn.`);
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  🎯 Garena Anti-Bot & Auto OTP Verification Tool (INDEX.JS)`);
  console.log(`  🧵 Số luồng song song: ${CONFIG.THREADS}`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();
  const threads = Array.from({ length: CONFIG.THREADS }, (_, i) => runThread(i + 1));

  await Promise.allSettled(threads);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ Tất cả luồng xử lý xong sau ${elapsed}s`);
}

main();