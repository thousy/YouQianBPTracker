const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

const tempDir = 'C:/Users/admin/.gemini/antigravity-ide/brain/65e82c2e-0713-4239-973b-cb9f439c5d16/.tempmediaStorage';
const testLocalImg = 'd:/xueya/测试OCR.jpg';

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

function preprocessImage(jimpImg, t = 10) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const gray = new Uint8Array(w * h);
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        gray[y * w + x] = Math.round(0.299 * this.bitmap.data[idx] + 0.587 * this.bitmap.data[idx+1] + 0.114 * this.bitmap.data[idx+2]);
    });
    const intImg = new Uint32Array(w * h);
    for (let i = 0; i < w; i++) {
        let sum = 0;
        for (let j = 0; j < h; j++) {
            sum += gray[j * w + i];
            intImg[j * w + i] = (i === 0) ? sum : intImg[j * w + i - 1] + sum;
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
        const sum = intImg[y2 * w + x2] - intImg[y1 * w + x2] - intImg[y2 * w + x1] + intImg[y1 * w + x1];
        const mean = sum / count;
        const val = gray[y * w + x] * 100 < mean * (100 - t) ? 0 : 255;
        this.bitmap.data[idx] = val;
        this.bitmap.data[idx + 1] = val;
        this.bitmap.data[idx + 2] = val;
    });
}

function preprocessImageGrayContrast(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    let minG = 255;
    let maxG = 0;
    const grays = new Uint8Array(w * h);

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grays[y * w + x] = gray;
        if (gray < minG) minG = gray;
        if (gray > maxG) maxG = gray;
    });

    const range = maxG - minG || 1;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const origGray = grays[y * w + x];
            let newGray = Math.round(((origGray - minG) * 255) / range);
            const lowBound = 25;
            const highBound = 230;
            if (newGray < lowBound) {
                newGray = 0;
            } else if (newGray > highBound) {
                newGray = 255;
            } else {
                newGray = Math.round(((newGray - lowBound) * 255) / (highBound - lowBound));
            }
            jimpImg.bitmap.data[idx] = newGray;
            jimpImg.bitmap.data[idx + 1] = newGray;
            jimpImg.bitmap.data[idx + 2] = newGray;
        }
    }
}

// 强涂绝对底部 15 像素，抹去可能存在的大黑杠与外壳杂质，阻断 BFS 向上抹除脉搏
function eraseAbsoluteBottom(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const eraseY = h - 15;
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        if (y >= eraseY) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
        }
    });
}

function clearBordersLeftRight(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;
    const visited = new Uint8Array(w * h);
    const queue = [];
    
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
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
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

function makeCanvasSlice(srcCanvas, yStartPct, yEndPct, xStartPct = 0, xEndPct = 1, envelope = null) {
    const slice = srcCanvas.clone();
    const w = slice.bitmap.width;
    const h = slice.bitmap.height;

    let startY, endY, startX, endX;
    if (envelope) {
        const boxW = envelope.maxX - envelope.minX + 1;
        const boxH = envelope.maxY - envelope.minY + 1;
        startY = Math.round(envelope.minY + boxH * yStartPct);
        endY = Math.round(envelope.minY + boxH * yEndPct);
        startX = Math.round(envelope.minX + boxW * xStartPct);
        endX = Math.round(envelope.minX + boxW * xEndPct);
    } else {
        startY = Math.round(h * yStartPct);
        endY = Math.round(h * yEndPct);
        startX = Math.round(w * xStartPct);
        endX = Math.round(w * xEndPct);
    }

    slice.scan(0, 0, w, h, function(x, y, idx) {
        if (x < startX || x >= endX || y < startY || y >= endY) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx+1] = 255;
            this.bitmap.data[idx+2] = 255;
        }
    });
    return slice;
}

// 正常的全图包络扫描
function getCanvasEnvelope(srcCanvas) {
    const w = srcCanvas.bitmap.width;
    const h = srcCanvas.bitmap.height;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let hasBlack = false;

    srcCanvas.scan(0, 0, w, h, function(x, y, idx) {
        if (this.bitmap.data[idx] === 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasBlack = true;
        }
    });

    if (hasBlack) {
        return {
            minX: Math.max(minX - 3, 0),
            maxX: Math.min(maxX + 3, w - 1),
            minY: Math.max(minY - 3, 0),
            maxY: Math.min(maxY + 3, h - 1)
        };
    }
    return null;
}

