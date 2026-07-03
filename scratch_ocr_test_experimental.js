const { Jimp } = require('jimp');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const images = [
    { name: "media_1782309257139", path: "C:/Users/admin/.gemini/antigravity-ide/brain/519b9d0f-a5c3-428d-b95f-4b5503be127a/media__1782309257139.jpg" },
    { name: "weixin_image", path: "d:/xueya/微信图片_20260624201424_422_197.jpg" }
];

async function recognizeBloodPressure(imgPath, options = {}) {
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

    // 2. 裁剪核心区域（支持通过 options 传入宽/窄裁剪比例，默认使用 0.50/0.36/0.31/0.47 窄裁剪）
    const cropX = Math.round(targetW * (options.cropX !== undefined ? options.cropX : 0.50));
    const cropY = Math.round(targetH * (options.cropY !== undefined ? options.cropY : 0.36));
    const cropW = Math.round(targetW * (options.cropW !== undefined ? options.cropW : 0.31));
    const cropH = Math.round(targetH * (options.cropH !== undefined ? options.cropH : 0.47));
    const croppedImage = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    const subW = croppedImage.bitmap.width;
    const subH = croppedImage.bitmap.height;

    // 3. 基础二值化与灰度对比度克隆
    const croppedImageContrast = croppedImage.clone();
    preprocessImageGrayContrast(croppedImageContrast);
    
    // 串联处理：由参数决定是否在二值化前先进行对比度拉伸
    if (options.useContrastSeries) {
        preprocessImageGrayContrast(croppedImage);
    }
    preprocessBradley(croppedImage, options.t !== undefined ? options.t : 10);
    
    if (options.useErode) {
        erodeBlack(croppedImage);
    }
    
    // 非对称边缘强涂白：液晶数字通常偏左（高压首位百数1极贴左侧），而粘连大都发生在屏幕右侧边缘
    if (options.useCornerMask) {
        const cxLeft = Math.round(subW * (options.maskLeft !== undefined ? options.maskLeft : 0.00));
        const cxRight = Math.round(subW * (options.maskRight !== undefined ? options.maskRight : 0.85));
        const cyTop = Math.round(subH * (options.maskTop !== undefined ? options.maskTop : 0.12));
        const cyBottom = Math.round(subH * (options.maskBottom !== undefined ? options.maskBottom : 0.88));
        
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            const isLeftTop = (cxLeft > 0 && x < cxLeft && y < cyTop);
            const isRightTop = (x > cxRight && y < cyTop);
            const isLeftBottom = (cxLeft > 0 && x < cxLeft && y > cyBottom);
            const isRightBottom = (x > cxRight && y > cyBottom);
            if (isLeftTop || isRightTop || isLeftBottom || isRightBottom) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
    }

    // 防火墙垂直白线断粘连：在左右边界极边缘拉出2px宽的隔离线，隔离高压数字与外边框的黑色粘连传染
    if (options.useFirewall) {
        const fxLeft = Math.round(subW * 0.08);
        const fxRight = Math.round(subW * 0.92);
        const fyEnd = Math.round(subH * 0.32);
        
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            const isLeftFirewall = (x >= fxLeft && x <= fxLeft + 1 && y < fyEnd);
            const isRightFirewall = (x >= fxRight - 1 && x <= fxRight && y < fyEnd);
            if (isLeftFirewall || isRightFirewall) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
    }

    // 种子隔离：强行涂白最顶端左右两列边缘像素，防止右上/左上边框阴影作为种子被清除传染
    if (options.useSeedMask) {
        const fyEnd = Math.round(subH * 0.16);
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            const isLeftBorderSeed = (x === 0 && y < fyEnd);
            const isRightBorderSeed = (x === subW - 1 && y < fyEnd);
            if (isLeftBorderSeed || isRightBorderSeed) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
    }
    // 全图边缘处理策略
    if (options.borderMode === 'clearBFS_Whole') {
        clearBordersLeftRight(croppedImage);
    } else if (options.borderMode === 'clearBFS_LeftMaskRightBFS') {
        const maskPct = options.maskPercent || 0.05;
        const maskW = Math.round(subW * maskPct);
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            if (x < maskW) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
        clearBordersRightOnly(croppedImage);
    } else if (options.borderMode === 'clearBFS_RightOnly') {
        clearBordersRightOnly(croppedImage);
    } else if (options.borderMode === 'clearBFS_LeftOnly') {
        clearBordersLeftOnly(croppedImage);
    } else if (options.borderMode === 'clearBFS_SmartDirected') {
        clearBordersSmartDirected(croppedImage);
    } else if (options.borderMode === 'clearBFS_SmartY') {
        clearBordersSmartY(croppedImage);
    } else if (options.borderMode === 'maskWhole') {
        const maskPct = options.maskPercent || 0.04;
        const maskW = Math.round(subW * maskPct);
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            if (x < maskW || x >= subW - maskW) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });
        // 涂白断开之后，再跑一次 BFS 边界清洗，彻底洗干净残留斑块
        clearBordersLeftRight(croppedImage);
    }

    // 膨胀
    dilateBlack(croppedImage);
    
    const tag = options.tag || 'default';
    await croppedImage.write(`d:/xueya/ceshi_file/debug_${tag}_preprocessed_${pathBasename(imgPath)}`);

    // 4. 计算包络框与定义自适应切片辅助函数
    let envelope = { minX: 0, maxX: subW - 1, minY: 0, maxY: subH - 1 };
    if (options.useEnvelope) {
        let minX = subW, maxX = 0, minY = subH, maxY = 0;
        let hasBlack = false;
        croppedImage.scan(0, 0, subW, subH, function(x, y, idx) {
            if (this.bitmap.data[idx] === 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                hasBlack = true;
            }
        });
        if (hasBlack) {
            // 给包络框周围留出极微小的缓冲区（3px），避免边缘贴死影响识别
            envelope = {
                minX: Math.max(minX - 3, 0),
                maxX: Math.min(maxX + 3, subW - 1),
                minY: Math.max(minY - 3, 0),
                maxY: Math.min(maxY + 3, subH - 1)
            };
            console.log(`    [Envelope] Detected black pixels bbox: X=[${envelope.minX} - ${envelope.maxX}], Y=[${envelope.minY} - ${envelope.maxY}]`);
        }
    }

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

    // 物理切割切片（支持从 options 传入通用的 xStart 和 xEnd 遮罩比例）
    const sysYStart = options.sysYStart !== undefined ? options.sysYStart : 0.0;
    const sysYEnd = options.sysYEnd !== undefined ? options.sysYEnd : 0.38;
    const xStart = options.xStart !== undefined ? options.xStart : 0.0;
    const xEnd = options.xEnd !== undefined ? options.xEnd : 1.0;
    
    const diaYStartWide = options.diaYStartWide !== undefined ? options.diaYStartWide : 0.31;
    const diaYStartMid = options.diaYStartMid !== undefined ? options.diaYStartMid : 0.35;
    const diaYStartNarrow = options.diaYStartNarrow !== undefined ? options.diaYStartNarrow : 0.38;
    const diaYEnd = options.diaYEnd !== undefined ? options.diaYEnd : 0.69;
    
    const pulseYStart = options.pulseYStart !== undefined ? options.pulseYStart : 0.63;
    
    let slices = null;
    let slicesContrast = null;
    
    if (!options.useWholeImage) {
        slices = {
            sys: makeSlice(sysYStart, sysYEnd, xStart, xEnd),
            diaWide: makeSlice(diaYStartWide, diaYEnd, xStart, xEnd),
            diaMid: makeSlice(diaYStartMid, diaYEnd, xStart, xEnd),
            diaNarrow: makeSlice(diaYStartNarrow, diaYEnd - 0.01, xStart, xEnd),
            pulse: makeSlice(pulseYStart, 1.0, 0.45, xEnd)
        };

        const makeSliceContrast = (yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) => {
            const slice = croppedImageContrast.clone();
            const startY = Math.round(subH * yStartPct);
            const endY = Math.round(subH * yEndPct);
            const startX = Math.round(subW * xStartPct);
            const endX = Math.round(subW * xEndPct);

            slice.scan(0, 0, subW, subH, function(x, y, idx) {
                if (x < startX || x >= endX || y < startY || y >= endY) {
                    this.bitmap.data[idx] = 255;
                    this.bitmap.data[idx + 1] = 255;
                    this.bitmap.data[idx + 2] = 255;
                }
            });
            return slice;
        };

        slicesContrast = {
            sys: makeSliceContrast(sysYStart, sysYEnd, xStart, xEnd),
            diaWide: makeSliceContrast(diaYStartWide, diaYEnd, xStart, xEnd),
            diaMid: makeSliceContrast(diaYStartMid, diaYEnd, xStart, xEnd),
            diaNarrow: makeSliceContrast(diaYStartNarrow, diaYEnd - 0.01, xStart, xEnd),
            pulse: makeSliceContrast(pulseYStart, 1.0, 0.45, xEnd)
        };

        // 如果启用了“切片后边缘清理”，我们跳过 SYS（高压），仅在 DIA 和 PULSE 上运行以防误杀 SYS 数字
        if (options.borderMode === 'clearBFS_Slices') {
            clearBordersLeftRight(slices.diaWide);
            clearBordersLeftRight(slices.diaMid);
            clearBordersLeftRight(slices.diaNarrow);
            clearBordersLeftRight(slices.pulse);
        }

        // 保存分流切片图以作观察
        await slices.sys.write(`d:/xueya/ceshi_file/debug_${tag}_sys_bin_${pathBasename(imgPath)}`);
        await slicesContrast.sys.write(`d:/xueya/ceshi_file/debug_${tag}_sys_contrast_${pathBasename(imgPath)}`);
    } else {
        // 保存整图二值化与对比度拉伸图以作观察
        await croppedImage.write(`d:/xueya/ceshi_file/debug_${tag}_whole_bin_${pathBasename(imgPath)}`);
        await croppedImageContrast.write(`d:/xueya/ceshi_file/debug_${tag}_whole_contrast_${pathBasename(imgPath)}`);
    }

    const sysCandidates = [];
    const diaCandidates = [];
    const pulseCandidates = [];

    const addCandidate = (val, source, type) => {
        if (!val) return;
        const mapped = mapConfusedCharacters(val);
        const num = parseInt(mapped.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) {
            if (type === 'sys' || type === 'whole' || type === 'whole_contrast') sysCandidates.push({ num, source, raw: val });
            if (type === 'dia' || type === 'whole' || type === 'whole_contrast') diaCandidates.push({ num, source, raw: val });
            if (type === 'pulse' || type === 'whole' || type === 'whole_contrast') pulseCandidates.push({ num, source, raw: val });
        }
    };

    // 5. 多路 OCR 识别
    let targets = [];
    if (options.useWholeImage) {
        targets = [
            { name: 'whole', img: croppedImage, desc: 'WHOLE_BIN' },
            { name: 'whole_contrast', img: croppedImageContrast, desc: 'WHOLE_CONTRAST' }
        ];
    } else {
        targets = [
            { name: 'sys', img: slices.sys, desc: 'SYS_BIN' },
            { name: 'sys', img: slicesContrast.sys, desc: 'SYS_CONTRAST' },
            { name: 'dia', img: slices.diaWide, desc: 'DIA_Wide_BIN' },
            { name: 'dia', img: slicesContrast.diaWide, desc: 'DIA_Wide_CONTRAST' },
            { name: 'dia', img: slices.diaMid, desc: 'DIA_Mid_BIN' },
            { name: 'dia', img: slicesContrast.diaMid, desc: 'DIA_Mid_CONTRAST' },
            { name: 'dia', img: slices.diaNarrow, desc: 'DIA_Narrow_BIN' },
            { name: 'dia', img: slicesContrast.diaNarrow, desc: 'DIA_Narrow_CONTRAST' },
            { name: 'pulse', img: slices.pulse, desc: 'PULSE_BIN' },
            { name: 'pulse', img: slicesContrast.pulse, desc: 'PULSE_CONTRAST' }
        ];
    }

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
    const dia = getBestValue(diaCandidates, 50, 110);
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

