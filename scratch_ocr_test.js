const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const images = [
    { name: "测试OCR", path: "d:/xueya/测试OCR.jpg" }
];

async function recognizeBloodPressure(imgPath) {
    if (!fs.existsSync(imgPath)) {
        return { success: false, error: "File not found" };
    }

    const image = await Jimp.read(imgPath);
    const w = image.bitmap.width;
    const h = image.bitmap.height;

    // 1. 缩放到标准高度
    const maxDim = 800;
    let targetW = w;
    let targetH = h;
    if (w > maxDim || h > maxDim) {
        if (w > h) {
            targetH = Math.round((h * maxDim) / w);
            targetW = maxDim;
        } else {
            targetW = Math.round((w * maxDim) / h);
            targetH = maxDim;
        }
        image.resize({ w: targetW, h: targetH });
    }

    // 2. 裁剪窄核心屏区域 (同步优化后的 X:47%, W:34% 排除白色塑料边缘干扰)
    const cropX = Math.round(targetW * 0.47);
    const cropY = Math.round(targetH * 0.36);
    const cropW = Math.round(targetW * 0.34);
    const cropH = Math.round(targetH * 0.47);
    const croppedImage = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    const subW = croppedImage.bitmap.width;
    const subH = croppedImage.bitmap.height;

    // 3. 基础二值化与局部定向清边缘+膨胀
    preprocessBradley(croppedImage, 6);
    clearBordersLeftRight(croppedImage);
    // dilateBlack(croppedImage);
    
    // 保存调试图以观察效果
    await croppedImage.write(`d:/xueya/ceshi_file/debug_directclear_preprocessed_${pathBasename(imgPath)}`);

    // 计算黑色像素的实际外围包络框 (Envelope BBox)
    let minX = subW, maxX = 0, minY = subH, maxY = 0;
    let hasBlack = false;
    croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
        if (this.bitmap.data[idx] === 0) { // 黑色像素
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasBlack = true;
        }
    });

    let envelope = { minX: 0, maxX: subW - 1, minY: 0, maxY: subH - 1 };
    if (hasBlack) {
        // 留出 3px 的边距以防止贴死影响识别
        envelope = {
            minX: Math.max(minX - 3, 0),
            maxX: Math.min(maxX + 3, subW - 1),
            minY: Math.max(minY - 3, 0),
            maxY: Math.min(maxY + 3, subH - 1)
        };
        console.log(`    [BBox] Detected BBox: Y=[${envelope.minY} - ${envelope.maxY}], X=[${envelope.minX} - ${envelope.maxX}]`);
    }

    // 4. 定义物理切割辅助函数 (基于动态包络框比例)
    const makeSlice = (yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) => {
        const slice = croppedImage.clone();
        const boxW = envelope.maxX - envelope.minX + 1;
        const boxH = envelope.maxY - envelope.minY + 1;

        const startY = Math.round(envelope.minY + boxH * yStartPct);
        const endY = Math.round(envelope.minY + boxH * yEndPct);
        const startX = Math.round(envelope.minX + boxW * xStartPct);
        const endX = Math.round(envelope.minX + boxW * xEndPct);

        slice.scan(0, 0, subW, subH, function(x, y, idx) {
            if (x < startX || x >= endX || y < startY || y >= endY) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
        return slice;
    };

    // 基于包络框的多路自适应物理切片 (精准物理行高隔离带切分)
    const slices = {
        sys: makeSlice(0.0, 0.27),
        diaWide: makeSlice(0.28, 0.60),
        diaMid: makeSlice(0.30, 0.59),
        diaNarrow: makeSlice(0.32, 0.58),
        pulse: makeSlice(0.61, 1.0, 0.0, 1.0)
    };

    // 保存分流切片图以作观察
    await slices.sys.write(`d:/xueya/ceshi_file/debug_directclear_sys_${pathBasename(imgPath)}`);
    await slices.diaWide.write(`d:/xueya/ceshi_file/debug_directclear_diawide_${pathBasename(imgPath)}`);
    await slices.diaMid.write(`d:/xueya/ceshi_file/debug_directclear_diamid_${pathBasename(imgPath)}`);
    await slices.diaNarrow.write(`d:/xueya/ceshi_file/debug_directclear_dianarrow_${pathBasename(imgPath)}`);
    await slices.pulse.write(`d:/xueya/ceshi_file/debug_directclear_pulse_${pathBasename(imgPath)}`);

    const sysCandidates = [];
    const diaCandidates = [];
    const pulseCandidates = [];

    const addCandidate = (val, source, type) => {
        if (!val) return;
        const mapped = mapConfusedCharacters(val);
        const num = parseInt(mapped.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) {
            if (type === 'sys') sysCandidates.push({ num, source, raw: val });
            if (type === 'dia') diaCandidates.push({ num, source, raw: val });
            if (type === 'pulse') pulseCandidates.push({ num, source, raw: val });
        }
    };

    // 5. 多路 OCR 识别
    const targets = [
        { name: 'sys', img: slices.sys, desc: 'SYS' },
        { name: 'dia', img: slices.diaWide, desc: 'DIA_Wide' },
        { name: 'dia', img: slices.diaMid, desc: 'DIA_Mid' },
        { name: 'dia', img: slices.diaNarrow, desc: 'DIA_Narrow' },
        { name: 'pulse', img: slices.pulse, desc: 'PULSE' }
    ];

    for (const target of targets) {
        const buffer = await target.img.getBuffer('image/jpeg');
        const psms = ['11', '7'];
        for (const psm of psms) {
            const worker = await Tesseract.createWorker('eng', 1);
            await worker.setParameters({
                tessedit_pageseg_mode: psm,
                tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
            });
            try {
                const { data: { text } } = await worker.recognize(buffer);
                const raw = text.trim();
                console.log(`    [${target.desc}] PSM:${psm} -> Raw: "${raw.replace(/\n/g, '\\n')}"`);
                if (raw) {
                    addCandidate(raw, `${target.desc}_PSM${psm}`, target.name);
                }
            } catch (e) {
                console.error(`Error in OCR:`, e);
            } finally {
                await worker.terminate();
            }
        }
    }

    // 6. 生理学表决
    const getBestValue = (candidates, minVal, maxVal) => {
        const counts = {};
        candidates.forEach(cand => {
            const val = cand.num;
            if (val >= minVal && val <= maxVal) {
                counts[val] = (counts[val] || 0) + 1;
            }
        });

        let bestVal = null;
        let maxCount = 0;
        for (const valStr in counts) {
            const val = parseInt(valStr);
            const count = counts[valStr];
            if (count > maxCount) {
                maxCount = count;
                bestVal = val;
            }
        }
        return bestVal;
    };

    const sys = getBestValue(sysCandidates, 90, 195);
    const dia = getBestValue(diaCandidates, 50, 115);
    const pulse = getBestValue(pulseCandidates, 45, 120);

    return {
        success: true,
        result: { sys, dia, pulse },
        details: { sysCandidates, diaCandidates, pulseCandidates }
    };
}

function pathBasename(path) {
    const parts = path.split('/');
    return parts[parts.length - 1];
}

function mapConfusedCharacters(str) {
    if (!str) return "";
    let res = "";
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const lower = char.toLowerCase();
        if (lower === 'i' || lower === 'l' || char === '|') {
            res += '1';
        } else if (lower === 'o' || lower === 'u') {
            res += '0';
        } else if (lower === 's') {
            res += '5';
        } else if (lower === 'b') {
            res += '8';
        } else if (lower === 'z') {
            res += '2';
        } else if (lower === 't') {
            res += '7';
        } else if (lower === 'g') {
            res += '9';
        } else {
            res += char;
        }
    }
    return res;
}

