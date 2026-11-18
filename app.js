// Lector en voz alta — creado por Ezequiel de Luis
'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('lector.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lector.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('lector.' + k); } catch (e) {} }
};
const CFG = window.LECTOR_CONFIG || {};
function status(id, msg, err, busy) {
  const el = $('#st-' + id); if (!el) return;
  el.className = 'status' + (err ? ' err' : '');
  el.innerHTML = (busy ? '<span class="spin"></span>' : '') + (msg || '');
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function stripHtml(h) {
  const doc = new DOMParser().parseFromString(String(h).replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '$&\n'), 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach(n => n.remove());
  return doc.body ? doc.body.textContent : '';
}
function limpiar(t) {
  return String(t).replace(/\r/g, '').replace(/ /g, ' ')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([^\n.!?:;»”)\]])\n(?!\n)/g, '$1 ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]*[-–•*·][ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
function limpiarMarkdown(t) {
  return String(t)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, m => m.replace(/\|/g, ' ').replace(/-{3,}/g, ''))
    .replace(/^[=\-]{3,}$/gm, '');
}

// ---------- pestañas ----------
document.querySelectorAll('.tabs button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    ['archivo', 'gmail', 'drive', 'web'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  };
});
function irA(tab) { const b = document.querySelector('.tabs button[data-tab="' + tab + '"]'); if (b) b.click(); }

// ---------- instalación ----------
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; $('#cardInstalar').classList.remove('hidden'); });
$('#btnInstalar').onclick = async () => { if (!promptInstalar) return; promptInstalar.prompt(); await promptInstalar.userChoice; promptInstalar = null; $('#cardInstalar').classList.add('hidden'); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// =====================================================================
// LECTURA DE ARCHIVOS
// =====================================================================
const fileIn = $('#file');
fileIn.onchange = e => { if (e.target.files[0]) abrirArchivo(e.target.files[0], 'archivo'); fileIn.value = ''; };
const drop = $('#drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => e.preventDefault()));
drop.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) abrirArchivo(f, 'archivo'); });

async function textoDeArchivo(f, st) {
  const nombre = f.name || 'archivo';
  const ext = (nombre.split('.').pop() || '').toLowerCase();
  const tipo = f.type || '';
  if (tipo === 'application/pdf' || ext === 'pdf') return await leerPDF(f, st);
  if (ext === 'docx' || tipo.includes('wordprocessingml')) return (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
  if (tipo.startsWith('image/') || /^(jpe?g|png|webp|heic|gif|bmp)$/.test(ext)) return await leerImagen(f, st);
  if (ext === 'html' || ext === 'htm' || tipo === 'text/html') return stripHtml(await f.text());
  if (ext === 'md') return limpiarMarkdown(await f.text());
  if (ext === 'doc' || ext === 'odt' || ext === 'rtf' || tipo === 'application/msword') throw new Error('Este formato viejo no se puede abrir directo. Guardalo como .docx o PDF y probá de nuevo.');
  if (tipo.startsWith('text/') || ext === 'txt' || ext === 'csv') return await f.text();
  throw new Error('No sé leer este tipo de archivo (' + esc(ext || tipo) + ').');
}
async function abrirArchivo(f, st) {
  st = st || 'archivo';
  status(st, 'Leyendo «' + esc(f.name || 'archivo') + '»…', false, true);
  try {
    const t = limpiar(await textoDeArchivo(f, st));
    if (!t) throw new Error('No encontré texto para leer en este archivo.');
    status(st, '');
    mostrarDocumento((f.name || 'Archivo').replace(/\.[^.]+$/, ''), t);
    return true;
  } catch (e) { status(st, e.message || 'No pude abrir el archivo.', true); return false; }
}

// --- PDF ---
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
async function leerPDF(f, st) {
  const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
  const partes = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    status(st, 'Leyendo página ' + i + ' de ' + pdf.numPages + '…', false, true);
    const pg = await pdf.getPage(i);
    const c = await pg.getTextContent();
    // armar renglones con su altura en la página
    const lineas = []; let txt = '', y0 = null, alto = 0;
    const cerrar = () => { if (txt.trim()) lineas.push({ t: txt.trim(), y: y0, h: alto }); txt = ''; y0 = null; alto = 0; };
    for (const it of c.items) {
      const y = it.transform ? it.transform[5] : null;
      if (y0 !== null && y !== null && Math.abs(y - y0) > 2) cerrar();
      if (it.str) { if (y0 === null) y0 = y; txt += it.str; alto = Math.max(alto, it.height || Math.abs(it.transform ? it.transform[3] : 0) || 0); }
      if (it.hasEOL) cerrar();
    }
    cerrar();
    // separación habitual entre renglones: si un salto es bastante mayor, es un párrafo nuevo
    const saltos = [];
    for (let k = 1; k < lineas.length; k++) { const d = lineas[k - 1].y - lineas[k].y; if (d > 0) saltos.push(d); }
    saltos.sort((a, b) => a - b);
    const normal = saltos.length ? saltos[Math.floor(saltos.length / 2)] : 0;
    let out = '';
    lineas.forEach((l, k) => {
      if (k === 0) { out = l.t; return; }
      const d = lineas[k - 1].y - l.y;
      const vineta = /^([-–•*·]|\d+[.)]|[a-zA-Z][.)])\s/.test(l.t);
      const nuevoParrafo = vineta || d <= 0 || (normal && d > normal * 1.45);
      out += (nuevoParrafo ? '\n\n' : '\n') + l.t;
    });
    if (out.replace(/\s/g, '').length < 20) {   // página escaneada
      status(st, 'La página ' + i + ' es una imagen: reconociendo el texto…', false, true);
      const vp = pg.getViewport({ scale: 2 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      out = await ocr(cv, st, 'página ' + i);
    }
    partes.push(out.trim());
  }
  return partes.join('\n\n');
}

