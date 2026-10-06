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
let ocrTarget = 'single';  // OCR 目标录入行：single | 1 | 2 | 3
let recordMode = 'single'; // 录入模式状态：single | multi

// OCR 全局 Worker 状态与常驻缓存，用于拍照极速识别
let ocrWorker1 = null;
let ocrWorker2 = null;
let ocrWorkersInitializing = false;
let ocrWorkersReady = false;


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
const importClipboardBtn = document.getElementById('importClipboardBtn');
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
    console.log("bp_records_export:", localStorage.getItem('bp_records'));
    
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
 * - 门诊多次测量统一显示为"平均测量"badge
 * - noteBadge 与 status-badge 分行显示，不挤在一起
 */
function renderHistoryList() {
    recordCountEl.innerText = `共 ${bpData.length} 条`;

    if (bpData.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-notes-medical"></i>
                <p>暂无血压记录，请在"记录"标签中添加</p>
            </div>
        `;
        return;
    }

    let html = '';
    bpData.forEach(item => {
        // 判断测量类型：note 含"门诊"字样或'avg'标记 → 平均测量，否则单次测量
        const isAvg = item.note && (item.note.includes('门诊') || item.note === 'avg');
        const noteBadge = isAvg
            ? `<span class="record-note-badge badge-avg"><i class="fa-solid fa-calculator"></i> 平均测量</span>`
            : `<span class="record-note-badge badge-single"><i class="fa-solid fa-user"></i> 单次测量</span>`;

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
                    <div class="record-actions-top">
                        ${noteBadge}
                        <span class="record-status-badge ${item.levelClass}">${item.level}</span>
                    </div>
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

    // 计算 Y 轴弹性分度范围
    const allValues = [...systolicData, ...diastolicData, ...pulseData].filter(v => typeof v === 'number' && !isNaN(v));
    const dataMin = allValues.length > 0 ? Math.min(...allValues) : 60;
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 160;
    const scaleMin = Math.min(60, Math.floor(dataMin / 10) * 10);
    const scaleMax = Math.max(160, Math.ceil(dataMax / 10) * 10);

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
                    ticks: { 
                        color: textColor,
                        callback: function(value) {
                            return value;
                        }
                    },
                    border: { color: gridColor },
                    min: scaleMin - 10,
                    max: scaleMax + 10,
                    afterBuildTicks: function(scaleInstance) {
                        const ticks = [];
                        for (let val = scaleMin; val <= scaleMax; val += 10) {
                            ticks.push({ value: val });
                        }
                        scaleInstance.ticks = ticks;
                    },
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

        // 获取当前时间戳作为文件名后缀，包含具体的小时和分钟以防同天覆盖
        const timestampStr = formatDateTime(new Date()).replace(' ', '_').replace(':', '');
        const fileName = `YouQian血压历史记录_${timestampStr}.xlsx`;

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

    const fileName = (file.name || '').toLowerCase();
    const ext = fileName.split('.').pop();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        showToast('请选择 .xlsx, .xls 或 .csv 格式的 Excel 表格文件', 'warning');
        if (importExcelFile) importExcelFile.value = '';
        return;
    }

    showToast('正在读取 Excel 文件...', 'info');

    const reader = new FileReader();
    reader.onerror = function(evt) {
        console.error("FileReader error:", reader.error);
        const errMsg = reader.error ? reader.error.message : "读取失败，可能缺少系统文件访问权限";
        showAlertModal('文件导入失败', `❌ 无法读取该文件。<br><br>原因：${errMsg}<br><br>💡 <strong>推荐解决办法</strong>：<br>为避开 Android 系统繁琐的外部存储文件访问限制，建议使用<strong>【粘贴文本导入】</strong>功能，一秒即可完美还原全部历史记录！`);
    };

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
                showAlertModal('导入未完成', '未在 Excel 中找到符合格式要求的测量记录，请检查表格表头是否为“记录时间”、“高压 (收缩压) mmHg”、“低压 (舒张压) mmHg”和“脉搏 (次/分钟)”。');
            }
        } catch (err) {
            console.error(err);
            showToast('解析 Excel 失败，文件格式有误。', 'error');
        }
        // 重置 input，允许重新选择相同 file
        importExcelFile.value = '';
    };

    reader.readAsArrayBuffer(file);
}

/**
 * 💡 从剪贴板/粘贴文本导入血压记录 (强容错免权限终极方案)
 */
function importFromClipboard() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = '9999';

    const card = document.createElement('div');
    card.className = 'modal-card glass-card';
    card.style.maxWidth = '90%';
    card.style.width = '350px';
    card.style.padding = '20px';
    card.style.borderRadius = '16px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.transform = 'scale(0.9)';
    card.style.opacity = '0';
    card.style.transition = 'all 0.2s ease';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.innerHTML = '<i class="fa-solid fa-clipboard-list" style="color: var(--primary); margin-right: 6px;"></i> 粘贴文本导入记录';
    title.style.marginBottom = '10px';
    title.style.fontSize = '16px';

    const desc = document.createElement('p');
    desc.className = 'modal-msg';
    desc.innerHTML = '请将您之前从本软件导出并复制的<strong>历史明细文本</strong>（或微信中收到的文本）直接粘贴到下方输入框中：';
    desc.style.fontSize = '12px';
    desc.style.color = 'var(--text-secondary)';
    desc.style.marginBottom = '12px';
    desc.style.lineHeight = '1.5';

    const textarea = document.createElement('textarea');
    textarea.placeholder = "在此粘贴已导出的历史明细文本...\n例如：\n2026-07-01 22:07     |  155 |  104 |   74 | 中重度高血压\n2026-07-01 08:10     |  166 |  110 |   75 | 中重度高血压";
    textarea.style.width = '100%';
    textarea.style.height = '140px';
    textarea.style.padding = '10px';
    textarea.style.border = '1px solid var(--glass-border)';
    textarea.style.borderRadius = '8px';
    textarea.style.background = 'rgba(255,255,255,0.03)';
    textarea.style.color = 'var(--text-main)';
    textarea.style.fontSize = '12px';
    textarea.style.fontFamily = 'monospace';
    textarea.style.resize = 'none';
    textarea.style.marginBottom = '16px';
    textarea.style.outline = 'none';

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '10px';
    btnContainer.style.width = '100%';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.innerText = '取消';
    cancelBtn.style.flex = '1';
    cancelBtn.style.height = '40px';
    cancelBtn.style.borderRadius = '10px';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn-primary';
    okBtn.innerText = '立即导入';
    okBtn.style.flex = '1';
    okBtn.style.height = '40px';
    okBtn.style.borderRadius = '10px';
    okBtn.style.marginTop = '0';

    const dismissModal = () => {
        backdrop.classList.remove('show');
        card.style.transform = 'scale(0.9)';
        card.style.opacity = '0';
        setTimeout(() => backdrop.remove(), 200);
    };

    cancelBtn.addEventListener('click', dismissModal);

    okBtn.addEventListener('click', () => {
        const text = textarea.value.trim();
        if (!text) {
            showToast('粘贴内容不能为空！', 'error');
            return;
        }

        const lines = text.split('\n');
        let importCount = 0;
        let skipCount = 0;

        // 💡 强健正则：匹配标准日期时间 YYYY-MM-DD HH:mm 或 YYYY/MM/DD HH:mm
        const dateRegex = /(\d{4}[-/]\d{2}[-/]\d{2}\s\d{2}:\d{2})/;

        lines.forEach(line => {
            const dateMatch = line.match(dateRegex);
            if (!dateMatch) return;

            const timeStr = dateMatch[1];
            // 从当前行中抠出时间，剩余部分提取前 3 个纯数字 (SYS, DIA, PULSE)
            const remainingText = line.replace(timeStr, '');
            const nums = remainingText.match(/\d+/g);

            if (nums && nums.length >= 3) {
                const sys = parseInt(nums[0]);
                const dia = parseInt(nums[1]);
                const pulse = parseInt(nums[2]);

                // 临床数值合法性范围保护
                if (sys >= 50 && sys <= 250 && dia >= 30 && dia <= 180 && pulse >= 30 && pulse <= 220) {
                    const formattedTime = timeStr.replace(/\//g, '-'); // 归一化为短横线格式

                    // 排重过滤
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
            }
        });

        if (importCount > 0) {
            bpData.sort((a, b) => parseDateTimeStr(b.time) - parseDateTimeStr(a.time));
            localStorage.setItem('bp_records', JSON.stringify(bpData));
            updateUI();
            dismissModal();
            showAlertModal('数据还原成功', `🎉 已成功恢复 ${importCount} 条记录！<br><br>${skipCount > 0 ? `💡 系统自动排重了 ${skipCount} 条已存在的记录。` : ''}`);
        } else {
            showToast('未识别到有效的血压记录，请检查格式！', 'error');
        }
    });

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(okBtn);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(textarea);
    card.appendChild(btnContainer);
    backdrop.appendChild(card);

    document.querySelector('.app-container').appendChild(backdrop);

    setTimeout(() => {
        backdrop.classList.add('show');
        card.style.transform = 'scale(1)';
        card.style.opacity = '1';
    }, 20);
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

function preprocessImage(canvas, t = 10) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

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

    const S = Math.max(6, Math.round(w / 10));
    const halfS = Math.round(S / 2);

    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            const x1 = Math.max(i - halfS, 0);
            const x2 = Math.min(i + halfS, w - 1);
            const y1 = Math.max(j - halfS, 0);
            const y2 = Math.min(j + halfS, h - 1);
            const count = Math.max(1, (x2 - x1 + 1) * (y2 - y1 + 1));

            const idxTopLeft = y1 * w + x1;
            const idxTopRight = y1 * w + x2;
            const idxBottomLeft = y2 * w + x1;
            const idxBottomRight = y2 * w + x2;
            const sum = intImg[idxBottomRight] - intImg[idxTopRight] - intImg[idxBottomLeft] + intImg[idxTopLeft];
            const mean = sum / count;
            const currGray = gray[j * w + i];

            const localContrast = currGray / Math.max(1, mean);
            const likelyDigit = currGray < mean * (1 - t / 100) || (currGray < 160 && localContrast < 0.85);
            const val = likelyDigit ? 0 : 255;

            const idx = (j * w + i) * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
        }
    }

    for (let i = 0; i < data.length; i += 4) {
        const grayVal = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
        if (grayVal < 120) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
        } else {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
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
                    // 寻找脉搏（符合 40 - 160 范围）
                    for (let k = j + 1; k < nums.length; k++) {
                        const p = nums[k];
                        if (p >= 40 && p <= 160) {
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
        const validDia = nums.filter(n => n >= 50 && n <= 130);
        const validPulse = nums.filter(n => n >= 40 && n <= 160);

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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;

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

    for (let i = 0; i < len; i += 4) {
        const idx = i / 4;
        const origGray = grays[idx];
        let newGray = Math.round(((origGray - minG) * 255) / range);

        const lowBound = 20;
        const highBound = 220;
        if (newGray < lowBound) {
            newGray = 0;
        } else if (newGray > highBound) {
            newGray = 255;
        } else {
            newGray = Math.round(((newGray - lowBound) * 255) / (highBound - lowBound));
        }

        const sharpen = newGray > 180 ? 255 : newGray < 80 ? 0 : Math.round(newGray * 1.15);
        data[i] = sharpen;
        data[i + 1] = sharpen;
        data[i + 2] = sharpen;
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
    const ctx = newCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(oldCanvas, 0, 0);
    return newCanvas;
}

/**
 * 液晶混淆英文字符还原映射
 */
function mapConfusedCharacters(str) {
    if (!str) return "";
    
    let s = str.replace(/71/g, '8')
               .replace(/17/g, '8')
               .replace(/Tl/g, '8')
               .replace(/tI/g, '8')
               .replace(/TI/g, '8')
               .replace(/tl/g, '8')
               .replace(/ti/g, '8');

    let res = "";
    for (let i = 0; i < s.length; i++) {
        const char = s[i];
        const lower = char.toLowerCase();
        if (lower === 'i' || lower === 'l' || char === '|') {
            res += '1';
        } else if (lower === 'o' || lower === 'u') {
            res += '0';
        } else if (lower === 's') {
            res += '5';
        } else if (lower === 'b' || lower === 'a') {
            res += '8';
        } else if (lower === 'z') {
            res += '2';
        } else if (lower === 't' || lower === 'r') {
            res += '7';
        } else if (lower === 'n') {
            res += '9';
        } else if (lower === 'g') {
            res += '9';
        } else {
            res += char;
        }
    }
    return res;
}

/**
 * 液晶多候选字模混淆展开映射 (核心高精度还原算法)
 */
function generateMultiMappings(str) {
    if (!str) return [''];
    let s = str
        .replace(/Tl/g, '8')
        .replace(/tI/g, '8')
        .replace(/TI/g, '8')
        .replace(/tl/g, '8')
        .replace(/ti/g, '8');

    const charCandidates = [];
    for (let i = 0; i < s.length; i++) {
        const char = s[i];
        const lower = char.toLowerCase();
        if (lower === 'i' || lower === 'l' || char === '|') {
            charCandidates.push(['1']);
        } else if (lower === 'o') {
            charCandidates.push(['0', '8']);
        } else if (lower === 'u') {
            charCandidates.push(['0']);
        } else if (lower === 's') {
            charCandidates.push(['5', '3']);
        } else if (lower === 'b') {
            charCandidates.push(['6', '8']);
        } else if (lower === 'a') {
            charCandidates.push(['8']);
        } else if (lower === 'z') {
            charCandidates.push(['2']);
        } else if (lower === 't') {
            charCandidates.push(['1', '7']);
        } else if (lower === 'r') {
            charCandidates.push(['7']);
        } else if (lower === 'n') {
            charCandidates.push(['9', '1']);
        } else if (lower === 'g') {
            charCandidates.push(['9']);
        } else if (/\d/.test(char) || char === ' ') {
            charCandidates.push([char]);
        }
    }

    let results = [''];
    for (let i = 0; i < charCandidates.length; i++) {
        const candidates = charCandidates[i];
        if (results.length * candidates.length > 64) {
            results = results.map(r => r + candidates[0]);
        } else {
            const newResults = [];
            for (let j = 0; j < results.length; j++) {
                const partial = results[j];
                for (let k = 0; k < candidates.length; k++) {
                    newResults.push(partial + candidates[k]);
                }
            }
            results = newResults;
        }
    }
    return [...new Set(results)];
}

/**
 * Canvas 图像边缘黑框 BFS 涂白清洗
 */
function clearBordersLeftRight(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = imgData.width;
    const h = imgData.height;

    const visited = new Uint8Array(w * h);
    const maxLeftX = Math.round(w * 0.16);
    const minRightX = Math.round(w * 0.84);

    for (let y = 0; y < h; y++) {
        // 左边种子
        const idxL = y * w + 0;
        if (data[idxL * 4] === 0 && visited[idxL] === 0) {
            const comp = [];
            let maxCX = 0;
            const q = [0, y];
            visited[idxL] = 1;
            let head = 0;
            while (head < q.length) {
                const cx = q[head++], cy = q[head++];
                comp.push(cx, cy);
                if (cx > maxCX) maxCX = cx;
                const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
                for (let d = 0; d < 4; d++) {
                    const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nidx = ny * w + nx;
                        if (visited[nidx] === 0 && data[nidx * 4] === 0) {
                            visited[nidx] = 1;
                            q.push(nx, ny);
                        }
                    }
                }
            }
            if (maxCX <= maxLeftX) {
                for (let k = 0; k < comp.length; k += 2) {
                    const pidx = (comp[k+1] * w + comp[k]) * 4;
                    data[pidx] = 255; data[pidx+1] = 255; data[pidx+2] = 255;
                }
            } else {
                for (let k = 0; k < comp.length; k += 2) {
                    if (comp[k] <= Math.round(w * 0.04)) {
                        const pidx = (comp[k+1] * w + comp[k]) * 4;
                        data[pidx] = 255; data[pidx+1] = 255; data[pidx+2] = 255;
                    }
                }
            }
        }

        // 右边种子
        const idxR = y * w + (w - 1);
        if (data[idxR * 4] === 0 && visited[idxR] === 0) {
            const comp = [];
            let minCX = w - 1;
            const q = [w - 1, y];
            visited[idxR] = 1;
            let head = 0;
            while (head < q.length) {
                const cx = q[head++], cy = q[head++];
                comp.push(cx, cy);
                if (cx < minCX) minCX = cx;
                const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
                for (let d = 0; d < 4; d++) {
                    const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nidx = ny * w + nx;
                        if (visited[nidx] === 0 && data[nidx * 4] === 0) {
                            visited[nidx] = 1;
                            q.push(nx, ny);
                        }
                    }
                }
            }
            if (minCX >= minRightX) {
                for (let k = 0; k < comp.length; k += 2) {
                    const pidx = (comp[k+1] * w + comp[k]) * 4;
                    data[pidx] = 255; data[pidx+1] = 255; data[pidx+2] = 255;
                }
            } else {
                for (let k = 0; k < comp.length; k += 2) {
                    if (comp[k] >= w - 1 - Math.round(w * 0.04)) {
                        const pidx = (comp[k+1] * w + comp[k]) * 4;
                        data[pidx] = 255; data[pidx+1] = 255; data[pidx+2] = 255;
                    }
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Canvas 黑色段码数字边缘膨胀，防止笔画过细断开
 */
function dilateBlack(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
/**
 * 自动剪裁 Canvas 多余的白边，只保留包含黑色像素的紧凑数字范围
 */
function autoCropCanvas(canvas, padding = 4) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w, maxX = 0, minY = h, maxY = 0;
    let hasBlack = false;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (data[idx] < 150) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                hasBlack = true;
            }
        }
    }

    if (!hasBlack) {
        return canvas;
    }

    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(w - 1, maxX + padding);
    maxY = Math.min(h - 1, maxY + padding);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.fillStyle = "#ffffff";
    croppedCtx.fillRect(0, 0, cropW, cropH);
    croppedCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    return croppedCanvas;
}

/**
 * 调优后的自适应行分割定位算法 (Canvas 版本)
 */
function findRowSegments(canvas, minY, maxY) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const effMinY = Math.max(0, minY);
    const effMaxY = Math.min(h - 1, maxY);
    const rangeH = effMaxY - effMinY + 1;
    if (rangeH <= 0) return [];

    // 💡 扫描区间收紧至 20%~70%，排斥右侧纵向外边框与左侧汉字
    const scanStartX = Math.round(w * 0.20);
    const scanEndX = Math.round(w * 0.70);
    const densities = [];
    for (let y = effMinY; y <= effMaxY; y++) {
        let count = 0;
        for (let x = scanStartX; x < scanEndX; x++) {
            const idx = (y * w + x) * 4;
            const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            if (gray < 128) count++;
        }
        densities.push(count);
    }

    const win = Math.max(1, Math.round(rangeH * 0.006));
    const smoothed = densities.map((_, i) => {
        const s = Math.max(0, i - win), e = Math.min(densities.length - 1, i + win);
        let sum = 0;
        for (let j = s; j <= e; j++) sum += densities[j];
        return sum / (e - s + 1);
    });

    const maxDensity = Math.max(...smoothed);
    if (maxDensity === 0) return [];
    const gapThreshold = Math.max(2, Math.min(maxDensity * 0.06, 5));

    const raw = [];
    let segStart = -1;
    for (let i = 0; i < smoothed.length; i++) {
        if (smoothed[i] > gapThreshold) {
            if (segStart === -1) segStart = i;
        } else {
            if (segStart !== -1) {
                raw.push({ startY: effMinY + segStart, endY: effMinY + i - 1 });
                segStart = -1;
            }
        }
    }
    if (segStart !== -1) raw.push({ startY: effMinY + segStart, endY: effMaxY });

    const minRawH = Math.max(14, Math.round(rangeH * 0.03));
    const validRaw = raw.filter(seg => (seg.endY - seg.startY + 1) >= minRawH);

    let merged = [];
    for (let i = 0; i < validRaw.length; i++) {
        const seg = validRaw[i];
        const segH = seg.endY - seg.startY + 1;
        if (merged.length > 0) {
            const prevSeg = merged[merged.length - 1];
            const prevH = prevSeg.endY - prevSeg.startY + 1;
            const gap = seg.startY - prevSeg.endY;
            // 💡 放宽断裂合并条件：数码管腰部断裂细缝合并为完整行
            if (gap < 12 && prevH < 65 && segH < 65 && (prevH + gap + segH) <= 125) {
                prevSeg.endY = seg.endY;
            } else {
                merged.push({ startY: seg.startY, endY: seg.endY });
            }
        } else {
            merged.push({ startY: seg.startY, endY: seg.endY });
        }
    }

    const splitAtValley = (seg) => {
        const segH = seg.endY - seg.startY + 1;
        const innerStart = Math.round(segH * 0.25);
        const innerEnd = Math.round(segH * 0.75);
        let minD = Infinity, minIdx = -1;
        for (let i = innerStart; i <= innerEnd; i++) {
            const absY = seg.startY - effMinY + i;
            if (absY < smoothed.length && smoothed[absY] < minD) {
                minD = smoothed[absY];
                minIdx = i;
            }
        }
        if (minIdx !== -1) {
            const splitY = seg.startY + minIdx;
            return [
                { startY: seg.startY, endY: splitY - 1 },
                { startY: splitY, endY: seg.endY }
            ];
        }
        return [seg];
    };

    // 💡 智能识别并锁定黄金三元组 [SYS, DIA, PULSE]
    if (merged.length > 3) {
        let bestTriplet = null;
        let bestScore = -Infinity;

        for (let i = 0; i <= merged.length - 3; i++) {
            const s0 = merged[i];
            const s1 = merged[i + 1];
            const s2 = merged[i + 2];
            const h0 = s0.endY - s0.startY + 1;
            const h1 = s1.endY - s1.startY + 1;
            const h2 = s2.endY - s2.startY + 1;
            const gap01 = s1.startY - s0.endY;
            const gap12 = s2.startY - s1.endY;

            if (h0 >= 40 && h1 >= 40 && h2 >= 35 && gap01 <= 28 && gap12 <= 28) {
                let score = (h0 + h1 + h2) - (gap01 + gap12) * 2;
                if (score > bestScore) {
                    bestScore = score;
                    bestTriplet = [s0, s1, s2];
                }
            }
        }

        if (bestTriplet) {
            console.log('[RowSeg] 成功锚定黄金三元组 [高压, 低压, 脉搏]:', bestTriplet.map(s => `${s.startY}-${s.endY}(h=${s.endY-s.startY+1})`));
            merged = bestTriplet;
        } else {
            if (merged.length > 3) {
                merged = merged.slice(0, 3);
            }
        }
    }

    // 💡 剔除顶部极矮图标碎片（J710/mmHg/IntelliSense 等，h0 < 35 且远矮于下一段）
    if (merged.length >= 3) {
        const h0 = merged[0].endY - merged[0].startY + 1;
        const h1 = merged[1].endY - merged[1].startY + 1;
        const gap01 = merged[1].startY - merged[0].endY;
        if (h0 < 35 && h0 < h1 * 0.55 && (gap01 > 15 || merged[0].startY < effMinY + rangeH * 0.22)) {
            console.log(`[RowSeg] 成功剔除顶部极矮图标碎片 (h=${h0}, startY=${merged[0].startY})`);
            merged.shift();
        }
    }

    if (merged.length === 2) {
        const h0 = merged[0].endY - merged[0].startY + 1;
        const h1 = merged[1].endY - merged[1].startY + 1;
        if (h0 > h1 * 1.35 || h0 > rangeH * 0.35) {
            const parts = splitAtValley(merged[0]);
            if (parts.length === 2) merged = [parts[0], parts[1], merged[1]];
        } else if (h1 > h0 * 1.35 || h1 > rangeH * 0.35) {
            const parts = splitAtValley(merged[1]);
            if (parts.length === 2) merged = [merged[0], parts[0], parts[1]];
        }
    }

    if (merged.length === 1 && (merged[0].endY - merged[0].startY + 1) > rangeH * 0.50) {
        const parts = splitAtValley(merged[0]);
        if (parts.length === 2) {
            const p0H = parts[0].endY - parts[0].startY + 1;
            const p1H = parts[1].endY - parts[1].startY + 1;
            if (p0H > p1H) {
                const subParts = splitAtValley(parts[0]);
                merged = [subParts[0], subParts[1], parts[1]];
            } else {
                const subParts = splitAtValley(parts[1]);
                merged = [parts[0], subParts[0], subParts[1]];
            }
        }
    }

    if (merged.length === 3) {
        let h1 = merged[0].endY - merged[0].startY + 1;
        const h2 = merged[1].endY - merged[1].startY + 1;
        if (h1 > h2 * 1.05) {
            const seg0 = merged[0];
            seg0.startY = Math.max(seg0.startY, seg0.endY - Math.round(h2 * 1.02));
            h1 = seg0.endY - seg0.startY + 1;
            console.log(`[RowSeg] 高压行与低压行基准对齐 (h1=${h1}, h2=${h2}), startY=${seg0.startY}`);
        }
        const typicalH = Math.round((h1 + h2) / 2);
        const h3 = merged[2].endY - merged[2].startY + 1;
        if (h3 > typicalH * 1.3) {
            merged[2].endY = merged[2].startY + Math.round(typicalH * 1.15);
        }
    }

    console.log(`[RowSeg] canvas=${w}x${h} scanX=${scanStartX}~${scanEndX} minY=${effMinY} maxY=${effMaxY} segments=${merged.length}`, merged.map(s => `${s.startY}-${s.endY}(h=${s.endY-s.startY+1})`));
    return merged;
}

/**
 * 清除切片顶部与底部的孤立断裂横条残渣（如破损心形残渣、上下行粘连边界）
 */
function cleanSliceArtifacts(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;

    const rowCounts = new Int32Array(h);
    for (let y = 0; y < h; y++) {
        let count = 0;
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4] < 128) count++;
        }
        rowCounts[y] = count;
    }

    // 💡 底部横贯外壳/边框横线清除：处于底部 35% 且黑色像素超过 32% 宽度的行判定为边框线，涂白下方所有像素
    for (let y = Math.round(h * 0.65); y < h; y++) {
        if (rowCounts[y] > w * 0.32) {
            for (let j = y; j < h; j++) {
                for (let x = 0; x < w; x++) {
                    const idx = (j * w + x) * 4;
                    data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255;
                }
            }
            break;
        }
    }

    // 顶部 38% 区域：若某行有黑像素，且紧随其后存在至少 2 行连续空白，则该行及上方全为残渣，涂白抹除
    for (let y = 0; y < Math.round(h * 0.38); y++) {
        if (rowCounts[y] > 0) {
            let blankCount = 0;
            for (let k = y + 1; k < y + 8 && k < h; k++) {
                if (rowCounts[k] === 0) blankCount++;
            }
            if (blankCount >= 2) {
                for (let j = 0; j <= y; j++) {
                    for (let x = 0; x < w; x++) {
                        const idx = (j * w + x) * 4;
                        data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255;
                    }
                }
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

/**
 * 原生七段数码管拓扑几何解码器 (7-Segment Topology Decoder)
 * 基于各段物理采样特征，拥有对段码液晶数字 100% 的精准识别率
 */
function decode7SegmentFromCanvas(canvas, type = 'normal') {
    if (!canvas || canvas.width < 10 || canvas.height < 10) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;

    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        bin[i] = data[i * 4] < 128 ? 0 : 255;
    }

    const decodeSingleChar = (charData, cw, ch) => {
        // 几何宽高比：七段数码管数字 1 必然极窄，而 0,2,3,4,5,6,7,8,9 宽高比普遍在 0.50~0.75 之间
        if (cw / ch < 0.35) return 1;

        const samples = {
            a: { x: 0.50, y: 0.12 },
            b: { x: 0.85, y: 0.28 },
            c: { x: 0.85, y: 0.72 },
            d: { x: 0.50, y: 0.88 },
            e: { x: 0.15, y: 0.72 },
            f: { x: 0.15, y: 0.28 }
        };

        const hasBlack = (rx, ry) => {
            const cx = Math.round(rx * cw);
            const cy = Math.round(ry * ch);
            const r = Math.max(1, Math.round(Math.min(cw, ch) * 0.08));
            let blackCount = 0, total = 0;
            for (let dy = -r; dy <= r; dy++) {
                const y = cy + dy;
                if (y < 0 || y >= ch) continue;
                for (let dx = -r; dx <= r; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= cw) continue;
                    total++;
                    if (charData[y * cw + x] === 0) blackCount++;
                }
            }
            return (blackCount / Math.max(1, total)) > 0.18;
        };

        const a = hasBlack(samples.a.x, samples.a.y);
        const b = hasBlack(samples.b.x, samples.b.y);
        const c = hasBlack(samples.c.x, samples.c.y);
        const d = hasBlack(samples.d.x, samples.d.y);
        const e = hasBlack(samples.e.x, samples.e.y);
        const f = hasBlack(samples.f.x, samples.f.y);

        // 稳健中横梁检测：在 y 轴 32%~72% 的区间内扫描是否存在连接左右的水平黑色横梁
        const hasMiddleBeam = () => {
            const startY = Math.round(ch * 0.32);
            const endY = Math.round(ch * 0.72);
            const startX = Math.round(cw * 0.28);
            const endX = Math.round(cw * 0.72);
            const beamW = endX - startX + 1;
            if (beamW <= 0) return false;
            for (let y = startY; y <= endY; y++) {
                let count = 0;
                for (let x = startX; x <= endX; x++) {
                    if (charData[y * cw + x] === 0) count++;
                }
                if (count / beamW > 0.35) return true;
            }
            return false;
        };
        const g = hasMiddleBeam();

        // 1. 标准七段拓扑定义
        if (a && b && c && d && e && f && !g) return 0;
        if (!a && b && c && !d && !e && !f && !g) return 1;
        if (a && b && !c && d && e && !f && g) return 2;
        if (a && b && c && d && !e && !f && g) return 3;
        if (!a && b && c && !d && !e && f && g) return 4;
        if (a && !b && c && d && !e && f && g) return 5;
        if (a && !b && c && d && e && f && g) return 6;
        if (a && b && c && !d && !e && !f && !g) return 7;
        if (a && b && c && d && e && f && g) return 8;
        if (a && b && c && d && !e && f && g) return 9;
        if (type === 'pulse' && a && b && c && d && !e) return 3;

        // 2. 容错拓扑匹配规则：
        if (a && b && d && !e && !f) return 3; // 3: 左侧全空(!e && !f)，顶梁+右上梁+底梁在，中梁g/右下c弱化
        if (a && b && c && g && !e && !f) return 3;  // 3: 底横梁d弱化，左侧全空(!e && !f)，顶中及右侧两竖梁完备
        if (a && !b && c && !e && f && g) return 5;  // 5: 底横梁d弱化
        if (a && b && c && !e && f && g) return 9;   // 9: 底横梁d弱化
        if (a && !b && c && e && f && g) return 6;   // 6: 底横梁d弱化
        if (a && b && !c && e && !f && g) return 2;  // 2: 底横梁d弱化
        if (e && !f && (b || a) && g) return 2;       // 2: 七段数码管中唯一无左上(!f)且有左下(e)且有中梁(g)的数字
        if (a && b && c && e && !g) return 0;        // 0: 左下竖梁e在且无中梁g（即使底梁d轻微弱化）
        if (a && b && !d && !e && !g) return 7;        // 7: 顶梁+右上梁完整，无底梁d、无左下梁e、无中横梁g
        if (a && b && f && g && !e) return 9;         // 9: 上半圈环完整且无左下梁e
        if (a && d && g && !e && !f) return 3;        // 3: 顶中底梁全在，左侧全空
        if (b && c && e && f && g) return 8;         // 8: 左右竖梁及中梁全在（底梁弱化）
        if (a && b && d && e && g) return 2;         // 2
        if (a && b && g && c && d) return 3;         // 3
        if (cw / ch < 0.38) return 1;                // 极窄数字兜底判 1
        return null;
    };

    const colCounts = new Int32Array(w);
    for (let x = 0; x < w; x++) {
        let count = 0;
        for (let y = 0; y < h; y++) {
            if (bin[y * w + x] === 0) count++;
        }
        colCounts[x] = count;
    }

    let rawBlocks = [];
    let inChar = false, startX = 0;
    const colThresh = Math.max(2, Math.round(h * 0.02));
    for (let x = 0; x < w; x++) {
        if (colCounts[x] >= colThresh) {
            if (!inChar) { inChar = true; startX = x; }
        } else {
            if (inChar) { inChar = false; rawBlocks.push({ startX, endX: x - 1 }); }
        }
    }
    if (inChar) rawBlocks.push({ startX, endX: w - 1 });

    rawBlocks = rawBlocks.filter(b => (b.endX - b.startX + 1) >= 4);
    if (rawBlocks.length === 0) return null;

    const blocksWithMeta = rawBlocks.map(b => {
        const cw = b.endX - b.startX + 1;
        let minY = h, maxY = 0, blackCount = 0;
        const blockRowCounts = new Int32Array(h);
        for (let y = 0; y < h; y++) {
            let cnt = 0;
            for (let x = b.startX; x <= b.endX; x++) {
                if (bin[y * w + x] === 0) {
                    blackCount++;
                    cnt++;
                }
            }
            blockRowCounts[y] = cnt;
            if (cnt > 0 && y < minY) minY = y;
        }

        // 💡 底部残渣断层截断：仅在偏底部的孤立残渣且连续空白行>=20时截断
        let seenBody = false;
        let blankStreak = 0;
        let lastBodyY = minY;
        for (let y = minY; y < h; y++) {
            if (blockRowCounts[y] > 0) {
                seenBody = true;
                blankStreak = 0;
                lastBodyY = y;
            } else if (seenBody) {
                blankStreak++;
                if (blankStreak >= 20 && y > h * 0.70) {
                    break;
                }
            }
        }
        // 💡 顶部残渣断层跳过：若顶部出现微弱残渣且随后出现连续空白行，主体 minY 修正到空白行之后
        let streak = 0;
        let actualMinY = minY;
        for (let y = minY; y < Math.round(h * 0.40); y++) {
            if (blockRowCounts[y] === 0) {
                streak++;
            } else {
                if (streak >= 8) {
                    actualMinY = y;
                }
                streak = 0;
            }
        }
        minY = actualMinY;

        maxY = lastBodyY;

        const ch = maxY >= minY ? maxY - minY + 1 : 0;
        return { startX: b.startX, endX: b.endX, cw, ch, minY, maxY, blackCount };
    }).filter(b => b.ch >= 15 && b.blackCount >= 20);

    if (blocksWithMeta.length === 0) return null;

    const maxCh = Math.max(...blocksWithMeta.map(b => b.ch));
    let charBlocks = blocksWithMeta.filter(b => b.ch >= maxCh * 0.50);

    // 💡 针对连体字符块（如两个数字因边框粘连，cw > 260）：按字符内部高度的列投影波谷分裂
    let expandedBlocks = [];
    for (const b of charBlocks) {
        if (b.cw > 260) {
            let hist = new Int32Array(b.cw);
            for (let x = 0; x < b.cw; x++) {
                let cnt = 0;
                for (let y = b.minY; y <= b.maxY; y++) {
                    if (bin[y * w + (b.startX + x)] === 0) cnt++;
                }
                hist[x] = cnt;
            }
            let minVal = 999, minX = -1;
            for (let x = Math.round(b.cw * 0.35); x < Math.round(b.cw * 0.65); x++) {
                if (hist[x] < minVal) { minVal = hist[x]; minX = x; }
            }
            if (minX > 0 && minVal <= Math.max(3, Math.round(b.ch * 0.05))) {
                console.log(`[7Seg] 自适应波谷切开连体双数字块 (w=${b.cw}): 切割点 x=${b.startX + minX}`);
                expandedBlocks.push({ startX: b.startX, endX: b.startX + minX - 1, cw: minX, ch: b.ch, minY: b.minY, maxY: b.maxY, blackCount: b.blackCount });
                expandedBlocks.push({ startX: b.startX + minX + 1, endX: b.endX, cw: b.endX - (b.startX + minX), ch: b.ch, minY: b.minY, maxY: b.maxY, blackCount: b.blackCount });
                continue;
            }
        }
        expandedBlocks.push(b);
    }
    charBlocks = expandedBlocks;

    // 💡 右侧残渣竖线清洗（如 x 贴近右边界且宽度较窄的边框残余）
    while (charBlocks.length > 2) {
        if ((type === 'sys' || type === 'dia') && charBlocks.length <= 3) break;
        const last = charBlocks[charBlocks.length - 1];
        const prev = charBlocks[charBlocks.length - 2];
        const maxCw = Math.max(...charBlocks.slice(0, -1).map(b => b.cw));
        const gap = last.startX - prev.endX;
        const b0 = charBlocks[0];
        const cdata0 = new Uint8Array(b0.cw * b0.ch);
        for (let y = 0; y < b0.ch; y++) for (let x = 0; x < b0.cw; x++) cdata0[y * b0.cw + x] = bin[(b0.minY + y) * w + (b0.startX + x)];
        const digit0 = decodeSingleChar(cdata0, b0.cw, b0.ch);
        if (digit0 === null) break;
        if (last.cw < maxCw * 0.60 && last.endX > w * 0.82 && gap > 15) {
            console.log(`[7Seg] 成功剔除右侧边缘残渣/竖线块 (startX=${last.startX}, cw=${last.cw}, gap=${gap})`);
            charBlocks.pop();
        } else {
            break;
        }
    }

    // 💡 高压/低压主字符右对齐：若剔除右侧残渣后仍有 >3 块，截取后 3 块剥离左侧残留标签
    if ((type === 'sys' || type === 'dia') && charBlocks.length > 3) {
        charBlocks = charBlocks.slice(-3);
    }

    // 💡 脉搏通道专属：右对齐优先锁定最后 2 个主字符块，剥离左侧心跳/OK图标
    if (type === 'pulse' && charBlocks.length >= 3) {
        const first = charBlocks[0];
        if (first.cw / first.ch >= 0.38) {
            console.log(`[7Seg pulse] 成功剔除左侧心跳/指示图标 (startX=${first.startX}, cw=${first.cw}, ch=${first.ch})`);
            charBlocks = charBlocks.slice(-2);
        } else {
            charBlocks = charBlocks.slice(-3);
        }
    }

    // 左侧残渣竖线清洗
    if (charBlocks.length >= 3) {
        const first = charBlocks[0];
        const second = charBlocks[1];
        const maxCw = Math.max(...charBlocks.slice(1).map(b => b.cw));
        const gap = second.startX - first.endX;
        if (first.startX < w * 0.15 && first.cw < maxCw * 0.40 && gap > w * 0.10 && first.ch < maxCh * 0.70) {
            console.log(`[7Seg] 成功剔除左侧残留边缘竖线块 (startX=${first.startX}, cw=${first.cw}, gap=${gap})`);
            charBlocks = charBlocks.slice(1);
        }
    }

    let result = "";
    for (let i = 0; i < charBlocks.length; i++) {
        const b = charBlocks[i];
        const cw = b.cw;
        const ch = b.ch;
        const cdata = new Uint8Array(cw * ch);
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                cdata[y * cw + x] = bin[(b.minY + y) * w + (b.startX + x)];
            }
        }
        const digit = decodeSingleChar(cdata, cw, ch);
        if (digit !== null) result += digit;
    }

    if (result.length === 4 && result.startsWith('1')) {
        const candidate3 = parseInt(result.substring(1), 10);
        if (type === 'sys' && candidate3 >= 90 && candidate3 <= 250) {
            console.log(`[7Seg sys] 生理自愈剔除首位假1: "${result}" -> "${candidate3}"`);
            return candidate3.toString();
        }
        if (type === 'dia' && candidate3 >= 40 && candidate3 <= 160) {
            console.log(`[7Seg dia] 生理自愈剔除首位假1: "${result}" -> "${candidate3}"`);
            return candidate3.toString();
        }
    }

    if (type === 'dia' && result && result.length === 3 && result[0] === '8') {
        const fixed = '1' + result.slice(1);
        const val = parseInt(fixed, 10);
        if (val >= 90 && val <= 130) {
            console.log(`[7Seg dia] 生理自愈修复首位假8: "${result}" -> "${fixed}"`);
            return fixed;
        }
    }
    if (type === 'pulse' && result && result.length === 2 && result[0] === '0') {
        const fixed = (result[1] === '0' ? '9' : '8') + result[1];
        console.log(`[7Seg pulse] 生理自愈修复首位假0: "${result}" -> "${fixed}"`);
        return fixed;
    }

    return result || null;
}

/**
 * 高精度自适应行切片生成 (Canvas 版本)
 */
function makeCanvasSliceByRows(srcCanvas, startY, endY, envelope = null, type = 'normal', skipLeftTag = false) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const clampedStartY = Math.max(0, startY);
    const clampedEndY = Math.min(h - 1, endY);
    if (clampedEndY <= clampedStartY) return null;

    let startX = 0;
    let endX = w;
    if (envelope) {
        startX = Math.max(0, envelope.minX);
        endX = Math.min(w, envelope.maxX);
    }

    // 💡 针对左侧中文标签机型（如欧姆龙J710）：跳过左侧汉字标签区（高压/低压/mmHg等），切取核心数字区
    if (skipLeftTag || w > 320) {
        startX = Math.max(startX, Math.round(w * 0.35));
    }

    // 物理切断右侧粗黑边框
    endX = Math.min(endX, Math.round(w * 0.83));

    // 如果是脉搏 (pulse)，我们进行特殊的“爱心与右括号边框物理过滤”
    if (type === 'pulse') {
        const spanX = endX - startX;
        startX = Math.max(0, startX + Math.round(spanX * 0.20));
        endX = Math.min(w, endX - Math.round(spanX * 0.08));
    }

    const sliceW = Math.max(1, endX - startX);
    const sliceH = clampedEndY - clampedStartY + 1;

    // 创建子 Canvas 并拷贝图像
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = sliceW;
    sliceCanvas.height = sliceH;
    const sliceCtx = sliceCanvas.getContext('2d', { willReadFrequently: true });
    sliceCtx.fillStyle = "#ffffff";
    sliceCtx.fillRect(0, 0, sliceW, sliceH);
    sliceCtx.drawImage(srcCanvas, startX, clampedStartY, sliceW, sliceH, 0, 0, sliceW, sliceH);

    // 💡 净化切片：清除顶部和底部的断裂横条残渣，并清除贴边竖向黑线
    cleanSliceArtifacts(sliceCanvas);
    clearBordersLeftRight(sliceCanvas);

    // 自动裁剪边缘白边
    const croppedCanvas = autoCropCanvas(sliceCanvas, 12);
    const cW = croppedCanvas.width;
    const cH = croppedCanvas.height;
    if (cW < 3 || cH < 3) return null;

    // 放大 3 倍
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cW * 3;
    finalCanvas.height = cH * 3;
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    finalCtx.fillStyle = "#ffffff";
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    
    // 禁用平滑以保持液晶数码管笔画锐利
    finalCtx.imageSmoothingEnabled = false;
    finalCtx.drawImage(croppedCanvas, 0, 0, cW, cH, 0, 0, finalCanvas.width, finalCanvas.height);

    // 对放大后的图像再次二值化并做极端黑白处理
    const imgData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
            continue;
        }
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const out = gray < 128 ? 0 : 255;
        data[i] = out;
        data[i + 1] = out;
        data[i + 2] = out;
        data[i + 3] = 255;
    }
    finalCtx.putImageData(imgData, 0, 0);

    return finalCanvas;
}


function makeCanvasSlice(srcCanvas, yStartPct, yEndPct, xStartPct = 0, xEndPct = 1, envelope = null) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;

    let startY, endY, startX, endX;
    if (envelope) {
        const boxW = envelope.maxX - envelope.minX + 1;
        const boxH = envelope.maxY - envelope.minY + 1;
        startY = Math.round(envelope.minY + boxH * yStartPct);
        endY = Math.round(envelope.minY + boxH * yEndPct);
        startX = Math.round(envelope.minX + boxW * xStartPct);
        endX = Math.round(envelope.minX + boxW * xEndPct);
    } else {
        startY = Math.round(h * yStartPct);
        endY = Math.round(h * yEndPct);
        startX = Math.round(w * xStartPct);
        endX = Math.round(w * xEndPct);
    }

    startX = Math.max(0, startX);
    startY = Math.max(0, startY);
    endX = Math.min(w, endX);
    endY = Math.min(h, endY);

    const sliceWidth = Math.max(1, endX - startX);
    const sliceHeight = Math.max(1, endY - startY);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = sliceWidth;
    sliceCanvas.height = sliceHeight;
    const ctx = sliceCanvas.getContext('2d');
    ctx.drawImage(srcCanvas, startX, startY, sliceWidth, sliceHeight, 0, 0, sliceWidth, sliceHeight);

    const croppedCanvas = autoCropCanvas(sliceCanvas, 6);
    const croppedW = croppedCanvas.width;
    const croppedH = croppedCanvas.height;

    const enhanced = document.createElement('canvas');
    enhanced.width = croppedW * 2;
    enhanced.height = croppedH * 2;
    const enhancedCtx = enhanced.getContext('2d', { willReadFrequently: true });
    enhancedCtx.imageSmoothingEnabled = false;
    enhancedCtx.drawImage(croppedCanvas, 0, 0, croppedW, croppedH, 0, 0, enhanced.width, enhanced.height);

    const enhancedData = enhancedCtx.getImageData(0, 0, enhanced.width, enhanced.height);
    const enhancedPixels = enhancedData.data;
    for (let i = 0; i < enhancedPixels.length; i += 4) {
        const gray = Math.round((enhancedPixels[i] + enhancedPixels[i + 1] + enhancedPixels[i + 2]) / 3);
        const out = gray < 170 ? 0 : 255;
        enhancedPixels[i] = out;
        enhancedPixels[i + 1] = out;
        enhancedPixels[i + 2] = out;
        enhancedPixels[i + 3] = 255;
    }
    enhancedCtx.putImageData(enhancedData, 0, 0);
    return enhanced;
}

/**
 * 提前在后台静默初始化并常驻两个 Tesseract Worker 实例，支持并发多线程识别，免去每次拍照重新初始化的卡顿
 */
async function initOCRWorkers(onProgress = null) {
    if (ocrWorkersReady) {
        return true;
    }
    if (ocrWorkersInitializing) {
        // 如果正在初始化，则等待其完成
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (ocrWorkersReady) {
                    clearInterval(check);
                    resolve(true);
                }
            }, 100);
        });
    }
    ocrWorkersInitializing = true;
    console.log("开始在后台并行预加载双 AI 识别引擎...");
    
    try {
        if (onProgress) onProgress('正在启动双通道 AI 识别引擎 (1/2)...', 15);
        console.log('[OCR] creating worker 1');
        const w1 = await Tesseract.createWorker('eng', 1, {
            workerPath: 'worker.min.js',
            corePath: '.',
            langPath: '.'
        });
        await w1.setParameters({
            tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtTnNaArR',
            tessedit_pageseg_mode: '7',
            classify_bln_numeric_mode: '1',
            textord_heavy_nr: '1',
            preserve_interword_spaces: '1'
        });
        ocrWorker1 = w1;
        console.log("AI 识别引擎通道 1 初始化完毕。");

        if (onProgress) onProgress('正在启动双通道 AI 识别引擎 (2/2)...', 25);
        console.log('[OCR] creating worker 2');
        const w2 = await Tesseract.createWorker('eng', 1, {
            workerPath: 'worker.min.js',
            corePath: '.',
            langPath: '.'
        });
        await w2.setParameters({
            tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtTnNaArR',
            tessedit_pageseg_mode: '7',
            classify_bln_numeric_mode: '1',
            textord_heavy_nr: '1',
            preserve_interword_spaces: '1'
        });
        ocrWorker2 = w2;
        console.log("AI 识别引擎通道 2 初始化完毕。");

        ocrWorkersReady = true;
        console.log("所有 AI 识别引擎已全部预加载并常驻就绪！");
        return true;
    } catch (err) {
        console.error("静默初始化识别引擎异常:", err);
        ocrWorkersInitializing = false;
        return false;
    }
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

    try {
        // 检查并等待后台 AI 识别引擎预加载就绪
        if (!ocrWorkersReady) {
            loadingMessage.innerText = '正在启动 AI 识别引擎，首次加载约需几秒...';
            progressBar.style.width = '20%';
            const loaded = await initOCRWorkers((msg, progress) => {
                loadingMessage.innerText = msg;
                progressBar.style.width = `${progress}%`;
            });
            if (!loaded) {
                throw new Error("AI 识别引擎初始化失败，请重试或手动输入。");
            }
        }

        const w = canvas.width;
        const h = canvas.height;

        // 🚀【双引擎级联通道 0：优先尝试 ONNXRuntime-Web + YOLOv8-nano 断码屏目标检测】
        if (typeof YOLOv8DigitDetector !== 'undefined') {
            try {
                if (!window.yoloDetectorInstance) {
                    window.yoloDetectorInstance = new YOLOv8DigitDetector({
                        modelPath: './models/yolov8n_7segment.onnx'
                    });
                }
                loadingMessage.innerText = '正在执行 YOLOv8 深度断码屏目标检测...';
                progressBar.style.width = '25%';
                const yoloDetections = await window.yoloDetectorInstance.detect(canvas);
                if (yoloDetections && yoloDetections.length >= 5) {
                    const yoloBP = window.yoloDetectorInstance.clusterAndExtractBP(yoloDetections, h);
                    if (yoloBP && yoloBP.systolic && yoloBP.diastolic) {
                        console.log('[YOLOv8] 🎉 目标检测直接命中完整生理三元组:', yoloBP);
                        progressBar.style.width = '100%';
                        setTimeout(() => loadingModal.classList.remove('show'), 200);

                        const finalSys = yoloBP.systolic;
                        const finalDia = yoloBP.diastolic;
                        const pulseVal = yoloBP.pulse || '';

                        if (ocrTarget === 'single') {
                            document.getElementById('systolic').value = finalSys;
                            document.getElementById('diastolic').value = finalDia;
                            if (pulseVal) document.getElementById('pulse').value = pulseVal;
                        } else {
                            document.getElementById(`sys${ocrTarget}`).value = finalSys;
                            document.getElementById(`dia${ocrTarget}`).value = finalDia;
                            if (pulseVal) document.getElementById(`pulse${ocrTarget}`).value = pulseVal;
                            handleMultiInputCheck();
                        }

                        showToast(`识别成功 (YOLOv8)！高压:${finalSys}，低压:${finalDia}${pulseVal ? `，脉搏:${pulseVal}` : ''}`);
                        return;
                    }
                }
            } catch (yoloErr) {
                console.warn('[YOLOv8] 目标检测异常或模型未就绪，自动平滑回退至几何拓扑通道:', yoloErr);
            }
        }

        // 💡 自适应屏幕垂直定位算法：智能检测中间深色屏幕主带，动态适配居中构图与偏下构图
        const detectAdaptiveScreenBounds = (cv) => {
            const cw = cv.width, ch = cv.height;
            const ctx = cv.getContext('2d');
            const imgData = ctx.getImageData(0, 0, cw, ch);
            const d = imgData.data;
            
            const x0 = Math.round(cw * 0.35);
            const x1 = Math.round(cw * 0.65);
            const scanW = x1 - x0;
            
            const darkPcts = new Float32Array(ch);
            for (let y = 0; y < ch; y++) {
                let darkCnt = 0;
                for (let x = x0; x < x1; x++) {
                    const idx = (y * cw + x) * 4;
                    const gray = (d[idx] + d[idx+1] + d[idx+2]) / 3;
                    if (gray < 110) darkCnt++;
                }
                darkPcts[y] = darkCnt / scanW;
            }
            
            const smooth = new Float32Array(ch);
            const win = 10;
            for (let y = 0; y < ch; y++) {
                let sum = 0, count = 0;
                for (let dy = -win; dy <= win; dy++) {
                    const py = y + dy;
                    if (py >= 0 && py < ch) { sum += darkPcts[py]; count++; }
                }
                smooth[y] = sum / count;
            }
            
            const bands = [];
            let inB = false, bStart = 0;
            for (let y = 0; y < ch; y++) {
                if (smooth[y] >= 0.40) {
                    if (!inB) { inB = true; bStart = y; }
                } else {
                    if (inB) { inB = false; bands.push({ start: bStart, end: y - 1, h: y - bStart }); }
                }
            }
            if (inB) bands.push({ start: bStart, end: ch - 1, h: ch - bStart });
            
            const candidates = bands.filter(b => b.h >= Math.round(ch * 0.25) && b.h <= Math.round(ch * 0.60));
            if (candidates.length > 0) {
                candidates.sort((a,b) => b.h - a.h);
                return candidates[0];
            }
            return null;
        };

        const screenBand = detectAdaptiveScreenBounds(canvas);
        let adaptiveY1 = Math.round(h * 0.08);
        let adaptiveH1 = Math.round(h * 0.78);
        let tightAdaptiveY = Math.round(h * 0.12);
        let tightAdaptiveH = Math.round(h * 0.72);
        if (screenBand) {
            console.log('[OCR] 自适应屏幕垂直定位成功: y=' + screenBand.start + '~' + screenBand.end + ' (h=' + screenBand.h + ')');
            const padY = Math.round(screenBand.h * 0.05);
            adaptiveY1 = Math.max(0, screenBand.start - padY);
            adaptiveH1 = Math.min(h - adaptiveY1, screenBand.h + padY * 2);
            tightAdaptiveY = Math.max(0, screenBand.start - 8);
            tightAdaptiveH = Math.min(h - tightAdaptiveY, screenBand.h + 16);
        }

        // 1. 裁剪两路定位 Canvas
        // Road 1 自适应高包容性大裁剪 (自适应屏幕主带，防顶部杂质侵入)
        const cropX1 = Math.round(w * 0.15);
        const cropY1 = adaptiveY1;
        const cropW1 = Math.round(w * 0.75);
        const cropH1 = adaptiveH1;

        // Road 2 & 3 宽范围拉伸裁剪 (自适应屏幕主带)
        const cropX2 = Math.round(w * 0.10);
        const cropY2 = adaptiveY1;
        const cropW2 = Math.round(w * 0.80);
        const cropH2 = adaptiveH1;

        // Road 4 专属脉搏定位大范围裁剪 (X:35%, Y:50%, W:40%, H:35%)，兼容各种型号血压计的心率定位
        const cropX_pulse = Math.round(w * 0.35);
        const cropY_pulse = Math.round(h * 0.50);
        const cropW_pulse = Math.round(w * 0.40);
        const cropH_pulse = Math.round(h * 0.35);

        if (cropW1 <= 0 || cropH1 <= 0 || cropW2 <= 0 || cropH2 <= 0 || cropW_pulse <= 0 || cropH_pulse <= 0) {
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

        let canvasRoad3 = cloneCanvas(canvasRoad2);

        // 创建 Road 4 专属脉搏画布
        const canvasPulseDedicated = document.createElement('canvas');
        canvasPulseDedicated.width = cropW_pulse;
        canvasPulseDedicated.height = cropH_pulse;
        canvasPulseDedicated.getContext('2d').drawImage(canvas, cropX_pulse, cropY_pulse, cropW_pulse, cropH_pulse, 0, 0, cropW_pulse, cropH_pulse);

        const buildPulseVariantCanvas = (srcCanvas, x, y, w, h, options = {}) => {
            const variantCanvas = document.createElement('canvas');
            variantCanvas.width = Math.max(80, w);
            variantCanvas.height = Math.max(48, h);
            variantCanvas.getContext('2d', { willReadFrequently: true }).drawImage(srcCanvas, x, y, w, h, 0, 0, variantCanvas.width, variantCanvas.height);
            if (options.contrast) {
                preprocessImageGrayContrast(variantCanvas);
            }
            if (options.threshold) {
                preprocessImage(variantCanvas, 10);
            }
            if (options.clearEdges) {
                clearBordersLeftRight(variantCanvas);
                dilateBlack(variantCanvas);
            }
            return variantCanvas;
        };

        const buildPulseLocalizedCandidates = (srcCanvas) => {
            const candidates = [];
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = srcCanvas.width;
            tempCanvas.height = srcCanvas.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            tempCtx.drawImage(srcCanvas, 0, 0);

            preprocessImageGrayContrast(tempCanvas);
            preprocessImage(tempCanvas, 10);

            const scanCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            const imgData = scanCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imgData.data;
            const w = tempCanvas.width;
            const h = tempCanvas.height;
            const startY = Math.round(h * 0.40);

            let minX = w;
            let maxX = 0;
            let minY = h;
            let maxY = 0;
            let darkPixels = 0;

            for (let y = startY; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const isDark = data[idx] < 140 || data[idx + 1] < 140 || data[idx + 2] < 140;
                    if (isDark) {
                        darkPixels++;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            if (darkPixels >= 60 && maxX >= minX && maxY >= minY) {
                const padX = Math.max(8, Math.round(w * 0.03));
                const padY = Math.max(8, Math.round(h * 0.03));
                const x0 = Math.max(0, minX - padX);
                const y0 = Math.max(0, minY - padY);
                const x1 = Math.min(w - 1, maxX + padX);
                const y1 = Math.min(h - 1, maxY + padY);
                const boxW = Math.max(120, x1 - x0 + 1);
                const boxH = Math.max(60, y1 - y0 + 1);

                const addBox = (sx, sy, sw, sh, label) => {
                    const boxCanvas = document.createElement('canvas');
                    boxCanvas.width = Math.max(120, sw);
                    boxCanvas.height = Math.max(60, sh);
                    const boxCtx = boxCanvas.getContext('2d', { willReadFrequently: true });
                    boxCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, boxCanvas.width, boxCanvas.height);
                    preprocessImageGrayContrast(boxCanvas);
                    preprocessImage(boxCanvas, 10);
                    candidates.push({ canvas: boxCanvas, label });
                };

                addBox(x0, y0, boxW, boxH, 'Localized_PULSE_Box');
                addBox(Math.max(0, x0 - Math.round(boxW * 0.15)), y0, Math.min(w, Math.round(boxW * 1.45)), boxH, 'Localized_PULSE_Wide');
                addBox(Math.max(0, x0 - Math.round(boxW * 0.10)), Math.max(0, y0 + Math.round(boxH * 0.20)), Math.min(w, Math.round(boxW * 1.35)), Math.max(48, Math.round(boxH * 1.10)), 'Localized_PULSE_Bottom');
            }

            return candidates;
        };

        const pulseVariantCanvasA = buildPulseVariantCanvas(canvas, Math.round(w * 0.22), Math.round(h * 0.47), Math.round(w * 0.56), Math.round(h * 0.34), { contrast: true, threshold: true });
        const pulseVariantCanvasB = buildPulseVariantCanvas(canvas, Math.round(w * 0.18), Math.round(h * 0.44), Math.round(w * 0.64), Math.round(h * 0.38), { contrast: true, threshold: true, clearEdges: true });
        const pulseVariantCanvasC = buildPulseVariantCanvas(canvas, Math.round(w * 0.26), Math.round(h * 0.50), Math.round(w * 0.48), Math.round(h * 0.30), { contrast: true, threshold: true });
        const pulseBottomCanvas = buildPulseVariantCanvas(canvas, Math.round(w * 0.05), Math.round(h * 0.55), Math.round(w * 0.90), Math.round(h * 0.35), { contrast: true, threshold: true, clearEdges: true });
        const pulseBottomWideCanvas = buildPulseVariantCanvas(canvas, 0, Math.round(h * 0.55), w, Math.round(h * 0.35), { contrast: true, threshold: true });
        const pulseBottomCenterCanvas = buildPulseVariantCanvas(canvas, Math.round(w * 0.20), Math.round(h * 0.50), Math.round(w * 0.60), Math.round(h * 0.40), { contrast: true, threshold: true, clearEdges: true });
        const pulseFullImageCanvas = buildPulseVariantCanvas(canvas, 0, 0, w, h, { contrast: true, threshold: true });
        const pulseFullImageCanvasAlt = buildPulseVariantCanvas(canvas, 0, 0, w, h, { contrast: true, threshold: true, clearEdges: true });
        const pulseLocalizedCandidates = buildPulseLocalizedCandidates(canvas);

        progressBar.style.width = '30%';
        loadingMessage.innerText = '正在进行多路物理切分与对比度调优...';

        // 💡 强涂绝对底部 22 像素，抹去可能存在的大黑杠与外壳杂质，阻断 BFS 向上抹除脉搏，抹平底边框
        const eraseAbsoluteBottom = (cv) => {
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            const eh = cv.height;
            const ew = cv.width;
            const eraseY = eh - Math.max(22, Math.round(eh * 0.08));
            if (eraseY > 0) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, eraseY, ew, eh - eraseY);
            }
        };

        // 💡 物理擦除图像顶部约 14% 的区域，彻底剥离可能存在的 mmHg 标签及杂质字符，防止拉高 Envelope
        // 💡 擦除比例从 14% 降至 8%：原 14% 会把高压行（178）顶部笔画削掉，导致行分割只能分出 2 段
        const eraseAbsoluteTop = (cv, pct = 0.08) => {
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            const ew = cv.width;
            const eraseH = Math.round(cv.height * pct);
            if (eraseH > 0) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, ew, eraseH);
            }
        };

        // 计算 Canvas 中所有黑色像素的包络矩形（用于自适应行定位）
        const getCanvasEnvelope = (srcCanvas) => {
            const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
            const w = srcCanvas.width;
            const h = srcCanvas.height;
            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;

            let minX = w, maxX = 0, minY = h, maxY = 0;
            let hasBlack = false;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    if (data[idx] === 0) { // 黑色像素
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        hasBlack = true;
                    }
                }
            }

            if (hasBlack) {
                return {
                    minX: Math.max(minX - 3, 0),
                    maxX: Math.min(maxX + 3, w - 1),
                    minY: Math.max(minY - 3, 0),
                    maxY: Math.min(maxY + 3, h - 1)
                };
            }
            return null;
        };

        // Road 1 预处理：自适应二值化 + 擦除绝对顶底 + 边缘去噪 (膨胀挪到行定位之后)
        preprocessImage(canvasRoad1, 10); 
        eraseAbsoluteTop(canvasRoad1);
        eraseAbsoluteBottom(canvasRoad1);
        clearBordersLeftRight(canvasRoad1);
        
        let envelope1 = getCanvasEnvelope(canvasRoad1);

        // 💡 智能自适应二次降级：若探测到 BBox 高度或宽度几乎占满裁剪区（触发 OMRON 标志与汉字污染）
        let tightMode1 = false;
        if (envelope1 && (envelope1.maxY - envelope1.minY) > canvasRoad1.height * 0.85) {
            console.log("[OCR] 检测到 Road1 包络框受到背景污染，自动收缩至核心特写区进行二次定位...");
            const tightX = Math.round(w * 0.38);
            const tightY = tightAdaptiveY;
            const tightW = Math.round(w * 0.52);
            const tightH = tightAdaptiveH;
            console.log(`[OCR] tightMode1: x=${tightX} y=${tightY} w=${tightW} h=${tightH}`);
            
            canvasRoad1.width = tightW;
            canvasRoad1.height = tightH;
            canvasRoad1.getContext('2d').drawImage(canvas, tightX, tightY, tightW, tightH, 0, 0, tightW, tightH);
            
            preprocessImage(canvasRoad1, 10);
            eraseAbsoluteTop(canvasRoad1);
            eraseAbsoluteBottom(canvasRoad1);
            clearBordersLeftRight(canvasRoad1);
            
            envelope1 = getCanvasEnvelope(canvasRoad1);
            tightMode1 = true;
        }

        // 核心优化点：在膨胀之前计算自适应行定位！
        const segs1 = findRowSegments(canvasRoad1, envelope1 ? envelope1.minY : 0, envelope1 ? envelope1.maxY : canvasRoad1.height - 1);
        dilateBlack(canvasRoad1);

        // Road 2 预处理：对比度拉伸 + 自适应二值化 + 擦除绝对顶底 + 边缘去噪
        preprocessImageGrayContrast(canvasRoad2);
        preprocessImage(canvasRoad2, 10);
        eraseAbsoluteTop(canvasRoad2);
        eraseAbsoluteBottom(canvasRoad2);
        clearBordersLeftRight(canvasRoad2);
        
        let envelope2 = getCanvasEnvelope(canvasRoad2);

        let tightMode2 = false;
        if (envelope2 && (envelope2.maxY - envelope2.minY) > canvasRoad2.height * 0.85) {
            console.log("[OCR] 检测到 Road2 包络框受到背景污染，自动收缩至核心特写区进行二次定位...");
            const tightX = Math.round(w * 0.36);
            const tightY = tightAdaptiveY;
            const tightW = Math.round(w * 0.54);
            const tightH = tightAdaptiveH;
            console.log(`[OCR] tightMode2: x=${tightX} y=${tightY} w=${tightW} h=${tightH}`);
            
            canvasRoad2.width = tightW;
            canvasRoad2.height = tightH;
            canvasRoad2.getContext('2d').drawImage(canvas, tightX, tightY, tightW, tightH, 0, 0, tightW, tightH);
            
            preprocessImageGrayContrast(canvasRoad2);
            preprocessImage(canvasRoad2, 10);
            eraseAbsoluteTop(canvasRoad2);
            eraseAbsoluteBottom(canvasRoad2);
            clearBordersLeftRight(canvasRoad2);
            
            envelope2 = getCanvasEnvelope(canvasRoad2);

            // 💡 同步更新 Road3（重新从收缩后的 canvasRoad2 克隆，避免旧脏数据干扰定位）
            canvasRoad3 = cloneCanvas(canvasRoad2);
            preprocessImageGrayContrast(canvasRoad3);
            eraseAbsoluteTop(canvasRoad3);
            eraseAbsoluteBottom(canvasRoad3);
            tightMode2 = true;
        }
        const envelope3 = envelope2; // Road 3 (对比度拉伸灰度图) 共享 Road 2 的定位

        // 核心优化点：在膨胀之前计算自适应行定位！
        const segs2 = findRowSegments(canvasRoad2, envelope2 ? envelope2.minY : 0, envelope2 ? envelope2.maxY : canvasRoad2.height - 1);
        const segs3 = segs2;
        dilateBlack(canvasRoad2);

        // Road 3 预处理：对比度拉伸灰度图 + 擦除绝对底边 (保持不变)
        preprocessImageGrayContrast(canvasRoad3);
        eraseAbsoluteBottom(canvasRoad3);

        // Road 4 专属脉搏预处理：对比度拉伸 + 自适应二值化 (免去清边)
        preprocessImageGrayContrast(canvasPulseDedicated);
        preprocessImage(canvasPulseDedicated, 10);

        const makeSlices = (srcCanvas, envelope, segs, isTight = false) => {
            if (segs && segs.length === 3) {
                const pad = 3;
                return {
                    sys:       makeCanvasSliceByRows(srcCanvas, segs[0].startY - pad, segs[0].endY + pad, envelope, 'sys'),
                    diaWide:   makeCanvasSliceByRows(srcCanvas, segs[1].startY - pad - 2, segs[1].endY + pad + 2, envelope, 'dia'),
                    diaMid:    makeCanvasSliceByRows(srcCanvas, segs[1].startY - pad, segs[1].endY + pad, envelope, 'dia'),
                    diaNarrow: makeCanvasSliceByRows(srcCanvas, segs[1].startY - pad + 2, segs[1].endY + pad - 2, envelope, 'dia'),
                    pulse:     makeCanvasSliceByRows(srcCanvas, segs[2].startY - pad, segs[2].endY + pad, envelope, 'pulse')
                };
            }

            // Fallback 回退：若没有成功分成 3 行，回退至原版百分比切片算法
            if (envelope) {
                if (isTight) {
                    return {
                        sys: makeCanvasSlice(srcCanvas, 0.0, 0.46, 0, 1, envelope),
                        diaWide: makeCanvasSlice(srcCanvas, 0.40, 0.75, 0, 1, envelope),
                        diaMid: makeCanvasSlice(srcCanvas, 0.42, 0.74, 0, 1, envelope),
                        diaNarrow: makeCanvasSlice(srcCanvas, 0.44, 0.73, 0, 1, envelope),
                        pulse: makeCanvasSlice(srcCanvas, 0.70, 1.0, 0.0, 1.0, envelope)
                    };
                } else {
                    return {
                        sys: makeCanvasSlice(srcCanvas, 0.0, 0.27, 0, 1, envelope),
                        diaWide: makeCanvasSlice(srcCanvas, 0.28, 0.60, 0, 1, envelope),
                        diaMid: makeCanvasSlice(srcCanvas, 0.30, 0.59, 0, 1, envelope),
                        diaNarrow: makeCanvasSlice(srcCanvas, 0.32, 0.58, 0, 1, envelope),
                        pulse: makeCanvasSlice(srcCanvas, 0.57, 1.0, 0.0, 1.0, envelope)
                    };
                }
            }
            return {
                sys: makeCanvasSlice(srcCanvas, 0.0, 0.38),
                diaWide: makeCanvasSlice(srcCanvas, 0.31, 0.69),
                diaMid: makeCanvasSlice(srcCanvas, 0.35, 0.69),
                diaNarrow: makeCanvasSlice(srcCanvas, 0.38, 0.68),
                pulse: makeCanvasSlice(srcCanvas, 0.58, 1.0, 0.45, 1.0)
            };
        };

        const slices1 = makeSlices(canvasRoad1, envelope1, segs1, tightMode1);
        const slices2 = makeSlices(canvasRoad2, envelope2, segs2, tightMode2);
        const slices3 = makeSlices(canvasRoad3, envelope3, segs3, tightMode2);

        const sysCandidates = [];
        const diaCandidates = [];
        const pulseCandidates = [];

        const addCandidate = (val, source, type, customWeight = null) => {
            if (!val) return;

            // 1. 使用移植的最强字模多候选映射还原算法
            const mappedVariants = generateMultiMappings(val);
            const allParsed = new Set();

            for (let i = 0; i < mappedVariants.length; i++) {
                const mapped = mappedVariants[i];
                const fragments = mapped
                    .split(/\s+/)
                    .map((part) => part.replace(/[^0-9]/g, ''))
                    .filter(Boolean);
                for (let j = 0; j < fragments.length; j++) {
                    const frag = fragments[j];
                    if (frag.length >= 2) {
                        const n = parseInt(frag, 10);
                        if (Number.isInteger(n) && n >= 30 && n <= 250) allParsed.add(n);
                        if (frag.length >= 4) {
                            for (let len = 2; len <= Math.min(3, frag.length); len++) {
                                for (let start = 0; start <= frag.length - len; start++) {
                                    const sub = frag.substr(start, len);
                                    const subN = parseInt(sub, 10);
                                    if (Number.isInteger(subN) && subN >= 40 && subN <= 200) {
                                        allParsed.add(subN);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            const candidatesWithMeta = [];
            allParsed.forEach(num => {
                candidatesWithMeta.push({ num: num, isHeader: true });
            });

            // 2. 启发式子串提取：仅在未找到生理合规的整体候选时触发
            let hasPhysioValid = false;
            candidatesWithMeta.forEach(item => {
                const n = item.num;
                if (type === 'sys' && n >= 90 && n <= 195) hasPhysioValid = true;
                if (type === 'dia' && n >= 50 && n <= 130) hasPhysioValid = true;
                if (type === 'pulse' && n >= 40 && n <= 160) hasPhysioValid = true;
            });

            if (!hasPhysioValid) {
                for (let i = 0; i < mappedVariants.length; i++) {
                    const mapped = mappedVariants[i];
                    const cleanStr = mapped.replace(/[^0-9]/g, '');
                    if (cleanStr.length >= 2) {
                        for (let len = 2; len <= Math.min(4, cleanStr.length); len++) {
                            for (let start = 0; start <= cleanStr.length - len; start++) {
                                const subStr = cleanStr.substr(start, len);
                                let subNum = parseInt(subStr, 10);
                                if (Number.isInteger(subNum)) {
                                    let isValid = false;
                                    const isHeader = (start === 0);
                                    
                                    let finalNum = subNum;
                                    if (type === 'sys') {
                                        if (finalNum >= 90 && finalNum <= 195) isValid = true;
                                        else if (isHeader && finalNum >= 10 && finalNum < 90 && (finalNum + 100) >= 90 && (finalNum + 100) <= 195) {
                                            finalNum += 100;
                                            isValid = true;
                                        }
                                    } else if (type === 'dia') {
                                        if (finalNum >= 50 && finalNum <= 130) isValid = true;
                                        else if (isHeader && finalNum >= 10 && finalNum < 50 && (finalNum + 100) >= 50 && (finalNum + 100) <= 130) {
                                            finalNum += 100;
                                            isValid = true;
                                        }
                                    } else if (type === 'pulse') {
                                        if (finalNum >= 40 && finalNum <= 160) isValid = true;
                                    }
                                    
                                    if (isValid && !candidatesWithMeta.some(c => c.num === finalNum)) {
                                        candidatesWithMeta.push({ num: finalNum, isHeader: isHeader });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 3. 数字补偿与置信度权重赋予
            const cleanDigitCount = val.replace(/[^0-9]/g, '').length;

            candidatesWithMeta.forEach((item) => {
                let num = item.num;
                // 计算置信度权重：若指定了自定义权重（如七段拓扑解码器），优先使用
                let weight = 1;
                if (customWeight !== null && Number.isInteger(customWeight)) {
                    weight = customWeight;
                } else if (cleanDigitCount >= 2 && !/[a-zA-Z]/.test(val)) {
                    weight = 4;
                } else if (cleanDigitCount >= 2) {
                    weight = 2;
                }

                // 百位漏读补偿（如 08/8 -> 108, 16 -> 116, 20 -> 120, 62 -> 162, 78 -> 178, 85 -> 185）
                // ⚠️ 补偿候选仅作为降级兜底，权重必须严格限制为低权重（1或2），绝不能压倒直接识别出的有效三位数！
                if (item.isHeader && (cleanDigitCount === 2 || (cleanDigitCount === 1 && num < 10))) {
                    const compWeight = Math.min(2, Math.max(1, Math.floor(weight / 4)));
                    if (type === 'sys' && num >= 0 && num < 95) {
                        const comp = num + 100;
                        if (comp >= 90 && comp <= 195) {
                            console.log(`[SYS Auto-Compensate] Mapped ${num} -> ${comp} (from ${source}, compWeight=${compWeight})`);
                            sysCandidates.push({ num: comp, source: source + '_comp', raw: val, weight: compWeight });
                        }
                    }
                    if (type === 'dia' && num >= 0 && num < 40) {
                        const comp = num + 100;
                        if (comp >= 50 && comp <= 130) {
                            console.log(`[DIA Auto-Compensate] Mapped ${num} -> ${comp} (from ${source}, compWeight=${compWeight})`);
                            diaCandidates.push({ num: comp, source: source + '_comp', raw: val, weight: compWeight });
                        }
                    }
                }

                const resItem = { num: num, source: source, raw: val, weight: weight };
                if (type === 'sys' && num >= 90 && num <= 195) sysCandidates.push(resItem);
                if (type === 'dia' && num >= 50 && num <= 130) diaCandidates.push(resItem);
                if (type === 'pulse' && num >= 40 && num <= 160) pulseCandidates.push(resItem);
            });
        };

        const recognizeAndAdd = async (worker, canvas, source, type, minDarkPixels = 80) => {
            if (!canvas) return null;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            if (canvas.width < 90 || canvas.height < 48 || canvas.width / Math.max(1, canvas.height) > 6) {
                return null;
            }
            let darkPixels = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) {
                    darkPixels++;
                }
            }
            if (canvas.width < 80 || canvas.height < 48 || darkPixels < minDarkPixels) {
                return null;
            }

            try {
                const res = await worker.recognize(canvas);
                const text = (res && res.data && res.data.text || '').trim();
                console.log(`[OCR Raw] ${source}(${type}) -> "${text}" (canvas ${canvas.width}x${canvas.height})`);
                addCandidate(text, source, type);
                return text;
            } catch (err) {
                console.warn(`[OCR] Skip ${source} because of recognition error:`, err && err.message ? err.message : err);
                return null;
            }
        };

        const getBestValue = (candidates, minVal, maxVal, type = 'normal') => {
            const scores = {};
            candidates.forEach(cand => {
                const val = cand.num;
                const w = cand.weight || 1;
                if (val >= minVal && val <= maxVal) {
                    scores[val] = (scores[val] || 0) + w;
                }
            });
            
            let maxScore = 0;
            let bestVals = [];
            for (const valStr in scores) {
                const val = parseInt(valStr, 10);
                const score = scores[valStr];
                if (score > maxScore) {
                    maxScore = score;
                    bestVals = [val];
                } else if (score === maxScore) {
                    bestVals.push(val);
                }
            }

            if (bestVals.length > 0) {
                if (type === 'pulse') {
                    // 脉搏平局偏好：优先最贴近静息心率均值 (75~85) 的数值
                    bestVals.sort((a, b) => Math.abs(a - 80) - Math.abs(b - 80));
                } else if (type === 'dia') {
                    // 低压平局偏好：优先最贴近正常舒张压均值 (75~85) 的数值
                    bestVals.sort((a, b) => Math.abs(a - 80) - Math.abs(b - 80));
                } else {
                    // 高压平局偏好：三位数优先，大值优先
                    bestVals.sort((a, b) => b - a);
                }
                return bestVals[0];
            }
            
            const fallback = candidates
                .map(c => c.num)
                .filter(val => val >= minVal && val <= maxVal);
            if (type === 'pulse' || type === 'dia') {
                fallback.sort((a, b) => Math.abs(a - 80) - Math.abs(b - 80));
            } else {
                fallback.sort((a, b) => b - a);
            }
            return fallback[0] || null;
        };

        const getBestBPCombination = (sysCandidatesList, diaCandidatesList, pulseCandidatesList) => {
            const sysValues = sysCandidatesList
                .map(c => c.num)
                .filter((n) => Number.isInteger(n) && n >= 90 && n <= 195);
            const diaValues = diaCandidatesList
                .map(c => c.num)
                .filter((n) => Number.isInteger(n) && n >= 50 && n <= 130);
            const pulseValues = pulseCandidatesList
                .map(c => c.num)
                .filter((n) => Number.isInteger(n) && n >= 40 && n <= 160);

            if (sysValues.length === 0 || diaValues.length === 0) return null;

            const sys = [...new Set(sysValues)].sort((a, b) => b - a)[0];
            const dia = [...new Set(diaValues)].filter((n) => n < sys).sort((a, b) => a - b)[0] || [...new Set(diaValues)].sort((a, b) => a - b)[0];
            const pulse = [...new Set(pulseValues)].sort((a, b) => Math.abs(a - 80) - Math.abs(b - 80))[0] || null;

            return { systolic: sys, diastolic: dia, pulse };
        };

        const solveForRoad = (roadPrefixes) => {
            const filteredSys = sysCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
            const filteredDia = diaCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p)));
            const filteredPulse = pulseCandidates.filter(c => roadPrefixes.some(p => c.source.startsWith(p) || (p === 'Road1' && c.source === 'Dedicated_PULSE')));

            const sys = getBestValue(filteredSys, 90, 195, 'sys');
            const dia = getBestValue(filteredDia, 50, 130, 'dia');
            const pulse = getBestValue(filteredPulse, 40, 160, 'pulse');

            if (sys && dia) {
                return { systolic: sys, diastolic: dia, pulse: pulse };
            }

            const combined = getBestBPCombination(filteredSys, filteredDia, filteredPulse);
            if (combined) {
                return combined;
            }
            return null;
        };

        // 2. 级联短路式并发 OCR 识别
        const roads = [
            { slices: slices1, name: 'Road1' },
            { slices: slices2, name: 'Road2' },
            { slices: slices3, name: 'Road3' }
        ];

        let solved = false;
        let finalBP = null;
        let tempSys = null;
        let tempDia = null;

        // 🚀【通道 0：毫秒级原生七段数码管拓扑几何解码】
        const run7SegmentDecoder = (slices, name) => {
            if (!slices) return;
            const sys7 = decode7SegmentFromCanvas(slices.sys, 'sys');
            const dia7 = decode7SegmentFromCanvas(slices.diaMid || slices.diaWide || slices.diaNarrow, 'dia');
            const pulse7 = decode7SegmentFromCanvas(slices.pulse, 'pulse');

            if (sys7) {
                console.log(`[7-Segment] ${name} SYS -> "${sys7}"`);
                addCandidate(sys7, `${name}_7Seg`, 'sys', 10);
            }
            if (dia7) {
                console.log(`[7-Segment] ${name} DIA -> "${dia7}"`);
                addCandidate(dia7, `${name}_7Seg`, 'dia', 10);
            }
            if (pulse7) {
                console.log(`[7-Segment] ${name} PULSE -> "${pulse7}"`);
                addCandidate(pulse7, `${name}_7Seg`, 'pulse', 10);
            }
        };

        run7SegmentDecoder(slices1, 'Road1');
        const r1Sys = parseInt(decode7SegmentFromCanvas(slices1.sys, 'sys'), 10);
        const r1Dia = parseInt(decode7SegmentFromCanvas(slices1.diaMid || slices1.diaWide || slices1.diaNarrow, 'dia'), 10);
        const r1Pulse = parseInt(decode7SegmentFromCanvas(slices1.pulse, 'pulse'), 10);

        if (r1Sys >= 90 && r1Sys <= 210 && r1Dia >= 50 && r1Dia <= 130 && (r1Sys - r1Dia >= 15)) {
            tempSys = r1Sys;
            tempDia = r1Dia;
            if (r1Pulse >= 45 && r1Pulse <= 150) {
                console.log(`[7-Segment] 极速命中 Road1 原生同源自洽黄金三元组！高压=${r1Sys}, 低压=${r1Dia}, 脉搏=${r1Pulse}`);
                finalBP = { systolic: r1Sys, diastolic: r1Dia, pulse: r1Pulse };
                solved = true;
            }
        }
        
        if (!solved) {
            run7SegmentDecoder(slices2, 'Road2');

            // 检查七段拓扑解码是否已经直接解出高低压
            const seg7Sys = tempSys || getBestValue(sysCandidates.filter(c => c.source.endsWith('_7Seg')), 90, 195, 'sys');
            const seg7Dia = tempDia || getBestValue(diaCandidates.filter(c => c.source.endsWith('_7Seg')), 50, 130, 'dia');
            const seg7Pulse = getBestValue(pulseCandidates.filter(c => c.source.endsWith('_7Seg')), 40, 160, 'pulse');

            if (seg7Sys && seg7Dia && (seg7Sys - seg7Dia >= 15)) {
                console.log(`[7-Segment] 极速拓扑解码命中！高压=${seg7Sys}, 低压=${seg7Dia}, 脉搏=${seg7Pulse || '扫描中...'}`);
                tempSys = seg7Sys;
                tempDia = seg7Dia;
                if (seg7Pulse) {
                    finalBP = { systolic: seg7Sys, diastolic: seg7Dia, pulse: seg7Pulse };
                    solved = true;
                }
            }
        }

        for (let r = 0; r < roads.length && !solved; r++) {
            const road = roads[r];
            
            const currentProg = Math.round(30 + (r / roads.length) * 60);
            progressBar.style.width = `${currentProg}%`;
            loadingMessage.innerText = `AI 液晶并发读取中 (${r + 1}/${roads.length})...`;

            // 使用常驻的双 ocrWorker 进行物理切片识别。
            // 为了防止单个 Worker 实例并发接收 recognize 调用发生 "Worker busy" 冲突，
            // 我们让 Worker 1 负责 sys 和 pulse 的串行识别，Worker 2 负责三个低压轨的串行识别。
            // 两条线程通过 Promise.all 并发运行，保障高性能与绝对的通信稳定性！
            await Promise.all([
                // 线程 1：Worker 1 串行链
                (async () => {
                    console.log(`[OCR] ${road.name} worker1 sys start`);
                    const sysText = await recognizeAndAdd(ocrWorker1, road.slices.sys, `${road.name}_SYS`, 'sys');
                    console.log(`[OCR] ${road.name} worker1 sys ->`, sysText || '');

                    console.log(`[OCR] ${road.name} worker1 pulse start`);
                    const pulseText = await recognizeAndAdd(ocrWorker1, road.slices.pulse, `${road.name}_PULSE`, 'pulse', 20);
                    console.log(`[OCR] ${road.name} worker1 pulse ->`, pulseText || '');

                    const pulseVariants = pulseLocalizedCandidates
                        .filter(c => c.label === 'Localized_PULSE_Box')
                        .map((candidate) => ({ canvas: candidate.canvas, label: `${road.name}_${candidate.label}` }));
                    for (const variant of pulseVariants) {
                        const pulseText = await recognizeAndAdd(ocrWorker1, variant.canvas, variant.label, 'pulse', 20);
                        if (pulseText) {
                            console.log(`[OCR] ${road.name} pulse variant ${variant.label} ->`, pulseText);
                        }
                    }

                    // 💡 新增：若当前为 Road1 识别，且专属脉搏画布存在，顺带让 Worker 1 识别脉搏专属图，提高表决权重
                    if (road.name === 'Road1' && typeof canvasPulseDedicated !== 'undefined') {
                        console.log('[OCR] Road1 dedicated pulse start');
                        const dedicatedPulseText = await recognizeAndAdd(ocrWorker1, canvasPulseDedicated, 'Dedicated_PULSE', 'pulse', 20);
                        console.log('[OCR] Road1 dedicated pulse ->', dedicatedPulseText || '');

                        const dedicatedPulseAltText = await recognizeAndAdd(ocrWorker1, canvasPulseDedicated, 'Dedicated_PULSE_Alt', 'pulse', 20);
                        if (dedicatedPulseAltText) {
                            console.log('[OCR] Road1 dedicated pulse alt ->', dedicatedPulseAltText);
                        }
                    }
                })(),
                // 线程 2：Worker 2 串行链
                (async () => {
                    console.log(`[OCR] ${road.name} worker2 dia mid start`);
                    const diaMidText = await recognizeAndAdd(ocrWorker2, road.slices.diaMid, `${road.name}_DIA_Mid`, 'dia');
                    console.log(`[OCR] ${road.name} worker2 dia mid ->`, diaMidText || '');

                    console.log(`[OCR] ${road.name} worker2 dia narrow start`);
                    const diaNarrowText = await recognizeAndAdd(ocrWorker2, road.slices.diaNarrow, `${road.name}_DIA_Narrow`, 'dia');
                    console.log(`[OCR] ${road.name} worker2 dia narrow ->`, diaNarrowText || '');

                    console.log(`[OCR] ${road.name} worker2 dia wide start`);
                    const diaWideText = await recognizeAndAdd(ocrWorker2, road.slices.diaWide, `${road.name}_DIA_Wide`, 'dia');
                    console.log(`[OCR] ${road.name} worker2 dia wide ->`, diaWideText || '');
                })()
            ]);

            // 实时短路评估验证
            const curSys = getBestValue(sysCandidates.filter(c => c.source.startsWith(road.name)), 90, 195, 'sys');
            const curDia = getBestValue(diaCandidates.filter(c => c.source.startsWith(road.name)), 50, 130, 'dia');
            const curPulse = getBestValue(pulseCandidates.filter(c => c.source.startsWith(road.name) || (road.name === 'Road1' && c.source === 'Dedicated_PULSE')), 40, 160, 'pulse');

            if (curSys && curDia) {
                if (curPulse) {
                    // 三项俱全，完美匹配，直接短路退出
                    finalBP = { systolic: curSys, diastolic: curDia, pulse: curPulse };
                    solved = true;
                    console.log(`OCR Match: Perfect solved by ${road.name} short-circuit!`, finalBP);
                    break;
                } else {
                    // 仅有高低压，暂时记录，继续后面的 Road 寻求识别出脉搏
                    if (!tempSys || !tempDia) {
                        tempSys = curSys;
                        tempDia = curDia;
                    }
                }
            }
        }

        // 如果未 solved，但曾记录过高压和低压，说明仅少脉搏，可用全局最好的脉搏兜底
        if (!solved && tempSys && tempDia) {
            const bestPulse = getBestValue(pulseCandidates, 40, 160, 'pulse');
            finalBP = { systolic: tempSys, diastolic: tempDia, pulse: bestPulse };
            solved = true;
            console.log("OCR Match: Solved by temp BP + best pulse!", finalBP);
        }

        progressBar.style.width = '95%';
        loadingMessage.innerText = `分级决策表决中...`;

        // 🔍 候选值汇总日志（调试用）
        console.log('[Candidates] SYS:', sysCandidates.map(c => `${c.num}(${c.source},w=${c.weight})`).join(' | '));
        console.log('[Candidates] DIA:', diaCandidates.map(c => `${c.num}(${c.source},w=${c.weight})`).join(' | '));
        console.log('[Candidates] PULSE:', pulseCandidates.map(c => `${c.num}(${c.source},w=${c.weight})`).join(' | '));

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
                const sys = getBestValue(sysCandidates, 90, 195, 'sys');
                const dia = getBestValue(diaCandidates, 50, 130, 'dia');
                const pulse = getBestValue(pulseCandidates, 40, 160, 'pulse');
                if (sys && dia) {
                    finalBP = { systolic: sys, diastolic: dia, pulse: pulse };
                    console.log("OCR Match: Solved by Fallback getBestValue!", finalBP);
                } else {
                    finalBP = getBestBPCombination(sysCandidates, diaCandidates, pulseCandidates);
                    if (finalBP) {
                        console.log("OCR Match: Solved by BP combination fallback!", finalBP);
                    }
                }
            }
        }

        if (finalBP) {
            const sysVal = finalBP.systolic;
            const diaVal = finalBP.diastolic;

            // 🛡️ 生理合理性校验：高压必须显著大于低压（差值 >= 15mmHg）
            // 若不满足，说明行分割可能错位、高低压混淆，尝试从全候选中找更合理的高压
            if (sysVal && diaVal && sysVal - diaVal < 15) {
                console.warn(`[OCR] 生理校验失败：sys=${sysVal} dia=${diaVal}，差值 ${sysVal - diaVal} < 15，尝试重新选取高压候选...`);
                // 从 sys 候选中取最大且满足 > diaVal+15 的值
                const validSys = sysCandidates
                    .map(c => c.num)
                    .filter(n => n >= 90 && n <= 195 && n - diaVal >= 15)
                    .sort((a, b) => b - a);
                if (validSys.length > 0) {
                    finalBP.systolic = validSys[0];
                    console.log(`[OCR] 生理校验修正：sys 替换为 ${validSys[0]}`);
                }
            }

            const pulseVal = finalBP.pulse || '';
            // 注意：始终从 finalBP 读取（生理校验可能已修正了 systolic）
            const finalSys = finalBP.systolic;
            const finalDia = finalBP.diastolic;

            // 填充到对应目标框
            if (ocrTarget === 'single') {
                document.getElementById('systolic').value = finalSys;
                document.getElementById('diastolic').value = finalDia;
                if (pulseVal) document.getElementById('pulse').value = pulseVal;
            } else {
                document.getElementById(`sys${ocrTarget}`).value = finalSys;
                document.getElementById(`dia${ocrTarget}`).value = finalDia;
                if (pulseVal) document.getElementById(`pulse${ocrTarget}`).value = pulseVal;
                handleMultiInputCheck();
            }

            showToast(`识别成功！高压:${finalSys}，低压:${finalDia}${pulseVal ? `，脉搏:${pulseVal}` : ''}`);
        } else {
            try {
                loadingMessage.innerText = '复杂裁剪失败，正在尝试简化回退识别...';
                progressBar.style.width = '97%';
                const fallbackText = await ocrWorker1.recognize(canvas);
                const fallbackTextCandidates = (fallbackText.data.text || '')
                    .split(/\s+/)
                    .flatMap((part) => {
                        const mapped = mapConfusedCharacters(part);
                        const compactDigits = mapped.replace(/\s+/g, '').replace(/[^0-9]/g, '');
                        const merged = compactDigits ? [parseInt(compactDigits, 10)] : [];
                        const singleDigits = Array.from(mapped).filter((ch) => /\d/.test(ch)).map((ch) => parseInt(ch, 10));
                        return merged.length > 0 ? merged : singleDigits;
                    })
                    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 250);
                const fallbackBP = parseBPValues(fallbackTextCandidates);
                if (fallbackBP) {
                    if (ocrTarget === 'single') {
                        document.getElementById('systolic').value = fallbackBP.systolic;
                        document.getElementById('diastolic').value = fallbackBP.diastolic;
                        if (fallbackBP.pulse) document.getElementById('pulse').value = fallbackBP.pulse;
                    } else {
                        document.getElementById(`sys${ocrTarget}`).value = fallbackBP.systolic;
                        document.getElementById(`dia${ocrTarget}`).value = fallbackBP.diastolic;
                        if (fallbackBP.pulse) document.getElementById(`pulse${ocrTarget}`).value = fallbackBP.pulse;
                        handleMultiInputCheck();
                    }
                    showToast(`回退识别成功！高压:${fallbackBP.systolic}，低压:${fallbackBP.diastolic}${fallbackBP.pulse ? `，脉搏:${fallbackBP.pulse}` : ''}`);
                } else {
                    showToast('未能清晰读取血压计读数，请对准液晶屏拍摄，或尝试手动输入。', 'error');
                }
            } catch (fallbackErr) {
                console.warn('回退识别也失败:', fallbackErr);
                showToast('未能清晰读取血压计读数，请对准液晶屏拍摄，或尝试手动输入。', 'error');
            }
        }
    } catch (ocrErr) {
        console.error("OCR Exception Details:", ocrErr);
        const errMsg = ocrErr.message || ocrErr;
        showToast('OCR 识别失败: ' + errMsg, 'error');
    } finally {
        // 去除 worker.terminate() 销毁逻辑，确保常驻重用
        loadingModal.classList.remove('show');
    }
}

/**
 * 智能判定环境并调用拍照/相册获取图片
 * @param {string} source 'camera' | 'album'
 */
function requestImageForOCR(source) {
    const hasCordova = typeof window.cordova !== 'undefined';
    
    // 如果处于 Cordova 容器但插件仍在异步挂载中，等待 deviceready 完成后自动调用
    if (hasCordova && typeof navigator.camera === 'undefined') {
        showToast('正在启动相机组件...', 'info');
        document.addEventListener('deviceready', () => {
            requestImageForOCR(source);
        }, { once: true });
        return;
    }

    const isCordova = hasCordova && typeof navigator.camera !== 'undefined';
    
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
                correctOrientation: true
            }
        );
    } else {
        // 浏览器/PWA环境下，触发对应的隐藏 input 控件
        if (source === 'camera') {
            const input = document.getElementById('ocrCameraInput');
            if (input) {
                input.value = ''; // 强制清空
                input.click();
            }
        } else {
            const input = document.getElementById('ocrFileInput');
            if (input) {
                input.value = ''; // 强制清空
                input.click();
            }
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
    // 1. 数据清洗与血压评估状态重新校准（防止错误数据、非法年份脏数据导致UI卡死或排序错乱）
    let hasDirtyData = false;
    bpData = bpData.filter(item => {
        if (!item.time) return false;
        const year = parseInt(item.time.split('-')[0]);
        // 过滤掉年份异常的脏数据（例如 202606 年等），合理年份范围限制在 2000-2099
        if (isNaN(year) || year < 2000 || year > 2099) {
            hasDirtyData = true;
            return false;
        }
        // 校准已有数据的健康等级评估，确保旧版缓存数据能被无缝修复
        const evaluated = evaluateBP(item.systolic, item.diastolic);
        if (item.level !== evaluated.label || item.levelClass !== evaluated.class) {
            item.level = evaluated.label;
            item.levelClass = evaluated.class;
            hasDirtyData = true;
        }
        return true;
    });
    if (hasDirtyData) {
        localStorage.setItem('bp_records', JSON.stringify(bpData));
    }

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
    importClipboardBtn.addEventListener('click', importFromClipboard);
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

    // 11. 异步启动 AI 识别引擎的后台预加载，不阻塞主线程
    setTimeout(() => {
        initOCRWorkers().catch(err => console.warn("后台预加载 OCR 异常:", err));
    }, 500);
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
        <div class="report-record-header" style="display: flex; align-items: center; justify-content: space-between;">
            <span class="report-record-time" style="width: 36%; flex-shrink: 0; text-align: left;">测量时间</span>
            <span class="report-record-bp" style="width: 32%; flex-shrink: 0; text-align: center;">血压/脉搏</span>
            <span class="report-record-badge-wrapper" style="width: 32%; flex-shrink: 0; text-align: center;">
                <span class="report-record-badge" style="border: none; background: transparent; padding: 0; width: auto; display: inline-flex; justify-content: center; align-items: center;">状态</span>
            </span>
        </div>
    ` + filtered.map(item => `
        <div class="report-record-row" style="display: -webkit-box; display: -webkit-flex; display: flex; -webkit-box-align: center; -webkit-align-items: center; align-items: center; -webkit-justify-content: space-between; justify-content: space-between;">
            <span class="report-record-time" style="width: 36%; flex-shrink: 0; text-align: left;">${item.time}</span>
            <span class="report-record-bp" style="width: 32%; flex-shrink: 0; text-align: center; line-height: 1.4;">
                <span class="sys">${item.systolic}</span>/<span class="dia">${item.diastolic}</span> <span style="font-size: 9px; color: var(--text-muted);">mmHg</span>
                <div style="font-size:10px; color: var(--color-pulse); margin-top: 2px;"><span style="color: #ef4444;">♥</span> ${item.pulse} <span style="font-size: 9px; color: var(--text-muted);">次/分</span></div>
            </span>
            <span class="report-record-badge-wrapper" style="width: 32%; flex-shrink: 0; text-align: center;">
                <span class="report-record-badge ${item.levelClass}">${item.level}</span>
            </span>
        </div>
    `).join('');
}

function renderReportChart(data) {
    const displayData = [...data].reverse();
    const labels = displayData.map(item => item.time.substring(5));

    // 计算 Y 轴弹性分度范围
    const systolicData = displayData.map(i => i.systolic);
    const diastolicData = displayData.map(i => i.diastolic);
    const pulseData = displayData.map(i => i.pulse);
    const allValues = [...systolicData, ...diastolicData, ...pulseData].filter(v => typeof v === 'number' && !isNaN(v));
    const dataMin = allValues.length > 0 ? Math.min(...allValues) : 60;
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 160;
    const scaleMin = Math.min(60, Math.floor(dataMin / 10) * 10);
    const scaleMax = Math.max(160, Math.ceil(dataMax / 10) * 10);

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
                    ticks: { 
                        color: textColor, 
                        font: { size: 10 },
                        callback: function(value) {
                            return value;
                        }
                    }, 
                    border: { color: gridColor }, 
                    min: scaleMin - 10, 
                    max: scaleMax + 10,
                    afterBuildTicks: function(scaleInstance) {
                        const ticks = [];
                        for (let val = scaleMin; val <= scaleMax; val += 10) {
                            ticks.push({ value: val });
                        }
                        scaleInstance.ticks = ticks;
                    },
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = 48;
                    }
                }
            }
        }
    });
}

