// utils.js
// 通用工具函数
export function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function formatForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function setTimeToNow(recordTimeInput) {
    const now = new Date();
    recordTimeInput.value = formatForInput(now);
}

export function showToast(message, type = 'success') {
    const toastEl = document.getElementById('toast');
    toastEl.className = `toast-container toast-${type} show`;
    let icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'info') icon = 'fa-circle-info';
    toastEl.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    setTimeout(() => toastEl.classList.remove('show'), 2500);
}

export function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');
        msgEl.innerText = message;
        modal.classList.add('show');
        const onConfirm = () => { modal.classList.remove('show'); cleanup(); resolve(true); };
        const onCancel = () => { modal.classList.remove('show'); cleanup(); resolve(false); };
        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}
