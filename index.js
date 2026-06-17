const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Đọc cấu hình từ UI (nếu có)
let sharedConfig = {};
try {
  sharedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared_config.json'), 'utf8'));
} catch (e) {}

// ===================== CẤU HÌNH =====================
const CONFIG = {
  TARGET_URL: 'https://sso.garena.com/universal/login?app_id=10100&redirect_uri=https%3A%2F%2Faccount.garena.com%2F&locale=vi-VN',
  THREADS: 1,                          
  HEADLESS: false,                     
  TIMEOUT: 40000,                      
};

// GIẢ LẬP DANH SÁCH TÀI KHOẢN (Định dạng: username|password|email|mailpassword)
const ACCOUNT_LIST = [
  "taikhoanGarena1|matkhauGarena1|email_cua_ban@domain.com|mat_khau_mail_1",
];
// ====================================================

const delayRand = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));

async function runThread(threadId) {
  // ── 0. BÓC TÁCH THÔNG TIN TÀI KHOẢN ──
  const rawAccount = ACCOUNT_LIST[(threadId - 1) % ACCOUNT_LIST.length];
  if (!rawAccount) {
    console.log(`[Thread ${threadId}] ❌ Không tìm thấy dữ liệu tài khoản.`);
    return;
  }
  const [garenaUser, garenaPass, emailUser, emailPass] = rawAccount.split('|');

  const userDataDir = path.join(__dirname, 'garena_profiles', `user_thread_${threadId}`);
  console.log(`[Thread ${threadId}] 🚀 Khởi tạo luồng cho tài khoản: ${garenaUser}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: CONFIG.HEADLESS,
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--start-maximized'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  const pageGarena = context.pages()[0] || await context.newPage();

  try {
    // ── 1. ĐĂNG NHẬP GARENA SSO & KIỂM TRA SESSION CŨ ──
    console.log(`[Thread ${threadId}] 🌐 Truy cập Garena SSO...`);
    await pageGarena.goto(CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });

    let currentUrl = pageGarena.url();
    
    if (!currentUrl.includes('universal/login') && currentUrl.includes('garena.com')) {
        console.log(`[Thread ${threadId}] ⚠️ Phát hiện Session cũ đang đăng nhập sẵn! Tiến hành dọn dẹp...`);
        
        // CẬP NHẬT: Định vị nút đăng xuất bằng class chuẩn đích danh
        const dangXuatKhuVucCu = pageGarena.locator('a.hd-operation:has-text("Đăng xuất")').first();
        try {
            await dangXuatKhuVucCu.waitFor({ state: 'visible', timeout: 5000 });
            await dangXuatKhuVucCu.hover();
            await dangXuatKhuVucCu.click({ delay: 100 });
            console.log(`[Thread ${threadId}] 🚪 Đã chủ động đăng xuất tài khoản cũ kẹt lại.`);
            await delayRand(3000, 5000);
            
            console.log(`[Thread ${threadId}] 🔄 Tải lại trang Login chuẩn...`);
            await pageGarena.goto(CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
        } catch (errClose) {
            console.log(`[Thread ${threadId}] ❌ Không click được Đăng xuất giao diện, tiến hành xóa cứng cookie...`);
            await context.clearCookies(); 
            await pageGarena.goto(CONFIG.TARGET_URL, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
        }
    }

    const title = await pageGarena.title();
    console.log(`[Thread ${threadId}] ✅ Màn hình Login đã sẵn sàng! Title: "${title}"`);

    const usernameSelector = 'input[type="text"]'; 
    const passwordSelector = 'input[type="password"]';

    await pageGarena.waitForSelector(usernameSelector, { timeout: 10000 });
    await pageGarena.locator(usernameSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(400, 800);

    console.log(`[Thread ${threadId}] Điền tài khoản...`);
    await pageGarena.locator(usernameSelector).pressSequentially(garenaUser, { delay: Math.floor(Math.random() * 120) + 80 });
    await delayRand(1000, 2000);

    await pageGarena.waitForSelector(passwordSelector, { timeout: 10000 });
    await pageGarena.locator(passwordSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(300, 600);

    console.log(`[Thread ${threadId}] Điền mật khẩu...`);
    await pageGarena.locator(passwordSelector).pressSequentially(garenaPass, { delay: Math.floor(Math.random() * 150) + 100 });
    await delayRand(1500, 3000);

    console.log(`[Thread ${threadId}] 🔑 Bấm Đăng nhập...`);
    await pageGarena.locator(passwordSelector).press('Enter');
    await delayRand(5000, 7000);

    // ── 2. CHUYỂN TRANG BẢO MẬT & CLICK Thay đổi Mật khẩu ──
    const securityUrl = 'https://account.garena.com/security';
    console.log(`[Thread ${threadId}] 🔄 Chuyển sang trang Bảo mật...`);
    await pageGarena.goto(securityUrl, { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
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
    }

    // ── 3. BẤM NÚT LẤY MÃ TRÊN GARENA (ĐÃ SỬA NHẮM TRÚNG ID CỨNG) ──
    console.log(`[Thread ${threadId}] 🔍 Nhắm mục tiêu chính xác ID '#J-getotp-trigger'...`);
    const layMaButton = pageGarena.locator('#J-getotp-trigger').first();
    
    await layMaButton.waitFor({ state: 'visible', timeout: 10000 });
    await layMaButton.hover(); 
    await delayRand(300, 600);
    
    await layMaButton.click({ delay: Math.floor(Math.random() * 100) + 50 });
    console.log(`[Thread ${threadId}] 📩 Đã bấm kích hoạt nút "Lấy mã" chuẩn xác.`);
    await delayRand(2000, 3000);

    // ── 4. MỞ TAB MỚI TRUY CẬP UNLIMITMAIL ──
    console.log(`[Thread ${threadId}] 🌐 Đang mở Tab mới để vào Unlimitmail...`);
    const pageMail = await context.newPage(); 
    await pageMail.goto('https://unlimitmail.com/en/email', { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
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

    // ── 5. CÀO MÃ OTP THỰC TẾ & KIỂM TRA ĐIỀU KIỆN 8 SỐ ──
    console.log(`[Thread ${threadId}] 🔍 Đang trích xuất mã OTP từ class code-cell...`);
    await pageMail.waitForSelector('.code-cell', { timeout: 15000 });
    
    let otpCode = await pageMail.locator('.code-cell').innerText();
    otpCode = otpCode.trim(); 

    if (!otpCode || !/^\d{8}$/.test(otpCode)) {
        throw new Error(`Không lấy được mã OTP hợp lệ (Yêu cầu chính xác 8 chữ số). Nội dung cào được: "${otpCode}"`);
    }

    console.log(`[Thread ${threadId}] 🎫 Lấy OTP thành công thực tế: [${otpCode}]`);
    await pageMail.close();

    // ── 6. QUAY LẠI TAB GARENA ĐỂ ĐIỀN OTP ──
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

    // ── 7. MÀN HÌNH ĐỔI MẬT KHẨU MỚI ──
    await delayRand(3000, 5000);
    console.log(`[Thread ${threadId}] 🔐 Đang chờ màn hình đổi mật khẩu hiển thị...`);
    const newPasswordFromUI = sharedConfig.newPasswordFromUI || "Matkhaumoi@2026"; 

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
    await pageGarena.locator(newPassSelector).pressSequentially(newPasswordFromUI, { delay: Math.floor(Math.random() * 150) + 100 });

    await delayRand(1000, 2000);

    console.log(`[Thread ${threadId}] ⌨️ Đang xác nhận lại mật khẩu mới...`);
    await pageGarena.locator(confirmPassSelector).click({ delay: Math.floor(Math.random() * 100) + 50 });
    await delayRand(300, 500);
    await pageGarena.locator(confirmPassSelector).pressSequentially(newPasswordFromUI, { delay: Math.floor(Math.random() * 120) + 80 });

    // ── 8. BẤM NÚT THAY ĐỔI ──
    await delayRand(1500, 3000); 
    console.log(`[Thread ${threadId}] 💾 Bấm nút "Thay đổi"...`);
    
    const thayDoiButton = pageGarena.getByRole('button', { name: 'Thay đổi' }).first();
    await thayDoiButton.hover(); 
    await delayRand(200, 500);
    await thayDoiButton.click({ delay: Math.floor(Math.random() * 100) + 50 });

    console.log(`[Thread ${threadId}] 🎉 Đã hoàn tất quá trình đổi mật khẩu!`);
    
    // ── 9. ĐỢI QUAY VỀ TRANG CHỦ & ĐĂNG XUẤT AN TOÀN ──
    console.log(`[Thread ${threadId}] ⏳ Chờ 8-10 giây để hệ thống xử lý quay về trang chủ...`);
    await delayRand(8000, 10000);

    const currentUrlAfterChange = pageGarena.url();
    if (!currentUrlAfterChange.includes('https://account.garena.com/security') && currentUrlAfterChange.includes('garena.com')) {
      console.log(`[Thread ${threadId}] 🔄 Trình duyệt tự chuyển hướng về: ${currentUrlAfterChange}`);
    } else {
      console.log(`[Thread ${threadId}] 🔄 Chủ động chuyển hướng về trang chủ account.garena.com...`);
      await pageGarena.goto('https://account.garena.com/', { timeout: CONFIG.TIMEOUT, waitUntil: 'networkidle' });
    }

    // CẬP NHẬT: Thay đổi selector cũ sang class điều hướng .hd-operation chuẩn để logout chính xác
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
    } catch {}
  } finally {
    await context.close();
    console.log(`[Thread ${threadId}] 🔒 Đã đóng luồng an toàn.`);
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  🎯 Garena Anti-Bot & Auto OTP Verification Tool`);
  console.log(`  🧵 Số luồng song song: ${CONFIG.THREADS}`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();
  const threads = Array.from({ length: CONFIG.THREADS }, (_, i) => runThread(i + 1));

  await Promise.allSettled(threads);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ Tất cả luồng xử lý xong sau ${elapsed}s`);
}

main();