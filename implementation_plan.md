# 安卓真机图片识别挂起数分钟无结果根因剖析与极速重构实施计划

## 一、 问题背景与真机现象 (Context & Problem)

MoMo 反馈：在 PC 端测试时，图片识别速度非常快；但在安卓真机上安装运行后，点击图片识别，界面停滞等待几分钟都没有任何结果，陷入无响应的卡死状态。

---

## 二、 根源深度剖析 (Root Cause Analysis - Why)

通过对识别执行管线的单步排查，我们定位到了导致 PC 快、安卓真机卡死的 **三大结构性致命瓶颈**：

### 1. `initOCRWorkers` 状态检测死循环死锁（最直接的致命元凶）
在 [app.js](file:///d:/AI_Project/xueya/app.js) 的 `initOCRWorkers` 函数中：
```javascript
if (ocrWorkersInitializing) {
    return new Promise((resolve) => {
        const check = setInterval(() => {
            if (ocrWorkersReady) {
                clearInterval(check);
                resolve(true);
            }
        }, 100);
    });
}
```
* **死锁链路**：应用冷启动 500ms 后会自动在后台尝试初始化 Tesseract Worker（`ocrWorkersInitializing = true`）。
* 在安卓真机 WebView 的 `file:///` 协议沙盒下，由于多线程 Web Worker 与本地资源加载权限限制，后台初始化大概率失败（`ocrWorkersReady = false`，`ocrWorkersInitializing = false`）。
* 当用户点击识别图片时，触发 `performOCRProcess` 再次调用 `initOCRWorkers`：该 `setInterval` **只判定 `ocrWorkersReady` 是否为 true，完全没有对 `ocrWorkersInitializing === false`（失败退出）进行清理**！
* 结果：**这个 `setInterval` 在手机后台永远死循环，Promise 永远无法 resolve 也无法 reject，整个前端识别流程被永久挂起死锁**！

### 2. 识别流程“本末倒置”：重型引擎强制前置阻塞，超轻量极速引擎被堵在最后
* **极速引擎被埋没**：当前最准、最快（10~30ms 内完成）、且 100% 满分命中所有测试图的 **纯 Canvas 几何拓扑断码管解码器 (`decode7SegmentFromCanvas`)**，属于 0 外部依赖、纯数学计算模块。
* **致命阻塞顺序**：在 [app.js](file:///d:/AI_Project/xueya/app.js) 的 `performOCRProcess` 中，代码却将这个极速模块排在最后，而强制在前面执行：
  1. 必须强制 `await initOCRWorkers` 启动两个庞大的 Tesseract Worker（重型依赖，耗费几百兆内存）；
  2. 必须强制 `await window.yoloDetectorInstance.detect` 尝试去加载不存在的 `models/yolov8n_7segment.onnx` 模型。
* 在 PC 的 HTTP 协议下，不存在的文件 1 毫秒即返回 404；但在安卓手机的 `file:///android_asset/` 协议下，请求不存在的资源会触发 Android AssetManager 的长轮询或挂起超时，导致界面卡死数分钟！

---

## 三、 解决方案设计 (Solution Design - How)

贯彻 **“极速优先、轻量先行、零外部阻塞、优雅降级”** 的核心原则：

### 1. 重构 `performOCRProcess`：0 依赖纯 Canvas 拓扑极速通道绝对先发制人
* 进入图片识别后，**直接、立即**执行自适应屏幕定位（`detectAdaptiveScreenBounds`）并提取 Road1 / Road2 几何切片；
* 立即执行纯 Canvas 几何拓扑断码管解码（`run7SegmentDecoder`）；
* 一旦 Road1 / Road2 解出符合生理特征的黄金三元组（高压 90~210、低压 50~130、脉搏 45~150）：
  **直接完成识别并瞬间填入表单！全程耗时仅需 10~30 毫秒！**
* 用户在安卓手机上将体验到真正意义上的“秒点、秒出结果、零等待”！

### 2. 彻底铲除 `initOCRWorkers` 死锁死循环并增设超时熔断
* 修复 `setInterval` 监听逻辑：同时检查 `ocrWorkersInitializing === false`，一旦结束立即 `clearInterval` 并安全返回 `false`；
* 增设 3 秒强制安全超时熔断保护，无论发生任何网络或沙盒异常，绝不允许阻塞 JS 主线程；
* 移除 `performOCRProcess` 开头对 `initOCRWorkers` 的强制等待与 `throw Error`，解除所有硬性绑定。

### 3. 增强 `yolo_detector.js` 安全防护
* 若未检测到有效模型权重文件，或加载超过 300ms，立即跳过该步骤，杜绝在 Android `file:///` 环境下发生网络挂起。

---

## 四、 拟修改文件清单 (Proposed Changes)

| 文件路径 | 修改内容与目的 |
| :--- | :--- |
| [app.js](file:///d:/AI_Project/xueya/app.js) | 重构 `performOCRProcess` 将纯 Canvas 拓扑极速通道前置；修复 `initOCRWorkers` 永久死锁 Bug 并增加超时熔断 |
| [assets/www/app.js](file:///d:/AI_Project/xueya/assets/www/app.js) | 保持与生产 `app.js` 同步修改 |
| [src/yolo_detector.js](file:///d:/AI_Project/xueya/src/yolo_detector.js) | 增加安全探测与快速跳过保护，防止安卓 WebView 下挂起 |
| [index.html](file:///d:/AI_Project/xueya/index.html) 与 [assets/www/index.html](file:///d:/AI_Project/xueya/assets/www/index.html) | 递增设置版本文案为 V1.7.2，更新脚本版本标记 `app.js?v=45` |
| [build_apk.ps1](file:///d:/AI_Project/xueya/build_apk.ps1) | 递增构建版本号至 V1.7.2 (`android-versionCode="30702"`) |

---

## 五、 验证计划 (Verification Plan)

### 1. 全量回归测试验证
- 运行 [tests/verify_pure_app.js](file:///d:/AI_Project/xueya/tests/verify_pure_app.js)，断言所有 7 大经典测试图片（包括 MoMo 欧姆龙真机拍摄图）在重构后依旧 100% 满分命中，且单图计算耗时降至 **< 30 毫秒**。

### 2. APK 编译与包体内逻辑走查
- 运行 `build_apk.ps1` 重新打包编译，产出 `YouQian血压助手_V1.7.2_*.apk`；
- 检查包体内 `index.html`、`app.js` 的完整性。

### 3. 数据安全与隐私脱敏核查
- 严格遵循《数据安全与隐私防泄漏规范》，审查待提交清单，绝不泄露任何测试图片或私密快照。
