const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function solveTencentCaptcha(page, sendLog, threadId) {
    sendLog(`[Thread ${threadId}] 🔍 Đang kiểm tra xem có bị dính Captcha không...`);

    // Chờ tối đa 5 giây xem iframe captcha có xuất hiện không
    const iframeElement = await page.waitForSelector('iframe[src*="tcaptcha"], iframe[src*="captcha"], iframe[name="tcaptcha_iframe"]', { state: 'visible', timeout: 5000 }).catch(() => null);
    
    if (!iframeElement) {
        sendLog(`[Thread ${threadId}] ✅ Không có Captcha, tiếp tục...`);
        return true; // Không có captcha
    }

    sendLog(`[Thread ${threadId}] ⚠️ Phát hiện Captcha! Đang thử giải tự động...`, 'warning');
    const frame = await iframeElement.contentFrame();
    if (!frame) return false;

    // Thử tối đa 2 lần giải tự động
    for (let attempt = 1; attempt <= 2; attempt++) {
        const slider = await frame.waitForSelector('#tcaptcha_drag_thumb, .tc-slider-normal, #slideBlock', { timeout: 5000 }).catch(() => null);
        if (!slider) {
            sendLog(`[Thread ${threadId}] ✅ Captcha đã biến mất.`);
            return true;
        }

        sendLog(`[Thread ${threadId}] 🤖 Lần thử ${attempt}/2: Phân tích ảnh để tìm khoảng cách...`);
        
        let distance = 0;
        try {
            // Lấy kích thước thực tế của khung Captcha
            const bgBox = await frame.locator('#slideBg, .tc-bg-img, #tcaptcha_pic').first().boundingBox();
            if (!bgBox) throw new Error("Không tìm thấy ảnh nền");

            // Chụp ảnh iframe để dùng pixelmatch thủ công
            const screenshot = await iframeElement.screenshot();
            
            // Tính toán khoảng cách (Cách đơn giản không cần OpenCV: Dùng Evaluate vẽ Canvas nếu không dính CORS)
            distance = await frame.evaluate(() => {
                const bg = document.querySelector('#slideBg, .tc-bg-img, #tcaptcha_pic');
                if (!bg) return 0;
                
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                const width = bg.clientWidth || 340;
                const height = bg.clientHeight || 195;
                
                canvas.width = width;
                canvas.height = height;
                
                try {
                    ctx.drawImage(bg, 0, 0, width, height);
                } catch(e) {
                    return 0; // Lỗi CORS
                }
                
                const imageData = ctx.getImageData(0, 0, width, height).data;
                
                // Tìm vùng có viền xám đen thẳng đứng (cạnh trái của cái lỗ)
                let maxContrast = 0;
                let targetX = 0;
                
                for (let x = 50; x < width - 40; x++) {
                    let columnDarkness = 0;
                    for (let y = 10; y < height - 10; y++) {
                        const idx = (y * width + x) * 4;
                        const r = imageData[idx];
                        const g = imageData[idx+1];
                        const b = imageData[idx+2];
                        
                        // Độ tương phản cạnh (cạnh của lỗ thường làm hình ảnh tối đi hoặc mờ đi rất rõ rệt)
                        const nextIdx = (y * width + x + 2) * 4;
                        const diff = Math.abs(r - imageData[nextIdx]) + Math.abs(g - imageData[nextIdx+1]) + Math.abs(b - imageData[nextIdx+2]);
                        columnDarkness += diff;
                    }
                    if (columnDarkness > maxContrast) {
                        maxContrast = columnDarkness;
                        targetX = x;
                    }
                }
                return targetX;
            });
            
            // Nếu CORS chặn getImageData, trả về 0, ta chuyển sang Manual Fallback
            if (distance < 20) {
                sendLog(`[Thread ${threadId}] ❌ Thuật toán Auto-solve bị trình duyệt chặn (CORS). Chuyển sang kéo tay!`);
                break;
            }

            sendLog(`[Thread ${threadId}] 📏 Khoảng cách tìm được: ~${Math.round(distance)}px. Bắt đầu kéo chuột...`);

            // ── QUỸ ĐẠO CHUỘT GIẢ LẬP CON NGƯỜI ──
            const sliderBox = await slider.boundingBox();
            const startX = sliderBox.x + sliderBox.width / 2;
            const startY = sliderBox.y + sliderBox.height / 2;
            
            await page.mouse.move(startX, startY);
            await delay(Math.random() * 200 + 100);
            await page.mouse.down();
            await delay(Math.random() * 200 + 100);

            // Bắt đầu kéo
            const steps = 30; // Số điểm chia nhỏ để kéo mượt
            // 27px là khoảng cách sai số bù trừ (do điểm bắt đầu của nút drag thường cách lề trái 1 đoạn)
            const actualDistance = distance - 27; 

            for (let i = 1; i <= steps; i++) {
                // Easing function: Bắt đầu nhanh, kết thúc chậm lại
                const t = i / steps;
                const easeOutCubic = 1 - Math.pow(1 - t, 3);
                
                const moveX = startX + (actualDistance * easeOutCubic);
                const moveY = startY + (Math.random() * 4 - 2); // Lệch trục Y (Run tay)
                
                await page.mouse.move(moveX, moveY);
                await delay(Math.random() * 15 + 5);
            }

            // Kéo lố qua 1 tí rồi thụt lùi lại (Giống tâm lý con người chỉnh lại cho khớp)
            await page.mouse.move(startX + actualDistance + 6, startY + 1);
            await delay(150);
            await page.mouse.move(startX + actualDistance, startY);
            await delay(200);

            await page.mouse.up();
            sendLog(`[Thread ${threadId}] 🖱️ Đã nhả chuột. Chờ kết quả...`);

            await delay(3000); // Chờ xem có load trang hay báo lỗi không
            
            // Kiểm tra xem iframe còn ở đó không
            const stillThere = await frame.$('#tcaptcha_drag_thumb, .tc-slider-normal, #slideBlock').catch(() => null);
            if (!stillThere) {
                sendLog(`[Thread ${threadId}] 🎉 Tự động vượt Captcha THÀNH CÔNG!`, 'success');
                return true;
            }

            sendLog(`[Thread ${threadId}] ❌ Kéo trượt. Đang thử lại...`);
            // Click reload nếu có nút reload
            const reloadBtn = await frame.$('#reload, .tc-reload').catch(() => null);
            if (reloadBtn) await reloadBtn.click();
            await delay(2000);

        } catch (e) {
            sendLog(`[Thread ${threadId}] ❌ Lỗi thuật toán: ${e.message}`);
            break;
        }
    }

    // MANUAL FALLBACK (Trường hợp Auto thất bại hoặc bị CORS chặn)
    sendLog(`[Thread ${threadId}] ⏳ TẠM DỪNG: Vui lòng tự lấy chuột kéo Captcha! (Có 20 giây)...`, 'warning');
    
    // Đợi tối đa 20s xem iframe có biến mất không (Tức là người dùng đã giải xong)
    let solved = false;
    for (let i = 0; i < 20; i++) {
        await delay(1000);
        const stillThere = await page.$('iframe[src*="tcaptcha"], iframe[src*="captcha"]').catch(() => null);
        
        // Nếu iframe mất (màn hình đã pass), break
        if (!stillThere) {
            const checkUrl = page.url();
            // Nếu vẫn ở login mà ko có iframe, có thể là đã pass
            solved = true;
            break;
        }
    }

    if (solved) {
        sendLog(`[Thread ${threadId}] ✅ Bạn đã giải Captcha thủ công xong. Chạy tiếp!`, 'success');
        return true;
    } else {
        sendLog(`[Thread ${threadId}] ❌ Hết thời gian chờ Captcha. Đánh dấu lỗi.`);
        throw new Error("Không thể vượt qua Captcha (Timeout).");
    }
}

module.exports = { solveTencentCaptcha };
