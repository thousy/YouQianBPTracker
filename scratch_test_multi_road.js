const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const images = [
    { name: "media_1782309257139", path: "C:/Users/admin/.gemini/antigravity-ide/brain/519b9d0f-a5c3-428d-b95f-4b5503be127a/media__1782309257139.jpg" },
    { name: "weixin_image", path: "d:/xueya/temp_artifact_0.jpg" }
];

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

async function recognizeJointRoads(imgPath) {
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

    // 两个裁剪区域：窄裁剪（Road 1）和宽裁剪（Road 2 & 3）
    const cropNarrow = {
        x: Math.round(targetW * 0.50),
        y: Math.round(targetH * 0.36),
        w: Math.round(targetW * 0.31),
        h: Math.round(targetH * 0.47)
    };
    const cropWide = {
        x: Math.round(targetW * 0.46),
        y: Math.round(targetH * 0.34),
        w: Math.round(targetW * 0.38),
        h: Math.round(targetH * 0.50)
    };

    const imgRoad1 = image.clone().crop(cropNarrow);
    const imgRoad2 = image.clone().crop(cropWide);
    const imgRoad3 = image.clone().crop(cropWide);

    // Road 1: 二值化
    preprocessBradley(imgRoad1, 10);
    clearBordersLeftRight(imgRoad1);
    dilateBlack(imgRoad1);

    // Road 2: 先拉伸对比度再二值化
    preprocessImageGrayContrast(imgRoad2);
    preprocessBradley(imgRoad2, 10);
    clearBordersLeftRight(imgRoad2);
    dilateBlack(imgRoad2);

    // Road 3: 只拉伸对比度（灰度图）
    preprocessImageGrayContrast(imgRoad3);

    const makeSlice = (img, yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) => {
        const slice = img.clone();
        const sw = slice.bitmap.width;
        const sh = slice.bitmap.height;
        const startY = Math.round(sh * yStartPct);
        const endY = Math.round(sh * yEndPct);
        const startX = Math.round(sw * xStartPct);
        const endX = Math.round(sw * xEndPct);
        slice.scan(0, 0, sw, sh, function(x, y, idx) {
            if (x < startX || x >= endX || y < startY || y >= endY) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx+1] = 255;
                this.bitmap.data[idx+2] = 255;
            }
        });
        return slice;
    };

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

    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

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
        const filteredPulse = pulseCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));

        const sys = getBestValue(filteredSys, 90, 195);
        const dia = getBestValue(filteredDia, 50, 110);
        const pulse = getBestValue(filteredPulse, 45, 120);

        if (sys && dia) {
            return { sys, dia, pulse };
        }
        return null;
    };

    const slices1 = {
        sys: makeSlice(imgRoad1, 0.0, 0.38),
        diaWide: makeSlice(imgRoad1, 0.31, 0.69),
        diaMid: makeSlice(imgRoad1, 0.35, 0.69),
        pulse: makeSlice(imgRoad1, 0.63, 1.0, 0.45, 1.0)
    };

    const slices2 = {
        sys: makeSlice(imgRoad2, 0.0, 0.38),
        diaWide: makeSlice(imgRoad2, 0.31, 0.69),
        diaMid: makeSlice(imgRoad2, 0.35, 0.69),
        pulse: makeSlice(imgRoad2, 0.63, 1.0, 0.45, 1.0)
    };

    const slices3 = {
        sys: makeSlice(imgRoad3, 0.0, 0.38),
        diaWide: makeSlice(imgRoad3, 0.31, 0.69),
        diaMid: makeSlice(imgRoad3, 0.35, 0.69),
        pulse: makeSlice(imgRoad3, 0.63, 1.0, 0.45, 1.0)
    };

    const roads = [
        { slices: slices1, name: 'Road1' },
        { slices: slices2, name: 'Road2' },
        { slices: slices3, name: 'Road3' }
    ];

    let solved = false;
    let finalRes = null;

    for (let r = 0; r < roads.length; r++) {
        const road = roads[r];

        const bufSys = await road.slices.sys.getBuffer('image/png');
        const { data: { text: tSys } } = await worker.recognize(bufSys);
        addCandidate(tSys.trim(), `${road.name}_SYS`, 'sys');

        const bufDiaWide = await road.slices.diaWide.getBuffer('image/png');
        const { data: { text: tDiaWide } } = await worker.recognize(bufDiaWide);
        addCandidate(tDiaWide.trim(), `${road.name}_DIA_Wide`, 'dia');

        const bufDiaMid = await road.slices.diaMid.getBuffer('image/png');
        const { data: { text: tDiaMid } } = await worker.recognize(bufDiaMid);
        addCandidate(tDiaMid.trim(), `${road.name}_DIA_Mid`, 'dia');

        const bufPulse = await road.slices.pulse.getBuffer('image/png');
        const { data: { text: tPulse } } = await worker.recognize(bufPulse);
        addCandidate(tPulse.trim(), `${road.name}_PULSE`, 'pulse');

        // 短路评估
        const curSys = getBestValue(sysCandidates.filter(c => c.source.startsWith(road.name)), 90, 195);
        const curDia = getBestValue(diaCandidates.filter(c => c.source.startsWith(road.name)), 50, 110);
        const curPulse = getBestValue(pulseCandidates.filter(c => c.source.startsWith(road.name)), 45, 120);

        if (curSys && curDia) {
            finalRes = { sys: curSys, dia: curDia, pulse: curPulse };
            solved = true;
            console.log(`    [Short-Circuit] Solved by ${road.name}!`);
            break;
        }
    }

    if (!solved) {
        finalRes = solveForRoad(["Road1"]);
        if (!finalRes) {
            finalRes = solveForRoad(["Road2"]);
            if (!finalRes) {
                finalRes = solveForRoad(["Road1", "Road2"]);
                if (!finalRes) {
                    finalRes = solveForRoad(["Road1", "Road2", "Road3"]);
                }
            }
        }
        if (!finalRes) {
            finalRes = {
                sys: getBestValue(sysCandidates, 90, 195),
                dia: getBestValue(diaCandidates, 50, 110),
                pulse: getBestValue(pulseCandidates, 45, 120)
            };
        }
    }

    await worker.terminate();

    return {
        result: finalRes,
        details: { sysCandidates, diaCandidates, pulseCandidates }
    };
}

async function main() {
    for (const img of images) {
        console.log(`\n==================================================`);
        console.log(`Testing Joint-Roads OCR on: ${img.name}`);
        console.log(`==================================================`);
        const start = Date.now();
        const res = await recognizeJointRoads(img.path);
        console.log(`Final Result:`, JSON.stringify(res.result));
        console.log(`Time taken: ${Date.now() - start}ms`);
        console.log(`SYS Candidates:`, JSON.stringify(res.details.sysCandidates));
        console.log(`DIA Candidates:`, JSON.stringify(res.details.diaCandidates));
        console.log(`PULSE Candidates:`, JSON.stringify(res.details.pulseCandidates));
    }
}

main().catch(console.error);