function clearBordersSmartDirected(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;

    // 1. 物理切断：在最右侧 10% 宽度、高低压交界处 (y 在 25% 到 28% 之间) 强刷白色 (255)
    // 此交界处为背景空白，没有任何液晶数字，切断能阻止低压的种子沿边框上行传染到高压 0
    const breakYStart = Math.round(h * 0.25);
    const breakYEnd = Math.round(h * 0.28);
    const breakXStart = Math.round(w * 0.90);
    
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        if (x >= breakXStart && y >= breakYStart && y <= breakYEnd) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
        }
    });

    // 2. 注入 BFS 种子
    const visited = new Uint8Array(w * h);
    const queue = [];

    // 左边缘：全部注入种子点，彻底洗刷左侧机身黑边
    for (let y = 0; y < h; y++) {
        const idxL = y * w + 0;
        if (data[idxL * 4] === 0 && visited[idxL] === 0) {
            visited[idxL] = 1;
            queue.push(0, y);
        }
    }
    
    // 右边缘：跳过高压右上角，只在 y >= breakYEnd (低压与脉搏段) 注入种子点
    for (let y = breakYEnd; y < h; y++) {
        const idxR = y * w + (w - 1);
        if (data[idxR * 4] === 0 && visited[idxR] === 0) {
            visited[idxR] = 1;
            queue.push(w - 1, y);
        }
    }

    // 3. 运行 BFS 清除
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