// --- Fotos: reconocimiento de texto en el propio teléfono ---
let lectorOCR = null, ocrProgreso = null;
function cargarScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function obtenerOCR() {
  if (!lectorOCR) lectorOCR = (async () => {
    if (!window.Tesseract) await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    return await Tesseract.createWorker('spa', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int',
      logger: m => ocrProgreso && ocrProgreso(m)
    });
  })().catch(e => { lectorOCR = null; throw new Error('No pude preparar el reconocimiento de texto. La primera vez hace falta internet.'); });
  return lectorOCR;
}
async function prepararImagen(blob) {
  const bmp = await createImageBitmap(blob);
  const max = 2200, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  // gris + contraste para fotos de hojas
  const d = cx.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128)); p[i] = p[i + 1] = p[i + 2] = g; }
  cx.putImageData(d, 0, 0);
  return cv;
}
async function ocr(img, st, cual) {
  ocrProgreso = m => { if (m.status === 'recognizing text') status(st, 'Reconociendo texto' + (cual ? ' (' + cual + ')' : '') + '… ' + Math.round(m.progress * 100) + '%', false, true); else if (/load|initializ/.test(m.status)) status(st, 'Preparando el reconocimiento de texto…', false, true); };
  const w = await obtenerOCR();
  const r = await w.recognize(img);
  return r.data.text || '';
}
async function leerImagen(f, st) {
  let img; try { img = await prepararImagen(f); } catch (e) { throw new Error('No pude abrir esta imagen. Probá con una foto JPG o PNG.'); }
  const t = await ocr(img, st);
  if (t.replace(/\s/g, '').length < 8) throw new Error('No encontré texto en la foto. Probá con más luz y la hoja derecha.');
  return t;
}

// =====================================================================
// WEB Y TEXTO
// =====================================================================
$('#leerPegado').onclick = () => {
  const raw = $('#pegado').value.trim(); if (!raw) return;
  if (/^https?:\/\/\S+$/.test(raw)) { $('#url').value = raw; leerWeb(); return; }
  mostrarDocumento('Texto pegado', limpiar(raw)); arrancar();
};
$('#leerWeb').onclick = () => leerWeb();
$('#url').addEventListener('keydown', e => { if (e.key === 'Enter') leerWeb(); });

