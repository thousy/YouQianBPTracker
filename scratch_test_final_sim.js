const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const path = require('path');

const imgPath = "d:/xueya/测试OCR.jpg";

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

// 模拟 makeCanvasSlice
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

// 计算包络框
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

async function main() {
    console.log("Loading:", imgPath);
    const image = await Jimp.read(imgPath);
    
    // 缩放到标准高度
    const maxDim = 800;
    let targetW = image.bitmap.width;
    let targetH = image.bitmap.height;
    if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
        } else {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
        }
        image.resize({ w: targetW, h: targetH });
    }

    // Road 1 窄裁剪 (X:47%, Y:36%, W:34%, H:47%)
    const cropX1 = Math.round(targetW * 0.47);
    const cropY1 = Math.round(targetH * 0.36);
    const cropW1 = Math.round(targetW * 0.34);
    const cropH1 = Math.round(targetH * 0.47);
    const canvasRoad1 = image.clone().crop({ x: cropX1, y: cropY1, w: cropW1, h: cropH1 });

    // Road 2 & 3 中宽裁剪 (X:43%, Y:34%, W:41%, H:50% 防止偏左百位数字1被切断)
    const cropX2 = Math.round(targetW * 0.43);
    const cropY2 = Math.round(targetH * 0.34);
    const cropW2 = Math.round(targetW * 0.41);
    const cropH2 = Math.round(targetH * 0.50);
    const canvasRoad2 = image.clone().crop({ x: cropX2, y: cropY2, w: cropW2, h: cropH2 });
    const canvasRoad3 = canvasRoad2.clone();

    // Road 1 预处理
    preprocessImage(canvasRoad1, 10);
    clearBordersLeftRight(canvasRoad1);
    dilateBlack(canvasRoad1);

    // Road 2 预处理
    preprocessImageGrayContrast(canvasRoad2);
    preprocessImage(canvasRoad2, 10);
    clearBordersLeftRight(canvasRoad2);
    dilateBlack(canvasRoad2);

    // Road 3 预处理
    preprocessImageGrayContrast(canvasRoad3);

    // 扫描包络
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
                pulse: makeCanvasSlice(srcCanvas, 0.61, 1.0, 0.0, 1.0, envelope)
            };
        }
        return {
            sys: makeCanvasSlice(srcCanvas, 0.0, 0.38),
            diaWide: makeCanvasSlice(srcCanvas, 0.31, 0.69),
            diaMid: makeCanvasSlice(srcCanvas, 0.35, 0.69),
            diaNarrow: makeCanvasSlice(srcCanvas, 0.38, 0.68),
            pulse: makeCanvasSlice(srcCanvas, 0.63, 1.0, 0.45, 1.0)
        };
    };

    const slices1 = makeSlices(canvasRoad1, envelope1);
    const slices2 = makeSlices(canvasRoad2, envelope2);
    const slices3 = makeSlices(canvasRoad3, envelope3);

    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    const runRoad = async (slices, roadName) => {
        console.log(`\n--- Running OCR on: ${roadName} ---`);
        for (const key in slices) {
            const buf = await slices[key].getBuffer('image/jpeg');
            const { data: { text } } = await worker.recognize(buf);
            const val = mapConfusedCharacters(text.trim());
            const num = parseInt(val.replace(/[^0-9]/g, ''));
            console.log(`  [${key}] Raw:`, JSON.stringify(text.trim()), `-> Mapped:`, val, `-> Num:`, num);
        }
    };

    await runRoad(slices1, "Road 1 (Bradley Bin)");
    await runRoad(slices2, "Road 2 (Contrast Bin)");
    await runRoad(slices3, "Road 3 (Contrast Gray)");

    await worker.terminate();
}

main().catch(console.error);
