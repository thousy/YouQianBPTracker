const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const imgPath = "d:/xueya/微信图片_20260624201424_422_197.jpg";

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

async function run() {
    console.log("Loading image:", imgPath);
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

    const cropX = Math.round(targetW * 0.47);
    const cropY = Math.round(targetH * 0.36);
    const cropW = Math.round(targetW * 0.37);
    const cropH = Math.round(targetH * 0.47);

    const cropped = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });
    const subW = cropped.bitmap.width;
    const subH = cropped.bitmap.height;

    // 对比度拉伸 + Bradley 二值化
    preprocessImageGrayContrast(cropped);
    preprocessBradley(cropped, 10);
    clearBordersLeftRight(cropped);
    dilateBlack(cropped);

    await cropped.write('d:/xueya/ceshi_file/debug_contrast_bin_weixin.jpg');

    const makeSlice = (yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) => {
        const slice = cropped.clone();
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

    const sysSlice = makeSlice(0.0, 0.38);
    const diaSlice = makeSlice(0.35, 0.69);

    await sysSlice.write('d:/xueya/ceshi_file/debug_contrast_bin_weixin_sys.jpg');
    await diaSlice.write('d:/xueya/ceshi_file/debug_contrast_bin_weixin_dia.jpg');

    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '11',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    const bufSys = await sysSlice.getBuffer('image/jpeg');
    const { data: { text: sysText } } = await worker.recognize(bufSys);
    console.log("SYS Raw Text:", JSON.stringify(sysText.trim()));
    console.log("SYS Mapped:", mapConfusedCharacters(sysText.trim()).replace(/[^0-9]/g, ''));

    const bufDia = await diaSlice.getBuffer('image/jpeg');
    const { data: { text: diaText } } = await worker.recognize(bufDia);
    console.log("DIA Raw Text:", JSON.stringify(diaText.trim()));
    console.log("DIA Mapped:", mapConfusedCharacters(diaText.trim()).replace(/[^0-9]/g, ''));

    await worker.terminate();
}

run().catch(console.error);
