// File: autoSlider.js

async function solveSimpleSlider(page, sendLog, threadId) {
    try {
        // ══════════════════════════════════════════════
        //  BƯỚC 1: TÌM IFRAME DATADOME
        // ══════════════════════════════════════════════
        let ddFrame = null;
        let ddIframeElement = null;

        // Tìm iframe có src chứa datadome hoặc captcha-delivery
        const iframes = page.frames();
        for (const frame of iframes) {
            const url = frame.url();
            if (url.includes('datadome') || url.includes('captcha-delivery') || url.includes('geo.captcha')) {
                ddFrame = frame;
                break;
            }
        }

        // Nếu không tìm được qua frames(), thử qua element
        if (!ddFrame) {
            try {
                const iframeEl = await page.waitForSelector(
                    'iframe[src*="datadome"], iframe[src*="captcha-delivery"], iframe[src*="geo.captcha"]',
                    { timeout: 3000 }
                );
                if (iframeEl) {
                    ddIframeElement = iframeEl;
                    ddFrame = await iframeEl.contentFrame();
                }
            } catch (_) {}
        }

        // ══════════════════════════════════════════════
        //  TRƯỜNG HỢP CŨ: Tencent Captcha (#tcaptcha_iframe)
        // ══════════════════════════════════════════════
        if (!ddFrame) {
            const tcaptchaEl = await page.$('#tcaptcha_iframe');
            if (tcaptchaEl && await tcaptchaEl.isVisible().catch(() => false)) {
                const frame = await tcaptchaEl.contentFrame();
                if (frame) {
                    const slider = await frame.$('#tcaptcha_drag_thumb, .tc-slider-normal, .tc-drag-thumb');
                    const track  = await frame.$('#tcaptcha_drag_track, .tc-bg, .tc-drag-track');
                    if (slider) {
                        let totalDistance = 217;
                        if (track && slider) {
                            const trackBox  = await track.boundingBox();
                            const sliderBox = await slider.boundingBox();
                            if (trackBox && sliderBox) totalDistance = trackBox.width - sliderBox.width;
                        }
                        return await _dragSlider(page, slider, tcaptchaEl, totalDistance, sendLog, threadId);
                    }
                }
            }
        }

        // ══════════════════════════════════════════════
        //  TRƯỜNG HỢP MỚI: DataDome trong iframe
        // ══════════════════════════════════════════════
        if (ddFrame) {
            sendLog(`[Thread ${threadId}] 🎯 Tìm thấy DataDome iframe: ${ddFrame.url().substring(0, 60)}...`);

            // Đảm bảo luôn có ddIframeElement để tính offset tọa độ chuột
            if (!ddIframeElement) {
                try {
                    ddIframeElement = await page.$(
                        'iframe[src*="datadome"], iframe[src*="captcha-delivery"], iframe[src*="geo.captcha"]'
                    );
                } catch (_) {}
            }

            await ddFrame.waitForLoadState('domcontentloaded').catch(() => {});
            await ddFrame.waitForTimeout(800);

            // ── Slider handle: div.slider (nút kéo thật) ──
            // KHÔNG dùng [class*="slider"] vì khớp cả container
            const sliderSelectors = [
                'div.slider',               // DataDome geo.captcha-delivery.com (chính xác)
                '#captcha-slider-handle',
                '.captcha-slider__handle',
                '.slider__handle',
                'div[class="slider"]',      // exact match
            ];

            let slider = null;
            for (const sel of sliderSelectors) {
                try {
                    const el = await ddFrame.$(sel);
                    if (el && await el.isVisible().catch(() => false)) {
                        const box = await el.boundingBox();
                        // div.slider phải nhỏ hơn container (~63px), loại nếu quá rộng
                        if (box && box.width < 150) {
                            slider = el;
                            sendLog(`[Thread ${threadId}] ✅ Tìm thấy slider: ${sel} (${Math.round(box.width)}x${Math.round(box.height)}px)`);
                            break;
                        }
                    }
                } catch (_) {}
            }

            // ── Tính khoảng cách kéo chính xác theo vị trí sliderTarget ──
            let totalDistance = 217; // fallback
            if (slider) {
                try {
                    const sliderBox = await slider.boundingBox();
                    // Ưu tiên 1: Dùng vị trí thực của sliderTarget (đích đến)
                    const target = await ddFrame.$('div.sliderTarget');
                    if (target && sliderBox) {
                        const targetBox = await target.boundingBox();
                        if (targetBox) {
                            // Kéo từ tâm slider đến tâm target
                            totalDistance = targetBox.x - sliderBox.x;
                            sendLog(`[Thread ${threadId}] 📐 Distance (target mode): sliderTarget.x(${Math.round(targetBox.x)}) - slider.x(${Math.round(sliderBox.x)}) = ${Math.round(totalDistance)}px`);
                        }
                    } else {
                        // Fallback: container - slider
                        const container = await ddFrame.$('div.sliderContainer');
                        if (container && sliderBox) {
                            const containerBox = await container.boundingBox();
                            if (containerBox) {
                                totalDistance = containerBox.width - sliderBox.width;
                                sendLog(`[Thread ${threadId}] 📐 Distance (container mode): ${Math.round(containerBox.width)} - ${Math.round(sliderBox.width)} = ${Math.round(totalDistance)}px`);
                            }
                        }
                    }
                } catch (_) {}

                return await _dragSlider(page, slider, ddIframeElement, totalDistance, sendLog, threadId, ddFrame);
            }

            sendLog(`[Thread ${threadId}] ❓ Không tìm thấy nút kéo trong DataDome iframe. Cần giải tay!`, 'warning');
            return false;
        }

        // ══════════════════════════════════════════════
        //  TRƯỜNG HỢP DỰ PHÒNG: DOM trực tiếp (không iframe)
        // ══════════════════════════════════════════════
        const directSlider = await page.$('div.slider, [class*="slider-handle"], [class*="drag-btn"]');
        if (directSlider && await directSlider.isVisible().catch(() => false)) {
            const track = await page.$('div.sliderContainer, [class*="slider-bar"], [class*="slider-track"]');
            let totalDistance = 260;
            if (track) {
                const trackBox  = await track.boundingBox();
                const sliderBox = await directSlider.boundingBox();
                if (trackBox && sliderBox) {
                    totalDistance = trackBox.width - sliderBox.width;
                    sendLog(`[Thread ${threadId}] 📐 Đo khoảng cách (DOM trực tiếp): ${Math.round(totalDistance)}px`);
                }
            }
            return await _dragSlider(page, directSlider, null, totalDistance, sendLog, threadId);
        }

        sendLog(`[Thread ${threadId}] ❓ Không tìm thấy nút kéo Captcha. Cần giải tay!`, 'warning');
        return false;

    } catch (err) {
        sendLog(`[Thread ${threadId}] Lỗi hệ thống Auto-Slider: ${err.message}`, 'error');
        return false;
    }
}

