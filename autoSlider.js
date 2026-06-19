async function solveSimpleSlider(page, sendLog, threadId) {
    try {
        const iframeElement = await page.waitForSelector('#tcaptcha_iframe', { timeout: 5000 }).catch(() => null);
        if (!iframeElement) return false; // Không có captcha

        const frame = await iframeElement.contentFrame();
        if (!frame) return false;

        // Chờ tải các thành phần của captcha trong iframe
        await page.waitForTimeout(1500);

        // Nút kéo và thanh trượt
        const slider = await frame.$('#tcaptcha_drag_thumb, .tc-slider-normal, .tc-drag-thumb');
        const track = await frame.$('#tcaptcha_drag_track, .tc-bg, .tc-drag-track');
        
        if (!slider) {
            sendLog(`[Thread ${threadId}] Không tìm thấy nút kéo Captcha. Cần giải tay!`, 'warning');
            return false; 
        }

        let distance = 250; // Quãng đường kéo mặc định an toàn nếu không tính được track
        if (track) {
            const trackBox = await track.boundingBox();
            const sliderBox = await slider.boundingBox();
            if (trackBox && sliderBox) {
                // Kéo đến cuối thanh trượt
                distance = trackBox.width - sliderBox.width;
            }
        }

        sendLog(`[Thread ${threadId}] Bắt đầu kéo Captcha tự động...`, 'info');
        
        const sliderBox = await slider.boundingBox();
        const iframeBox = await iframeElement.boundingBox();
        
        if (!sliderBox || !iframeBox) return false;

        // Tọa độ tuyệt đối trên page
        const startX = iframeBox.x + sliderBox.x + sliderBox.width / 2;
        const startY = iframeBox.y + sliderBox.y + sliderBox.height / 2;

        await page.mouse.move(startX, startY);
        await page.waitForTimeout(Math.random() * 200 + 100);
        await page.mouse.down();
        
        // ── QUỸ ĐẠO CHUỘT GIẢ LẬP CON NGƯỜI ──
        let steps = 15 + Math.floor(Math.random() * 10); // 15-25 bước nhỏ
        
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            
            // Hàm easing (nhanh ở đầu, chậm ở cuối)
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            
            const nextX = startX + (distance * easeOutQuart);
            // Chuột hơi rung lắc +- 2 pixel dọc
            const nextY = startY + (Math.random() * 4 - 2);
            
            await page.mouse.move(nextX, nextY);
            await page.waitForTimeout(Math.random() * 20 + 10); // Nghỉ 10-30ms mỗi bước
        }
        
        // Cố tình kéo lố một chút rồi giật lùi (đặc trưng của người làm nhanh)
        const overshootX = startX + distance + Math.random() * 8 + 3;
        await page.mouse.move(overshootX, startY + (Math.random() * 4 - 2));
        await page.waitForTimeout(Math.random() * 60 + 40);
        
        // Giật lùi lại cho khớp
        await page.mouse.move(startX + distance, startY);
        await page.waitForTimeout(Math.random() * 150 + 100);
        
        // Thả chuột
        await page.mouse.up();
        
        sendLog(`[Thread ${threadId}] Đã kéo xong! Đang chờ kết quả...`, 'info');
        
        // Đợi một chút xem captcha có biến mất không
        await page.waitForTimeout(2000);
        const stillVisible = await iframeElement.isVisible().catch(() => false);
        if (stillVisible) {
            sendLog(`[Thread ${threadId}] ❌ Kéo tự động thất bại (AI Garena bắt làm lại). Vui lòng giải tay!`, 'warning');
            return false;
        }
        
        sendLog(`[Thread ${threadId}] ✅ Kéo Captcha TỰ ĐỘNG THÀNH CÔNG!`, 'success');
        return true;
        
    } catch (err) {
        sendLog(`[Thread ${threadId}] Lỗi Auto-Slider: ${err.message}`, 'error');
        return false;
    }
}

module.exports = { solveSimpleSlider };
