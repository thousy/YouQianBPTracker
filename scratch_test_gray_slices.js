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

    const cropX = Math.round(targetW * 0.40);
    const cropY = Math.round(targetH * 0.36);
    const cropW = Math.round(targetW * 0.46);
    const cropH = Math.round(targetH * 0.47);

    const cropped = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });
    const subW = cropped.bitmap.width;
    const subH = cropped.bitmap.height;

    // 纯灰度对比度拉伸
    preprocessImageGrayContrast(cropped);
    await cropped.write('d:/xueya/ceshi_file/debug_gray_preprocessed.jpg');

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

    const sysSlice = makeSlice(0.0, 0.24);
    const diaSlice = makeSlice(0.27, 0.58);
    const pulseSlice = makeSlice(0.60, 0.95, 0.45, 1.0);

    await sysSlice.write('d:/xueya/ceshi_file/debug_gray_sys.jpg');
    await diaSlice.write('d:/xueya/ceshi_file/debug_gray_dia.jpg');
    await pulseSlice.write('d:/xueya/ceshi_file/debug_gray_pulse.jpg');

    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT'
    });

    const runOcr = async (jimpImg, desc) => {
        const buf = await jimpImg.getBuffer('image/jpeg');
        const { data: { text } } = await worker.recognize(buf);
        console.log(`[${desc}] Raw:`, JSON.stringify(text.trim()));
    };

    await runOcr(sysSlice, "SYS");
    await runOcr(diaSlice, "DIA");
    await runOcr(pulseSlice, "PULSE");

    await worker.terminate();
}

run().catch(console.error);