function clearBordersLeftRight(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;

    const visited = new Uint8Array(w * h);
    const queue = [];

    // 只从左右最边缘开始扫描 (x = 0 和 x = w - 1)，将和边缘连通的黑色连通域清空
    for (let y = 0; y < h; y++) {
        const idxL = y * w + 0;
        if (data[idxL * 4] === 0 && visited[idxL] === 0) {
            visited[idxL] = 1;
            queue.push(0, y);
        }
        const idxR = y * w + (w - 1);
        if (data[idxR * 4] === 0 && visited[idxR] === 0) {
            visited[idxR] = 1;
            queue.push(w - 1, y);
        }
    }

    let head = 0;
    while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];

        const dirs = [
            [0, -1], [0, 1], [-1, 0], [1, 0]
        ];
        for (let i = 0; i < dirs.length; i++) {
            const nx = cx + dirs[i][0];
            const ny = cy + dirs[i][1];

            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const nidx = ny * w + nx;
                if (visited[nidx] === 0 && data[nidx * 4] === 0) {
                    visited[nidx] = 1;
                    queue.push(nx, ny);
                }
            }
        }
    }

    for (let i = 0; i < w * h; i++) {
        if (visited[i] === 1) {
            const pixelIdx = i * 4;
            data[pixelIdx] = 255;
            data[pixelIdx + 1] = 255;
            data[pixelIdx + 2] = 255;
        }
    }
}

