// ocr.js
// OCR 相关功能（拍照、图像预处理、数字解析）
// 依赖 Tesseract.js（已在 index.html 中通过 CDN 引入）

export async function runOCR(imageBlob) {
    // 使用 Tesseract.js 进行文字识别，返回数字数组
    const { data: { text } } = await Tesseract.recognize(imageBlob, 'eng', {
        logger: m => console.log(m) // 可选：显示进度
    });
    // 提取所有数字（包括可能的血压和脉搏值）
    const nums = text.match(/\d+/g) ? text.match(/\d+/g).map(n => parseInt(n, 10)) : [];
    return nums;
}

// 简单的灰度化与二值化（Bradley 自适应算法）
export function preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width, h = canvas.height;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    // 积分图
    const intImg = new Uint32Array(w * h);
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = 0; y < h; y++) {
            sum += gray[y * w + x];
            if (x === 0) {
                intImg[y * w + x] = sum;
            } else {
                intImg[y * w + x] = intImg[y * w + x - 1] + sum;
            }
        }
    }
    const S = Math.round(w / 8);
    const halfS = Math.round(S / 2);
    const t = 10; // 灵敏度阈值
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const x1 = Math.max(x - halfS, 0);
            const x2 = Math.min(x + halfS, w - 1);
            const y1 = Math.max(y - halfS, 0);
            const y2 = Math.min(y + halfS, h - 1);
            const count = (x2 - x1) * (y2 - y1);
            const idxTL = y1 * w + x1;
            const idxTR = y1 * w + x2;
            const idxBL = y2 * w + x1;
            const idxBR = y2 * w + x2;
            const sum = intImg[idxBR] - intImg[idxTR] - intImg[idxBL] + intImg[idxTL];
            const mean = sum / count;
            const curr = gray[y * w + x];
            const val = curr * 100 < mean * (100 - t) ? 0 : 255;
            const idx = (y * w + x) * 4;
            data[idx] = data[idx + 1] = data[idx + 2] = val;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

// 解析数字序列为血压/脉搏值（参考原项目逻辑）
export function parseBPValues(nums) {
    if (!nums || nums.length < 2) return null;
    let systolic = null, diastolic = null, pulse = null;
    // 主流程：按顺序寻找符合范围的数值
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        if (n >= 90 && n <= 195 && systolic === null) {
            systolic = n;
            for (let j = i + 1; j < nums.length; j++) {
                const m = nums[j];
                if (m >= 50 && m <= 115 && m < systolic && diastolic === null) {
                    diastolic = m;
                    for (let k = j + 1; k < nums.length; k++) {
                        const p = nums[k];
                        if (p >= 45 && p <= 120) { pulse = p; break; }
                    }
                    break;
                }
            }
            if (systolic && diastolic) break;
        }
    }
    // 若未匹配成功，宽松匹配
    if (!systolic || !diastolic) {
        const validSys = nums.filter(n => n >= 90 && n <= 195);
        const validDia = nums.filter(n => n >= 50 && n <= 115);
        const validPulse = nums.filter(n => n >= 45 && n <= 120);
        if (validSys.length && validDia.length) {
            systolic = validSys[0];
            diastolic = validDia.find(d => d !== systolic) || validDia[0];
            pulse = validPulse.find(p => p !== systolic && p !== diastolic) || null;
        }
    }
    if (systolic && diastolic) return { systolic, diastolic, pulse };
    return null;
}