function clearBordersLeftOnly(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;

    const visited = new Uint8Array(w * h);
    const queue = [];

    // 只从左侧最边缘开始扫描 (x = 0)
    for (let y = 0; y < h; y++) {
        const idxL = y * w + 0;
        if (data[idxL * 4] === 0 && visited[idxL] === 0) {
            visited[idxL] = 1;
            queue.push(0, y);
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

function clearBordersRightOnly(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;

    const visited = new Uint8Array(w * h);
    const queue = [];

    // 只从右边缘 x = w - 1 注入种子
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

function clearBordersSmartY(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    const data = jimpImg.bitmap.data;

    const globalVisited = new Uint8Array(w * h);

    const checkAndClear = (startX, startY) => {
        const startIdx = startY * w + startX;
        if (data[startIdx * 4] !== 0 || globalVisited[startIdx] !== 0) return;

        const queue = [startX, startY];
        const visited = [startIdx];
        globalVisited[startIdx] = 1;

        let minY = startY, maxY = startY;

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
                    if (data[nidx * 4] === 0 && globalVisited[nidx] === 0) {
                        globalVisited[nidx] = 1;
                        visited.push(nidx);
                        queue.push(nx, ny);

                        if (ny < minY) minY = ny;
                        if (ny > maxY) maxY = ny;
                    }
                }
            }
        }

        // 核心阈值：只有当这个边缘连通域的最下端依然停留在图像顶部 25% 高度以内时，才判定为杂质并清除
        const touchesCoreRegion = maxY > h * 0.25;

        if (!touchesCoreRegion) {
            for (let i = 0; i < visited.length; i++) {
                const pixelIdx = visited[i] * 4;
                data[pixelIdx] = 255;
                data[pixelIdx + 1] = 255;
                data[pixelIdx + 2] = 255;
            }
        }
    };

    for (let y = 0; y < h; y++) {
        checkAndClear(0, y);
        checkAndClear(w - 1, y);
    }
    for (let x = 0; x < w; x++) {
        checkAndClear(x, 0);
    }
}


function erodeBlack(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    
    const temp = new Uint8Array(w * h);
    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        temp[y * w + x] = jimpImg.bitmap.data[idx];
    });

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        if (temp[y * w + x] === 0) { // 黑色像素
            let hasWhite = false;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= w) continue;
                    if (temp[ny * w + nx] === 255) { // 碰到白色像素说明是边缘
                        hasWhite = true;
                        break;
                    }
                }
                if (hasWhite) break;
            }
            if (hasWhite) {
                jimpImg.bitmap.data[idx] = 255;
                jimpImg.bitmap.data[idx + 1] = 255;
                jimpImg.bitmap.data[idx + 2] = 255;
            }
        }
    });
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