// ══════════════════════════════════════════════
//  HÀM KÉO SLIDER (dùng chung cho mọi trường hợp)
// ══════════════════════════════════════════════
async function _dragSlider(page, slider, iframeElement, totalDistance, sendLog, threadId, frame) {
    try {
        await slider.hover();
        await page.waitForTimeout(400 + Math.random() * 200);

        const sliderBox = await slider.boundingBox();
        if (!sliderBox) return false;

        // Tính tọa độ tuyệt đối trên màn hình
        let startX, startY;
        if (iframeElement) {
            const iframeBox = await iframeElement.boundingBox();
            if (!iframeBox) return false;
            startX = iframeBox.x + sliderBox.x + sliderBox.width / 2;
            startY = iframeBox.y + sliderBox.y + sliderBox.height / 2;
        } else {
            startX = sliderBox.x + sliderBox.width / 2;
            startY = sliderBox.y + sliderBox.height / 2;
        }

        sendLog(`[Thread ${threadId}] 🖱️ Bắt đầu kéo Captcha (Human Track Mode)... dist=${Math.round(totalDistance)}px`, 'info');

        await page.mouse.move(startX, startY);
        await page.waitForTimeout(300 + Math.random() * 100);
        await page.mouse.down();
        await page.waitForTimeout(150 + Math.random() * 100);

        // Phân đoạn 1: Kéo nhanh 35% đầu
        const seg1 = totalDistance * 0.35;
        await page.mouse.move(startX + seg1, startY, { steps: 6 });
        await page.waitForTimeout(50 + Math.random() * 50);

        // Phân đoạn 2: Giảm tốc hình sin + rung trục Y
        const steps = 18 + Math.floor(Math.random() * 8);
        let currentX = startX + seg1;
        let currentY = startY;

        for (let i = 0; i < steps; i++) {
            const progress = i / steps;
            const seg2 = totalDistance * 0.65;
            const xOffset = Math.sin(progress * Math.PI / 2) * seg2;
            currentX = startX + seg1 + xOffset;
            const yJitter = (Math.random() - 0.5) * 6;
            currentY = startY + yJitter;
            await page.mouse.move(currentX, currentY);
            await page.waitForTimeout(Math.random() * 10 + 8);
        }

        // Phân đoạn 3: Về đích chính xác
        await page.mouse.move(startX + totalDistance, startY, { steps: 4 });
        await page.waitForTimeout(400 + Math.random() * 200);
        await page.mouse.up();

        sendLog(`[Thread ${threadId}] Đã nhả chuột. Đang chờ kết quả...`, 'info');
        await page.waitForTimeout(2500);

        // Kiểm tra captcha đã biến mất chưa
        // Kiểm tra trong frame nếu có
        const targetCtx = frame || page;
        const stillVisible = await targetCtx.$('div.sliderContainer, [class*="slider-bar"], #captcha-container').then(
            el => el ? el.isVisible() : false
        ).catch(() => false);
        const iframeStill = iframeElement ? await iframeElement.isVisible().catch(() => false) : false;

        if (stillVisible || iframeStill) {
            sendLog(`[Thread ${threadId}] ❌ Kéo tự động bị trượt. Vui lòng giải tay!`, 'warning');
            return false;
        }

        sendLog(`[Thread ${threadId}] ✅ Kéo Captcha HOÀN TOÀN THÀNH CÔNG!`, 'success');
        return true;

    } catch (err) {
        sendLog(`[Thread ${threadId}] Lỗi kéo slider: ${err.message}`, 'error');
        return false;
    }
}

module.exports = { solveSimpleSlider };