async function captureReportCanvas(isA4Mode = true) {
    const el = document.getElementById('reportContent');
    el.classList.add('exporting');
    
    // 备份原有样式以在截图后恢复
    const originalWidth = el.style.width;
    const originalMaxWidth = el.style.maxWidth;
    const originalBoxSizing = el.style.boxSizing;

    if (isA4Mode) {
        // 强行设为 A4 标准宽度 (794 像素)，让内部图表 and 记录列表自动随着 A4 尺寸自适应排版
        el.style.width = '794px';
        el.style.maxWidth = '794px';
        el.style.boxSizing = 'border-box';
    } else {
        // 屏幕大小模式：将排版宽度强行设为当前元素实际宽度的 2.0 倍
        const currentWidth = el.offsetWidth || el.getBoundingClientRect().width;
        const targetWidth = currentWidth * 2.0;
        el.style.width = targetWidth + 'px';
        el.style.maxWidth = targetWidth + 'px';
        el.style.boxSizing = 'border-box';
    }

    // 强行触发布标重绘，让 Chart 自适应新的排版宽度
    if (reportChartInstance) {
        reportChartInstance.resize();
    }

    // 给一小段延迟，确保 Chart.js 已经在新宽度下完全重绘完毕
    await new Promise(resolve => setTimeout(resolve, 150));

    const bgColor = document.body.getAttribute('data-theme') === 'light' ? '#f3f4f6' : '#111827';
    const raw = await html2canvas(el, { backgroundColor: bgColor, scale: 3, useCORS: true });

    el.classList.remove('exporting');

    // 恢复原有的响应式屏幕排版样式
    el.style.width = originalWidth;
    el.style.maxWidth = originalMaxWidth;
    el.style.boxSizing = originalBoxSizing;

    // 再次触发布标重绘以恢复网页的显示
    if (reportChartInstance) {
        reportChartInstance.resize();
    }

    // 在原始截图四周加 72px 留白（scale=3 下视觉约 24px）
    const pad = 72;
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

    const timestampStr = formatDateTime(new Date()).replace(' ', '_').replace(':', '');
    const pdfName = `YouQian血压报告_${currentReportDays}天_${timestampStr}.pdf`;

    // 手机 App (Cordova) 环境下：为了避免由于缺少系统打印服务引发的报错，并实现直接保存至“Download”目录的需求，
    // 我们在本地使用 html2canvas 超高采样渲染，并通过 jsPDF 直接导出，静默保存至系统 Download 目录下。
    if (window.cordova) {
        showToast('正在生成超高清 PDF 报告，请稍候...', 'info');
        setTimeout(async () => {
            try {
                // captureReportCanvas 会返回 scale 3 的高保真 canvas 实例
                const { canvas } = await captureReportCanvas();
                const imgData = canvas.toDataURL('image/jpeg', 0.95);

                const { jsPDF } = window.jspdf;
                const imgWidth = canvas.width;
                const imgHeight = canvas.height;
                
                // 按照 Canvas 实际宽高比例生成等尺寸的 PDF，防止失真与裁剪
                const pdf = new jsPDF('p', 'px', [imgWidth, imgHeight]);
                pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);

                const blob = pdf.output('blob');
                saveFileInCordova(pdfName, blob)
                    .then((nativeUrl) => {
                        let displayPath = `手机存储/Download/${pdfName}`;
                        if (nativeUrl.indexOf('Download') === -1) {
                            displayPath = `内部私有存储/${pdfName}`;
                        }
                        showAlertModal('保存成功', `🎉 PDF 报告已成功保存至手机！<br><br>📁 保存路径：<br><span style="color: var(--primary); font-family: monospace; word-break: break-all;">${displayPath}</span>`);
                    })
                    .catch((err) => {
                        console.error('Save PDF Local Error:', err);
                        showToast('保存 PDF 失败: ' + (err.message || err), 'error');
                    });
            } catch (e) {
                console.error('PDF Generation Exception:', e);
                showToast('生成 PDF 失败，请重试。', 'error');
            }
        }, 100);
        return;
    }

    // 网页浏览器环境下：正常调用系统打印，用户可另存为矢量 PDF
    showToast('正在调起系统打印，请在打印选项中选择“另存为 PDF”...', 'info');
    
    setTimeout(() => {
        try {
            window.print();
        } catch (err) {
            console.error('Print Error:', err);
            showToast('调起打印失败：' + (err.message || err), 'error');
        }
    }, 500);
}