function preprocessImageGrayContrast(jimpImg) {
    const w = jimpImg.bitmap.width;
    const h = jimpImg.bitmap.height;
    let minG = 255;
    let maxG = 0;
    const grays = new Uint8Array(w * h);

    jimpImg.scan(0, 0, w, h, function(x, y, idx) {
        const r = jimpImg.bitmap.data[idx];
        const g = jimpImg.bitmap.data[idx + 1];
        const b = jimpImg.bitmap.data[idx + 2];
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
            
            // 线性拉伸
            let newGray = Math.round(((origGray - minG) * 255) / range);
            
            // 双剪切拉伸增强：亮的部分(>230)设为255，暗的部分(<25)设为0，中间线性放大
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

async function runExperiment() {
    const plans = [
        {
            name: "Plan M3 (crop 0.50/0.31, clearBFS_LeftRight)",
            options: {
                borderMode: 'clearBFS_Whole',
                useEnvelope: false,
                cropX: 0.50, cropY: 0.36, cropW: 0.31, cropH: 0.47,
                xStart: 0.0, xEnd: 1.0, tag: 'planM3'
            }
        },
        {
            name: "Plan M6 (crop 0.50/0.31, Left Mask 5% + Right BFS)",
            options: {
                borderMode: 'clearBFS_LeftMaskRightBFS',
                maskPercent: 0.05,
                useEnvelope: false,
                cropX: 0.50, cropY: 0.36, cropW: 0.31, cropH: 0.47,
                xStart: 0.0, xEnd: 1.0, tag: 'planM6_narrow_5pct'
            }
        },
        {
            name: "Plan M6 (crop 0.50/0.31, Right BFS Only)",
            options: {
                borderMode: 'clearBFS_RightOnly',
                useEnvelope: false,
                cropX: 0.50, cropY: 0.36, cropW: 0.31, cropH: 0.47,
                xStart: 0.0, xEnd: 1.0, tag: 'planM6_narrow_rightOnly'
            }
        },
        {
            name: "Plan M6 (crop 0.47/0.37, Left Mask 5% + Right BFS, xStart 0.05)",
            options: {
                borderMode: 'clearBFS_LeftMaskRightBFS',
                maskPercent: 0.05,
                useEnvelope: false,
                cropX: 0.47, cropY: 0.36, cropW: 0.37, cropH: 0.47,
                xStart: 0.05, xEnd: 1.0, tag: 'planM6_wide_xstart'
            }
        }
    ];

    for (const plan of plans) {
        console.log(`\n======================================================================`);
        console.log(`RUNNING PLAN: ${plan.name}`);
        console.log(`======================================================================`);
        
        console.log(`[media_1782309257139]`);
        const res1 = await recognizeBloodPressure(images[0].path, plan.options);
        console.log(`Result:`, JSON.stringify(res1.result));
        console.log(`Details:`, JSON.stringify(res1.details));

        console.log(`[weixin_image]`);
        const res2 = await recognizeBloodPressure(images[1].path, plan.options);
        console.log(`Result:`, JSON.stringify(res2.result));
        console.log(`Details:`, JSON.stringify(res2.details));
    }
}

runExperiment().catch(console.error);


