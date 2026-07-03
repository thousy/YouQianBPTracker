const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');

const imgPath = "d:/xueya/测试OCR.jpg";

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

async function testWholeCrop(cropParams, desc) {
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

    const cropX = Math.round(targetW * cropParams.x);
    const cropY = Math.round(targetH * cropParams.y);
    const cropW = Math.round(targetW * cropParams.w);
    const cropH = Math.round(targetH * cropParams.h);
    const cropped = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    // 仅作对比度拉伸，不作自适应二值化和 BFS 边缘抹杀！
    preprocessImageGrayContrast(cropped);

    const buf = await cropped.getBuffer('image/png');
    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '11',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT\n '
    });

    const { data: { text } } = await worker.recognize(buf);
    console.log(`[${desc}] Raw Text:\n`, text);
    await worker.terminate();
}

async function main() {
    const crops = [
        { name: "Narrow (0.50/0.36/0.31/0.47)", x: 0.50, y: 0.36, w: 0.31, h: 0.47 },
        { name: "Wide (0.47/0.36/0.37/0.47)", x: 0.47, y: 0.36, w: 0.37, h: 0.47 },
        { name: "Original app.js (0.32/0.28/0.60/0.60)", x: 0.32, y: 0.28, w: 0.60, h: 0.60 },
        { name: "Full Image (0.0/0.0/1.0/1.0)", x: 0.0, y: 0.0, w: 1.0, h: 1.0 }
    ];

    for (const crop of crops) {
        await testWholeCrop(crop, crop.name);
    }
}

main().catch(console.error);