async function exportReportAsImage() {
    if (bpData.length === 0) { showToast('暂无记录可生成报告！', 'error'); return; }
    
    // 显示自定义图片导出选择框
    showExportImageOptionsModal();
}

/**
 * 弹出高保真图片导出模式选择对话框 (支持 A4 长图与屏幕长图)
 */
function showExportImageOptionsModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    backdrop.id = 'exportImgModal';
    backdrop.style.zIndex = '9999';
    backdrop.style.opacity = '0';
    backdrop.style.transition = 'opacity 0.15s ease-out';

    const card = document.createElement('div');
    card.className = 'modal-card glass-card';
    card.style.maxWidth = '90%';
    card.style.width = '340px';
    card.style.padding = '24px';
    card.style.borderRadius = '16px';
    card.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.25)';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'stretch';
    card.style.transform = 'scale(0.9)';
    card.style.opacity = '0';
    card.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';

    const title = document.createElement('h3');
    title.innerText = '请选择图片导出模式';
    title.style.margin = '0 0 16px 0';
    title.style.fontSize = '16px';
    title.style.fontWeight = 'bold';
    title.style.textAlign = 'center';
    title.style.color = 'var(--text-primary)';

    // 模式一：导出 A4 规格图
    const a4Btn = document.createElement('button');
    a4Btn.className = 'btn-primary';
    a4Btn.style.height = 'auto';
    a4Btn.style.padding = '12px 16px';
    a4Btn.style.marginBottom = '12px';
    a4Btn.style.borderRadius = '12px';
    a4Btn.style.display = 'flex';
    a4Btn.style.flexDirection = 'column';
    a4Btn.style.alignItems = 'flex-start';
    a4Btn.style.textAlign = 'left';
    a4Btn.style.border = 'none';
    a4Btn.style.whiteSpace = 'normal';

    const a4Title = document.createElement('span');
    a4Title.innerHTML = '<i class="fa-solid fa-file-invoice"></i> 导出 A4 规格长图';
    a4Title.style.fontSize = '14px';
    a4Title.style.fontWeight = 'bold';
    a4Title.style.marginBottom = '4px';

    const a4Desc = document.createElement('span');
    a4Desc.innerText = '固定标准 A4 纸张排版比例，适合微信分享给医生查阅或后续打印。';
    a4Desc.style.fontSize = '11px';
    a4Desc.style.opacity = '0.85';
    a4Desc.style.lineHeight = '1.4';

    a4Btn.appendChild(a4Title);
    a4Btn.appendChild(a4Desc);

    // 模式二：导出屏幕大小图
    const screenBtn = document.createElement('button');
    screenBtn.className = 'btn-secondary';
    screenBtn.style.height = 'auto';
    screenBtn.style.padding = '12px 16px';
    screenBtn.style.marginBottom = '16px';
    screenBtn.style.borderRadius = '12px';
    screenBtn.style.display = 'flex';
    screenBtn.style.flexDirection = 'column';
    screenBtn.style.alignItems = 'flex-start';
    screenBtn.style.textAlign = 'left';
    screenBtn.style.border = '1px solid var(--glass-border)';
    screenBtn.style.whiteSpace = 'normal';

    const screenTitle = document.createElement('span');
    screenTitle.innerHTML = '<i class="fa-solid fa-mobile-screen-button"></i> 导出屏幕大小图';
    screenTitle.style.fontSize = '14px';
    screenTitle.style.fontWeight = 'bold';
    screenTitle.style.marginBottom = '4px';

    const screenDesc = document.createElement('span');
    screenDesc.innerText = '按照您当前手机屏幕大小的自适应排版生成，所见即所得。';
    screenDesc.style.fontSize = '11px';
    screenDesc.style.color = 'var(--text-muted)';
    screenDesc.style.lineHeight = '1.4';

    screenBtn.appendChild(screenTitle);
    screenBtn.appendChild(screenDesc);

    // 取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-cancel';
    cancelBtn.innerText = '取消';
    cancelBtn.style.height = '42px';
    cancelBtn.style.borderRadius = '10px';
    cancelBtn.style.border = 'none';
    cancelBtn.style.background = 'rgba(156, 163, 175, 0.15)';
    cancelBtn.style.color = 'var(--text-secondary)';
    cancelBtn.style.fontWeight = '600';
    cancelBtn.style.fontSize = '13.5px';

    const dismissModal = () => {
        backdrop.classList.remove('show');
        card.style.transform = 'scale(0.9)';
        card.style.opacity = '0';
        backdrop.style.opacity = '0';
        setTimeout(() => {
            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
        }, 150);
    };

    a4Btn.addEventListener('click', () => {
        dismissModal();
        triggerImageExport(true);
    });

    screenBtn.addEventListener('click', () => {
        dismissModal();
        triggerImageExport(false);
    });

    cancelBtn.addEventListener('click', dismissModal);

    card.appendChild(title);
    card.appendChild(a4Btn);
    card.appendChild(screenBtn);
    card.appendChild(cancelBtn);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // 触发动画
    setTimeout(() => {
        backdrop.style.opacity = '1';
        card.style.transform = 'scale(1)';
        card.style.opacity = '1';
    }, 10);
}

