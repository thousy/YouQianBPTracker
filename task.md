# 任务跟踪清单 (Task Tracking)

- [x] 针对新测试图识别异常的根因剖析与方案制定 <!-- id: 15 -->
  - [x] 复现两张新问题图报错结果（图1 175/110/90误报188/81/88，图2 150/101/83误报110/80/88） <!-- id: 16 -->
  - [x] 定位死板硬编码 tightY=0.12 导致偏下构图引入顶部黑色键盘与席子网格的根因 <!-- id: 17 -->
  - [x] 验证基于白色机身隔离带的“自适应屏幕主带定位”算法可行性 <!-- id: 18 -->
  - [x] 编写 `implementation_plan.md` 提请 MoMo 审批 <!-- id: 19 -->
- [x] 代码修改与自适应屏幕定位闭环 <!-- id: 20 -->
  - [x] 改造 [app.js](file:///d:/AI_Project/xueya/app.js) 屏幕定位逻辑，实现自适应主带提取替换写死 tightY <!-- id: 21 -->
  - [x] 优化七段数码管在 175/150/101/110 等读数上的边界拓扑判定 <!-- id: 22 -->
  - [x] 同步更新 [assets/www/app.js](file:///d:/AI_Project/xueya/assets/www/app.js) <!-- id: 23 -->
  - [x] 递增 [index.html](file:///d:/AI_Project/xueya/index.html) 与 [assets/www/index.html](file:///d:/AI_Project/xueya/assets/www/index.html) 版本号至 `v=39` <!-- id: 24 -->
- [x] 全套用例自动化回归验证与交付 <!-- id: 25 -->
  - [x] 对关键问题测试图片执行无 Mock 真实端到端回归断言，达成 100% 满分命中 <!-- id: 26 -->
  - [x] 登记 [problem_tracking_log.md](file:///d:/AI_Project/xueya/problem_tracking_log.md) <!-- id: 27 -->
  - [x] 编写 [walkthrough.md](file:///d:/AI_Project/xueya/walkthrough.md) 并交付成果走查报告 <!-- id: 28 -->
  - [x] Git 状态安全脱敏核查 <!-- id: 29 -->

- [x] ONNXRuntime-Web 与 YOLOv8-nano 目标检测引擎集成 <!-- id: 30 -->
  - [x] 安装并引入 onnxruntime-web 静态依赖（ort.min.js、WASM核心） <!-- id: 31 -->
  - [x] 搭建前端 YOLOv8 推理管道（Letterbox预处理、ONNX推理、NMS后处理、3行聚类） <!-- id: 32 -->
  - [x] 实现与现有 Canvas 拓扑几何通道的双引擎协同与自适应优雅降级 <!-- id: 33 -->
  - [x] 同步更新 assets/www/ 生产文件与 build_apk.ps1 打包脚本 <!-- id: 34 -->
- [x] 针对 178/120/93 实拍图识别异常 (178/88/75) 的修复与闭环 <!-- id: 36 -->
  - [x] 补全数字 3 的底横梁 d 弱化拓扑容错规则 <!-- id: 37 -->
  - [x] 优化平局决策逻辑与同源主通道短路优先级 <!-- id: 38 -->
  - [x] 同步更新 assets/www/ 生产文件并递增版本号至 v=41 <!-- id: 39 -->
  - [x] 真实全量回归验证，确保 178/120/93 以及全套历史用例 100% 满分通过 <!-- id: 40 -->
  - [x] 更新 problem_tracking_log.md、walkthrough.md 与 Git 脱敏核查 <!-- id: 41 -->
- [x] 针对 185/116/82 新实拍图识别异常 (110/81/81) 的修复与闭环 <!-- id: 42 -->
  - [x] 定位高压行顶部边框杂质混入导致连通块粘连的根因 <!-- id: 43 -->
  - [x] 实现基于高低压 1:1 物理等高比与密度断层跃升的高压行智能杂质剥离算法 <!-- id: 44 -->
  - [x] 补全七段数码管中唯一无左上(!f)且有左下(e)且有中横梁(g)的数字 2 拓扑自愈规则 <!-- id: 45 -->
  - [x] 同步更新 assets/www/ 生产文件并递增版本号至 v=42 <!-- id: 46 -->
  - [x] 纯净生产代码（零 Mock）真实全量回归验证，确保 185/116/82 及历史核心用例 100% 满分通过 <!-- id: 47 -->
  - [x] 更新 problem_tracking_log.md、walkthrough.md 与 Git 脱敏核查 <!-- id: 48 -->
- [x] 针对欧姆龙 J710 实拍新图 (150/101/83 与 162/108/83) 识别异常的根治与全域自适应演进 <!-- id: 49 -->
  - [x] 精准定位图 1 低压误判 10（首块汉字残渣引发误 pop）与图 2 高压 162 顶部 mmHg 横梁噪点粘连根因 <!-- id: 50 -->
  - [x] 实现高低压物理等高基准对齐（彻底剔除顶部 mmHg 噪点）与首块有效性感知保护 <!-- id: 51 -->
  - [x] 实现顶部残渣断层跳过与自适应波谷切开连体双数字块算法 <!-- id: 52 -->
  - [x] 补全脉搏专属拓扑容错匹配 3，并确立 Road1 原生同源自洽黄金三元组绝对优先短路机制 <!-- id: 53 -->
  - [x] 同步更新 assets/www/ 生产代码并递增版本号至 v=43 <!-- id: 54 -->
  - [x] 纯净生产代码真实全量回归验证，确保 7 大关键用例 100% 满分通过（零回归退化） <!-- id: 55 -->
  - [x] 登记 problem_tracking_log.md、编写 walkthrough.md 并完成 Git 安全脱敏核查 <!-- id: 56 -->
- [x] V1.7 版本发布与 Android 正式包构建 <!-- id: 57 -->
  - [x] 更新项目版本号至 V1.7.0（UI设置面板、package.json、build_apk.ps1） <!-- id: 58 -->
  - [x] 成功执行 build_apk.ps1 编译生成 YouQian血压助手_V1.7_20261006_1431.apk <!-- id: 59 -->
  - [x] 配置 .gitignore 严密拦截测试快照，放行 V1.7 正式安装包发布 <!-- id: 60 -->
  - [x] 遵循《数据安全与隐私防泄漏规范》，经全量白名单审核后提交代码并打上 v1.7 标签 <!-- id: 61 -->
  - [x] 成功执行 git push origin main --tags 推送至 GitHub 远程仓库 <!-- id: 62 -->



