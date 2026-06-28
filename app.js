/**
 * 血压助手 (BP Tracker)
 * 核心业务逻辑脚本
 */

// ==========================================
// 1. 初始化状态 (State)
// ==========================================
let bpData = JSON.parse(localStorage.getItem('bp_records')) || [];
let chartInstance = null;
let currentRange = '7'; // 默认查看最近7次趋势
let recordMode = 'single'; // 录入模式：single | multi
let ocrTarget = 'single';  // OCR 目标录入行：single | 1 | 2 | 3

// 血压分级标准定义
const BP_LEVELS = {
    LOW: { class: 'badge-low', label: '低血压', color: '#3b82f6', desc: '血压偏低。建议注意营养，避免突然起立致头晕，必要时咨询医生。' },
    NORMAL: { class: 'badge-normal', label: '正常血压', color: '#10b981', desc: '血压状态极佳，属于健康范围。请继续保持良好的生活习惯！' },
    PREHIGH: { class: 'badge-prehigh', label: '正常偏高', color: '#f59e0b', desc: '血压处于正常偏高范围。建议注意低盐低脂饮食，规律作息和适度运动。' },
    STAGE1: { class: 'badge-stage1', label: '轻度高血压', color: '#f97316', desc: '属于1级高血压。建议限制食盐摄入，控制体重，定期监测血压，必要时就诊。' },
    STAGE2: { class: 'badge-stage2', label: '中重度高血压', color: '#ef4444', desc: '血压处于较高风险级别。请尽快咨询专业医生，按医嘱进行调理或药物治疗。' }
};

// ==========================================
// 2. DOM 元素获取
// ==========================================
const bpForm = document.getElementById('bpForm');
const recordTimeInput = document.getElementById('recordTime');
const setCurrentTimeBtn = document.getElementById('setCurrentTimeBtn');
const systolicInput = document.getElementById('systolic');
const diastolicInput = document.getElementById('diastolic');
const pulseInput = document.getElementById('pulse');

const avgSystolicEl = document.getElementById('avgSystolic');
const avgDiastolicEl = document.getElementById('avgDiastolic');
const avgPulseEl = document.getElementById('avgPulse');
const healthSummaryTextEl = document.getElementById('healthSummaryText');
const healthSummaryIcon = document.querySelector('#healthSummary i');

const historyList = document.getElementById('historyList');
const recordCountEl = document.getElementById('recordCount');
const toastEl = document.getElementById('toast');

const themeToggleBtn = document.getElementById('themeToggleBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const importExcelFile = document.getElementById('importExcelFile');
const clearDataBtn = document.getElementById('clearDataBtn');

// ==========================================
// 3. 辅助函数 (Helpers)
// ==========================================

/**
 * 格式化日期对象为 "YYYY-MM-DD HH:mm" 字符串
 */
function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}

/**
 * 将 "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DDTHH:mm" 字符串安全地解析为本地时间的 Date 对象
 */
function parseDateTimeStr(str) {
    if (!str) return new Date();
    const parts = str.replace('T', ' ').split(' ');
    const dateParts = parts[0].split('-');
    const timeParts = parts[1] ? parts[1].split(':') : [0, 0];
    return new Date(
        parseInt(dateParts[0]),
        parseInt(dateParts[1]) - 1,
        parseInt(dateParts[2]),
        parseInt(timeParts[0] || 0),
        parseInt(timeParts[1] || 0)
    );
}

/**
 * 格式化日期对象为 "YYYY-MM-DDTHH:mm" (datetime-local 控件所需格式)
 */
function formatForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}`;
}

/**
 * 设置记录时间输入框为当前系统时间
 */
function setTimeToNow() {
    const now = new Date();
    recordTimeInput.value = formatForInput(now);
}

/**
 * 根据收缩压和舒张压评估健康等级 (WHO/中国标准)
 */
function evaluateBP(systolic, diastolic) {
    // 强制转换为数字
    const sys = parseInt(systolic);
    const dia = parseInt(diastolic);

    if (sys < 90 || dia < 60) {
        return BP_LEVELS.LOW;
    }
    
    // 如果分属不同级别，以较高级别为准
    if (sys >= 160 || dia >= 100) {
        return BP_LEVELS.STAGE2;
    } else if ((sys >= 140 && sys <= 159) || (dia >= 90 && dia <= 99)) {
        return BP_LEVELS.STAGE1;
    } else if ((sys >= 120 && sys <= 139) || (dia >= 80 && dia <= 89)) {
        return BP_LEVELS.PREHIGH;
    } else {
        return BP_LEVELS.NORMAL;
    }
}

/**
 * 显示 Toast 提示信息
 */
function showToast(message, type = 'success') {
    toastEl.className = `toast-container toast-${type} show`;
    
    let icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'info') icon = 'fa-circle-info';
    
    toastEl.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    
    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 2500);
}

// ==========================================
// 4. 业务逻辑与数据管理
// ==========================================

/**
 * 保存记录到本地存储并刷新 UI
 */
function saveRecord(sys, dia, pulse, dateTimeStr, note = '') {
    const levelObj = evaluateBP(sys, dia);
    const newRecord = {
        id: 'record_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        time: dateTimeStr.replace('T', ' '), // 转换为 "YYYY-MM-DD HH:mm"
        systolic: parseInt(sys),
        diastolic: parseInt(dia),
        pulse: parseInt(pulse),
        level: levelObj.label,
        levelClass: levelObj.class,
        note: note
    };

    bpData.unshift(newRecord); // 最新记录放最前
    // 按时间进行降序排序，保证时间线上是最新的在最前
    bpData.sort((a, b) => parseDateTimeStr(b.time) - parseDateTimeStr(a.time));

    localStorage.setItem('bp_records', JSON.stringify(bpData));
    
    updateUI();
    showToast('血压记录已成功保存！');
}

/**
 * 显示自定义确认模态弹窗，返回 Promise (resolve true 代表确认，false 代表取消)
 */
function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        msgEl.innerText = message;
        modal.classList.add('show');

        const onConfirm = () => {
            modal.classList.remove('show');
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            modal.classList.remove('show');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

/**
 * 删除单条血压记录
 */
function deleteRecord(id, cardElement) {
    cardElement.classList.add('deleting');
    
    // 动效结束后从数组中移除并刷新 UI
    setTimeout(() => {
        bpData = bpData.filter(item => item.id !== id);
        localStorage.setItem('bp_records', JSON.stringify(bpData));
        updateUI();
        showToast('已删除该条记录。', 'info');
    }, 300);
}

/**
 * 重新计算平均值及生成健康状态建议
 */
function updateStatsAndDashboard() {
    const dashboardTitleEl = document.getElementById('dashboardTitle');
    if (bpData.length === 0) {
        if (dashboardTitleEl) { dashboardTitleEl.innerText = '最近 7 次平均值'; }
        avgSystolicEl.innerText = '--';
        avgDiastolicEl.innerText = '--';
        avgPulseEl.innerText = '--';
        healthSummaryTextEl.innerText = '暂无足够数据，请开始记录';
        healthSummaryIcon.className = 'fa-solid fa-circle-info';
        healthSummaryIcon.style.color = 'var(--text-muted)';
        return;
    }

    // 取最后一次记录（最新录入的那一条，位于数组第一位）
    const lastRecord = bpData[0];
    
    // 更新看板标题为最后一次测量时间并换行
    if (dashboardTitleEl) {
        dashboardTitleEl.innerHTML = `最后一次测量数据<br><span style="font-size: 11.5px; font-weight: normal; color: var(--text-muted); margin-top: 4px; display: block; text-transform: none; letter-spacing: 0;">测量时间：${lastRecord.time}</span>`;
    }

    avgSystolicEl.innerText = lastRecord.systolic;
    avgDiastolicEl.innerText = lastRecord.diastolic;
    avgPulseEl.innerText = lastRecord.pulse;

    // 评估最后一次血压的健康等级并提供健康小建议
    const levelObj = evaluateBP(lastRecord.systolic, lastRecord.diastolic);
    healthSummaryTextEl.innerText = `最新血压属于【${levelObj.label}】。${levelObj.desc}`;
    healthSummaryIcon.className = 'fa-solid fa-heart-circle-check';
    healthSummaryIcon.style.color = levelObj.color;
}

/**
 * 渲染历史记录列表
 */
function renderHistoryList() {
    recordCountEl.innerText = `共 ${bpData.length} 条`;

    if (bpData.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-notes-medical"></i>
                <p>暂无血压记录，请在“记录”标签中添加</p>
            </div>
        `;
        return;
    }

    let html = '';
    bpData.forEach(item => {
        const noteBadge = item.note ? `<span class="record-note-badge"><i class="fa-solid fa-calculator"></i> ${item.note}</span>` : '';
        html += `
            <div class="record-card" data-id="${item.id}">
                <div class="record-info">
                    <div class="record-datetime">${item.time}</div>
                    <div class="record-nums">
                        <div class="record-bp-row">
                            <span class="record-bp-sys">${item.systolic}</span>
                            <span class="record-slash">/</span>
                            <span class="record-bp-dia">${item.diastolic}</span>
                            <span class="record-unit" style="font-size: 11px; color: var(--text-muted); margin-left: 2px;">mmHg</span>
                        </div>
                        <div class="record-pulse-row">
                            <span class="record-pulse-val"><i class="fa-solid fa-heart pulse-icon" style="animation:none; font-size: 11px; color: #ef4444;"></i> ${item.pulse} <span style="font-size: 10px; color: var(--text-muted);">次/分</span></span>
                        </div>
                    </div>
                </div>
                <div class="record-actions">
                    ${noteBadge}
                    <span class="record-status-badge ${item.levelClass}">${item.level}</span>
                    <button class="delete-record-btn" onclick="handleDeleteRecord('${item.id}', this)" title="删除">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    });

    historyList.innerHTML = html;
}

// 绑定到 window，方便 HTML 中的 onclick 调用
window.handleDeleteRecord = async function(id, btnEl) {
    const cardEl = btnEl.closest('.record-card');
    const confirmed = await showConfirmModal('确认删除这条血压记录吗？');
    if (confirmed) {
        deleteRecord(id, cardEl);
    }
};

// ==========================================
// 5. Chart.js 图表渲染逻辑
// ==========================================

/**
 * 绘制/刷新血压趋势图表
 */
function renderChart() {
    const ctx = document.getElementById('trendsChart').getContext('2d');
    
    // 如果没有数据，清空图表并返回
    if (bpData.length === 0) {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        return;
    }

    // 根据选择的时间范围截取数据
    let displayData = [...bpData];
    if (currentRange === '7') {
        displayData = displayData.slice(0, 7);
    } else if (currentRange === '30') {
        displayData = displayData.slice(0, 30);
    }
    displayData.reverse(); // 时间正序

    const labels = displayData.map(item => item.time.substring(5));
    const systolicData = displayData.map(item => item.systolic);
    const diastolicData = displayData.map(item => item.diastolic);
    const pulseData = displayData.map(item => item.pulse);

    // 获取当前主题
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#9ca3af' : '#374151';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.1)';

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '高压 (收缩压)',
                    data: systolicData,
                    borderColor: isDark ? '#f43f5e' : '#e11d48',
                    backgroundColor: isDark ? 'rgba(244, 63, 94, 0.08)' : 'rgba(225, 29, 72, 0.12)',
                    borderWidth: isDark ? 3 : 3.5,
                    pointBackgroundColor: isDark ? '#f43f5e' : '#e11d48',
                    pointBorderColor: isDark ? '#f43f5e' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2.5,
                    pointRadius: isDark ? 4 : 5.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: '低压 (舒张压)',
                    data: diastolicData,
                    borderColor: isDark ? '#10b981' : '#059669',
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(5, 150, 105, 0.12)',
                    borderWidth: isDark ? 3 : 3.5,
                    pointBackgroundColor: isDark ? '#10b981' : '#059669',
                    pointBorderColor: isDark ? '#10b981' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2.5,
                    pointRadius: isDark ? 4 : 5.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: '脉搏',
                    data: pulseData,
                    borderColor: isDark ? '#f59e0b' : '#d97706',
                    borderDash: [5, 5],
                    borderWidth: isDark ? 2 : 2.5,
                    pointBackgroundColor: isDark ? '#f59e0b' : '#d97706',
                    pointBorderColor: isDark ? '#f59e0b' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2,
                    pointRadius: isDark ? 3 : 4.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            layout: {
                padding: {
                    left: 10,
                    right: 10,
                    top: 10,
                    bottom: 0
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        boxWidth: 12,
                        font: { size: 11, family: 'Inter' }
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(17,24,39,0.95)' : 'rgba(255,255,255,0.98)',
                    titleColor: isDark ? '#f3f4f6' : '#111827',
                    bodyColor: isDark ? '#9ca3af' : '#374151',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if (context.dataset.label.includes('脉搏')) {
                                    label += context.parsed.y + ' 次/分';
                                } else {
                                    label += context.parsed.y + ' mmHg';
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 10 } },
                    border: { color: gridColor }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: '血压 (mmHg) / 脉搏 (次/分)',
                        color: textColor,
                        font: { size: 11 }
                    },
                    grid: { color: gridColor },
                    ticks: { color: textColor },
                    border: { color: gridColor },
                    min: 40,
                    max: 220,
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = 52;
                    }
                }
            }
        }
    });
}

function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

/**
 * 在 Cordova 手机环境下将 Blob 二进制文件保存到本地
 */
function saveFileInCordova(fileName, dataBlob) {
    return new Promise((resolve, reject) => {
        if (!window.cordova || !cordova.file) {
            reject(new Error('未检测到 Cordova 环境'));
            return;
        }

        // 优先保存到手机的公共 Download 目录
        const parentDir = cordova.file.externalRootDirectory + "Download/";

        window.resolveLocalFileSystemURL(parentDir, function(dirEntry) {
            dirEntry.getFile(fileName, { create: true, exclusive: false }, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = function() {
                        resolve(fileEntry.nativeURL);
                    };
                    fileWriter.onerror = function(err) {
                        reject(err);
                    };
                    fileWriter.write(dataBlob);
                }, reject);
            }, reject);
        }, function(err) {
            // Fallback: 写入 App 外部私有目录
            const fallbackDir = cordova.file.externalApplicationStorageDirectory || cordova.file.dataDirectory;
            window.resolveLocalFileSystemURL(fallbackDir, function(fallbackDirEntry) {
                fallbackDirEntry.getFile(fileName, { create: true, exclusive: false }, function(fileEntry) {
                    fileEntry.createWriter(function(fileWriter) {
                        fileWriter.onwriteend = function() {
                            resolve(fileEntry.nativeURL);
                        };
                        fileWriter.onerror = function(err) {
                            reject(err);
                        };
                        fileWriter.write(dataBlob);
                    }, reject);
                }, reject);
            }, reject);
        });
    });
}

// ==========================================
// 6. Excel 导入与导出逻辑 (SheetJS)
// ==========================================

/**
 * 导出数据到 Excel
 */
function exportToExcel() {
    if (bpData.length === 0) {
        showToast('暂无记录可导出！', 'error');
        return;
    }

    try {
        // 构建表格数据，表头中文更友好
        const excelData = bpData.map(item => ({
            '记录时间': item.time,
            '高压 (收缩压) mmHg': item.systolic,
            '低压 (舒张压) mmHg': item.diastolic,
            '脉搏 (次/分钟)': item.pulse,
            '健康等级': item.level
        }));

        // 创建 Worksheet
        const ws = XLSX.utils.json_to_sheet(excelData);

        // 设置列宽，让表格在 Excel 中显示更美观
        const colWidths = [
            { wch: 22 }, // 记录时间
            { wch: 18 }, // 高压
            { wch: 18 }, // 低压
            { wch: 15 }, // 脉搏
            { wch: 12 }  // 健康等级
        ];
        ws['!cols'] = colWidths;

        // 创建 Workbook 并写入数据
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "血压记录");

        // 获取当前时间戳作为文件名后缀
        const todayStr = formatDateTime(new Date()).split(' ')[0];
        const fileName = `YouQian血压历史记录_${todayStr}.xlsx`;

        if (window.cordova) {
            // Cordova 环境下生成二进制并本地写入
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: "application/octet-stream" });
            
            saveFileInCordova(fileName, blob)
                .then((nativeUrl) => {
                    const copied = copyDataToClipboard();
                    let displayPath = `手机存储/Download/${fileName}`;
                    if (nativeUrl.indexOf('Download') === -1) {
                        displayPath = `内部私有存储/${fileName} (建议通过剪贴板数据直接去微信粘贴分享)`;
                    }
                    showAlertModal(
                        'Excel 导出成功', 
                        `<i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 20px; margin-right: 6px;"></i> 血压数据已成功写入本地文件！<br><br>
                         📂 <strong>保存路径</strong>：<br>
                         <span style="color: var(--primary); font-family: monospace; word-break: break-all;">${displayPath}</span><br><br>
                         💡 <strong>数据已复制到剪贴板</strong>：<br>
                         为防不同设备查找不便，系统已自动将全部 ${bpData.length} 条记录复制到剪贴板！您可以去微信直接粘贴发送给医生。`
                    );
                })
                .catch((err) => {
                    console.error('Cordova Excel Save Error:', err);
                    const copied = copyDataToClipboard();
                    showAlertModal(
                        'Excel 导出提示', 
                        `<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b; font-size: 20px; margin-right: 6px;"></i> 写入本地文件失败 (${err.message || err})。<br><br>
                         💡 <strong>但数据已复制到剪贴板</strong>：<br>
                         系统已自动将全部 ${bpData.length} 条记录复制到剪贴板！您可以去微信直接粘贴发送给医生。`
                    );
                });
        } else {
            // 普通浏览器端：下载 Excel
            XLSX.writeFile(wb, fileName);
            showToast(`Excel 文件导出成功！\n请在您电脑的【下载】文件夹中查看，文件名为：${fileName}`);
        }
    } catch (err) {
        console.error(err);
        showToast('导出 Excel 失败，请重试。', 'error');
    }
}

/**
 * 将数据格式化为文本表格并复制到系统剪贴板
 */
function copyDataToClipboard() {
    try {
        let text = "📋 YouQian血压助手 - 血压历史记录数据\n\n";
        text += "时间                 | 高压 | 低压 | 脉搏 | 状态评估\n";
        text += "---------------------------------------------------\n";
        bpData.forEach(item => {
            const timeStr = item.time.padEnd(20, ' ');
            const sysStr = String(item.systolic).padStart(4, ' ');
            const diaStr = String(item.diastolic).padStart(4, ' ');
            const pulseStr = String(item.pulse).padStart(4, ' ');
            text += `${timeStr} | ${sysStr} | ${diaStr} | ${pulseStr} | ${item.level}\n`;
        });
        text += "---------------------------------------------------\n";
        text += `数据统计：共 ${bpData.length} 条测量记录\n`;
        text += `生成时间：${formatDateTime(new Date())}`;

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    } catch (e) {
        console.error('一键复制数据失败:', e);
        return false;
    }
}

/**
 * 从 Excel 导入数据
 */
function importFromExcel(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // 读取第一张 Worksheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // 将 Worksheet 转为 JSON
            const rawRows = XLSX.utils.sheet_to_json(worksheet);
            
            if (rawRows.length === 0) {
                showToast('Excel 文件中没有数据！', 'error');
                return;
            }

            let importCount = 0;
            let skipCount = 0;

            rawRows.forEach(row => {
                // 尝试匹配中文字段或英文原字段（容错处理）
                const time = row['记录时间'] || row['time'] || row['Time'] || '';
                const sys = parseInt(row['高压 (收缩压) mmHg'] || row['高压(收缩压)mmHg'] || row['高压'] || row['systolic'] || row['Systolic']);
                const dia = parseInt(row['低压 (舒张压) mmHg'] || row['低压(舒张压)mmHg'] || row['低压'] || row['diastolic'] || row['Diastolic']);
                const pulse = parseInt(row['脉搏 (次/分钟)'] || row['脉搏(次/分)'] || row['脉搏'] || row['pulse'] || row['Pulse']);

                // 核心字段格式校验
                if (time && !isNaN(sys) && !isNaN(dia) && !isNaN(pulse)) {
                    // 标准化时间格式，把可能的 Excel 时间转换或者 T 替换为空格
                    let formattedTime = String(time).trim().replace('T', ' ');
                    if (formattedTime.length > 16) {
                        formattedTime = formattedTime.substring(0, 16); // 截取到分钟 "YYYY-MM-DD HH:mm"
                    }

                    // 避免重复导入完全相同时间的数据
                    const isDuplicate = bpData.some(item => item.time === formattedTime);
                    if (isDuplicate) {
                        skipCount++;
                        return;
                    }

                    const levelObj = evaluateBP(sys, dia);
                    
                    bpData.push({
                        id: 'record_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                        time: formattedTime,
                        systolic: sys,
                        diastolic: dia,
                        pulse: pulse,
                        level: levelObj.label,
                        levelClass: levelObj.class
                    });
                    importCount++;
                }
            });

            if (importCount > 0) {
                // 按日期降序重新排序
                bpData.sort((a, b) => parseDateTimeStr(b.time) - parseDateTimeStr(a.time));
                localStorage.setItem('bp_records', JSON.stringify(bpData));
                updateUI();
                showToast(`成功导入 ${importCount} 条记录！${skipCount > 0 ? `已自动排重 ${skipCount} 条。` : ''}`, 'success');
            } else {
                showToast('导入失败，请检查 Excel 文件格式！', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('解析 Excel 失败，文件格式有误。', 'error');
        }
        // 重置 input，允许重新选择相同文件
        importExcelFile.value = '';
    };

    reader.readAsArrayBuffer(file);
}

// ==========================================
// 6.5. 门诊多次测量及 OCR 识别逻辑
// ==========================================

/**
 * 实时监测多次录入数据并计算差值与预览
 */
function handleMultiInputCheck() {
    const diffHintBox = document.getElementById('multiDiffHint');
    const diffHintText = document.getElementById('diffHintText');
    const previewBox = document.getElementById('multiCalcPreview');
    const container = document.getElementById('dynamicMultiContainer');

    // 1. 获取当前所有测量值
    let i = 1;
    const values = [];
    while (true) {
        const sysEl = document.getElementById(`sys${i}`);
        const diaEl = document.getElementById(`dia${i}`);
        const pulseEl = document.getElementById(`pulse${i}`);
        if (!sysEl) break;
        values.push({
            index: i,
            sys: sysEl.value ? parseInt(sysEl.value) : null,
            dia: diaEl.value ? parseInt(diaEl.value) : null,
            pulse: pulseEl.value ? parseInt(pulseEl.value) : null,
            sysEl,
            diaEl,
            pulseEl
        });
        i++;
    }

    // 2. 检查前 2 次输入
    if (values.length < 2 || values[0].sys === null || values[0].dia === null || values[1].sys === null || values[1].dia === null) {
        diffHintBox.style.display = 'none';
        previewBox.style.display = 'none';
        if (container) { container.innerHTML = ''; }
        return;
    }

    // 3. 链式级联比对
    let currentIdx = 1;
    let finished = false;
    let finalSys = 0;
    let finalDia = 0;
    let finalPulse = 0;
    let hintHtml = '';

    while (true) {
        const prev = values[currentIdx - 1];
        const curr = values[currentIdx];

        if (!curr || curr.sys === null || curr.dia === null) {
            finished = false;
            removeExtraInputs(currentIdx + 2);
            break;
        }

        const sysDiff = Math.abs(prev.sys - curr.sys);
        const diaDiff = Math.abs(prev.dia - curr.dia);

        if (sysDiff <= 10 && diaDiff <= 10) {
            finished = true;
            finalSys = Math.round((prev.sys + curr.sys) / 2);
            finalDia = Math.round((prev.dia + curr.dia) / 2);
            const p1 = prev.pulse || 0;
            const p2 = curr.pulse || 0;
            finalPulse = (p1 && p2) ? Math.round((p1 + p2) / 2) : (p2 || p1 || '--');

            if (currentIdx === 1) {
                hintHtml = `<strong style="display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-circle-check"></i> 差值正常：</strong>两次测量差异较小（高压差: ${sysDiff}mmHg，低压差: ${diaDiff}mmHg，均在 10mmHg 以内）。系统将直接取两次测量的平均值进行保存。`;
            } else {
                hintHtml = `<strong style="display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-circle-check"></i> 差值正常：</strong>最后两次（第 ${currentIdx} 次和第 ${currentIdx + 1} 次）测量差异较小（高压差: ${sysDiff}mmHg，低压差: ${diaDiff}mmHg，已收敛在 10mmHg 以内）。系统将取最后这两次的平均值进行保存。`;
            }

            removeExtraInputs(currentIdx + 2);
            break;
        } else {
            const nextNum = currentIdx + 2;
            hintHtml = `<strong style="display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-triangle-exclamation"></i> 门诊需测量第 ${nextNum} 次：</strong>最后两次（第 ${currentIdx} 次和第 ${currentIdx + 1} 次）测量差异较大（高压差: ${sysDiff}mmHg，低压差: ${diaDiff}mmHg，已超过 10mmHg）。请在间隔 1 分钟后进行第 ${nextNum} 次测量并在下方录入。`;

            if (values.length < nextNum) {
                appendNewInputCard(nextNum);
                finished = false;
                break;
            } else {
                currentIdx++;
            }
        }
    }

    // 4. 更新 UI 状态与提示框动态定位
    diffHintBox.style.display = 'flex';
    if (finished) {
        diffHintBox.classList.add('info-mode');
        diffHintText.innerHTML = hintHtml;
        previewBox.style.display = 'block';
        document.getElementById('previewSys').innerText = finalSys;
        document.getElementById('previewDia').innerText = finalDia;
        document.getElementById('previewPulse').innerText = finalPulse;

        // 动态移动提示框位置
        const lastCardNum = currentIdx + 1;
        if (lastCardNum >= 3) {
            const lastCard = document.getElementById(`multiSectionCard${lastCardNum}`);
            if (lastCard) {
                if (lastCard.nextSibling) {
                    container.insertBefore(diffHintBox, lastCard.nextSibling);
                } else {
                    container.appendChild(diffHintBox);
                }
            }
        } else {
            container.parentNode.insertBefore(diffHintBox, container);
        }
    } else {
        diffHintBox.classList.remove('info-mode');
        diffHintText.innerHTML = hintHtml;
        previewBox.style.display = 'none';

        // 未收敛，移动提示框到最新卡片上方
        const nextNum = currentIdx + 2;
        const nextCard = document.getElementById(`multiSectionCard${nextNum}`);
        if (nextCard) {
            container.insertBefore(diffHintBox, nextCard);
        }
    }
}

function appendNewInputCard(num) {
    const container = document.getElementById('dynamicMultiContainer');
    if (!container || document.getElementById(`sys${num}`)) return;

    const card = document.createElement('div');
    card.className = 'multi-section-card third-section';
    card.id = `multiSectionCard${num}`;
    card.innerHTML = `
        <div class="section-sub-header">
            <span class="field-group-title"><span class="badge-num warn">${num}</span> 第 ${num} 次测量</span>
            <button type="button" class="ocr-btn-action" data-target="${num}">
                <i class="fa-solid fa-camera"></i> 拍照识别
            </button>
        </div>
        <div class="inputs-row">
            <div class="form-group flex-1">
                <label for="sys${num}">收缩压 (高压)</label>
                <div class="input-unit-wrapper">
                    <input type="number" id="sys${num}" min="50" max="250" placeholder="120" required>
                    <span class="unit">mmHg</span>
                </div>
            </div>
            <div class="form-group flex-1">
                <label for="dia${num}">舒张压 (低压)</label>
                <div class="input-unit-wrapper">
                    <input type="number" id="dia${num}" min="30" max="180" placeholder="80" required>
                    <span class="unit">mmHg</span>
                </div>
            </div>
        </div>
        <div class="form-group">
            <label for="pulse${num}">脉搏</label>
            <div class="input-unit-wrapper">
                <input type="number" id="pulse${num}" min="30" max="220" placeholder="75" required>
                <span class="unit">次/分</span>
            </div>
        </div>
    `;
    container.appendChild(card);

    // 绑定事件监听，当新输入框值改变时，自动重新链式评估差值
    document.getElementById(`sys${num}`).addEventListener('input', handleMultiInputCheck);
    document.getElementById(`dia${num}`).addEventListener('input', handleMultiInputCheck);
    document.getElementById(`pulse${num}`).addEventListener('input', handleMultiInputCheck);
}

/**
 * 递归删除大于等于某序号的所有动态追加测量框
 */
function removeExtraInputs(startNum) {
    let num = startNum;
    while (true) {
        const card = document.getElementById(`multiSectionCard${num}`);
        if (!card) break;
        card.remove();
        num++;
    }
}

function preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    // 1. 转为灰度矩阵
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
    }

    // 2. 利用积分图计算局部均值并二值化 (Bradley 局部自适应算法)
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

    // s 相当于窗口大小（设为图像宽度的 1/8），t 相当于灵敏度（设为比局部均值低 10% 则判定为黑字）
    const S = Math.round(w / 8);
    const halfS = Math.round(S / 2);
    const t = 10;

    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            const x1 = Math.max(i - halfS, 0);
            const x2 = Math.min(i + halfS, w - 1);
            const y1 = Math.max(j - halfS, 0);
            const y2 = Math.min(j + halfS, h - 1);

            const count = (x2 - x1) * (y2 - y1);

            const idxTopLeft = y1 * w + x1;
            const idxTopRight = y1 * w + x2;
            const idxBottomLeft = y2 * w + x1;
            const idxBottomRight = y2 * w + x2;

            // 局部区域灰度求和
            const sum = intImg[idxBottomRight] - intImg[idxTopRight] - intImg[idxBottomLeft] + intImg[idxTopLeft];
            const mean = sum / count;

            const currGray = gray[j * w + i];
            // 判定：像素值低于均值 10% 判为段码液晶数字
            const val = currGray * 100 < mean * (100 - t) ? 0 : 255;

            const idx = (j * w + i) * 4;
            data[idx] = val;
            data[idx+1] = val;
            data[idx+2] = val;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * 从识别出的所有数字中，基于临床医学高压/低压/脉搏分布规律与位置顺序进行智能比对提取，
 * 能够完美过滤像血压仪型号“710”或各种微小噪点。
 */
function parseBPValues(nums) {
    if (!nums || nums.length < 2) return null;

    let systolic = null;
    let diastolic = null;
    let pulse = null;

    // 1. 欧姆龙血压计一般从上往下显示：高压 -> 低压 -> 脉搏
    // 寻找高压收缩压（符合 90 - 195 范围）
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        if (n >= 90 && n <= 195 && systolic === null) {
            systolic = n;
            // 寻找低压舒张压（符合 50 - 115 范围，且必须小于高压）
            for (let j = i + 1; j < nums.length; j++) {
                const m = nums[j];
                if (m >= 50 && m <= 115 && m < systolic && diastolic === null) {
                    diastolic = m;
                    // 寻找脉搏（符合 45 - 120 范围）
                    for (let k = j + 1; k < nums.length; k++) {
                        const p = nums[k];
                        if (p >= 45 && p <= 120) {
                            pulse = p;
                            break;
                        }
                    }
                    break;
                }
            }
            if (systolic && diastolic) break;
        }
    }

    // 2. 降级容错匹配：如果严格的顺序寻找失败了，就对包含的所有数字做全局排序筛选
    if (!systolic || !diastolic) {
        const validSys = nums.filter(n => n >= 90 && n <= 195);
        const validDia = nums.filter(n => n >= 50 && n <= 110);
        const validPulse = nums.filter(n => n >= 45 && n <= 120);

        if (validSys.length > 0 && validDia.length > 0) {
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

/**
 * 图像预处理第二路：直方图拉伸 + 对比度双剪切增强（保留灰度平滑，极大减少反光与断笔）
 */
function preprocessImageGrayContrast(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;

    // 1. 转灰度并记录最大最小值
    let minG = 255;
    let maxG = 0;
    const grays = new Uint8Array(len / 4);

    for (let i = 0; i < len; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grays[i / 4] = gray;
        if (gray < minG) minG = gray;
        if (gray > maxG) maxG = gray;
    }

    const range = maxG - minG || 1;

    // 2. 直方图拉伸与剪切
    for (let i = 0; i < len; i += 4) {
        const idx = i / 4;
        const origGray = grays[idx];
        
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

        data[i] = newGray;
        data[i + 1] = newGray;
        data[i + 2] = newGray;
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * 辅助克隆 Canvas 画布
 */
function cloneCanvas(oldCanvas) {
    const newCanvas = document.createElement('canvas');
    newCanvas.width = oldCanvas.width;
    newCanvas.height = oldCanvas.height;
    const ctx = newCanvas.getContext('2d');
    ctx.drawImage(oldCanvas, 0, 0);
    return newCanvas;
}

/**
 * 液晶混淆英文字符还原映射
 */
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

/**
 * Canvas 图像边缘黑框 BFS 涂白清洗
 */
function clearBordersLeftRight(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    const visited = new Uint8Array(w * h);
    const queue = [];

    // 从最左边缘 (x=0) 和最右边缘 (x=w-1) 注入种子
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
            const idx = i * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Canvas 黑色段码数字边缘膨胀，防止笔画过细断开
 */
function dilateBlack(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    const temp = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        temp[i] = data[i * 4];
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (temp[idx] === 255) {
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
                    const pixelIdx = idx * 4;
                    data[pixelIdx] = 0;
                    data[pixelIdx + 1] = 0;
                    data[pixelIdx + 2] = 0;
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * 根据百分比高度切片并擦除其余部分的物理分轨
 */
function makeCanvasSlice(srcCanvas, yStartPct, yEndPct, xStartPct = 0, xEndPct = 1) {
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = srcCanvas.width;
    sliceCanvas.height = srcCanvas.height;
    const ctx = sliceCanvas.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, sliceCanvas.width, sliceCanvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    const startY = Math.round(h * yStartPct);
    const endY = Math.round(h * yEndPct);
    const startX = Math.round(w * xStartPct);
    const endX = Math.round(w * xEndPct);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x < startX || x >= endX || y < startY || y >= endY) {
                const idx = (y * w + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return sliceCanvas;
}

/**
 * 通用的 AI OCR 识别与填充流程（黄金局部裁剪与三路互补流）
 */
async function performOCRProcess(canvas) {
    const loadingModal = document.getElementById('ocrLoadingModal');
    const loadingMessage = document.getElementById('ocrLoadingMessage');
    const progressBar = document.getElementById('ocrProgressBar');

    progressBar.style.width = '10%';
    loadingMessage.innerText = '正在载入并优化图像分辨率...';
    loadingModal.classList.add('show');

    let worker = null;

    try {
        const w = canvas.width;
        const h = canvas.height;

        // 1. 裁剪两路定位 Canvas
        // Road 1 窄裁剪 (X:50%, Y:36%, W:31%, H:47%)
        const cropX1 = Math.round(w * 0.50);
        const cropY1 = Math.round(h * 0.36);
        const cropW1 = Math.round(w * 0.31);
        const cropH1 = Math.round(h * 0.47);

        // Road 2 & 3 中宽裁剪 (X:46%, Y:34%, W:38%, H:50%)
        const cropX2 = Math.round(w * 0.46);
        const cropY2 = Math.round(h * 0.34);
        const cropW2 = Math.round(w * 0.38);
        const cropH2 = Math.round(h * 0.50);

        if (cropW1 <= 0 || cropH1 <= 0 || cropW2 <= 0 || cropH2 <= 0) {
            throw new Error(`图像缩放尺寸异常: ${w}x${h}`);
        }

        // 创建 Road 1 画布
        const canvasRoad1 = document.createElement('canvas');
        canvasRoad1.width = cropW1;
        canvasRoad1.height = cropH1;
        canvasRoad1.getContext('2d').drawImage(canvas, cropX1, cropY1, cropW1, cropH1, 0, 0, cropW1, cropH1);

        // 创建 Road 2 和 Road 3 画布
        const canvasRoad2 = document.createElement('canvas');
        canvasRoad2.width = cropW2;
        canvasRoad2.height = cropH2;
        canvasRoad2.getContext('2d').drawImage(canvas, cropX2, cropY2, cropW2, cropH2, 0, 0, cropW2, cropH2);

        const canvasRoad3 = cloneCanvas(canvasRoad2);

        progressBar.style.width = '20%';
        loadingMessage.innerText = '正在初始化 AI 识别引擎...';

        // 初始化单 Worker，常驻重用
        worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT',
            tessedit_pageseg_mode: '7' // 只使用高精度的单行识别模式
        });

        progressBar.style.width = '30%';
        loadingMessage.innerText = '正在进行多路物理切分与对比度调优...';

        // Road 1 预处理：自适应二值化 + 边缘去噪 + 膨胀
        preprocessImage(canvasRoad1); // 自适应 Bradley 10 二值化
        clearBordersLeftRight(canvasRoad1);
        dilateBlack(canvasRoad1);

        // Road 2 预处理：对比度拉伸 + 自适应二值化 + 边缘去噪 + 膨胀
        preprocessImageGrayContrast(canvasRoad2);
        preprocessImage(canvasRoad2);
        clearBordersLeftRight(canvasRoad2);
        dilateBlack(canvasRoad2);

        // Road 3 预处理：对比度拉伸灰度图
        preprocessImageGrayContrast(canvasRoad3);

        // 收集三路各自的分轨切片 (物理切片增加三轨低压以应对拍照垂直偏移)
        const makeSlices = (srcCanvas) => {
            return {
                sys: makeCanvasSlice(srcCanvas, 0.0, 0.38),
                diaWide: makeCanvasSlice(srcCanvas, 0.31, 0.69),
                diaMid: makeCanvasSlice(srcCanvas, 0.35, 0.69),
                diaNarrow: makeCanvasSlice(srcCanvas, 0.38, 0.68),
                pulse: makeCanvasSlice(srcCanvas, 0.63, 1.0, 0.45, 1.0)
            };
        };

        const slices1 = makeSlices(canvasRoad1);
        const slices2 = makeSlices(canvasRoad2);
        const slices3 = makeSlices(canvasRoad3);

        const sysCandidates = [];
        const diaCandidates = [];
        const pulseCandidates = [];

        const addCandidate = (val, source, type) => {
            if (!val) return;
            const mapped = mapConfusedCharacters(val);
            const num = parseInt(mapped.replace(/[^0-9]/g, ''));
            if (!isNaN(num)) {
                const item = { num, source, raw: val };
                if (type === 'sys') sysCandidates.push(item);
                if (type === 'dia') diaCandidates.push(item);
                if (type === 'pulse') pulseCandidates.push(item);
            }
        };

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

        const solveForRoad = (roadPrefixes) => {
            const filteredSys = sysCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
            const filteredDia = diaCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
            const filteredPulse = pulseCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));

            const sys = getBestValue(filteredSys, 90, 195);
            const dia = getBestValue(filteredDia, 50, 110);
            const pulse = getBestValue(filteredPulse, 45, 120);

            if (sys && dia) {
                return { systolic: sys, diastolic: dia, pulse: pulse };
            }
            return null;
        };

        // 2. 级联短路式 OCR 识别
        const roads = [
            { slices: slices1, name: 'Road1' },
            { slices: slices2, name: 'Road2' },
            { slices: slices3, name: 'Road3' }
        ];

        let solved = false;
        let finalBP = null;

        for (let r = 0; r < roads.length; r++) {
            const road = roads[r];
            
            // 依次串行识别当前路切片 (高压、低压三轨、脉搏)
            const resSys = await worker.recognize(road.slices.sys);
            addCandidate(resSys.data.text.trim(), `${road.name}_SYS`, 'sys');

            const resDiaWide = await worker.recognize(road.slices.diaWide);
            addCandidate(resDiaWide.data.text.trim(), `${road.name}_DIA_Wide`, 'dia');

            const resDiaMid = await worker.recognize(road.slices.diaMid);
            addCandidate(resDiaMid.data.text.trim(), `${road.name}_DIA_Mid`, 'dia');

            const resDiaNarrow = await worker.recognize(road.slices.diaNarrow);
            addCandidate(resDiaNarrow.data.text.trim(), `${road.name}_DIA_Narrow`, 'dia');

            const resPulse = await worker.recognize(road.slices.pulse);
            addCandidate(resPulse.data.text.trim(), `${road.name}_PULSE`, 'pulse');

            const currentProg = Math.round(30 + ((r + 1) / roads.length) * 60);
            progressBar.style.width = `${currentProg}%`;
            loadingMessage.innerText = `AI 液晶读取中 (${r + 1}/${roads.length})...`;

            // 实时短路评估验证
            const curSys = getBestValue(sysCandidates.filter(c => c.source.startsWith(road.name)), 90, 195);
            const curDia = getBestValue(diaCandidates.filter(c => c.source.startsWith(road.name)), 50, 110);
            const curPulse = getBestValue(pulseCandidates.filter(c => c.source.startsWith(road.name)), 45, 120);

            if (curSys && curDia) {
                finalBP = { systolic: curSys, diastolic: curDia, pulse: curPulse };
                solved = true;
                console.log(`OCR Match: Solved by ${road.name} short-circuit!`, finalBP);
                break; // 成功后立即短路中断，不执行后续 Road 识别
            }
        }

        progressBar.style.width = '95%';
        loadingMessage.innerText = `分级决策表决中...`;

        // 3. 兜底与级联回退决策
        if (!solved) {
            finalBP = solveForRoad(["Road1"]);
            if (!finalBP) {
                finalBP = solveForRoad(["Road2"]);
                if (!finalBP) {
                    finalBP = solveForRoad(["Road1", "Road2"]);
                    if (!finalBP) {
                        finalBP = solveForRoad(["Road1", "Road2", "Road3"]);
                    }
                }
            }

            // 终极兜底
            if (!finalBP) {
                const sys = getBestValue(sysCandidates, 90, 195);
                const dia = getBestValue(diaCandidates, 50, 110);
                const pulse = getBestValue(pulseCandidates, 45, 120);
                if (sys && dia) {
                    finalBP = { systolic: sys, diastolic: dia, pulse: pulse };
                    console.log("OCR Match: Solved by Fallback getBestValue!", finalBP);
                }
            }
        }

        if (finalBP) {
            const sysVal = finalBP.systolic;
            const diaVal = finalBP.diastolic;
            const pulseVal = finalBP.pulse || '';

            // 填充到对应目标框
            if (ocrTarget === 'single') {
                document.getElementById('systolic').value = sysVal;
                document.getElementById('diastolic').value = diaVal;
                if (pulseVal) document.getElementById('pulse').value = pulseVal;
            } else {
                document.getElementById(`sys${ocrTarget}`).value = sysVal;
                document.getElementById(`dia${ocrTarget}`).value = diaVal;
                if (pulseVal) document.getElementById(`pulse${ocrTarget}`).value = pulseVal;
                handleMultiInputCheck();
            }

            showToast(`识别成功！高压:${sysVal}，低压:${diaVal}${pulseVal ? `，脉搏:${pulseVal}` : ''}`);
        } else {
            showToast('未能清晰读取血压计读数，请对准液晶屏拍摄，或尝试手动输入。', 'error');
        }
    } catch (ocrErr) {
        console.error("OCR Exception Details:", ocrErr);
        const errMsg = ocrErr.message || ocrErr;
        showToast('OCR 识别失败: ' + errMsg, 'error');
    } finally {
        if (worker) {
            await worker.terminate();
        }
        loadingModal.classList.remove('show');
    }
}

/**
 * 智能判定环境并调用拍照/相册获取图片
 * @param {string} source 'camera' | 'album'
 */
function requestImageForOCR(source) {
    const isCordova = typeof window.cordova !== 'undefined' && typeof navigator.camera !== 'undefined';
    
    if (isCordova) {
        // Cordova 环境下直接调起原生摄像头/相册
        const sourceType = source === 'camera' 
            ? navigator.camera.PictureSourceType.CAMERA 
            : navigator.camera.PictureSourceType.PHOTOLIBRARY;
            
        navigator.camera.getPicture(
            (base64Data) => {
                processImageBase64(base64Data);
            },
            (err) => {
                console.warn('Cordova Camera Error:', err);
                if (err && err.indexOf('Cancelled') === -1 && err.indexOf('cancelled') === -1) {
                    showToast('无法启动相机，请确认已授予应用相机权限。', 'error');
                }
            },
            {
                quality: 85,
                destinationType: navigator.camera.DestinationType.DATA_URL,
                sourceType: sourceType,
                encodingType: navigator.camera.EncodingType.JPEG,
                mediaType: navigator.camera.MediaType.PICTURE,
                correctOrientation: true,
                targetWidth: 1000,
                targetHeight: 1000
            }
        );
    } else {
        // 浏览器/PWA环境下，触发对应的隐藏 input 控件
        if (source === 'camera') {
            const input = document.getElementById('ocrCameraInput');
            input.value = ''; // 强制清空
            input.click();
        } else {
            const input = document.getElementById('ocrFileInput');
            input.value = ''; // 强制清空
            input.click();
        }
    }
}

/**
 * 接收文件 URL / Base64 数据并加载进行画布缩放与 OCR 提交
 */
function processImageBase64(base64Data) {
    const loadingModal = document.getElementById('ocrLoadingModal');
    const loadingMessage = document.getElementById('ocrLoadingMessage');
    const progressBar = document.getElementById('ocrProgressBar');

    progressBar.style.width = '10%';
    loadingMessage.innerText = '正在载入并优化图片分辨率...';
    loadingModal.classList.add('show');

    const img = new Image();
    img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const maxDim = 800;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
            if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
            } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
            }
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        loadingModal.classList.remove('show');
        performOCRProcess(canvas);
    };
    img.onerror = function() {
        showToast('解析图片失败，文件可能有缺损。', 'error');
        loadingModal.classList.remove('show');
    };
    
    // 补全 base64 协议头
    if (!base64Data.startsWith('data:')) {
        img.src = "data:image/jpeg;base64," + base64Data;
    } else {
        img.src = base64Data;
    }
}

/**
 * 拍照/从相册选取大图进行 OCR 处理（文件 Input 的 change 回调）
 */
async function handleOCRFile(e) {
    const file = e.target.files[0];
    if (!file) {
        e.target.value = ''; // 提前 return 时也强制重置
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        processImageBase64(event.target.result);
    };
    reader.onerror = function() {
        showToast('读取文件出错！', 'error');
    };
    reader.readAsDataURL(file);

    // 立即清空输入值，防止无法二次触发
    e.target.value = '';
}

// ==========================================
// 7. 页面交互控制 (UI Events & Tabs)
// ==========================================

/**
 * 统一更新并同步 UI 状态
 */
function updateUI() {
    updateStatsAndDashboard();
    renderHistoryList();
    renderChart();
}

/**
 * 初始化页面与事件绑定
 */
function init() {
    // 初始化读取并应用缓存的主题，默认为明亮模式 'light'
    const savedTheme = localStorage.getItem('bp_theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    themeToggleBtn.innerHTML = savedTheme === 'light' 
        ? '<i class="fa-solid fa-sun"></i>' 
        : '<i class="fa-solid fa-moon"></i>';

    // 1. 设置输入框默认时间为当前时间
    setTimeToNow();

    // 2. 初始化渲染 UI
    updateUI();

    // 3. 切换时间按钮
    setCurrentTimeBtn.addEventListener('click', setTimeToNow);

    // 3.5 录入模式切换
    const modeSingleBtn = document.getElementById('modeSingleBtn');
    const modeMultiBtn = document.getElementById('modeMultiBtn');
    const singleEntryFields = document.getElementById('singleEntryFields');
    const multiEntryFields = document.getElementById('multiEntryFields');

    const sys1 = document.getElementById('sys1');
    const dia1 = document.getElementById('dia1');
    const pulse1 = document.getElementById('pulse1');
    const sys2 = document.getElementById('sys2');
    const dia2 = document.getElementById('dia2');
    const pulse2 = document.getElementById('pulse2');

    modeSingleBtn.addEventListener('click', () => {
        recordMode = 'single';
        modeSingleBtn.classList.add('active');
        modeMultiBtn.classList.remove('active');
        singleEntryFields.style.display = 'block';
        multiEntryFields.style.display = 'none';

        systolicInput.setAttribute('required', 'required');
        diastolicInput.setAttribute('required', 'required');
        pulseInput.setAttribute('required', 'required');

        sys1.removeAttribute('required');
        dia1.removeAttribute('required');
        pulse1.removeAttribute('required');
        sys2.removeAttribute('required');
        dia2.removeAttribute('required');
        pulse2.removeAttribute('required');
    });

    modeMultiBtn.addEventListener('click', () => {
        recordMode = 'multi';
        modeMultiBtn.classList.add('active');
        modeSingleBtn.classList.remove('active');
        singleEntryFields.style.display = 'none';
        multiEntryFields.style.display = 'block';

        systolicInput.removeAttribute('required');
        diastolicInput.removeAttribute('required');
        pulseInput.removeAttribute('required');

        sys1.setAttribute('required', 'required');
        dia1.setAttribute('required', 'required');
        pulse1.setAttribute('required', 'required');
        sys2.setAttribute('required', 'required');
        dia2.setAttribute('required', 'required');
        pulse2.setAttribute('required', 'required');

        handleMultiInputCheck();
    });

    const multiInputs = [sys1, dia1, pulse1, sys2, dia2, pulse2];
    multiInputs.forEach(inputEl => {
        if (inputEl) {
            inputEl.addEventListener('input', handleMultiInputCheck);
        }
    });

    // 3.8 拍照 OCR 识别事件监听
    const ocrFileInput = document.getElementById('ocrFileInput');
    const ocrCameraInput = document.getElementById('ocrCameraInput');
    const ocrCameraModal = document.getElementById('ocrCameraModal');
    const closeScannerBtn = document.getElementById('closeScannerBtn');
    const captureFrameBtn = document.getElementById('captureFrameBtn');
    const scannerUploadBtn = document.getElementById('scannerUploadBtn');

    const tabRecord = document.getElementById('tab-record');
    if (tabRecord) {
        tabRecord.addEventListener('click', (e) => {
            const btn = e.target.closest('.ocr-btn-action');
            if (btn) {
                ocrTarget = btn.getAttribute('data-target');
                ocrCameraModal.classList.add('show');
            }
        });
    }

    closeScannerBtn.addEventListener('click', () => {
        ocrCameraModal.classList.remove('show');
    });

    captureFrameBtn.addEventListener('click', () => {
        ocrCameraModal.classList.remove('show');
        requestImageForOCR('camera');
    });

    scannerUploadBtn.addEventListener('click', () => {
        ocrCameraModal.classList.remove('show');
        requestImageForOCR('album');
    });

    ocrFileInput.addEventListener('change', handleOCRFile);
    ocrCameraInput.addEventListener('change', handleOCRFile);

    // 4. 表单提交保存
    bpForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const recordTime = recordTimeInput.value;
        
        if (recordMode === 'single') {
            const sys = systolicInput.value;
            const dia = diastolicInput.value;
            const pulse = pulseInput.value;
            saveRecord(sys, dia, pulse, recordTime, '');
        } else {
            let i = 1;
            const values = [];
            while (true) {
                const sysEl = document.getElementById(`sys${i}`);
                const diaEl = document.getElementById(`dia${i}`);
                const pulseEl = document.getElementById(`pulse${i}`);
                if (!sysEl) break;
                values.push({
                    index: i,
                    sys: sysEl.value ? parseInt(sysEl.value) : null,
                    dia: diaEl.value ? parseInt(diaEl.value) : null,
                    pulse: pulseEl.value ? parseInt(pulseEl.value) : null
                });
                i++;
            }

            let currentIdx = 1;
            let finalSys = 0;
            let finalDia = 0;
            let finalPulse = 0;
            let note = '门诊测量';

            while (true) {
                const prev = values[currentIdx - 1];
                const curr = values[currentIdx];

                if (!curr || curr.sys === null || curr.dia === null) {
                    finalSys = prev.sys;
                    finalDia = prev.dia;
                    finalPulse = prev.pulse || 0;
                    note = `门诊测第${currentIdx}次`;
                    break;
                }

                const sysDiff = Math.abs(prev.sys - curr.sys);
                const diaDiff = Math.abs(prev.dia - curr.dia);

                if (sysDiff <= 10 && diaDiff <= 10) {
                    finalSys = Math.round((prev.sys + curr.sys) / 2);
                    finalDia = Math.round((prev.dia + curr.dia) / 2);
                    const p1 = prev.pulse || 0;
                    const p2 = curr.pulse || 0;
                    finalPulse = (p1 && p2) ? Math.round((p1 + p2) / 2) : (p2 || p1);
                    note = `门诊测量(共${currentIdx + 1}次,取最后2次均值)`;
                    break;
                } else {
                    const nextIdx = currentIdx + 1;
                    if (values.length <= nextIdx || values[nextIdx].sys === null || values[nextIdx].dia === null) {
                        finalSys = Math.round((prev.sys + curr.sys) / 2);
                        finalDia = Math.round((prev.dia + curr.dia) / 2);
                        const p1 = prev.pulse || 0;
                        const p2 = curr.pulse || 0;
                        finalPulse = (p1 && p2) ? Math.round((p1 + p2) / 2) : (p2 || p1);
                        note = `门诊未收敛(共${currentIdx + 1}次,取最后均值)`;
                        break;
                    } else {
                        currentIdx++;
                    }
                }
            }

            saveRecord(finalSys, finalDia, finalPulse, recordTime, note);
        }
        
        bpForm.reset();
        setTimeToNow();

        // 多次模式 UI 重置
        const diffHintBox = document.getElementById('multiDiffHint');
        const dynamicContainer = document.getElementById('dynamicMultiContainer');
        if (diffHintBox && dynamicContainer) {
            // 移回原位防止被 innerHTML = '' 清空销毁
            dynamicContainer.parentNode.insertBefore(diffHintBox, dynamicContainer);
        }
        if (diffHintBox) diffHintBox.style.display = 'none';
        document.getElementById('multiCalcPreview').style.display = 'none';
        if (dynamicContainer) { dynamicContainer.innerHTML = ''; }

        if (recordMode === 'multi') {
            sys1.setAttribute('required', 'required');
            dia1.setAttribute('required', 'required');
            pulse1.setAttribute('required', 'required');
            sys2.setAttribute('required', 'required');
            dia2.setAttribute('required', 'required');
            pulse2.setAttribute('required', 'required');

            systolicInput.removeAttribute('required');
            diastolicInput.removeAttribute('required');
            pulseInput.removeAttribute('required');
        } else {
            systolicInput.setAttribute('required', 'required');
            diastolicInput.setAttribute('required', 'required');
            pulseInput.setAttribute('required', 'required');

            sys1.removeAttribute('required');
            dia1.removeAttribute('required');
            pulse1.removeAttribute('required');
            sys2.removeAttribute('required');
            dia2.removeAttribute('required');
            pulse2.removeAttribute('required');
        }
    });

    // 5. 底部 Tab 切换
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');

            navItems.forEach(nav => nav.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            item.classList.add('active');
            const targetPane = document.getElementById(targetTab);
            targetPane.classList.add('active');

            if (targetTab === 'tab-trends') {
                setTimeout(renderChart, 50);
            }
            if (targetTab === 'tab-report') {
                setTimeout(updateReport, 50);
            }
        });
    });

    // 6. 图表时间范围选择器
    const rangeBtns = document.querySelectorAll('.range-btn');
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.getAttribute('data-range');
            renderChart();
        });
    });

    // 7. 主题切换
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', nextTheme);
        localStorage.setItem('bp_theme', nextTheme); // 写入缓存
        themeToggleBtn.innerHTML = nextTheme === 'light' 
            ? '<i class="fa-solid fa-sun"></i>' 
            : '<i class="fa-solid fa-moon"></i>';
        
        if (chartInstance) {
            renderChart();
        }
        if (reportChartInstance) {
            updateReport();
        }
    });

    // 8. 导入/导出/清空事件
    exportExcelBtn.addEventListener('click', exportToExcel);
    importExcelFile.addEventListener('change', importFromExcel);
    clearDataBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmModal('警告：此操作将清空所有血压记录，且无法撤销！\n您确定要清空吗？');
        if (confirmed) {
            bpData = [];
            localStorage.removeItem('bp_records');
            updateUI();
            showToast('已清空所有血压记录。', 'info');
        }
    });

    // 9. 报告时间范围选择器
    const reportRangeBtns = document.querySelectorAll('.report-range-btn');
    reportRangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            reportRangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateReport();
        });
    });

    // 10. 报告导出按钮
    document.getElementById('exportReportPdfBtn').addEventListener('click', exportReportAsPdf);
    document.getElementById('exportReportImgBtn').addEventListener('click', exportReportAsImage);
}

// ==========================================
// 报告功能
// ==========================================

let reportChartInstance = null;
let currentReportDays = 7;

/**
 * 更新报告页内容（统计+图表+记录列表）
 */
function updateReport() {
    const activeBtn = document.querySelector('.report-range-btn.active');
    currentReportDays = activeBtn ? parseInt(activeBtn.getAttribute('data-days')) : 7;

    const now = new Date();
    const cutoff = new Date(now.getTime() - currentReportDays * 24 * 60 * 60 * 1000);
    const filtered = bpData.filter(item => parseDateTimeStr(item.time) >= cutoff);

    document.getElementById('reportMeta').innerHTML =
        `范围：最近 ${currentReportDays} 天<br>生成时间：${formatDateTime(now)}`;

    if (filtered.length === 0) {
        document.getElementById('rptAvgSys').innerText = '--';
        document.getElementById('rptAvgDia').innerText = '--';
        document.getElementById('rptAvgPulse').innerText = '--';
        document.getElementById('rptCount').innerText = '0';
        const rptLastTimeEl = document.getElementById('rptLastTime');
        if (rptLastTimeEl) { rptLastTimeEl.style.display = 'none'; }
        document.getElementById('reportRecordsList').innerHTML =
            '<div class="report-empty"><i class="fa-solid fa-notes-medical"></i><p>该时间段内暂无记录</p></div>';
        if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }
        return;
    }

    const lastRecord = filtered[0];

    document.getElementById('rptAvgSys').innerText = lastRecord.systolic;
    document.getElementById('rptAvgDia').innerText = lastRecord.diastolic;
    document.getElementById('rptAvgPulse').innerText = lastRecord.pulse;
    document.getElementById('rptCount').innerText = filtered.length;

    const rptLastTimeEl = document.getElementById('rptLastTime');
    if (rptLastTimeEl) {
        rptLastTimeEl.innerText = `最新测量时间：${lastRecord.time}`;
        rptLastTimeEl.style.display = 'block';
    }

    renderReportChart(filtered);

    const listEl = document.getElementById('reportRecordsList');
    listEl.innerHTML = `
        <div class="report-record-header">
            <span class="report-record-time">测量时间</span>
            <span class="report-record-bp" style="text-align: center;">血压/脉搏</span>
            <span class="report-record-badge" style="text-align: right; border: none; background: transparent; padding: 0;">状态</span>
        </div>
    ` + filtered.map(item => `
        <div class="report-record-row">
            <span class="report-record-time">${item.time}</span>
            <span class="report-record-bp" style="text-align: center; line-height: 1.4;">
                <span class="sys">${item.systolic}</span>/<span class="dia">${item.diastolic}</span> <span style="font-size: 9px; color: var(--text-muted);">mmHg</span>
                <div style="font-size:10px; color:#ef4444; margin-top: 2px;">♥ ${item.pulse} <span style="font-size: 9px; color: var(--text-muted);">次/分</span></div>
            </span>
            <span class="report-record-badge ${item.levelClass}">${item.level}</span>
        </div>
    `).join('');
}

function renderReportChart(data) {
    const displayData = [...data].reverse();
    const labels = displayData.map(item => item.time.substring(5));
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#9ca3af' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)';

    if (reportChartInstance) reportChartInstance.destroy();

    const ctx = document.getElementById('reportChart').getContext('2d');
    reportChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '高压 (收缩压)',
                    data: displayData.map(i => i.systolic),
                    borderColor: isDark ? '#f43f5e' : '#e11d48',
                    backgroundColor: isDark ? 'rgba(244, 63, 94, 0.08)' : 'rgba(225, 29, 72, 0.12)',
                    borderWidth: isDark ? 3 : 3.5,
                    pointBackgroundColor: isDark ? '#f43f5e' : '#e11d48',
                    pointBorderColor: isDark ? '#f43f5e' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2.5,
                    pointRadius: isDark ? 4 : 5.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: '低压 (舒张压)',
                    data: displayData.map(i => i.diastolic),
                    borderColor: isDark ? '#10b981' : '#059669',
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(5, 150, 105, 0.12)',
                    borderWidth: isDark ? 3 : 3.5,
                    pointBackgroundColor: isDark ? '#10b981' : '#059669',
                    pointBorderColor: isDark ? '#10b981' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2.5,
                    pointRadius: isDark ? 4 : 5.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: '脉搏',
                    data: displayData.map(i => i.pulse),
                    borderColor: isDark ? '#f59e0b' : '#d97706',
                    borderDash: [5, 5],
                    borderWidth: isDark ? 2 : 2.5,
                    pointBackgroundColor: isDark ? '#f59e0b' : '#d97706',
                    pointBorderColor: isDark ? '#f59e0b' : '#fff',
                    pointBorderWidth: isDark ? 0 : 2,
                    pointRadius: isDark ? 3 : 4.5,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { left: 6, right: 6, top: 12, bottom: 4 } },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, boxWidth: 12, font: { size: 11, family: 'Inter' } }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(17,24,39,0.95)' : 'rgba(255,255,255,0.98)',
                    titleColor: isDark ? '#f3f4f6' : '#111827',
                    bodyColor: isDark ? '#9ca3af' : '#374151',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if (context.dataset.label.includes('脉搏')) {
                                    label += context.parsed.y + ' 次/分';
                                } else {
                                    label += context.parsed.y + ' mmHg';
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, border: { color: gridColor } },
                y: { 
                    position: 'left', 
                    title: {
                        display: true,
                        text: '血压 (mmHg) / 脉搏 (次/分)',
                        color: textColor,
                        font: { size: 10 }
                    },
                    grid: { color: gridColor }, 
                    ticks: { color: textColor, font: { size: 10 } }, 
                    border: { color: gridColor }, 
                    min: 40, 
                    max: 220,
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = 48;
                    }
                }
            }
        }
    });
}

async function captureReportCanvas() {
    const el = document.getElementById('reportContent');
    const bgColor = document.body.getAttribute('data-theme') === 'light' ? '#f3f4f6' : '#111827';
    const raw = await html2canvas(el, { backgroundColor: bgColor, scale: 2, useCORS: true });

    // 在原始截图四周加 48px 留白（scale=2 下视觉约 24px）
    const pad = 48;
    const final = document.createElement('canvas');
    final.width = raw.width + pad * 2;
    final.height = raw.height + pad * 2;
    const ctx = final.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, final.width, final.height);
    ctx.drawImage(raw, pad, pad);
    return { canvas: final, bgColor };
}

/**
 * 导出报告为 PDF
 */
async function exportReportAsPdf() {
    if (bpData.length === 0) { showToast('暂无记录可生成报告！', 'error'); return; }

    const todayStr = formatDateTime(new Date()).split(' ')[0];
    const pdfName = `YouQian血压报告_${currentReportDays}天_${todayStr}.pdf`;

    showToast('正在生成 PDF 报告，请稍候...', 'info');
    try {
        const { canvas } = await captureReportCanvas();
        const imgData = canvas.toDataURL('image/jpeg', 0.95);

        const { jsPDF } = window.jspdf;
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        
        // 动态根据 Canvas 宽高生成等尺寸的 PDF，防止排版模糊与裁剪
        const pdf = new jsPDF('p', 'px', [imgWidth, imgHeight]);
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);

        if (window.cordova) {
            // Android Cordova 环境下：将编译出的 PDF 二进制 Blob 直接保存到系统公共 Download 目录下
            const blob = pdf.output('blob');
            saveFileInCordova(pdfName, blob)
                .then((nativeUrl) => {
                    let displayPath = `手机存储/Download/${pdfName}`;
                    if (nativeUrl.indexOf('Download') === -1) {
                        displayPath = `内部私有存储/${pdfName}`;
                    }
                    showToast(`PDF 报告已成功保存至：\n${displayPath}`);
                })
                .catch((err) => {
                    console.error('Save PDF Local Error:', err);
                    showToast('保存 PDF 失败: ' + (err.message || err), 'error');
                });
        } else {
            // 浏览器环境：正常另存为文件下载
            pdf.save(pdfName);
            showToast(`PDF 报告已成功导出！\n请在您电脑的【下载】文件夹中查看，文件名为：${pdfName}`);
        }
    } catch (e) {
        console.error('PDF Generation Exception:', e);
        showToast('生成 PDF 失败，请重试。', 'error');
    }
}

async function exportReportAsImage() {
    if (bpData.length === 0) { showToast('暂无记录可生成报告！', 'error'); return; }
    
    const todayStr = formatDateTime(new Date()).split(' ')[0];
    const imgName = `YouQian血压报告_${currentReportDays}天_${todayStr}.png`;

    showToast('正在生成图片，请稍候...', 'info');
    try {
        const { canvas } = await captureReportCanvas();
        const imgSrc = canvas.toDataURL('image/png');

        if (window.cordova) {
            // 手机 App 端：弹窗展示，提供一键保存与长按保存双方案
            showMobileImageModal(imgSrc, imgName);
            showToast('报告图片生成成功！');
        } else {
            // Web 浏览器端：模拟 a 标签下载
            const link = document.createElement('a');
            link.download = imgName;
            link.href = imgSrc;
            link.click();
            showToast(`图片导出成功！\n请在您电脑的【下载】文件夹中查看，文件名为：${imgName}`);
        }
    } catch (e) {
        console.error(e);
        showToast('图片导出失败，请重试。', 'error');
    }
}

/**
 * 手机端显示生成的报告长图，引导长按保存
 */
function showMobileImageModal(imgSrc, imgName) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'reportImageModal';
    backdrop.style.zIndex = '9999';

    const card = document.createElement('div');
    card.className = 'modal-card glass-card';
    card.style.maxWidth = '90%';
    card.style.width = '360px';
    card.style.padding = '20px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.borderRadius = '16px';
    card.style.transform = 'translateY(0)';
    card.style.opacity = '1';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.innerText = '血压健康报告已生成';
    title.style.marginBottom = '8px';
    title.style.fontSize = '16px';
    title.style.color = 'var(--text-primary)';

    const tip = document.createElement('p');
    tip.className = 'modal-msg';
    tip.innerHTML = `<i class="fa-solid fa-hand-pointer" style="color: var(--primary); margin-right: 4px;"></i> <strong>点击下方按钮保存</strong> 或长按图片分享。<br><br>
                     📸 <strong>温馨提示</strong>：若部分系统长按保存没反应，<strong>可直接点击保存按钮</strong>写入手机存储，或截屏分享，同样十分清晰！<br><br>
                     📂 <strong>预期保存路径</strong> (点击保存后)：<br>
                     <span style="color: var(--primary); font-family: monospace;">手机存储/Download/${imgName}</span>`;
    tip.style.fontSize = '12px';
    tip.style.color = 'var(--text-secondary)';
    tip.style.marginBottom = '15px';
    tip.style.textAlign = 'center';
    tip.style.lineHeight = '1.5';

    const imgWrapper = document.createElement('div');
    imgWrapper.style.width = '100%';
    imgWrapper.style.maxHeight = '240px';
    imgWrapper.style.overflowY = 'auto';
    imgWrapper.style.marginBottom = '15px';
    imgWrapper.style.borderRadius = '8px';
    imgWrapper.style.border = '1px solid var(--glass-border)';

    const img = document.createElement('img');
    img.src = imgSrc;
    img.style.width = '100%';
    img.style.display = 'block';

    // 💾 保存图片文件按钮 (Cordova 下调用)
    const saveImgBtn = document.createElement('button');
    saveImgBtn.className = 'btn-primary';
    saveImgBtn.innerText = '💾 保存图片至本地';
    saveImgBtn.style.marginTop = '0';
    saveImgBtn.style.marginBottom = '10px';
    saveImgBtn.style.height = '42px';
    saveImgBtn.style.width = '100%';
    saveImgBtn.style.borderRadius = '10px';
    saveImgBtn.style.fontWeight = '600';
    saveImgBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)'; // 绿色高质感渐变
    saveImgBtn.style.border = 'none';
    saveImgBtn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.25)';
    saveImgBtn.addEventListener('click', () => {
        try {
            const blob = dataURLtoBlob(imgSrc);
            saveFileInCordova(imgName, blob)
                .then((nativeUrl) => {
                    let displayPath = `手机存储/Download/${imgName}`;
                    if (nativeUrl.indexOf('Download') === -1) {
                        displayPath = `内部私有存储/${imgName}`;
                    }
                    showToast(`图片已成功保存至：\n${displayPath}`);
                })
                .catch((err) => {
                    console.error('Save Image Local Error:', err);
                    showToast('保存图片失败: ' + (err.message || err), 'error');
                });
        } catch (err) {
            console.error('Save Image Process Error:', err);
            showToast('保存图片失败: ' + err.message, 'error');
        }
    });

    // 复制明细文本按钮 (备用方案)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary';
    copyBtn.innerText = '📋 复制明细文本';
    copyBtn.style.marginTop = '0';
    copyBtn.style.marginBottom = '10px';
    copyBtn.style.height = '42px';
    copyBtn.style.width = '100%';
    copyBtn.style.borderRadius = '10px';
    copyBtn.style.fontWeight = '600';
    copyBtn.addEventListener('click', () => {
        const copied = copyDataToClipboard();
        if (copied) {
            showToast('明细数据已成功复制到剪贴板！');
        } else {
            showToast('复制数据失败，请重试。', 'error');
        }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.innerText = '关闭预览';
    closeBtn.style.marginTop = '0';
    closeBtn.style.height = '42px';
    closeBtn.style.width = '100%';
    closeBtn.style.borderRadius = '10px';
    closeBtn.style.fontWeight = '600';
    closeBtn.addEventListener('click', () => {
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 300);
    });

    imgWrapper.appendChild(img);
    card.appendChild(title);
    card.appendChild(tip);
    card.appendChild(imgWrapper);
    card.appendChild(saveImgBtn);
    card.appendChild(copyBtn);
    card.appendChild(closeBtn);
    backdrop.appendChild(card);
    
    // 挂载到正确的相对定位容器下
    document.querySelector('.app-container').appendChild(backdrop);
    
    // 延迟一帧添加 show 类，激活淡入过渡和 pointer-events: auto
    setTimeout(() => {
        backdrop.classList.add('show');
    }, 20);
}

/**
 * 手机端纯前端通用提示弹窗 (我知道了)
 */
function showAlertModal(titleText, messageHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'infoAlertModal';
    backdrop.style.zIndex = '9999';

    const card = document.createElement('div');
    card.className = 'modal-card glass-card';
    card.style.maxWidth = '90%';
    card.style.width = '340px';
    card.style.padding = '24px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.borderRadius = '16px';
    card.style.transform = 'translateY(0)';
    card.style.opacity = '1';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.innerText = titleText;
    title.style.marginBottom = '12px';
    title.style.fontSize = '16px';
    title.style.color = 'var(--text-primary)';

    const msg = document.createElement('p');
    msg.className = 'modal-msg';
    msg.innerHTML = messageHtml;
    msg.style.fontSize = '12.5px';
    msg.style.color = 'var(--text-secondary)';
    msg.style.marginBottom = '20px';
    msg.style.textAlign = 'left';
    msg.style.lineHeight = '1.6';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn-primary';
    okBtn.innerText = '我知道了';
    okBtn.style.marginTop = '0';
    okBtn.style.height = '42px';
    okBtn.style.width = '100%';
    okBtn.style.borderRadius = '10px';
    okBtn.style.fontWeight = '600';
    okBtn.addEventListener('click', () => {
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 300);
    });

    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(okBtn);
    backdrop.appendChild(card);
    
    // 挂载到正确的相对定位容器下
    document.querySelector('.app-container').appendChild(backdrop);
    
    // 延迟一帧添加 show 类，激活淡入过渡和 pointer-events: auto
    setTimeout(() => {
        backdrop.classList.add('show');
    }, 20);
}


// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    init();

    // 注册 PWA Service Worker 离线服务
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(reg => console.log('Service Worker 注册成功:', reg.scope))
                .catch(err => console.log('Service Worker 注册失败:', err));
        });
    }
});
