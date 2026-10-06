/**
 * YOLOv8-nano 断码屏数字目标检测与聚类模块 (ONNXRuntime-Web)
 * 专为血压计/仪表盘七段数码管设计，通过目标检测识别 0~9 数字并聚类为收缩压/舒张压/脉搏
 */

(function (global) {
    class YOLOv8DigitDetector {
        constructor(options = {}) {
            this.modelPath = options.modelPath || './models/yolov8n_7segment.onnx';
            this.inputSize = options.inputSize || 640;
            this.confThresh = options.confThresh || 0.35;
            this.iouThresh = options.iouThresh || 0.45;
            this.numClasses = options.numClasses || 10; // 数字 0 ~ 9
            this.session = null;
            this.isInitializing = false;
            this.isReady = false;
        }

        /**
         * 异步初始化 ONNX 推理会话
         */
        async init(customPath) {
            if (this.isReady && this.session) return true;
            if (this.isInitializing) {
                while (this.isInitializing) {
                    await new Promise(r => setTimeout(r, 100));
                }
                return this.isReady;
            }

            this.isInitializing = true;
            const targetPath = customPath || this.modelPath;

            try {
                if (typeof ort === 'undefined') {
                    console.warn('[YOLOv8] ONNXRuntime-Web (ort) 未在环境中载入');
                    this.isInitializing = false;
                    return false;
                }

                // 配置 WASM 静态资源根路径，优先使用当前同级目录
                if (ort.env && ort.env.wasm) {
                    ort.env.wasm.wasmPaths = './';
                    ort.env.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 2);
                }

                // 尝试优先使用 WebGL (若支持) 或 WASM
                const providers = ['wasm'];
                console.log(`[YOLOv8] 正在加载断码屏目标检测模型: ${targetPath}...`);
                this.session = await ort.InferenceSession.create(targetPath, {
                    executionProviders: providers,
                    graphOptimizationLevel: 'all'
                });

                this.isReady = true;
                console.log('[YOLOv8] 模型会话初始化成功，输入节点:', this.session.inputNames, '输出节点:', this.session.outputNames);
                return true;
            } catch (err) {
                console.warn('[YOLOv8] ONNX 会话初始化失败，将无缝降级为 Canvas 拓扑几何解码:', err);
                this.isReady = false;
                return false;
            } finally {
                this.isInitializing = false;
            }
        }

        /**
         * Letterbox 预处理：保持长宽比缩放至 640x640，周围补灰边 (114, 114, 114)
         */
        preprocessLetterbox(srcCanvas) {
            const w = srcCanvas.width;
            const h = srcCanvas.height;
            const target = this.inputSize;

            const scale = Math.min(target / w, target / h);
            const newW = Math.round(w * scale);
            const newH = Math.round(h * scale);
            const padX = Math.round((target - newW) / 2);
            const padY = Math.round((target - newH) / 2);

            // 创建 640x640 临时画布
            let letterCanvas;
            if (typeof document !== 'undefined' && document.createElement) {
                letterCanvas = document.createElement('canvas');
            } else {
                throw new Error('Canvas not supported in current environment');
            }
            letterCanvas.width = target;
            letterCanvas.height = target;
            const ctx = letterCanvas.getContext('2d', { willReadFrequently: true });

            // 填充灰底 (RGB 114)
            ctx.fillStyle = '#727272';
            ctx.fillRect(0, 0, target, target);
            ctx.drawImage(srcCanvas, 0, 0, w, h, padX, padY, newW, newH);

            // 提取像素构建 Float32 NCHW Tensor (1, 3, 640, 640)
            const imgData = ctx.getImageData(0, 0, target, target);
            const data = imgData.data;
            const totalPixels = target * target;
            const floatData = new Float32Array(3 * totalPixels);

            for (let i = 0; i < totalPixels; i++) {
                const idx = i * 4;
                floatData[i] = data[idx] / 255.0;                         // R
                floatData[totalPixels + i] = data[idx + 1] / 255.0;       // G
                floatData[2 * totalPixels + i] = data[idx + 2] / 255.0;   // B
            }

            const tensor = new ort.Tensor('float32', floatData, [1, 3, target, target]);
            return { tensor, scale, padX, padY, origW: w, origH: h };
        }

        /**
         * 计算两框的 IoU (Intersection over Union)
         */
        calculateIoU(boxA, boxB) {
            const x1 = Math.max(boxA[0], boxB[0]);
            const y1 = Math.max(boxA[1], boxB[1]);
            const x2 = Math.min(boxA[2], boxB[2]);
            const y2 = Math.min(boxA[3], boxB[3]);

            const interW = Math.max(0, x2 - x1);
            const interH = Math.max(0, y2 - y1);
            const interArea = interW * interH;
            if (interArea <= 0) return 0;

            const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
            const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);
            return interArea / (areaA + areaB - interArea);
        }

        /**
         * 非极大值抑制 (NMS)
         */
        nonMaxSuppression(boxes, iouThresh) {
            boxes.sort((a, b) => b.score - a.score);
            const kept = [];
            while (boxes.length > 0) {
                const current = boxes.shift();
                kept.push(current);
                boxes = boxes.filter(box => this.calculateIoU(current.box, box.box) < iouThresh);
            }
            return kept;
        }

        /**
         * 执行 YOLOv8 目标检测并还原真实坐标
         */
        async detect(srcCanvas) {
            const ready = await this.init();
            if (!ready || !this.session) return null;

            const pre = this.preprocessLetterbox(srcCanvas);
            const inputName = this.session.inputNames[0];
            const outputMap = await this.session.run({ [inputName]: pre.tensor });
            const outputName = this.session.outputNames[0];
            const outputTensor = outputMap[outputName];
            if (!outputTensor) return null;

            // YOLOv8 标准输出: [1, 4 + numClasses, 8400]
            const dims = outputTensor.dims;
            const data = outputTensor.data;
            const boxes = [];

            let numFeatures, numAnchors;
            let isTransposed = false;
            if (dims.length === 3) {
                if (dims[1] < dims[2]) {
                    numFeatures = dims[1]; // 4 + 10 = 14
                    numAnchors = dims[2];  // 8400
                } else {
                    isTransposed = true;
                    numAnchors = dims[1];  // 8400
                    numFeatures = dims[2]; // 14
                }
            } else {
                return null;
            }

            const numClasses = numFeatures - 4;

            for (let a = 0; a < numAnchors; a++) {
                let cx, cy, w, h;
                let maxScore = 0;
                let classId = -1;

                if (!isTransposed) {
                    cx = data[0 * numAnchors + a];
                    cy = data[1 * numAnchors + a];
                    w = data[2 * numAnchors + a];
                    h = data[3 * numAnchors + a];
                    for (let c = 0; c < numClasses; c++) {
                        const score = data[(4 + c) * numAnchors + a];
                        if (score > maxScore) {
                            maxScore = score;
                            classId = c;
                        }
                    }
                } else {
                    const offset = a * numFeatures;
                    cx = data[offset];
                    cy = data[offset + 1];
                    w = data[offset + 2];
                    h = data[offset + 3];
                    for (let c = 0; c < numClasses; c++) {
                        const score = data[offset + 4 + c];
                        if (score > maxScore) {
                            maxScore = score;
                            classId = c;
                        }
                    }
                }

                if (maxScore >= this.confThresh && classId >= 0 && classId <= 9) {
                    // 从 640x640 Letterbox 空间反算回原图物理坐标
                    const realX1 = Math.max(0, (cx - w / 2 - pre.padX) / pre.scale);
                    const realY1 = Math.max(0, (cy - h / 2 - pre.padY) / pre.scale);
                    const realX2 = Math.min(pre.origW, (cx + w / 2 - pre.padX) / pre.scale);
                    const realY2 = Math.min(pre.origH, (cy + h / 2 - pre.padY) / pre.scale);

                    if (realX2 > realX1 && realY2 > realY1) {
                        boxes.push({
                            digit: classId,
                            score: maxScore,
                            box: [realX1, realY1, realX2, realY2],
                            cx: (realX1 + realX2) / 2,
                            cy: (realY1 + realY2) / 2,
                            w: realX2 - realX1,
                            h: realY2 - realY1
                        });
                    }
                }
            }

            const detections = this.nonMaxSuppression(boxes, this.iouThresh);
            return detections;
        }

        /**
         * 空间聚类算法：将检测出的散乱数字框聚类为高压、低压、脉搏 3 行
         */
        clusterAndExtractBP(detections, canvasHeight) {
            if (!detections || detections.length < 5) return null;

            // 1. 按中心 Y 坐标升序排序
            const sortedByY = [...detections].sort((a, b) => a.cy - b.cy);

            // 2. 聚类行分割：计算连续字符在 Y 方向的间距
            const lines = [];
            let currentLine = [sortedByY[0]];

            for (let i = 1; i < sortedByY.length; i++) {
                const prev = currentLine[currentLine.length - 1];
                const curr = sortedByY[i];
                const yDist = curr.cy - prev.cy;
                const avgH = (curr.h + prev.h) / 2;

                // 若垂直间距超过字符高度的 45%，判定为换行
                if (yDist > avgH * 0.45) {
                    lines.push(currentLine);
                    currentLine = [curr];
                } else {
                    currentLine.push(curr);
                }
            }
            if (currentLine.length > 0) lines.push(currentLine);

            // 血压计屏幕必须包含 3 行数字 (高压、低压、脉搏)
            if (lines.length !== 3) {
                // 若出现 4 行（如心跳/序号被误检），按行平均 Y 坐标挑选最合理的 3 行主数字
                if (lines.length > 3) {
                    lines.sort((a, b) => {
                        const avgYA = a.reduce((s, d) => s + d.cy, 0) / a.length;
                        const avgYB = b.reduce((s, d) => s + d.cy, 0) / b.length;
                        return avgYA - avgYB;
                    });
                } else {
                    return null;
                }
            }

            // 3. 提取每行的数值：行内按 X 坐标从左到右排序
            const parseLine = (line) => {
                line.sort((a, b) => a.cx - b.cx);
                const str = line.map(d => d.digit.toString()).join('');
                return parseInt(str, 10);
            };

            const sys = parseLine(lines[0]);
            const dia = parseLine(lines[1]);
            const pulse = parseLine(lines[2]);

            // 4. 生理学合理性校验
            if (sys >= 80 && sys <= 250 && dia >= 40 && dia <= 160 && sys - dia >= 15 && pulse >= 40 && pulse <= 180) {
                return {
                    systolic: sys,
                    diastolic: dia,
                    pulse: pulse,
                    confidence: 0.95,
                    source: 'YOLOv8_ONNX'
                };
            }

            return null;
        }
    }

    // 挂载到全局
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = YOLOv8DigitDetector;
    }
    if (typeof global !== 'undefined') {
        global.YOLOv8DigitDetector = YOLOv8DigitDetector;
    }
})(typeof window !== 'undefined' ? window : global);
