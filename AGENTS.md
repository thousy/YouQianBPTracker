# Workspace Agent Instructions

## Agnes AI integration
- When the user asks to use Agnes AI, Agnes, agnes-ai, image generation, video generation, or text generation with Agnes, prefer the CLI-first workflow.
- Use the verified command pattern:
  - `npx -y agnes-ai-cli@^0.1.0 --help`
  - `npx -y agnes-ai-cli@^0.1.0 text chat --prompt "..."`
- Prefer Agnes CLI over hand-written HTTP requests for live execution.
- If an API key is needed, use the environment variable `AGNES_API_KEY`.
- If the user asks for a model, choose the smallest suitable one:
  - text: `agnes-2.0-flash`
  - image: `agnes-image-2.1-flash`
  - video: `agnes-video-v2.0`
- For this workspace, treat Agnes as an available tool for text, image, and video generation tasks.

## 全局沟通与项目交付规范 (MoMo 专属)

为了维持与 MoMo 之间最高效、顺畅 of 开发合作体验，AI 助手在后续所有项目的沟通与交付中，必须严格贯彻并应用以下沟通机制：

### 1. 严格的“规划-审批”流程 (Planning & Approval)
*   **凡是有功能性变更、Bug 修复或新功能开发需求时，必须先启动 Planning Mode（规划模式）**。
*   首先深入分析代码库及技术路径，创建或更新 `implementation_plan.md` 实施计划。
*   计划中必须清晰呈现：【问题分析与根源定位】（精准解析 Why）、【优化解决方案】（清晰描述 How）、【拟修改文件】（列出 diff 和文件路径）以及【验证计划】。
*   将 `request_feedback` 设为 `true` 提请 MoMo 确认，**必须在获得 MoMo 的明确审批同意后，方可进入实际代码编写和执行阶段**，杜绝盲目修改。

### 2. 精准的交付与成果跟踪 (Tracking & Walkthrough)
*   执行阶段必须实时维护 `task.md` 任务清单，并在完成后标记。
*   开发与修复完成后，必须编写或更新 `walkthrough.md` 成果报告，归纳变更点，并详细说明手动与自动化验证结果。
*   每一项修复的根源、细节和解决状态，必须同步登记在工作区的 `problem_tracking_log.md`（问题修复跟踪日志）中，保持历史记录的一致性与透明度。

### 3. 防错设计与友好错误反馈 (No Black-Box Errors)
*   编写代码时，必须对可能失败的异步接口、文件操作或平台 API 增加多级降级兜底方案。
*   在全局 `try...catch` 异常分支里，**严禁使用默默忽略的空 catch**。必须加入 `showToast` 或其他显式的 UI 错误反馈，将报错原因直接反馈给用户，严防界面无响应的黑盒状态。

### 4. 尊称与中文沟通规范 (Greeting & Language)
*   **称呼要求**：每次与用户交流、汇报时，**必须尊称用户为 "MoMo"**。
*   **语言规范**：内部推理思考与向 MoMo 展示的所有文本内容（包括解释、指导、错误提示等）均**必须完全使用【中文】**。
*   **工具调用提示**：调用系统工具时，`toolAction` 与 `toolSummary` 必须使用清晰、直观的中文描述。
*   **clickable 链接**：回复中提到的所有关键代码文件、日志或报告，必须创建 clickable 的 GitHub 风格 Markdown 本地链接（如 `[filename](file:///path/to/file)`），方便 MoMo 一键直达。