function filtroWeb(md) {   // saca menús, casillas y renglones que son casi solo enlaces
  return md.split('\n').filter(l => {
    const s = l.trim(); if (!s) return true;
    if (/^[-*]\s*\[[ x]\]/i.test(s)) return false;
    const enlaces = (s.match(/\[[^\]]*\]\([^)]*\)/g) || []).join('').length;
    return enlaces <= s.length * 0.6;
  }).join('\n');
}
async function textoDeWeb(url) {
  // 1) lector de páginas que devuelve solo el contenido principal
  // primero solo el artículo principal; si la página no tiene, la página entera
  for (const extra of [{ 'X-Target-Selector': 'article, main, [role=main]' }, {}]) {
    try {
      const r = await fetch('https://r.jina.ai/' + url, { headers: Object.assign({ 'Accept': 'text/plain', 'X-Return-Format': 'markdown', 'X-Retain-Images': 'none', 'X-Remove-Selector': 'nav, header, footer, aside, form, button, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .menu, .sidebar, .share, .social, .mw-editsection, .navbox, .reference, sup, .vector-page-toolbar, .vector-menu, .cookie, #cookie' }, extra) });
      if (!r.ok) continue;
      const t = await r.text();
      const titulo = (t.match(/^Title:\s*(.+)$/m) || [])[1] || '';
      const cuerpo = filtroWeb(t.split(/^Markdown Content:\s*$/m)[1] || t);
      if (cuerpo.replace(/\s/g, '').length > 80) return { titulo, texto: limpiarMarkdown(cuerpo) };
    } catch (e) {}
  }
  // 2) respaldo: la página completa, quedándonos con los párrafos
  const r2 = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
  if (!r2.ok) throw new Error('La página no respondió.');
  const doc = new DOMParser().parseFromString(await r2.text(), 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,iframe').forEach(n => n.remove());
  const raiz = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const ps = [...raiz.querySelectorAll('h1,h2,h3,p,li')].map(n => n.textContent.trim()).filter(s => s.length > 30 || /^h/i.test(s));
  return { titulo: doc.title || '', texto: ps.join('\n\n') };
}
async function leerWeb(urlDada) {
  let url = (urlDada || $('#url').value).trim();
  if (!url) return;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  irA('web'); $('#url').value = url;
  status('web', 'Abriendo la página…', false, true);
  try {
    const { titulo, texto } = await textoDeWeb(url);
    const t = limpiar(texto);
    if (t.length < 40) throw new Error('No encontré texto para leer en esa página.');
    status('web', '');
    mostrarDocumento(titulo || new URL(url).hostname, t); arrancar();
  } catch (e) { status('web', (e.message || 'No pude abrir la página.') + ' Si es una página con usuario y contraseña, copiá el texto y pegalo abajo.', true); }
}

// =====================================================================
// LO COMPARTIDO DESDE OTRAS APPS
// =====================================================================
async function revisarCompartido() {
  if (!/[?&]compartido=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('compartido');
    const infoR = await c.match('./compartido/info'); if (!infoR) return;
    const info = await infoR.json();
    if (info.archivos.length) {
      irA('archivo');
      const r = await c.match(info.archivos[0]);
      const blob = await r.blob();
      const nombre = decodeURIComponent(r.headers.get('X-Nombre') || 'archivo');
      const f = new File([blob], nombre, { type: blob.type });
      if (await abrirArchivo(f, 'archivo')) arrancar();
    } else {
      const todo = [info.title, info.text, info.url].filter(Boolean).join('\n');
      const soloUrl = (info.url || '').trim() || ((info.text || '').trim().match(/^https?:\/\/\S+$/) || [])[0];
      const hayTexto = (info.text || '').replace(/https?:\/\/\S+/g, '').trim().length > 200;
      const enlace = soloUrl || (!hayTexto && (todo.match(/https?:\/\/\S+/) || [])[0]);
      if (enlace) leerWeb(enlace);
      else if (todo.trim()) { irA('web'); mostrarDocumento(info.title || 'Texto compartido', limpiar(info.text || todo)); arrancar(); }
    }
    await Promise.all((await c.keys()).map(k => c.delete(k)));
  } catch (e) {}
}

// =====================================================================
// GOOGLE (Gmail y Drive)
// =====================================================================
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly';
let tokenClient = null, gToken = store.get('gtoken', null), pendienteToken = null;
function tokenValido() { return gToken && gToken.exp > Date.now() + 60000; }
function cargarGIS() {
  return new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => rej(new Error('No pude cargar el acceso de Google. ¿Hay internet?'));
    document.head.appendChild(s);
  });
}
async function pedirToken(interactivo) {
  if (!CFG.googleClientId) throw new Error('La conexión con Google todavía no está configurada en esta copia de la app.');
  await cargarGIS();
  if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.googleClientId, scope: SCOPES,
    callback: r => {
      const p = pendienteToken; pendienteToken = null;
      if (r.error) { p && p.rej(new Error(r.error === 'access_denied' ? 'No diste permiso para entrar a tu cuenta.' : 'Google no dio acceso (' + r.error + ').')); return; }
      gToken = { t: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
      store.set('gtoken', gToken); store.set('gconectado', true); actualizarGoogleUI();
      p && p.res(gToken.t);
    },
    error_callback: e => { const p = pendienteToken; pendienteToken = null; p && p.rej(new Error(e && e.type === 'popup_closed' ? 'Se cerró la ventana de Google antes de terminar.' : 'No se pudo abrir la ventana de Google.')); }
  });
  return new Promise((res, rej) => {
    pendienteToken = { res, rej };
    tokenClient.requestAccessToken({ prompt: interactivo ? (store.get('gconectado', false) ? '' : 'consent') : '' , hint: store.get('gmail', undefined) });
  });
}
async function tokenGoogle() { if (tokenValido()) return gToken.t; return await pedirToken(true); }
async function gapi(url, opts = {}) {
  let t = await tokenGoogle();
  let r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401) { gToken = null; store.del('gtoken'); t = await pedirToken(true); r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } }); }
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).error.message; } catch (e) {}
    throw new Error(r.status === 403 ? 'Google no dejó entrar (' + esc(m || 'permiso') + ').' : 'Google respondió con un error' + (m ? ': ' + esc(m) : '.'));
  }
  return opts.blob ? r.blob() : (opts.text ? r.text() : r.json());
}
function actualizarGoogleUI() {
  const on = store.get('gconectado', false);
  ['gmail', 'drive'].forEach(k => { $('#' + k + 'Off').classList.toggle('hidden', on); $('#' + k + 'On').classList.toggle('hidden', !on); });
  $('#googleEstado').textContent = on ? 'Conectada' + (store.get('gmail', '') ? ': ' + store.get('gmail', '') : '.') : 'Sin conectar.';
  $('#gDesconectar').classList.toggle('hidden', !on);
}
async function conectarGoogle(st) {
  status(st, 'Abriendo Google…', false, true);
  try {
    await pedirToken(true);
    try { const p = await gapi('https://gmail.googleapis.com/gmail/v1/users/me/profile'); store.set('gmail', p.emailAddress); actualizarGoogleUI(); } catch (e) {}
    status(st, '');
    if (st === 'gmail') buscarGmail(); else buscarDrive();
  } catch (e) { status(st, e.message, true); }
}
$('#gConectar').onclick = () => conectarGoogle('gmail');
$('#dConectar').onclick = () => conectarGoogle('drive');
$('#gDesconectar').onclick = () => {
  if (gToken && window.google && google.accounts) try { google.accounts.oauth2.revoke(gToken.t); } catch (e) {}
  gToken = null; store.del('gtoken'); store.del('gconectado'); store.del('gmail'); actualizarGoogleUI();
};

