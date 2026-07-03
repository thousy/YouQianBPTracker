const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

const images = [
    { name: "media_1782309257139", path: "C:/Users/admin/.gemini/antigravity-ide/brain/519b9d0f-a5c3-428d-b95f-4b5503be127a/media__1782309257139.jpg" },
    { name: "weixin_image", path: "d:/xueya/temp_artifact_0.jpg" }
];

let worker11 = null;
let worker7 = null;

async function initWorkers() {
    console.log("Initializing Tesseract Workers...");
    worker11 = await Tesseract.createWorker('eng', 1);
    await worker11.setParameters({
        tessedit_pageseg_mode: '11',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    worker7 = await Tesseract.createWorker('eng', 1);
    await worker7.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });
    console.log("Workers ready!");
}

async function terminateWorkers() {
    if (worker11) await worker11.terminate();
    if (worker7) await worker7.terminate();
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

function clearBordersRightOnly(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;
    const visited = new Uint8Array(w * h);
    const queue = [];
    for (let y = 0; y < h; y++) {
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

function preprocessBradley(jimpImg, t = 10) {
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

async function testParamCombination(imgPath, opt) {
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

    const cropX = Math.round(targetW * opt.cropX);
    const cropY = Math.round(targetH * opt.cropY);
    const cropW = Math.round(targetW * opt.cropW);
    const cropH = Math.round(targetH * opt.cropH);
    const croppedImage = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    const subW = croppedImage.bitmap.width;
    const subH = croppedImage.bitmap.height;

    // 关键优化：如果使用对比度预处理
    if (opt.useContrast) {
        preprocessImageGrayContrast(croppedImage);
    }
    preprocessBradley(croppedImage, 10);

    if (opt.borderMode === 'clearBFS_LeftRight') {
        clearBordersLeftRight(croppedImage);
    } else if (opt.borderMode === 'clearBFS_LeftMaskRightBFS') {
        const maskW = Math.round(subW * opt.maskPercent);
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            if (x < maskW) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx+1] = 255;
                this.bitmap.data[idx+2] = 255;
            }
        });
        clearBordersRightOnly(croppedImage);
    } else if (opt.borderMode === 'clearBFS_RightOnly') {
        clearBordersRightOnly(croppedImage);
    }

    dilateBlack(croppedImage);

    const makeSlice = (yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) => {
        const slice = croppedImage.clone();
        const startY = Math.round(subH * yStartPct);
        const endY = Math.round(subH * yEndPct);
        const startX = Math.round(subW * xStartPct);
        const endX = Math.round(subW * xEndPct);
        slice.scan(0, 0, subW, subH, function(x, y, idx) {
            if (x < startX || x >= endX || y < startY || y >= endY) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx+1] = 255;
                this.bitmap.data[idx+2] = 255;
            }
        });
        return slice;
    };

    const slices = {
        sys: makeSlice(0.0, 0.38),
        diaWide: makeSlice(0.31, 0.69),
        diaMid: makeSlice(0.35, 0.69),
        diaNarrow: makeSlice(0.38, 0.68),
        pulse: makeSlice(0.63, 1.0, 0.45, 1.0)
    };

    const sysCandidates = [];
    const diaCandidates = [];
    const pulseCandidates = [];

    const addCandidate = (val, type) => {
        if (!val) return;
        const mapped = mapConfusedCharacters(val);
        const num = parseInt(mapped.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) {
            if (type === 'sys') sysCandidates.push(num);
            if (type === 'dia') diaCandidates.push(num);
            if (type === 'pulse') pulseCandidates.push(num);
        }
    };

    const targets = [
        { name: 'sys', img: slices.sys },
        { name: 'dia', img: slices.diaWide },
        { name: 'dia', img: slices.diaMid },
        { name: 'dia', img: slices.diaNarrow },
        { name: 'pulse', img: slices.pulse }
    ];

    for (const target of targets) {
        const buffer = await target.img.getBuffer('image/jpeg');
        
        // PSM 11
        const { data: { text: text11 } } = await worker11.recognize(buffer);
        addCandidate(text11.trim(), target.name);

        // PSM 7
        const { data: { text: text7 } } = await worker7.recognize(buffer);
        addCandidate(text7.trim(), target.name);
    }

    const getBestValue = (candidates, minVal, maxVal) => {
        const counts = {};
        candidates.forEach(val => {
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
    const dia = getBestValue(diaCandidates, 50, 110);
    const pulse = getBestValue(pulseCandidates, 45, 120);

    return { sys, dia, pulse };
}

async function search() {
    await initWorkers();

    const borderModes = [
        { mode: 'clearBFS_LeftRight', useContrast: false },
        { mode: 'clearBFS_LeftRight', useContrast: true },
        { mode: 'clearBFS_RightOnly', useContrast: false },
        { mode: 'clearBFS_RightOnly', useContrast: true },
        { mode: 'clearBFS_LeftMaskRightBFS', maskPercent: 0.05, useContrast: true },
        { mode: 'clearBFS_LeftMaskRightBFS', maskPercent: 0.05, useContrast: false }
    ];

    // 遍历参数
    const cropXList = [0.45, 0.46, 0.47, 0.48, 0.49, 0.50];
    const cropWList = [0.31, 0.33, 0.35, 0.37];

    console.log(`Starting parameter search. Total combinations: ${cropXList.length * cropWList.length * borderModes.length}`);
    
    let found = 0;

    for (const cropX of cropXList) {
        for (const cropW of cropWList) {
            for (const bm of borderModes) {
                const opt = {
                    cropX,
                    cropY: 0.36,
                    cropW,
                    cropH: 0.47,
                    borderMode: bm.mode,
                    maskPercent: bm.maskPercent,
                    useContrast: bm.useContrast
                };

                try {
                    const res1 = await testParamCombination(images[0].path, opt);
                    if (res1.sys === 150 && res1.dia === 81 && res1.pulse === 83) {
                        const res2 = await testParamCombination(images[1].path, opt);
                        if (res2.sys === 150 && res2.dia === 101 && res2.pulse === 83) {
                            console.log(`[SUCCESS] Double-Pass Parameters:`);
                            console.log(JSON.stringify(opt, null, 2));
                            console.log(`Media results:`, res1);
                            console.log(`Weixin results:`, res2);
                            found++;
                        }
                    }
                } catch (e) {
                    // 忽略错误继续
                }
            }
        }
    }

    console.log(`Search completed. Found ${found} double-pass parameter combinations.`);
    await terminateWorkers();
}

search().catch(console.error);
