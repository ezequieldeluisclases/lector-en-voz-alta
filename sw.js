// Lector en voz alta — service worker
const VERSION = 'lector-v1';
const CORE = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'compartido' && k !== 'librerias').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Lo que se comparte desde otras apps (WhatsApp, Gmail, Archivos, Chrome…)
  if (e.request.method === 'POST' && url.pathname.endsWith('/compartir')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const c = await caches.open('compartido');
        await Promise.all((await c.keys()).map(k => c.delete(k)));
        const info = { title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', archivos: [] };
        let i = 0;
        for (const f of fd.getAll('archivos')) {
          if (!f || typeof f === 'string' || !f.size) continue;
          const key = './compartido/' + (i++);
          await c.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name || 'archivo') } }));
          info.archivos.push(key);
        }
        await c.put('./compartido/info', new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } }));
      } catch (err) {}
      return Response.redirect('./?compartido=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;

  // Librerías externas (PDF, Word, reconocimiento de texto): se guardan para usarlas sin internet
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata/.test(url.host + url.pathname)) {
    e.respondWith(caches.open('librerias').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }));
    return;
  }

  // Archivos propios de la app: primero la red, si no hay, lo guardado
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  }
});
