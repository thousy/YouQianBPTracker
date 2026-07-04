@echo off
title YouQian血压助�?- 本地测试服务启动�?
echo ==================================================
echo         YouQian血压助�?- 本地测试服务启动�?echo ==================================================
echo.
echo [1/3] 正在检测本�?Node.js 运行环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未能在您的电脑中找到 Node.js 环境�?    echo [说明] 血压计拍照 AI 识别功能需要本�?HTTP 服务支持，无法在本地直接双击运行 index.html 文件（浏览器安全沙箱会拦截离�?OCR Worker）�?    echo [建议] 请先前往 https://nodejs.org 下载并安�?Node.js 官方推荐�?LTS 稳定版�?    echo 安装完成后，请重新双击此脚本即可一键测试！
    echo.
    pause
    exit /b
)

echo [2/3] 正在自动为您在默认浏览器中打开页面...
start "" "http://localhost:9988/index.html"

echo [3/3] 正在本地 9988 端口上开启轻量级 HTTP 安全服务...
echo --------------------------------------------------
echo 工作目录: %~dp0
echo 运行地址: http://localhost:9988
echo 特别说明: 
echo   1. 本服务配置了 --cors (允许跨域) �?-c-1 (彻底禁用浏览器缓�?，可保证 Tesseract 识别正常运行�?echo   2. 请不要关闭此黑色命令行窗口，若关闭此窗口，本地测试服务将自动停止�?echo --------------------------------------------------
echo.

cd /d "%~dp0"
npx --yes http-server ./ -p 9988 --cors -c-1

if %errorlevel% neq 0 (
    echo.
    echo [警告] 服务因异常中断或无法开启！
    echo 可能�?9988 端口已被其他进程占用，或您的网络存在问题�?    echo 请关闭其他运行的测试服务，或重启电脑后重新双击重试�?    echo.
    pause
)