function dilateBlack(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    
    const temp = new Uint8Array(w * h);
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        temp[y * w + x] = this.bitmap.data[idx];
    });

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        if (temp[y * w + x] === 255) {
            let hasBlack = false;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= w) continue;
                    if (temp[ny * w + nx] === 0) {
                        hasBlack = true;
                        break;
                    }
                }
                if (hasBlack) break;
            }
            if (hasBlack) {
                this.bitmap.data[idx] = 0;
                this.bitmap.data[idx + 1] = 0;
                this.bitmap.data[idx + 2] = 0;
            }
        }
    });
}

function preprocessBradley(jimpImg, t = 10) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const gray = new Uint8Array(w * h);

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        gray[y * w + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    });

    const intImg = new Uint32Array(w * h);
    for (let i = 0; i < w; i++) {
        let sum = 0;
        for (let j = 0; j < h; j++) {
            sum += gray[j * w + i];
            if (i === 0) {
                intImg[j * w + i] = sum;
            } else {
                intImg[j * w + i] = intImg[j * w + i - 1] + sum;
            }
        }
    }

    const S = Math.round(w / 8);
    const halfS = Math.round(S / 2);

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        const x1 = Math.max(x - halfS, 0);
        const x2 = Math.min(x + halfS, w - 1);
        const y1 = Math.max(y - halfS, 0);
        const y2 = Math.min(y + halfS, h - 1);

        const count = (x2 - x1) * (y2 - y1);
        const idxTopLeft = y1 * w + x1;
        const idxTopRight = y1 * w + x2;
        const idxBottomLeft = y2 * w + x1;
        const idxBottomRight = y2 * w + x2;

        const sum = intImg[idxBottomRight] - intImg[idxTopRight] - intImg[idxBottomLeft] + intImg[idxTopLeft];
        const mean = sum / count;

        const currGray = gray[y * w + x];
        const val = currGray * 100 < mean * (100 - t) ? 0 : 255;

        this.bitmap.data[idx] = val;
        this.bitmap.data[idx + 1] = val;
        this.bitmap.data[idx + 2] = val;
    });
}

async function runAll() {
    for (const img of images) {
        console.log(`\n==================================================`);
        console.log(`Running Grand-Tuned OCR on: ${img.name}`);
        console.log(`==================================================`);
        const start = Date.now();
        const res = await recognizeBloodPressure(img.path);
        const duration = Date.now() - start;
        console.log("Final Result:", JSON.stringify(res.result));
        console.log(`Time taken: ${duration}ms`);
        console.log("Details:");
        console.log("  SYS candidates:", JSON.stringify(res.details.sysCandidates));
        console.log("  DIA candidates:", JSON.stringify(res.details.diaCandidates));
        console.log("  PULSE candidates:", JSON.stringify(res.details.pulseCandidates));
    }
}

runAll().catch(console.error);
