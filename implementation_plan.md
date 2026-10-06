# 点击“立即拍照”弹出相册而非相机的根因剖析与修复实施计划

## 一、 问题背景与现象 (Context & Problem)

MoMo 反馈：在安装运行最新的血压助手应用后，在 OCR 识别弹窗中点击**“立即拍照识别”**按钮，系统弹出的竟然是相册/文件选择界面，而不是直接调取手机系统相机。

---

## 二、 根源深度剖析 (Root Cause Analysis - Why)

经过对代码库与 Git 提交历史（Commit `4cf22382`）的排查，我们精准定位到了该 Bug 的产生链路：

1. **`index.html` 中的关键脚本 `cordova.js` 缺失**：
   在最近一次集成 YOLOv8 与 ONNX 推理模块时，[index.html](file:///d:/AI_Project/xueya/index.html) 底部脚本区域的 `<script src="cordova.js"></script>` 被误替换：
   ```html
   <!-- 原本有: -->
   <script src="cordova.js"></script>
   <!-- 误替换后变成: -->
   <script src="ort.min.js"></script>
   <script src="src/yolo_detector.js"></script>
   <script src="app.js?v=43"></script>
   ```
2. **`isCordova` 检测失效导致链路降级**：
   在 [app.js](file:///d:/AI_Project/xueya/app.js) 的 `requestImageForOCR` 函数中：
   ```javascript
   const isCordova = typeof window.cordova !== 'undefined' && typeof navigator.camera !== 'undefined';
   ```
   因为没有加载 `cordova.js`，WebView 容器内的 `window.cordova` 与 `navigator.camera` 始终为 `undefined`，导致 `isCordova` 恒为 `false`。
3. **降级触发 `<input type="file">` 导致弹出相册**：
   当 `isCordova` 为 `false` 时，系统进入浏览器兼容分支：
   ```javascript
   const input = document.getElementById('ocrCameraInput');
   input.click();
   ```
   在 Android 原生 WebView 下，模拟点击隐藏的 `<input type="file" capture="environment">` 时，系统底层 WebView 没有被原生 Cordova 插件拦截，直接触发了 Android 系统默认的 DocumentsUI/相册文件选择器，从而表现为“弹出相册而不是直接调取相机”。
4. **连锁潜在隐患**：
   `cordova.js` 的丢失不仅影响相机调取，还会导致导出 Excel、导出 PDF 报告时无法调用原生 `cordova.file` 保存至手机 `Download` 目录。

---

## 三、 解决方案设计 (Solution Design - How)

### 1. 恢复 Cordova 原生桥接层脚本注入
在 [index.html](file:///d:/AI_Project/xueya/index.html) 和 [assets/www/index.html](file:///d:/AI_Project/xueya/assets/www/index.html) 中，恢复并置顶 `<script src="cordova.js"></script>`，确保在打包为 APK 运行时，Cordova 原生桥接通道与 `navigator.camera` 插件顺利注入。

### 2. 增强 `requestImageForOCR` 生命周期容错与 Web 端兼容
在 [app.js](file:///d:/AI_Project/xueya/app.js) 和 [assets/www/app.js](file:///d:/AI_Project/xueya/assets/www/app.js) 中优化相机调用逻辑：
- **增加 Cordova 加载中兜底**：如果检测到处于 Cordova 容器（`window.cordova` 存在）但原生插件尚未就绪，自动监听 `deviceready` 事件等待并重新触发，杜绝刚打开应用快速点击时的假降级；
- **优化 Web 端 input 属性**：针对纯浏览器/PWA 环境，优化 `ocrCameraInput` 属性（支持 `capture="environment"` 并追加标准拍照约束），提升非 APK 环境下拉起相机的兼容率。

### 3. 增强 AndroidManifest 权限配置与版本递增
在 [build_apk.ps1](file:///d:/AI_Project/xueya/build_apk.ps1) 中：
- 在 `config.xml` 注入阶段显式追加 `<uses-permission android:name="android.permission.CAMERA" />`，避免特定厂商定制 Android 系统（如 MIUI/OriginOS/HarmonyOS）在缺少显式权限声明时静默拦截相机 Intent；
- 将应用版本号递增为 **V1.7.1**（`android-versionCode="30701"`），保证 MoMo 手机端能够顺利无缝覆盖升级安装。

---

## 四、 拟修改文件清单 (Proposed Changes)

| 文件路径 | 修改内容与目的 |
| :--- | :--- |
| [index.html](file:///d:/AI_Project/xueya/index.html) | 恢复引入 `<script src="cordova.js"></script>`，将设置版本文案递增为 V1.7.1，更新 app.js 缓存标记 |
| [assets/www/index.html](file:///d:/AI_Project/xueya/assets/www/index.html) | 保持与生产 `index.html` 同步恢复 `cordova.js` 引入 |
| [app.js](file:///d:/AI_Project/xueya/app.js) | 在 `requestImageForOCR` 中增强 Cordova `deviceready` 状态感知与防降级兜底 |
| [assets/www/app.js](file:///d:/AI_Project/xueya/assets/www/app.js) | 保持与生产 `app.js` 逻辑同步 |
| [build_apk.ps1](file:///d:/AI_Project/xueya/build_apk.ps1) | 显式注入 CAMERA 权限声明，递增 `versionCode` 为 30701，升级构建版本至 V1.7.1 |

---

## 五、 验证计划 (Verification Plan)

### 1. 静态结构与依赖验证
- 验证 `index.html` 与 `assets/www/index.html` 已正确包含 `cordova.js`，且位于所有业务 JS 与 ONNX 库之前；
- 检查 `app.js` 中的语法与 `requestImageForOCR` 逻辑是否严密无语法错误。

### 2. APK 编译与包体内资产走查
- 运行 `build_apk.ps1` 进行全自动构建；
- 走查生成项目中 `platforms/android/app/src/main/assets/www/index.html`，确认 `cordova.js` 存在且平台原生插件清单（`cordova_plugins.js`）正常挂载；
- 确认编译产出全新的 `YouQian血压助手_V1.7.1_*.apk` 安装包。

### 3. 数据安全与隐私脱敏核查
- 遵循《数据安全与隐私防泄漏规范》，执行 `git status` 严格审查待提交清单，确保任何测试图片或临时产物未被 Git 追踪。