// ---- Gmail ----
function b64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return s; }
function decodificar(data) { const bin = atob(b64url(data)); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; }
function texto8(data) { return new TextDecoder('utf-8').decode(decodificar(data)); }
function hdr(m, n) { const h = ((m.payload && m.payload.headers) || []).find(x => x.name.toLowerCase() === n); return h ? h.value : ''; }
function nombreRemitente(de) { const m = String(de).match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : String(de).replace(/<.*?>/, '').trim(); }
function fechaCorta(ms) { const d = new Date(+ms); const hoy = new Date(); return d.toDateString() === hoy.toDateString() ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }); }

$('#gbuscar').onclick = () => buscarGmail();
$('#gq').addEventListener('keydown', e => { if (e.key === 'Enter') buscarGmail(); });
async function buscarGmail() {
  const ul = $('#glista'); ul.innerHTML = '';
  status('gmail', 'Buscando correos…', false, true);
  try {
    const q = $('#gq').value.trim() || 'in:inbox';
    const lista = await gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=' + encodeURIComponent(q));
    const ids = (lista.messages || []).map(m => m.id);
    if (!ids.length) { status('gmail', 'No encontré correos con esa búsqueda.'); return; }
    const metas = await Promise.all(ids.map(id => gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From').catch(() => null)));
    status('gmail', '');
    metas.filter(Boolean).forEach(m => {
      const li = document.createElement('li');
      const noLeido = (m.labelIds || []).includes('UNREAD');
      li.innerHTML = '<div class="t">' + (noLeido ? '● ' : '') + esc(hdr(m, 'subject') || '(sin asunto)') + '</div><div class="s">' + esc(nombreRemitente(hdr(m, 'from'))) + ' · ' + fechaCorta(m.internalDate) + ' · ' + esc(stripHtml(m.snippet || '')) + '</div>';
      li.onclick = () => abrirCorreo(m.id);
      ul.appendChild(li);
    });
  } catch (e) { status('gmail', e.message, true); }
}
function partes(p, out = { plano: [], html: [], adj: [] }) {
  if (!p) return out;
  if (p.filename && p.body && (p.body.attachmentId || p.body.data)) out.adj.push({ nombre: p.filename, tipo: p.mimeType, id: p.body.attachmentId, data: p.body.data, tam: p.body.size });
  else if (p.mimeType === 'text/plain' && p.body && p.body.data) out.plano.push(texto8(p.body.data));
  else if (p.mimeType === 'text/html' && p.body && p.body.data) out.html.push(texto8(p.body.data));
  (p.parts || []).forEach(x => partes(x, out));
  return out;
}
function limpiarCorreo(t) {
  const lineas = t.replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lineas) {
    if (/^\s*>/.test(l)) continue;                                           // texto citado
    if (/^(El|On) .{5,120}(escribió|wrote):\s*$/i.test(l.trim())) break;      // respuesta anterior
    if (/^-{2,}\s*(Mensaje original|Original Message|Forwarded message|Mensaje reenviado)/i.test(l.trim())) { out.push('Mensaje reenviado.'); continue; }
    if (/^--\s*$/.test(l)) break;                                            // firma
    if (/^(Enviado desde|Sent from) (mi|my) /i.test(l.trim())) continue;
    out.push(l);
  }
  return out.join('\n');
}
let adjuntosActuales = [];
async function abrirCorreo(id) {
  status('gmail', 'Abriendo el correo…', false, true);
  try {
    const m = await gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=full');
    const pr = partes(m.payload);
    let cuerpo = pr.plano.length ? pr.plano.join('\n\n') : stripHtml(pr.html.join('\n'));
    cuerpo = limpiarCorreo(cuerpo);
    const asunto = hdr(m, 'subject') || 'Correo sin asunto';
    let texto = 'De: ' + nombreRemitente(hdr(m, 'from')) + '.\n\nAsunto: ' + asunto + '.\n\n' + cuerpo;
    adjuntosActuales = pr.adj.map(a => Object.assign(a, { msg: id }));
    if (adjuntosActuales.length) texto += '\n\n' + (adjuntosActuales.length === 1 ? 'Tiene un adjunto: ' : 'Tiene ' + adjuntosActuales.length + ' adjuntos: ') + adjuntosActuales.map(a => a.nombre).join(', ') + '.';
    status('gmail', '');
    mostrarDocumento(asunto, limpiar(texto), { adjuntos: adjuntosActuales });
    if (store.get('leerAdj', true) && adjuntosActuales.some(legible)) {
      const extra = [];
      for (const a of adjuntosActuales.filter(legible)) {
        try { status('gmail', 'Preparando el adjunto «' + esc(a.nombre) + '»…', false, true); const t = limpiar(await textoDeArchivo(await bajarAdjunto(a), 'gmail')); if (t) extra.push('Adjunto: ' + a.nombre.replace(/\.[^.]+$/, '') + '.\n\n' + t); } catch (e) {}
      }
      status('gmail', '');
      if (extra.length) agregarAlDocumento(extra.join('\n\n'));
    }
    arrancar();
  } catch (e) { status('gmail', e.message, true); }
}
function legible(a) { return /pdf|wordprocessingml|text\/plain|image\//.test(a.tipo || '') || /\.(pdf|docx|txt|jpe?g|png)$/i.test(a.nombre); }
async function bajarAdjunto(a) {
  let data = a.data;
  if (!data) data = (await gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + a.msg + '/attachments/' + a.id)).data;
  return new File([decodificar(data)], a.nombre, { type: a.tipo || 'application/octet-stream' });
}

// ---- Drive ----
$('#dbuscar').onclick = () => buscarDrive();
$('#dq').addEventListener('keydown', e => { if (e.key === 'Enter') buscarDrive(); });
const TIPOS_DRIVE = ["application/vnd.google-apps.document", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "image/jpeg", "image/png", "application/vnd.google-apps.presentation"];
async function buscarDrive() {
  const ul = $('#dlista'); ul.innerHTML = '';
  status('drive', 'Buscando documentos…', false, true);
  try {
    const n = $('#dq').value.trim().replace(/\\/g, '').replace(/'/g, "\\'");
    let q = 'trashed = false and (' + TIPOS_DRIVE.map(t => "mimeType = '" + t + "'").join(' or ') + ')';
    if (n) q = "name contains '" + n + "' and " + q;
    const r = await gapi('https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime)&q=' + encodeURIComponent(q));
    const fs = r.files || [];
    if (!fs.length) { status('drive', 'No encontré documentos con ese nombre.'); return; }
    status('drive', '');
    const etiqueta = t => ({ 'application/vnd.google-apps.document': 'Documento de Google', 'application/vnd.google-apps.presentation': 'Presentación de Google', 'application/pdf': 'PDF', 'text/plain': 'Texto' }[t] || (t.includes('word') ? 'Word' : t.startsWith('image/') ? 'Imagen' : t));
    fs.forEach(f => {
      const li = document.createElement('li');
      li.innerHTML = '<div class="t">' + esc(f.name) + '</div><div class="s">' + etiqueta(f.mimeType) + ' · ' + new Date(f.modifiedTime).toLocaleDateString('es-AR') + '</div>';
      li.onclick = () => abrirDrive(f);
      ul.appendChild(li);
    });
  } catch (e) { status('drive', e.message, true); }
}
async function abrirDrive(f) {
  status('drive', 'Abriendo «' + esc(f.name) + '»…', false, true);
  try {
    if (f.mimeType.startsWith('application/vnd.google-apps.')) {
      const t = await gapi('https://www.googleapis.com/drive/v3/files/' + f.id + '/export?mimeType=text/plain', { text: true });
      status('drive', '');
      mostrarDocumento(f.name, limpiar(t)); arrancar();
    } else {
      const blob = await gapi('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', { blob: true });
      if (await abrirArchivo(new File([blob], f.name, { type: f.mimeType }), 'drive')) arrancar();
    }
  } catch (e) { status('drive', e.message, true); }
}

// =====================================================================
// DOCUMENTO EN PANTALLA
// =====================================================================
let parrafos = [], idx = 0, tituloActual = '';
function dividir(texto) { return texto.split(/\n{2,}/).map(s => s.replace(/\n/g, ' ').trim()).filter(s => /[\p{L}\p{N}]/u.test(s)); }
function pintarParrafos() {
  const cont = $('#text'); cont.innerHTML = '';
  parrafos.forEach((p, i) => { const el = document.createElement('p'); el.textContent = p; el.onclick = () => { detener(); idx = i; arrancar(); }; cont.appendChild(el); });
}
function mostrarDocumento(titulo, texto, extra = {}) {
  detener();
  tituloActual = titulo;
  parrafos = dividir(texto);
  pintarParrafos();
  $('#docTitle').textContent = titulo;
  const adj = $('#adjuntos'); adj.innerHTML = '';
  (extra.adjuntos || []).forEach(a => {
    const b = document.createElement('button'); b.className = 'btn sec peq'; b.textContent = '📎 ' + a.nombre;
    b.onclick = async () => { try { status('gmail', 'Abriendo el adjunto…', false, true); if (await abrirArchivo(await bajarAdjunto(a), 'gmail')) arrancar(); } catch (e) { status('gmail', e.message, true); } };
    adj.appendChild(b);
  });
  $('#reader').classList.remove('hidden');
  $('#player').classList.remove('hidden');
  const pos = store.get('pos', {});
  idx = pos[titulo] && pos[titulo] < parrafos.length ? pos[titulo] : 0;
  marcar(true);
  $('#reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: titulo, artist: 'Lector en voz alta', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
}
function agregarAlDocumento(texto) { parrafos = parrafos.concat(dividir(texto)); pintarParrafos(); marcar(true); }
function marcar(sinScroll) {
  const ps = document.querySelectorAll('#text p');
  ps.forEach((p, i) => p.classList.toggle('cur', i === idx));
  if (ps[idx] && !sinScroll && !document.hidden) ps[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// =====================================================================
// VOCES
// =====================================================================
const synth = window.speechSynthesis || null;
const audio = $('#audio');
let voces = [];
const AZ_VOCES = [['es-AR-ElenaNeural', 'Elena — Argentina'], ['es-AR-TomasNeural', 'Tomás — Argentina']];
const PREF = ['es-AR', 'es-419', 'es-UY', 'es-US', 'es-MX', 'es-CL', 'es-CO', 'es'];
function rankVoz(v) {
  const l = (v.lang || '').replace('_', '-').toLowerCase();
  let i = PREF.findIndex(p => l.startsWith(p.toLowerCase())); if (i < 0) i = 99;
  if (/argentin/i.test(v.name)) i = -1;
  if (/natural|neural|online/i.test(v.name)) i -= 0.5;
  return i;
}
function azure() { const k = store.get('azKey', ''), r = store.get('azRegion', ''); return k && r ? { k, r } : null; }
function cargarVoces() {
  const sel = $('#voz'), prev = store.get('voz', '');
  sel.innerHTML = '';
  if (azure()) AZ_VOCES.forEach(([id, n]) => { const o = document.createElement('option'); o.value = 'az:' + id; o.textContent = n; sel.appendChild(o); });
  if (synth) {
    voces = synth.getVoices().filter(v => /^es/i.test(v.lang)).sort((a, b) => rankVoz(a) - rankVoz(b));
    const paises = { AR: 'Argentina', MX: 'México', US: 'Latinoamérica', ES: 'España', CO: 'Colombia', CL: 'Chile', UY: 'Uruguay', '419': 'Latinoamérica' };
    voces.forEach(v => {
      const o = document.createElement('option'); o.value = 'n:' + v.name;
      const pais = paises[(v.lang.split(/[-_]/)[1] || '').toUpperCase()] || v.lang;
      o.textContent = 'Teléfono — ' + pais + (/female|mujer/i.test(v.name) ? ' (mujer)' : /male|hombre/i.test(v.name) ? ' (hombre)' : '');
      sel.appendChild(o);
    });
  }
  if (!sel.options.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Sin voces'; sel.appendChild(o); }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
if (synth) synth.onvoiceschanged = cargarVoces;
$('#voz').onchange = () => { store.set('voz', $('#voz').value); reiniciarSiLee(); };
$('#vel').value = String(store.get('vel', 1));
$('#vel').onchange = () => { store.set('vel', parseFloat($('#vel').value)); if (motor === 'az') audio.playbackRate = 1; reiniciarSiLee(); };
function reiniciarSiLee() { if (leyendo) { const i = idx; detener(); idx = i; arrancar(); } }

// ---- Microsoft (voz argentina) ----
const cacheAudio = new Map();
function ssml(texto, voz, rate) {
  const pct = Math.round((rate - 1) * 100);
  const t = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<speak version="1.0" xml:lang="es-AR" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voz}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${t}</prosody></voice></speak>`;
}
function audioAzure(texto, voz, rate) {
  const key = voz + '|' + rate + '|' + texto;
  if (cacheAudio.has(key)) return cacheAudio.get(key);
  const az = azure();
  const p = fetch(`https://${az.r}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': az.k, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
    body: ssml(texto.slice(0, 3000), voz, rate)
  }).then(async r => {
    if (r.status === 401 || r.status === 403) throw new Error('clave');
    if (r.status === 429) throw new Error('limite');
    if (!r.ok) throw new Error('azure');
    return URL.createObjectURL(await r.blob());
  });
  p.catch(() => cacheAudio.delete(key));
  cacheAudio.set(key, p);
  if (cacheAudio.size > 12) { const k0 = cacheAudio.keys().next().value; cacheAudio.get(k0).then(u => URL.revokeObjectURL(u)).catch(() => {}); cacheAudio.delete(k0); }
  return p;
}
function trozosLargos(p) {   // para Microsoft: hasta ~1500 caracteres por pedido
  if (p.length <= 1500) return [p];
  const fr = p.match(/[^.!?]+[.!?]*\s*/g) || [p]; const out = []; let c = '';
  fr.forEach(f => { if ((c + f).length > 1500 && c) { out.push(c); c = ''; } c += f; });
  if (c) out.push(c); return out;
}

// ---- Voz del teléfono ----
function trozos(p) {   // frases cortas: algunos teléfonos cortan la voz en textos largos
  const fr = p.match(/[^.!?;:]+[.!?;:]*["»”)]?\s*/g) || [p]; const out = []; let cur = '';
  for (const f of fr) {
    if ((cur + f).length > 220 && cur) { out.push(cur.trim()); cur = ''; }
    if (f.length > 220) f.split(/,\s*/).forEach(x => { if ((cur + x).length > 220 && cur) { out.push(cur.trim()); cur = ''; } cur += x + ', '; });
    else cur += f;
  }
  if (cur.trim()) out.push(cur.trim().replace(/,\s*$/, ''));
  return out;
}

// =====================================================================
// REPRODUCCIÓN
// =====================================================================
let leyendo = false, token = 0, motor = 'tel';
function decir(texto, t) {
  const sel = $('#voz').value, rate = parseFloat($('#vel').value) || 1;
  if (sel.startsWith('az:') && azure()) {
    motor = 'az';
    const voz = sel.slice(3);
    return (async () => {
      const partesP = trozosLargos(texto);
      for (let i = 0; i < partesP.length; i++) {
        if (t !== token) return;
        const url = await audioAzure(partesP[i], voz, rate);
        if (i + 1 < partesP.length) audioAzure(partesP[i + 1], voz, rate);
        else if (parrafos[idx + 1]) audioAzure(trozosLargos(parrafos[idx + 1])[0], voz, rate).catch(() => {});   // adelanta el párrafo siguiente
        if (t !== token) return;
        await new Promise((res, rej) => {
          audio.onended = res; audio.onerror = () => rej(new Error('audio'));
          audio.src = url; audio.play().catch(rej);
        });
      }
    })();
  }
  motor = 'tel';
  return new Promise((res, rej) => {
    if (!synth) { rej(new Error('sinvoz')); return; }
    const ps = trozos(texto); let i = 0;
    const v = voces.find(x => 'n:' + x.name === sel) || voces[0];
    const sig = () => {
      if (t !== token || i >= ps.length) { res(); return; }
      const u = new SpeechSynthesisUtterance(ps[i++]);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-AR';
      u.rate = rate;
      u.onend = sig; u.onerror = e => { if (e.error === 'interrupted' || e.error === 'canceled') res(); else sig(); };
      synth.speak(u);
    };
    sig();
  });
}
async function arrancar() {
  if (!parrafos.length) return;
  if (synth) synth.cancel();
  if (idx >= parrafos.length) idx = 0;
  const t = ++token; leyendo = true; ui();
  pedirWakeLock(); iniciarTemporizador();
  while (leyendo && t === token && idx < parrafos.length) {
    marcar();
    const pos = store.get('pos', {}); pos[tituloActual] = idx; store.set('pos', pos);
    try { await decir(parrafos[idx], t); }
    catch (e) {
      if (t !== token) return;
      if (e.message === 'clave') avisoVoz('La clave de la voz argentina no funciona. Revisala en Ajustes. Sigo con la voz del teléfono.');
      else if (e.message === 'limite') avisoVoz('Se terminó el cupo gratuito de este mes de la voz argentina. Sigo con la voz del teléfono.');
      else if (motor === 'az') avisoVoz('No pude usar la voz argentina (¿hay internet?). Sigo con la voz del teléfono.');
      else { leyendo = false; break; }
      const op = [...$('#voz').options].find(o => o.value.startsWith('n:')); if (op) { $('#voz').value = op.value; continue; } else { leyendo = false; break; }
    }
    if (t !== token || !leyendo) return;
    idx++;
  }
  if (t === token) {
    leyendo = false; ui(); soltarWakeLock();
    if (idx >= parrafos.length) { idx = 0; const pos = store.get('pos', {}); delete pos[tituloActual]; store.set('pos', pos); marcar(true); if ($('#apagar').value === 'fin') { $('#apagar').value = '0'; } }
  }
}
function avisoVoz(m) { $('#timerInfo').textContent = m; setTimeout(() => { if ($('#timerInfo').textContent === m) $('#timerInfo').textContent = ''; actualizarTimerInfo(); }, 7000); }
function detener() {
  token++; leyendo = false;
  if (synth) synth.cancel();
  try { audio.pause(); } catch (e) {}
  ui(); soltarWakeLock();
}
function ui() {
  const b = $('#play'); b.textContent = leyendo ? '⏸' : '▶'; b.setAttribute('aria-label', leyendo ? 'Pausa' : 'Reproducir');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = leyendo ? 'playing' : 'paused';
}
$('#play').onclick = () => { leyendo ? detener() : arrancar(); };
$('#stop').onclick = () => { detener(); idx = 0; marcar(); };
$('#next').onclick = () => saltar(1);
$('#prev').onclick = () => saltar(-1);
function saltar(n) { const p = leyendo; detener(); idx = Math.max(0, Math.min(parrafos.length - 1, idx + n)); marcar(); if (p) arrancar(); }
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  try { ms.setActionHandler('play', () => arrancar()); ms.setActionHandler('pause', () => detener()); ms.setActionHandler('stop', () => detener());
    ms.setActionHandler('nexttrack', () => saltar(1)); ms.setActionHandler('previoustrack', () => saltar(-1)); } catch (e) {}
}

// ---- pantalla encendida ----
let wl = null;
async function pedirWakeLock() { if (!store.get('pantalla', false) || !('wakeLock' in navigator)) return; try { wl = await navigator.wakeLock.request('screen'); } catch (e) {} }
function soltarWakeLock() { if (wl) { wl.release().catch(() => {}); wl = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && leyendo) pedirWakeLock(); });

// ---- temporizador para apagar ----
let finTimer = 0, intTimer = null;
$('#apagar').onchange = () => { iniciarTemporizador(true); };
function iniciarTemporizador(reset) {
  const v = $('#apagar').value;
  if (v === '0' || v === 'fin') { finTimer = 0; clearInterval(intTimer); intTimer = null; actualizarTimerInfo(); return; }
  if (reset || !finTimer) finTimer = Date.now() + parseInt(v, 10) * 60000;
  clearInterval(intTimer);
  intTimer = setInterval(() => { if (finTimer && Date.now() >= finTimer) { detener(); finTimer = 0; $('#apagar').value = '0'; clearInterval(intTimer); intTimer = null; } actualizarTimerInfo(); }, 15000);
  actualizarTimerInfo();
}
function actualizarTimerInfo() {
  const v = $('#apagar').value, el = $('#timerInfo');
  if (v === 'fin') el.textContent = 'Se apaga al terminar este documento';
  else if (finTimer) el.textContent = 'Se apaga en ' + Math.max(1, Math.round((finTimer - Date.now()) / 60000)) + ' min';
  else el.textContent = '';
}

// =====================================================================
// AJUSTES
// =====================================================================
const dlg = $('#ajustes');
$('#btnAjustes').onclick = () => {
  $('#azKey').value = store.get('azKey', ''); $('#azRegion').value = store.get('azRegion', 'brazilsouth');
  $('#optPantalla').checked = store.get('pantalla', false);
  $('#optGrande').checked = store.get('grande', false);
  $('#optAdj').checked = store.get('leerAdj', true);
  status('az', ''); actualizarGoogleUI();
  dlg.showModal();
};
$('#cerrarAjustes').onclick = () => dlg.close();
$('#optPantalla').onchange = e => store.set('pantalla', e.target.checked);
$('#optGrande').onchange = e => { store.set('grande', e.target.checked); document.body.classList.toggle('grande', e.target.checked); };
$('#optAdj').onchange = e => store.set('leerAdj', e.target.checked);
$('#azBorrar').onclick = () => { store.del('azKey'); store.del('azRegion'); $('#azKey').value = ''; cargarVoces(); status('az', 'Listo, se quitó la voz argentina.'); };
$('#azProbar').onclick = async () => {
  const k = $('#azKey').value.trim(), r = $('#azRegion').value.trim().toLowerCase().replace(/\s+/g, '') || 'brazilsouth';
  if (!k) { status('az', 'Pegá la clave primero.', true); return; }
  store.set('azKey', k); store.set('azRegion', r);
  status('az', 'Probando…', false, true);
  try {
    const url = await audioAzure('Hola. Ya tengo la voz argentina lista para leerte lo que quieras.', 'es-AR-ElenaNeural', 1);
    audio.src = url; await audio.play();
    cargarVoces(); $('#voz').value = 'az:es-AR-ElenaNeural'; store.set('voz', 'az:es-AR-ElenaNeural');
    status('az', '¡Funciona! Ya podés elegir Elena o Tomás en «Voz».');
  } catch (e) {
    store.del('azKey');
    status('az', e.message === 'clave' ? 'La clave o la región no coinciden. Revisá que la región sea la misma que elegiste al crear el servicio.' : 'No pude probarla. ¿Hay internet?', true);
  }
};

// ---------- inicio ----------
document.body.classList.toggle('grande', store.get('grande', false));
cargarVoces(); actualizarGoogleUI(); revisarCompartido();
