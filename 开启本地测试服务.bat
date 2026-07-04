@echo off
:: 切换代码页为 UTF-8，防止 Windows 默认 cmd 中文乱码
chcp 65001 >nul
title YouQian血压助手 - 本地测试服务启动器

echo ==================================================
echo         YouQian血压助手 - 本地测试服务启动器
echo ==================================================
echo.
echo [1/3] 正在检测本地 Node.js 运行环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ [错误] 未能在您的电脑中找到 Node.js 环境！
    echo 💡 [说明] 血压计拍照 AI 识别功能需要本地 HTTP 服务支持，无法在本地直接双击双开 index.html 文件运行（浏览器安全沙箱会拦截离线 OCR Worker）。
    echo 📢 [建议] 请先前往 https://nodejs.org 下载并安装 Node.js 官方推荐的 LTS 稳定版。
    echo 安装完成后，请重新双击此脚本即可一键测试！
    echo.
    pause
    exit /b
)

echo [2/3] 正在自动为您在默认浏览器中打开页面...
:: 启动浏览器访问
start "" "http://localhost:9988/index.html"

echo [3/3] 正在本地 9988 端口上开启轻量级 HTTP 安全服务...
echo --------------------------------------------------
echo 📂 当前工作目录: %~dp0
echo 🔌 服务运行地址: http://localhost:9988
echo 💡 特别说明: 
echo   1. 本服务配置了 --cors (允许跨域) 和 -c-1 (彻底禁用浏览器缓存)，可百分之百保证 Tesseract 拍照识别正常运行，并避免代码更新后因浏览器缓存而不生效。
echo   2. 请不要关闭此黑色命令行窗口，若关闭此窗口，本地测试服务将自动停止。
echo --------------------------------------------------
echo.

:: 启动 http-server 服务，加载当前盘符和当前目录
cd /d "%~dp0"
npx --yes http-server ./ -p 9988 --cors -c-1

if %errorlevel% neq 0 (
    echo.
    echo ❌ [警告] 服务因异常中断或无法开启！
    echo 💡 可能是 9988 端口已被其他进程占用，或您的网络存在问题。
    echo 请关闭其他运行的测试服务，或重启电脑后重新双击重试。
    echo.
    pause
)
