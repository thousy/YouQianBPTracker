// measurement.js
// 门诊多次测量交互逻辑、差值计算、预览展示
export function handleMultiInputCheck() {
    const sys1Val = document.getElementById('sys1').value;
    const dia1Val = document.getElementById('dia1').value;
    const pulse1Val = document.getElementById('pulse1').value;
    const sys2Val = document.getElementById('sys2').value;
    const dia2Val = document.getElementById('dia2').value;
    const pulse2Val = document.getElementById('pulse2').value;

    const diffHintBox = document.getElementById('multiDiffHint');
    const diffHintText = document.getElementById('diffHintText');
    const thirdSection = document.getElementById('multiThirdEntry');
    const sys3Input = document.getElementById('sys3');
    const dia3Input = document.getElementById('dia3');
    const pulse3Input = document.getElementById('pulse3');
    const previewBox = document.getElementById('multiCalcPreview');

    if (sys1Val && dia1Val && sys2Val && dia2Val) {
        const s1 = parseInt(sys1Val);
        const d1 = parseInt(dia1Val);
        const s2 = parseInt(sys2Val);
        const d2 = parseInt(dia2Val);
        const sysDiff = Math.abs(s1 - s2);
        const diaDiff = Math.abs(d1 - d2);
        const needThird = sysDiff > 10 || diaDiff > 10;
        diffHintBox.style.display = 'flex';
        if (needThird) {
            diffHintBox.classList.remove('info-mode');
            diffHintText.innerHTML = `<strong style="display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-triangle-exclamation"></i> 门诊需测量第 3 次：两次测量差异较大（高压差: ${sysDiff}mmHg，低压差: ${diaDiff}mmHg，已超过 10mmHg）。请在间隔 1 分钟后进行第 3 次测量，并在下方录入。系统将取后两次平均值。</strong>`;
            thirdSection.style.display = 'flex';
            sys3Input.setAttribute('required', 'required');
            dia3Input.setAttribute('required', 'required');
            pulse3Input.setAttribute('required', 'required');
            const sys3Val = sys3Input.value;
            const dia3Val = dia3Input.value;
            const pulse3Val = pulse3Input.value;
            if (sys3Val && dia3Val) {
                const s3 = parseInt(sys3Val);
                const d3 = parseInt(dia3Val);
                const p2 = parseInt(pulse2Val) || 0;
                const p3 = parseInt(pulse3Val) || 0;
                previewBox.style.display = 'block';
                document.getElementById('previewSys').innerText = Math.round((s2 + s3) / 2);
                document.getElementById('previewDia').innerText = Math.round((d2 + d3) / 2);
                document.getElementById('previewPulse').innerText = (p2 && p3) ? Math.round((p2 + p3) / 2) : (p3 || p2 || '--');
            } else {
                previewBox.style.display = 'none';
            }
        } else {
            diffHintBox.classList.add('info-mode');
            diffHintText.innerHTML = `<strong style="display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-circle-check"></i> 差值正常：两次测量差异较小（高压差: ${sysDiff}mmHg，低压差: ${diaDiff}mmHg，均在 10mmHg 以内）。系统将直接取两次测量的平均值进行保存。</strong>`;
            thirdSection.style.display = 'none';
            sys3Input.removeAttribute('required');
            dia3Input.removeAttribute('required');
            pulse3Input.removeAttribute('required');
            sys3Input.value = '';
            dia3Input.value = '';
            pulse3Input.value = '';
            const p1 = parseInt(pulse1Val) || 0;
            const p2 = parseInt(pulse2Val) || 0;
            previewBox.style.display = 'block';
            document.getElementById('previewSys').innerText = Math.round((s1 + s2) / 2);
            document.getElementById('previewDia').innerText = Math.round((d1 + d2) / 2);
            document.getElementById('previewPulse').innerText = (p1 && p2) ? Math.round((p1 + p2) / 2) : (p2 || p1 || '--');
        }
    } else {
        diffHintBox.style.display = 'none';
        thirdSection.style.display = 'none';
        sys3Input.removeAttribute('required');
        dia3Input.removeAttribute('required');
        pulse3Input.removeAttribute('required');
        previewBox.style.display = 'none';
    }
}
