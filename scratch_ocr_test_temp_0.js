const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

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

function applyFirewall(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    
    // 智能防火墙：强行将偏外部边框区域涂白，保护内部数字不被去噪传染
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        const isLeft = (x <= 12);
        const isRight = (x >= w - 55); // 调回到安全宽度，因为我们限制了去噪注入高度
        const isBottom = (y >= h - 16); // 底部保留小隔离即可
        const isTop = (y <= 10);
        
        // 智能下左侧隔离带：在下半部分，强行把左侧 80 像素内涂白，切断底部横边框
        const isBottomLeftGate = (y >= h * 0.60 && x <= 80);
        
        if (isLeft || isRight || isBottom || isTop || isBottomLeftGate) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx+1] = 255;
            this.bitmap.data[idx+2] = 255;
        }
    });
}

function clearBordersLeftRight(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;
    const visited = new Uint8Array(w * h);
    const queue = [];
    
    const seedL = 13;
    const seedR = w - 56;
    
    // 关键修正：限制去噪种子仅在图像上半部分 (y < h * 0.60) 注入，防止下半部外壳粗横框误引入去噪算法，误杀脉搏
    const limitY = Math.round(h * 0.60);
    for (let y = 0; y < limitY; y++) {
        const idxL = y * w + seedL;
        if (seedL < w && data[idxL * 4] === 0 && visited[idxL] === 0) {
            visited[idxL] = 1;
            queue.push(seedL, y);
        }
        const idxR = y * w + seedR;
        if (seedR >= 0 && data[idxR * 4] === 0 && visited[idxR] === 0) {
            visited[idxR] = 1;
            queue.push(seedR, y);
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

async function runOCRTest(imgPath) {
    console.log(`Processing image: ${imgPath}`);
    const image = await Jimp.read(imgPath);
    const w = image.bitmap.width;
    const h = image.bitmap.height;

    // 缩放到标准高度
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

    // 裁剪两路定位 Canvas
    // Road 1 窄裁剪 (X:47%, Y:36%, W:34%, H:47%)
    const cropX1 = Math.round(targetW * 0.47);
    const cropY1 = Math.round(targetH * 0.36);
    const cropW1 = Math.round(targetW * 0.34);
    const cropH1 = Math.round(targetH * 0.47);

    // Road 2 & 3 中宽裁剪 (优化后 X:42%, Y:34%, W:43%, H:50% 防止百位数字1被切断)
    const cropX2 = Math.round(targetW * 0.42);
    const cropY2 = Math.round(targetH * 0.34);
    const cropW2 = Math.round(targetW * 0.43);
    const cropH2 = Math.round(targetH * 0.50);

    const canvasRoad1 = image.clone().crop({ x: cropX1, y: cropY1, w: cropW1, h: cropH1 });
    const canvasRoad2 = image.clone().crop({ x: cropX2, y: cropY2, w: cropW2, h: cropH2 });
    const canvasRoad3 = canvasRoad2.clone();

    // Road 1 预处理
    preprocessImage(canvasRoad1, 10); 
    applyFirewall(canvasRoad1);
    clearBordersLeftRight(canvasRoad1);
    dilateBlack(canvasRoad1);
    await canvasRoad1.write(`d:/xueya/ceshi_file/debug_bin_road1.jpg`);

    // Road 2 预处理
    preprocessImageGrayContrast(canvasRoad2);
    preprocessImage(canvasRoad2, 10);
    await canvasRoad2.write(`d:/xueya/ceshi_file/debug_bin_road2_noclear.jpg`);
    applyFirewall(canvasRoad2);
    await canvasRoad2.write(`d:/xueya/ceshi_file/debug_bin_road2_firewall_only.jpg`);
    clearBordersLeftRight(canvasRoad2);
    dilateBlack(canvasRoad2);
    await canvasRoad2.write(`d:/xueya/ceshi_file/debug_bin_road2.jpg`);

    // Road 3 预处理 (共享拉伸图)
    preprocessImageGrayContrast(canvasRoad3);

    const envelope1 = getCanvasEnvelope(canvasRoad1);
    const envelope2 = getCanvasEnvelope(canvasRoad2);
    const envelope3 = envelope2;

    console.log("Road 1 Envelope:", envelope1);
    console.log("Road 2 Envelope:", envelope2);

    const makeSlices = (srcCanvas, envelope) => {
        if (envelope) {
            return {
                sys: makeCanvasSlice(srcCanvas, 0.0, 0.27, 0, 1, envelope),
                diaWide: makeCanvasSlice(srcCanvas, 0.28, 0.60, 0, 1, envelope),
                diaMid: makeCanvasSlice(srcCanvas, 0.28, 0.59, 0, 1, envelope), 
                diaNarrow: makeCanvasSlice(srcCanvas, 0.29, 0.58, 0, 1, envelope), 
                pulse: makeCanvasSlice(srcCanvas, 0.57, 1.0, 0.0, 1.0, envelope) // 改为 0.57 包含83的完整头部
            };
        }
        return {
            sys: makeCanvasSlice(srcCanvas, 0.0, 0.38),
            diaWide: makeCanvasSlice(srcCanvas, 0.31, 0.69),
            diaMid: makeCanvasSlice(srcCanvas, 0.33, 0.69),
            diaNarrow: makeCanvasSlice(srcCanvas, 0.35, 0.68),
            pulse: makeCanvasSlice(srcCanvas, 0.59, 1.0, 0.45, 1.0)
        };
    };

    const slices1 = makeSlices(canvasRoad1, envelope1);
    const slices2 = makeSlices(canvasRoad2, envelope2);
    const slices3 = makeSlices(canvasRoad3, envelope3);

    // 保存切片文件以便查看效果
    for (const key in slices1) {
        await slices1[key].write(`d:/xueya/ceshi_file/debug_slice_road1_${key}.jpg`);
    }
    for (const key in slices2) {
        await slices2[key].write(`d:/xueya/ceshi_file/debug_slice_road2_${key}.jpg`);
    }
    for (const key in slices3) {
        await slices3[key].write(`d:/xueya/ceshi_file/debug_slice_road3_${key}.jpg`);
    }

    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    const runRoad = async (slices, roadName) => {
        console.log(`\n--- Running OCR on: ${roadName} ---`);
        for (const key in slices) {
            const buf = await slices[key].getBuffer('image/png');
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

async function main() {
    await runOCRTest("d:/xueya/测试OCR.jpg");
}

main().catch(console.error);
