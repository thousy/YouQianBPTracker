// storage.js
// 本地存储封装
export function loadBPData() {
    const raw = localStorage.getItem('bp_records');
    return raw ? JSON.parse(raw) : [];
}

export function saveBPData(data) {
    localStorage.setItem('bp_records', JSON.stringify(data));
}
