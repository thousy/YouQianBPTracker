const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const images = [
    { name: "测试OCR", path: "d:/xueya/测试OCR.jpg" }
];

async function simulateAppOCR(imgPath) {
    if (!fs.existsSync(imgPath)) {
        return { success: false, error: "File not found" };
    }

    const image = await Jimp.read(imgPath);
    const w = image.bitmap.width;
    const h = image.bitmap.height;

    // 1. 液晶屏核心区裁剪 (X: 32%-92%, Y: 28%-88%) -> w*0.60, h*0.60
    const cropX = Math.round(w * 0.32);
    const cropY = Math.round(h * 0.28);
    const cropW = Math.round(w * 0.60);
    const cropH = Math.round(h * 0.60);

    const croppedImage = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    // 第一路：Bradley 局部自适应二值化 (t = 10)
    const road1 = croppedImage.clone();
    preprocessBradley(road1, 10);

    // 第二路：对比度增强灰度图
    const road2 = croppedImage.clone();
    preprocessGrayContrast(road2);

    // 第三路：全图对比度增强图 (这里用裁剪前的原图进行全图拉伸)
    const road3 = image.clone();
    preprocessGrayContrast(road3);

    // 保存调试图
    const base = pathBasename(imgPath);
    await road1.write(`d:/xueya/ceshi_file/debug_app_road1_${base}`);
    await road2.write(`d:/xueya/ceshi_file/debug_app_road2_${base}`);

    console.log(`Running OCR for ${pathBasename(imgPath)}...`);

    const runTesseract = async (jimpImg, desc) => {
        const buffer = await jimpImg.getBuffer('image/jpeg');
        const worker = await Tesseract.createWorker('eng', 1);
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789\n '
        });
        try {
            const { data: { text } } = await worker.recognize(buffer);
            console.log(`  [${desc}] Raw: "${text.trim().replace(/\n/g, '\\n')}"`);
            return text;
        } catch (e) {
            console.error(e);
            return "";
        } finally {
            await worker.terminate();
        }
    };

    const text1 = await runTesseract(road1, "Road1 (Binarized)");
    const text2 = await runTesseract(road2, "Road2 (GrayContrast)");
    const text3 = await runTesseract(road3, "Road3 (FullGray)");

    const parseNums = (text) => {
        const matches = text.match(/\d+/g) || [];
        return matches.map(Number).filter(n => n >= 30 && n <= 300);
    };

    const cleanNums1 = parseNums(text1);
    const cleanNums2 = parseNums(text2);
    const cleanNums3 = parseNums(text3);

    console.log(`  Clean Nums Road 1:`, cleanNums1);
    console.log(`  Clean Nums Road 2:`, cleanNums2);
    console.log(`  Clean Nums Road 3:`, cleanNums3);

    // 调用 app.js 中的智能提取逻辑
    let parsedVals = parseBPValues(cleanNums1);
    if (!parsedVals) parsedVals = parseBPValues(cleanNums2);
    if (!parsedVals) parsedVals = parseBPValues(cleanNums3);
    if (!parsedVals) {
        const mergedNums = Array.from(new Set([...cleanNums1, ...cleanNums2]));
        parsedVals = parseBPValues(mergedNums);
    }
    if (!parsedVals) {
        const allMergedNums = Array.from(new Set([...cleanNums1, ...cleanNums2, ...cleanNums3]));
        parsedVals = parseBPValues(allMergedNums);
    }

    return parsedVals;
}

function pathBasename(path) {
    const parts = path.split('/');
    return parts[parts.length - 1];
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

function preprocessGrayContrast(jimpImg) {
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

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
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

        this.bitmap.data[idx] = newGray;
        this.bitmap.data[idx + 1] = newGray;
        this.bitmap.data[idx + 2] = newGray;
    });
}

function parseBPValues(nums) {
    if (!nums || nums.length < 2) return null;

    let systolic = null;
    let diastolic = null;
    let pulse = null;

    // 1. 收缩压正常范围 90 - 195
    const validSys = nums.filter(n => n >= 90 && n <= 195);
    // 2. 舒张压正常范围 50 - 115
    const validDia = nums.filter(n => n >= 50 && n <= 115);
    // 3. 脉搏正常范围 45 - 120
    const validPulse = nums.filter(n => n >= 45 && n <= 120);

    if (validSys.length > 0 && validDia.length > 0) {
        if (validSys.length === 1 && validDia.length === 1) {
            systolic = validSys[0];
            diastolic = validDia[0];
            pulse = validPulse.find(n => n !== systolic && n !== diastolic) || null;
        } else {
            // 如果有多个匹配，按顺序排列
            systolic = validSys[0];
            diastolic = validDia.find(n => n !== systolic) || validDia[0];
            pulse = validPulse.find(n => n !== systolic && n !== diastolic) || null;
        }
    }

    if (systolic && diastolic) {
        return { systolic, diastolic, pulse };
    }
    return null;
}

async function run() {
    for (const img of images) {
        console.log(`\n==================================================`);
        console.log(`Simulating App OCR on: ${img.name}`);
        const res = await simulateAppOCR(img.path);
        console.log(`Result:`, JSON.stringify(res));
    }
}

run().catch(console.error);
