// sw.js 自毁注销脚本，用于彻底清理旧版本缓存并强制刷新客户端
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach((client) => {
        // 强制通知客户端进行重新加载，以载入网络上的最新资源
        client.postMessage({ action: 'clearCacheReload' });
      });
    })
  );
});

// 不拦截任何 fetch 请求，允许所有网络请求直接穿透到服务器
self.addEventListener('fetch', (e) => {
  // 直接放行，不从缓存读取
  return;
});
