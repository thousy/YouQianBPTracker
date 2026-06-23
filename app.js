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
function saveRecord(sys, dia, pulse, dateTimeStr) {
    const levelObj = evaluateBP(sys, dia);
    const newRecord = {
        id: 'record_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        time: dateTimeStr.replace('T', ' '), // 转换为 "YYYY-MM-DD HH:mm"
        systolic: parseInt(sys),
        diastolic: parseInt(dia),
        pulse: parseInt(pulse),
        level: levelObj.label,
        levelClass: levelObj.class
    };

    bpData.unshift(newRecord); // 最新记录放最前
    // 按时间进行降序排序，保证时间线上是最新的在最前
    bpData.sort((a, b) => new Date(b.time.replace(' ', 'T')) - new Date(a.time.replace(' ', 'T')));

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
    if (bpData.length === 0) {
        avgSystolicEl.innerText = '--';
        avgDiastolicEl.innerText = '--';
        avgPulseEl.innerText = '--';
        healthSummaryTextEl.innerText = '暂无足够数据，请开始记录';
        healthSummaryIcon.className = 'fa-solid fa-circle-info';
        healthSummaryIcon.style.color = 'var(--text-muted)';
        return;
    }

    // 取最近7次（如果不足7次，取全部）
    const recentRecords = bpData.slice(0, 7);
    const sumSys = recentRecords.reduce((sum, item) => sum + item.systolic, 0);
    const sumDia = recentRecords.reduce((sum, item) => sum + item.diastolic, 0);
    const sumPulse = recentRecords.reduce((sum, item) => sum + item.pulse, 0);
    const count = recentRecords.length;

    const avgSys = Math.round(sumSys / count);
    const avgDia = Math.round(sumDia / count);
    const avgPulse = Math.round(sumPulse / count);

    avgSystolicEl.innerText = avgSys;
    avgDiastolicEl.innerText = avgDia;
    avgPulseEl.innerText = avgPulse;

    // 评估平均血压的健康等级并提供健康小建议
    const levelObj = evaluateBP(avgSys, avgDia);
    healthSummaryTextEl.innerText = `最近均值属于【${levelObj.label}】。${levelObj.desc}`;
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
        html += `
            <div class="record-card" data-id="${item.id}">
                <div class="record-info">
                    <div class="record-datetime">${item.time}</div>
                    <div class="record-nums">
                        <span class="record-bp">
                            <span class="record-bp-sys">${item.systolic}</span>
                            <span class="record-slash">/</span>
                            <span class="record-bp-dia">${item.diastolic}</span>
                        </span>
                        <span class="record-unit" style="font-size: 11px; color: var(--text-muted);">mmHg</span>
                        <span class="record-pulse-val"><i class="fa-solid fa-heart pulse-icon" style="animation:none; font-size: 11px;"></i> ${item.pulse} <span style="font-size: 10px; color: var(--text-muted);">次/分</span></span>
                    </div>
                </div>
                <div class="record-actions">
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

    // 根据选择的时间范围截取数据 (由于历史记录数组是时间倒序，绘制折线图时应该转换为时间正序)
    let displayData = [...bpData];
    if (currentRange === '7') {
        displayData = displayData.slice(0, 7);
    } else if (currentRange === '30') {
        displayData = displayData.slice(0, 30);
    }
    displayData.reverse(); // 时间正序

    const labels = displayData.map(item => item.time.substring(5)); // 只取月-日 时:分
    const systolicData = displayData.map(item => item.systolic);
    const diastolicData = displayData.map(item => item.diastolic);
    const pulseData = displayData.map(item => item.pulse);

    // 获取当前主题
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#9ca3af' : '#4b5563';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';

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
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.05)',
                    borderWidth: 3,
                    pointBackgroundColor: '#f43f5e',
                    pointRadius: 4,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: '低压 (舒张压)',
                    data: diastolicData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 3,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 4,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: '脉搏',
                    data: pulseData,
                    borderColor: '#fbbf24',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointBackgroundColor: '#fbbf24',
                    pointRadius: 3,
                    tension: 0.3,
                    yAxisID: 'y1'
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
                    padding: 12,
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 12 }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 10 } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: '血压 (mmHg)',
                        color: textColor,
                        font: { size: 11 }
                    },
                    grid: { color: gridColor },
                    ticks: { color: textColor },
                    min: 40,
                    max: 220
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: '脉搏 (次/分)',
                        color: textColor,
                        font: { size: 11 }
                    },
                    grid: { drawOnChartArea: false }, // 避免网格线冲突
                    ticks: { color: textColor },
                    min: 40,
                    max: 160
                }
            }
        }
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

        // 下载 Excel
        XLSX.writeFile(wb, fileName);
        showToast('Excel 文件导出成功！');
    } catch (err) {
        console.error(err);
        showToast('导出 Excel 失败，请重试。', 'error');
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
                bpData.sort((a, b) => new Date(b.time.replace(' ', 'T')) - new Date(a.time.replace(' ', 'T')));
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
    // 1. 设置输入框默认时间为当前时间
    setTimeToNow();

    // 2. 初始化渲染 UI
    updateUI();

    // 3. 切换时间按钮
    setCurrentTimeBtn.addEventListener('click', setTimeToNow);

    // 4. 表单提交保存
    bpForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const sys = systolicInput.value;
        const dia = diastolicInput.value;
        const pulse = pulseInput.value;
        const recordTime = recordTimeInput.value;
        
        saveRecord(sys, dia, pulse, recordTime);
        
        // 重置表单，但保留默认当前时间
        bpForm.reset();
        setTimeToNow();
    });

    // 5. 底部 Tab 切换
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');

            // 移除所有激活状态
            navItems.forEach(nav => nav.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            // 激活当前 Tab
            item.classList.add('active');
            const targetPane = document.getElementById(targetTab);
            targetPane.classList.add('active');

            // 如果切换到趋势图或历史，重新绘制图表，以避免 canvas 尺寸渲染问题
            if (targetTab === 'tab-trends' || targetTab === 'tab-history') {
                setTimeout(renderChart, 50); // 延时一小下等 DOM 显示完成
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
        themeToggleBtn.innerHTML = nextTheme === 'light' 
            ? '<i class="fa-solid fa-sun"></i>' 
            : '<i class="fa-solid fa-moon"></i>';
        
        // 重绘图表以更新线条与文字颜色
        if (chartInstance) {
            renderChart();
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
