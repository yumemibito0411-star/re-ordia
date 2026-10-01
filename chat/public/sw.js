'use strict';
// Caches the app shell so the installed app opens instantly and survives a flaky connection.
// Always tries the network first so a deploy is picked up on the next launch.
// API calls, uploaded files and the WebSocket are never cached.

const CACHE = 'chat-shell-v1';
const SHELL = ['/', '/app.css', '/app.js', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/ws') return;

  const isPage = req.mode === 'navigate';
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(isPage ? '/' : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(isPage ? '/' : req).then((hit) => hit || Response.error())),
  );
});

// Focus an open window (or open one) when a notification is clicked.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins[0];
      if (win) {
        win.navigate(target).catch(() => {});
        return win.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
