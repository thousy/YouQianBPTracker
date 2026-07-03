// chart.js
// 负责血压趋势图的绘制与更新，使用全局 Chart 对象（已在 index.html 中通过 CDN 引入）
import { BP_LEVELS } from './constants.js';

let chartInstance = null;

export function renderChart(bpData, currentRange) {
    if (!bpData || bpData.length === 0) {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        return;
    }
    // 根据时间范围截取数据，注意 bpData 已经是倒序（最新在前），绘图需要正序
    let displayData = [...bpData];
    if (currentRange === '7') {
        displayData = displayData.slice(0, 7);
    } else if (currentRange === '30') {
        displayData = displayData.slice(0, 30);
    }
    displayData.reverse(); // 正序
    const labels = displayData.map(item => item.time.substring(5)); // 月-日 时:分
    const systolicData = displayData.map(item => item.systolic);
    const diastolicData = displayData.map(item => item.diastolic);
    const pulseData = displayData.map(item => item.pulse);

    // 主题颜色适配
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#9ca3af' : '#4b5563';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    const ctx = document.getElementById('trendsChart').getContext('2d');
    if (chartInstance) {
        chartInstance.destroy();
    }
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '高压 (收缩压)',
                    data: systolicData,
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244,63,94,0.05)',
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
                    backgroundColor: 'rgba(16,185,129,0.05)',
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
                    borderDash: [5,5],
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
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: textColor, boxWidth: 12, font: { size: 11, family: 'Inter' } } },
                tooltip: { padding: 12, titleFont: { size: 12, weight: 'bold' }, bodyFont: { size: 12 } }
            },
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: '血压 (mmHg)', color: textColor, font: { size: 11 } }, grid: { color: gridColor }, ticks: { color: textColor }, min: 40, max: 220 },
                y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: '脉搏 (次/分)', color: textColor, font: { size: 11 } }, grid: { drawOnChartArea: false }, ticks: { color: textColor }, min: 40, max: 160 }
            }
        }
    });
}

export function destroyChart() {
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}