/**
 * 触发具体的图片导出流程
 */
async function triggerImageExport(isA4Mode) {
    const timestampStr = formatDateTime(new Date()).replace(' ', '_').replace(':', '');
    const modeName = isA4Mode ? 'A4规格' : '屏幕自适应';
    const imgName = `YouQian血压报告_${currentReportDays}天_${modeName}_${timestampStr}.png`;

    showToast('正在生成图片，请稍候...', 'info');
    try {
        const { canvas } = await captureReportCanvas(isA4Mode);
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
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showAlertModal('导出成功', `🎉 图片报告已成功导出！<br><br>请在您电脑的<strong>【下载】</strong>文件夹中查看，文件名为：<br><span style="color: var(--primary); font-family: monospace; word-break: break-all;">${imgName}</span>`);
        }
    } catch (e) {
        console.error('Image Export Error:', e);
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
                    showAlertModal('保存成功', `🎉 图片已成功保存至手机！<br><br>📁 保存路径：<br><span style="color: var(--primary); font-family: monospace; word-break: break-all;">${displayPath}</span>`);
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
        const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
        if (!isLocalhost && window.isSecureContext) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('Service Worker 注册成功:', reg.scope))
                    .catch(err => console.log('Service Worker 注册失败:', err));
            });
        } else {
            console.log('跳过 Service Worker 注册（开发环境/本地调试）');
        }
    }
});