async function runOCRTest(imgPath, worker) {
    const image = await Jimp.read(imgPath);
    const w = image.bitmap.width;
    const h = image.bitmap.height;

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

    // Road 1 窄裁剪 (保持原版 0.47/0.34)
    const cropX1 = Math.round(targetW * 0.47);
    const cropY1 = Math.round(targetH * 0.36);
    const cropW1 = Math.round(targetW * 0.34);
    const cropH1 = Math.round(targetH * 0.47);
    const canvasRoad1 = image.clone().crop({ x: cropX1, y: cropY1, w: cropW1, h: cropH1 });

    // Road 2 & 3 中宽裁剪 (使用宽参数 0.43/0.41/0.50 拥抱百位数“1”)
    const cropX2 = Math.round(targetW * 0.43);
    const cropY2 = Math.round(targetH * 0.34);
    const cropW2 = Math.round(targetW * 0.41);
    const cropH2 = Math.round(targetH * 0.50);
    const canvasRoad2 = image.clone().crop({ x: cropX2, y: cropY2, w: cropW2, h: cropH2 });
    const canvasRoad3 = canvasRoad2.clone();

    // Road 4 专属脉搏定位裁剪 (高度 0.13)
    const cropX_pulse = Math.round(targetW * 0.51);
    const cropY_pulse = Math.round(targetH * 0.58);
    const cropW_pulse = Math.round(targetW * 0.19);
    const cropH_pulse = Math.round(targetH * 0.13);
    const canvasPulseDedicated = image.clone().crop({ x: cropX_pulse, y: cropY_pulse, w: cropW_pulse, h: cropH_pulse });

    // Road 1 预处理：擦除最底部 15 像素防去噪误抹
    preprocessImage(canvasRoad1, 10);
    eraseAbsoluteBottom(canvasRoad1);
    clearBordersLeftRight(canvasRoad1);
    dilateBlack(canvasRoad1);

    // Road 2 预处理：擦除最底部 15 像素防去噪误抹
    preprocessImageGrayContrast(canvasRoad2);
    preprocessImage(canvasRoad2, 10);
    eraseAbsoluteBottom(canvasRoad2);
    clearBordersLeftRight(canvasRoad2);
    dilateBlack(canvasRoad2);

    // Road 3 预处理：擦除最底部 15 像素
    preprocessImageGrayContrast(canvasRoad3);
    eraseAbsoluteBottom(canvasRoad3);

    // Road 4 专属脉搏预处理
    preprocessImageGrayContrast(canvasPulseDedicated);
    preprocessImage(canvasPulseDedicated, 10);

    const envelope1 = getCanvasEnvelope(canvasRoad1);
    const envelope2 = getCanvasEnvelope(canvasRoad2);
    const envelope3 = envelope2;

    const makeSlices = (srcCanvas, envelope) => {
        if (envelope) {
            return {
                sys: makeCanvasSlice(srcCanvas, 0.0, 0.27, 0, 1, envelope),
                diaWide: makeCanvasSlice(srcCanvas, 0.28, 0.60, 0, 1, envelope),
                diaMid: makeCanvasSlice(srcCanvas, 0.30, 0.59, 0, 1, envelope),
                diaNarrow: makeCanvasSlice(srcCanvas, 0.32, 0.58, 0, 1, envelope),
                pulse: makeCanvasSlice(srcCanvas, 0.57, 1.0, 0.0, 1.0, envelope)
            };
        }
        return {
            sys: makeCanvasSlice(srcCanvas, 0.0, 0.38),
            diaWide: makeCanvasSlice(srcCanvas, 0.31, 0.69),
            diaMid: makeCanvasSlice(srcCanvas, 0.35, 0.69),
            diaNarrow: makeCanvasSlice(srcCanvas, 0.38, 0.68),
            pulse: makeCanvasSlice(srcCanvas, 0.58, 1.0, 0.45, 1.0)
        };
    };

    const slices1 = makeSlices(canvasRoad1, envelope1);
    const slices2 = makeSlices(canvasRoad2, envelope2);
    const slices3 = makeSlices(canvasRoad3, envelope3);

    const sysCandidates = [];
    const diaCandidates = [];
    const pulseCandidates = [];

    const addCandidate = (val, source, type) => {
        if (!val) return;
        const mapped = mapConfusedCharacters(val);
        let num = parseInt(mapped.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) {
            // 💡 强限制两位数才能自动补偿百位数“1”，防止个位噪点污染
            if (type === 'sys' && num >= 10 && num < 90 && (num + 100) >= 90 && (num + 100) <= 195) {
                num += 100;
            }
            if (type === 'dia' && num >= 10 && num < 50 && (num + 100) >= 90 && (num + 100) <= 110) {
                num += 100;
            }
            const item = { num, source };
            if (type === 'sys') sysCandidates.push(item);
            if (type === 'dia') diaCandidates.push(item);
            if (type === 'pulse') pulseCandidates.push(item);
        }
    };

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

    const solveForRoad = (roadPrefixes) => {
        const filteredSys = sysCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
        const filteredDia = diaCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
        const filteredPulse = pulseCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p) || (p === 'Road1' && c.source === 'Dedicated_PULSE')));

        const sys = getBestValue(filteredSys, 90, 195);
        const dia = getBestValue(filteredDia, 50, 110);
        const pulse = getBestValue(filteredPulse, 40, 160);

        if (sys && dia) {
            return { systolic: sys, diastolic: dia, pulse: pulse };
        }
        return null;
    };

    const runRoad = async (slices, name) => {
        for (const key in slices) {
            if (!slices[key]) continue;
            const buf = await slices[key].getBuffer('image/jpeg');
            const { data: { text } } = await worker.recognize(buf);
            addCandidate(text.trim(), `${name}_${key.toUpperCase()}`, key.startsWith('dia') ? 'dia' : (key === 'sys' ? 'sys' : 'pulse'));
        }
    };

    // 运行 Road 1
    await runRoad(slices1, "Road1");
    // 额外识别专属脉搏
    const bufPulse = await canvasPulseDedicated.getBuffer('image/jpeg');
    const { data: { text: textPulse } } = await worker.recognize(bufPulse);
    addCandidate(textPulse.trim(), "Dedicated_PULSE", "pulse");

    let result = solveForRoad(["Road1", "Dedicated"]);
    if (result) return result;

    // 运行 Road 2
    await runRoad(slices2, "Road2");
    result = solveForRoad(["Road2", "Dedicated"]) || solveForRoad(["Road1", "Road2", "Dedicated"]);
    if (result) return result;

    // 运行 Road 3
    await runRoad(slices3, "Road3");
    result = solveForRoad(["Road1", "Road2", "Road3", "Dedicated"]);
    return result || { systolic: getBestValue(sysCandidates, 90, 195), diastolic: getBestValue(diaCandidates, 50, 110), pulse: getBestValue(pulseCandidates, 40, 160) };
}

async function main() {
    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    console.log("=== Running Final Absolute-Erase-Bottom + Dedicated Pulse Regression ===");
    try {
        const res = await runOCRTest(testLocalImg, worker);
        console.log(`[测试OCR.jpg] => SYS: ${res.systolic}, DIA: ${res.diastolic}, PULSE: ${res.pulse} (Expected: 162, 108, 83)`);
    } catch (e) {
        console.error("Error on local test image:", e);
    }

    if (fs.existsSync(tempDir)) {
        console.log("\n=== Running Regression Test on Artifact Storage Images ===");
        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg')).slice(0, 5);
        for (const file of files) {
            const p = path.join(tempDir, file);
            try {
                const res = await runOCRTest(p, worker);
                console.log(`[${file}] => SYS: ${res.systolic}, DIA: ${res.diastolic}, PULSE: ${res.pulse}`);
            } catch (e) {
                console.error(`Error on file ${file}:`, e.message);
            }
        }
    }

    await worker.terminate();
}

main().catch(console.error);
