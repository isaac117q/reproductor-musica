const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Configurar auto-updater: notificar al usuario cuando hay actualización
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Eventos del auto-updater para notificar a la ventana
autoUpdater.on('update-available', (info) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-available', info.version);
});

autoUpdater.on('update-downloaded', (info) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-downloaded', info.version);
});

// Progreso de la descarga: el botón "Actualizar" muestra el porcentaje y una
// barra de carga mientras se baja la nueva versión.
autoUpdater.on('download-progress', (p) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const pct = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)));
  win.webContents.send('update-progress', {
    percent: pct,
    transferred: p && p.transferred,
    total: p && p.total
  });
});

// La comprobación terminó y no hay versión nueva: el botón vuelve a su estado
// normal (sin punto de aviso).
autoUpdater.on('update-not-available', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-not-available');
});

autoUpdater.on('checking-for-update', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-checking');
});

autoUpdater.on('error', (err) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-error', String(err && err.message || err));
  console.error('autoUpdater error:', err && err.message || err);
});
const fsp = fs.promises;

let mainWindow = null;

// Carpeta de datos alternativa SOLO para pruebas aisladas:
//   electron . --userdata="C:\ruta\temporal"
// Se usa antes de app.whenReady(), así no se toca la lista ni los ajustes reales.
const udArg = process.argv.find(a => /^--userdata=/.test(a));
if (udArg) {
  const dir = udArg.slice('--userdata='.length).replace(/^"|"$/g, '');
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); app.setPath('userData', dir); } catch (e) {} }
}

// ====== Prueba automática de sincronización de letras (electron . --selftest) ====== */
const SELFTEST_CODE = `
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { steps: [], errs: [] };
  window.addEventListener('error', e => out.errs.push(String(e.message)));
  const media = document.getElementById('media');
  const active = () => (document.querySelector('.ly.on') || {}).textContent || null;
  const headTxt = () => (document.querySelector('.ly.head') || {}).textContent || null;
  const lineCount = () => document.querySelectorAll('.ly[data-t]').length;
  const snap = (tag) => ({
    tag: tag,
    title: document.getElementById('title').textContent,
    rows: document.querySelectorAll('.row').length,
    count: document.getElementById('count').textContent,
    dur: isFinite(media.duration) ? media.duration : String(media.duration),
    src: (media.currentSrc || media.src || '').slice(0, 24),
    toast: document.getElementById('toast').textContent
  });

  try {
    // 1) Sembrar la caché con una LETRA SIMPLE (ruta sin tiempos reales)
    if (window.playerAPI && playerAPI.saveCachedLyrics) {
      await playerAPI.saveCachedLyrics('pruebademo-cancion-plain', {
        type: 'plain',
        text: ['linea uno de la cancion','linea dos aqui','linea tres aqui','linea cuatro aqui',
               'linea cinco aqui','linea seis aqui','linea siete aqui','linea ocho aqui',
               'linea nueve aqui','linea diez aqui'].join(String.fromCharCode(10))
      });
      out.steps.push('caché sembrada');
    }

    // 2) WAV sintético de 207 segundos (duración real de "Levitating")
    const sr = 8000, n = sr * 207, data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = Math.round(127 + 100 * Math.sin(2 * Math.PI * 440 * i / sr));
    const buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
    const ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    ws(0,'RIFF'); dv.setUint32(4,36+n,true); ws(8,'WAVE'); ws(12,'fmt ');
    dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
    dv.setUint32(24,sr,true); dv.setUint32(28,sr,true); dv.setUint16(32,1,true); dv.setUint16(34,8,true);
    ws(36,'data'); dv.setUint32(40,n,true);

    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'Dua Lipa - Levitating.wav', {type:'audio/wav'}));
    dt.items.add(new File([buf], 'Pruebademo - Cancion Plain.wav', {type:'audio/wav'}));
    out.filesSoltados = dt.items.length;
    window.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
    out.afterDrop = snap('inmediato');
    out.steps.push('2 archivos soltados');

    // 3) Pista 0: letra sincronizada descargada de internet
    await sleep(4000); out.t4 = snap('4s');
    await sleep(8000);
    out.online = Object.assign(snap('12s'), {
      lines: lineCount(),
      head: headTxt()
    });
    media.currentTime = 25;
    await sleep(1000);
    out.online.active25 = active();

    // 3b) REPRODUCCIÓN REAL: la canción suene y la letra debe avanzar sola
    const samples = [];
    try { await media.play(); } catch (e) { out.playErr = String(e); }
    for (let s = 0; s < 4; s++) {
      await sleep(3000);
      samples.push({
        wall: (s + 1) * 3,
        time: +media.currentTime.toFixed(2),
        paused: media.paused,
        active: active()
      });
    }
    media.pause();
    out.playback = {
      samples: samples,
      timeAdvanced: samples.length > 1 && samples[samples.length - 1].time > samples[0].time,
      lyricAdvanced: new Set(samples.map(x => x.active)).size > 1
    };

    // 4) Pista 1: letra simple desde caché + avance estimado
    const rows = document.querySelectorAll('.row');
    out.rowsNow = rows.length;
    if (rows[1]) { rows[1].click(); await sleep(2500); }
    out.plain = { head: headTxt(), lines: lineCount(), snap: snap('pista2') };
    media.currentTime = 12;
    await sleep(1000);
    out.plain.active12 = active();
    out.plain.duration = isFinite(media.duration) ? media.duration : String(media.duration);
    out.plain.times = [...document.querySelectorAll('.ly[data-t]')].slice(0, 5).map(e => e.dataset.t);
    out.removed = window.__removed || 0;
    out.removedStack = window.__removedStack || null;
  } catch (e) {
    out.error = String(e && (e.stack || e.message) || e);
  }
  return out;
})()
`;

// ====== Prueba con un archivo REAL del usuario (electron . --filetest) ====== */
const REALFILETEST_CODE = `
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { steps: [], errs: [] };
  window.addEventListener('error', e => out.errs.push(String(e.message)));
  const media = document.getElementById('media');
  const active = () => (document.querySelector('.ly.on') || {}).textContent || null;
  const headTxt = () => (document.querySelector('.ly.head') || {}).textContent || null;
  const lineCount = () => document.querySelectorAll('.ly[data-t]').length;

  try {
    // Decodificar el archivo real (base64 inyectado desde el proceso principal)
    const b64 = __B64__;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const name = __NAME__;
    const file = new File([bytes], name, { type: 'audio/mpeg' });
    out.file = { name: name, mb: +(bytes.length / 1048576).toFixed(1) };

    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    out.steps.push('archivo real soltado');

    // Esperar a que cargue metadata y la letra
    await sleep(9000);
    const lineEls = [...document.querySelectorAll('.ly[data-t]')];
    out.carga = {
      title: document.getElementById('title').textContent,
      artist: document.getElementById('artist').textContent,
      dur: isFinite(media.duration) ? +media.duration.toFixed(1) : String(media.duration),
      lines: lineEls.length,
      head: headTxt(),
      statico: lineEls.length === 0,        // letra SIN tiempos → nunca resaltará
      primeraLinea: lineEls.length ? +lineEls[0].dataset.t : null
    };

    // REPRODUCIR desde donde empiezan las letras y vigilar si avanza sola
    try { await media.play(); } catch (e) { out.playErr = String(e); }
    if (out.carga.primeraLinea != null) media.currentTime = Math.max(0, out.carga.primeraLinea - 1);
    const samples = [];
    for (let s = 0; s < 5; s++) {
      await sleep(3000);
      samples.push({
        t: +media.currentTime.toFixed(1),
        paused: media.paused,
        active: active()
      });
    }
    media.pause();
    out.samples = samples;
    out.sincroniza = {
      tiempoAvanza: samples[samples.length - 1].t > samples[0].t,
      letraCambia: new Set(samples.map(x => x.active)).size > 1
    };
  } catch (e) {
    out.error = String(e && (e.stack || e.message) || e);
  }
  return out;
})()
`;

// ====== Letras sin internet: caché local + archivos .lrc ====== */
function lyricCacheFile(key) {
  const safe = String(key || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (!safe) return null;
  return path.join(app.getPath('userData'), 'lyrics', safe + '.json');
}

// Leer letra guardada previamente (funciona sin internet)
ipcMain.handle('lyrics-cache-get', async (_e, key) => {
  try {
    const f = lyricCacheFile(key);
    if (!f) return null;
    const raw = await fsp.readFile(f, 'utf8');
    return JSON.parse(raw);
  } catch (e) { return null; }
});

// Guardar letra descargada para usarla luego sin internet
ipcMain.handle('lyrics-cache-set', async (_e, key, data) => {
  try {
    const f = lyricCacheFile(key);
    if (!f) return false;
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, JSON.stringify(data), 'utf8');
    return true;
  } catch (e) { return false; }
});

// Leer archivo .lrc (con tiempos) o .txt (letra simple) junto a la canción
ipcMain.handle('read-lrc', async (_e, p) => {
  try {
    if (!p || !/\.(lrc|txt)$/i.test(p)) return null;
    const real = await fsp.realpath(p).catch(() => p);
    const txt = await fsp.readFile(real, 'utf8');
    return String(txt).replace(/^\uFEFF/, '');
  } catch (e) { return null; }
});


function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

// Descargar letra desde letras.com (página original o traducción) — automático, sin botones
ipcMain.handle('fetch-letras', async (_e, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : { url: payload };
  let urls = [];
  if (p.url) urls = [p.url];
  if (!urls.length && p.artist && p.title) {
    const slug = (s) => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const JUNK = /traduc|official|oficial|v\u00eddeo|video|videoclip|letra|lyrics?|lyric|audio|visuali[sz]er|live|directo|en\s+vivo|primera\s+fila|hd|4k|remaster(?:ed)?|original\s+version|versi\u00f3n\s+original|version\s+original|karaoke|cover|sub\s*espa\u00f1ol|subtitulad[oa]s?/i;
    const clean = (s) => String(s || '')
      .replace(/\[[^\]]*\]/g, ' ').replace(/\(([^)]*)\)/g, (m, im) => JUNK.test(im) ? ' ' : m)
      .replace(/\s*[|]\s*/g, ' ')
      .replace(/\s{2,}/g, ' ').trim();
    const sinFt = (s) => s.replace(/\s+(?:ft\.?|feat\.?|featuring|with)\s+.*$/i, '').trim();
    const base = sinFt(clean(p.title)) || clean(p.title);
    // Variante totalmente limpia: sin paréntesis ni palabras de video. letras.com
    // no tiene páginas como «…-original-version» ni «…-letra»: sin esto, canciones
    // en español con nombres largos nunca encontraban su página.
    const limpio = sinFt(String(base)
      .replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(new RegExp('\\b(?:' + JUNK.source + ')\\b.*$', 'gi'), ' ')
      .replace(/\s{2,}/g, ' ').trim()) || base;
    const art = slug(clean(p.artist));
    const vistos = new Set();
    for (const b of [limpio, base]) {
      const u = 'https://www.letras.com/' + art + '/' + slug(b) + '/';
      if (!vistos.has(u)) { vistos.add(u); urls.push(u); }
    }
  }
  if (!urls.length) return { ok: false, error: 'sin url' };
  for (const url of urls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Referer': 'https://www.letras.com/'
        }
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status === 403 || res.status >= 500) return { ok: false, error: 'HTTP ' + res.status, net: true };
        continue;   // 404: probar la siguiente variante de URL
      }
      const html = await res.text();
      const reVerse = new RegExp('<span[^>]*class\\s*=\\s*"verse"[^>]*>\\s*<span[^>]*>([\\s\\S]*?)</span>', 'gi');
      const reChorus = new RegExp(reVerse.source.replace('verse', 'chorus'), 'gi');
      let verses = [...html.matchAll(reVerse), ...html.matchAll(reChorus)];
      if (verses.length) {
        const lines = verses.map(m => decodeHtml(m[1])).map(s => s.trim()).filter(Boolean);
        if (lines.length) return { ok: true, text: lines.join('\n'), source: 'letras.com' };
      }
      const idx = html.indexOf('js-lyric-content');
      const chunk = idx >= 0 ? html.slice(idx, idx + 30000) : html;
      const pm = chunk.match(new RegExp('<p[^>]*>([\\s\\S]*?)</p>'));
      if (pm) {
        const raw = pm[1].replace(new RegExp('<br\\s*/?>', 'gi'), '\n').replace(/<[^>]+>/g, '').trim();
        const text = decodeHtml(raw);
        if (text) return { ok: true, text, source: 'letras.com' };
      }
    } catch (e) {
      clearTimeout(timer);
      const net = !!(e && /abort|fetch|network/i.test(String(e && e.message || e)));
      if (net) return { ok: false, error: String(e && e.message || e), net: true };
      // otro error: probar la siguiente variante
    }
  }
  return { ok: false, error: 'no se encontró la letra' };
});

// Guardar una letra descargada como archivo .lrc junto a la canción (para usarla sin internet)
// Leer el audio de la pista para analizar la voz en el renderizador (Web Audio).
// Solo se usa en la pista actual y con un tope de tamaño: nunca bloquea la interfaz.
const AUDIO_MAX_BYTES = 64 * 1024 * 1024;
ipcMain.handle('read-audio', async (_e, p) => {
  try {
    const file = String(p || '');
    if (!file || !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|mp4|m4v|mkv|mov)$/i.test(file)) return null;
    const real = await fsp.realpath(file).catch(() => file);
    const st = await fsp.stat(real);
    if (!st.isFile() || st.size > AUDIO_MAX_BYTES) return null;
    return await fsp.readFile(real);
  } catch (e) { return null; }
});

// Analizador de voz en Rust (rápido). Devuelve { phrases, onsets, ... } o null.
// Si el ejecutable no existe o falla, el renderizador usa el analizador JS de siempre.
function voiceAnalyzerPath() {
  const exe = process.platform === 'win32' ? 'voice-analyzer.exe' : 'voice-analyzer';
  if (app.isPackaged) return path.join(process.resourcesPath, exe);
  return path.join(__dirname, 'rust-voice', exe);
}

ipcMain.handle('analyze-voice-rust', async (_e, p) => {
  try {
    const file = String(p || '');
    if (!file || !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|mp4|m4v|mkv|mov)$/i.test(file)) return null;
    const bin = voiceAnalyzerPath();
    if (!fs.existsSync(bin)) return null;
    const real = await fsp.realpath(file).catch(() => file);
    return await new Promise((resolve) => {
      let out = '';
      let done = false;
      let proc;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        proc = spawn(bin, [real], { windowsHide: true });
      } catch (e) { return finish(null); }
      const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} finish(null); }, 60000);
      proc.stdout.on('data', (d) => { out += d; });
      proc.stderr.on('data', () => {});
      proc.on('error', () => { clearTimeout(timer); finish(null); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return finish(null);
        try {
          const j = JSON.parse(out);
          if (!j || !Array.isArray(j.phrases) || !j.phrases.length) return finish(null);
          finish(j);
        } catch (e) { finish(null); }
      });
    });
  } catch (e) { return null; }
});

ipcMain.handle('save-lrc', async (_e, p, text) => {
  try {
    if (!p || !text) return false;
    const base = String(p).replace(/\.[^.]+$/, '');
    const lrcPath = base + '.lrc';
    await fsp.writeFile(lrcPath, String(text), 'utf8');
    await appendDebug('letra guardada en ' + lrcPath);
    return true;
  } catch (e) {
    await appendDebug('ERROR save-lrc: ' + (e && e.message || e));
    return false;
  }
});

// ====== Lista de reproducción persistente (sobrevive al cerrar la app) ====== */
const playlistFile = () => path.join(app.getPath('userData'), 'playlist.json');

// Registro de diagnóstico reutilizable (máx ~200 KB)
async function appendDebug(line) {
  try {
    const f = path.join(app.getPath('userData'), 'debug.log');
    try {
      const st = await fsp.stat(f);
      if (st.size > 200000) await fsp.unlink(f).catch(() => {});
    } catch (e) { /* aún no existe */ }
    await fsp.appendFile(f, String(line).slice(0, 500) + '\n', 'utf8');
  } catch (e) { /* sin registro */ }
}

ipcMain.handle('playlist-get', async () => {
  try {
    return JSON.parse(await fsp.readFile(playlistFile(), 'utf8'));
  } catch (e) {
    if (e && e.code !== 'ENOENT') await appendDebug('ERROR playlist-get: ' + (e.message || e));
    return null;
  }
});
ipcMain.handle('playlist-set', async (_e, data) => {
  const f = playlistFile();
  try {
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data || {}), 'utf8');
    await fsp.rename(tmp, f);        // reemplazo atómico: nunca deja el JSON a medias
    return true;
  } catch (e) {
    await appendDebug('ERROR playlist-set: ' + (e && e.message || e));
    return false;
  }
});
ipcMain.handle('file-exists', async (_e, p) => {
  try { return (await fsp.stat(String(p || ''))).isFile(); }
  catch (e) { return false; }
});

// Diagnóstico: registrar eventos clave en userData/debug.log (máx ~200 KB)
ipcMain.handle('debug-log', async (_e, msg) => {
  await appendDebug(String(msg || ''));
  return true;
});

// ====== Búsqueda de letras (en el proceso principal: sin CORS) ====== */
async function lyricsFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const isNetError = (msg) => /failed|ENOTFOUND|ECONN|EAI_AGAIN|abort|network|ECONNREFUSED|ETIMEDOUT/i.test(msg);

ipcMain.handle('search-lyrics', async (_event, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : { q: payload };
  const enc = (s) => encodeURIComponent(String(s || '').slice(0, 200));
  const dur = Math.round(Number(p.duration) || 0);

  // 1) Coincidencia EXACTA con título + artista + duración (letra sincronizada fiable)
  if (p.exact && p.title && p.artist && dur > 30) {
    try {
      const url = 'https://lrclib.net/api/get?track_name=' + enc(p.title) +
                  '&artist_name=' + enc(p.artist) + '&duration=' + dur;
      const data = await lyricsFetch(url);
      // Validar que la entrada devuelta corresponde de verdad al título pedido:
      // con archivos cuyos campos artista/título vienen cambiados, la coincidencia
      // exacta podía traer la letra de OTRA versión (p. ej. la inglesa). Si el
      // título no se parece, se descarta y se sigue con la búsqueda normal.
      const parecido = (a, b) => {
        const na = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const ta = new Set(na(a).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^\d+$/.test(w)));
        const tb = new Set(na(b).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^\d+$/.test(w)));
        if (!ta.size || !tb.size) return 0;
        let hit = 0;
        ta.forEach(w => { if (tb.has(w)) hit++; });
        return hit / Math.min(ta.size, tb.size);
      };
      if (data && (data.syncedLyrics || data.plainLyrics) && parecido(data.trackName, p.title) >= 0.5) {
        return { ok: true, data: [data], exact: true };
      }
    } catch (err) {
      if (err && err.status === 404) { /* sin coincidencia exacta: seguimos buscando */ }
      else if (isNetError(String(err && err.message || err))) {
        return { ok: false, error: String(err.message || err), net: true };
      }
    }
  }

  // 2) Búsqueda libre con reintentos ante 503 / caídas
  const url = 'https://lrclib.net/api/search?q=' + enc(p.q);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await lyricsFetch(url);
      return { ok: true, data };
    } catch (err) {
      lastErr = String(err && err.message || err);
      // Error de red (sin internet) → no insistir
      if (isNetError(lastErr)) return { ok: false, error: lastErr, net: true };
      if (attempt < 2) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastErr };
});


// Búsqueda estructurada: track_name + artist_name. A diferencia de la búsqueda
// libre (q), LRCLIB devuelve de forma consistente todas las versiones de ese
// artista, incluidas las sincronizadas buenas.
ipcMain.handle('search-lyrics-structured', async (_event, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : {};
  const enc = (s) => encodeURIComponent(String(s || '').slice(0, 200));
  const track = String(p.trackName || '').trim();
  const artist = String(p.artistName || '').trim();
  if (!track) return { ok: false, error: 'sin título' };
  let url = 'https://lrclib.net/api/search?track_name=' + enc(track);
  if (artist) url += '&artist_name=' + enc(artist);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await lyricsFetch(url);
      return { ok: true, data };
    } catch (err) {
      lastErr = String(err && err.message || err);
      if (isNetError(lastErr)) return { ok: false, error: lastErr, net: true };
      if (attempt < 2) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastErr };
});

// Colores de la barra de título (Windows) según el tema activo
ipcMain.on('titlebar-colors', (event, colors) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  if (!colors || !isHex(colors.color) || !isHex(colors.symbolColor)) return;
  try {
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 34 });
  } catch (e) { /* versión sin soporte: se queda con el color por defecto */ }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 420,
    minHeight: 640,
    resizable: true,
    backgroundColor: '#f6f6fa',
    title: 'Reproductor de Música',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    // Barra de título integrada: los botones de ventana se pintan según el tema
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f6f6fa', symbolColor: '#12131a', height: 34 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  // Menú mínimo (Alt para mostrar)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }
      ]
    }
  ]));

  mainWindow.loadFile('index.html', {
    // En modo prueba la app no restaura ni pisa la lista guardada del usuario
    query: (process.argv.includes('--selftest') || process.argv.includes('--filetest')) ? { test: '1' } : {}
  });

  // Diagnóstico: errores de la consola del reproductor visibles en la terminal
  mainWindow.webContents.on('console-message', (...args) => {
    const d = (args[1] && typeof args[1] === 'object' && 'message' in args[1])
      ? args[1]
      : { level: args[1], message: args[2], line: args[3], sourceId: args[4] };
    const lvl = ['log', 'info', 'warning', 'error'][Number(d.level) || 0] || 'log';
    if (lvl === 'warning' || lvl === 'error')
      console.log('[web:' + lvl + '] ' + d.message + ' (' + d.sourceId + ':' + d.line + ')');
  });

  // Prueba automática interna: electron . --selftest
  if (process.argv.includes('--selftest')) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(SELFTEST_CODE, true);
          console.log('[SELFTEST] ' + JSON.stringify(result, null, 1));
        } catch (e) {
          console.log('[SELFTEST-ERR] ' + (e && (e.stack || e.message) || e));
        }
        app.quit();
      }, 1200);
    });
  }

  // Prueba con un archivo REAL del usuario: electron . --filetest "ruta\cancion.mp3"
  const ftIdx = process.argv.indexOf('--filetest');
  if (ftIdx > -1 && process.argv[ftIdx + 1]) {
    const realPath = process.argv[ftIdx + 1];
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const bytes = await fsp.readFile(realPath);
          const b64 = bytes.toString('base64');
          const code = REALFILETEST_CODE
            .replace('__NAME__', JSON.stringify(path.basename(realPath)))
            .replace('__B64__', JSON.stringify(b64));
          const result = await mainWindow.webContents.executeJavaScript(code, true);
          console.log('[FILETEST] ' + JSON.stringify(result, null, 1));
        } catch (e) {
          console.log('[FILETEST-ERR] ' + (e && (e.stack || e.message) || e));
        }
        app.quit();
      }, 1200);
    });
  }

  // Evita que soltar archivos desde el escritorio navegue fuera de la app
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Prueba de actualización ligera (electron . --updatetest): descarga la
  // última app.asar publicada, la programa y cierra la app para validar el
  // mecanismo de sustitución en resources/app.asar.
  if (process.argv.includes('--updatetest')) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const light = await fetchLightUpdateInfo();
          if (light && updCmp(light.version, app.getVersion()) > 0) {
            const r = await downloadLightUpdate(light);
            console.log('[UPDATETEST] descarga ok ' + JSON.stringify(r));
            scheduleApplyUpdateOnQuit(false);
          } else {
            console.log('[UPDATETEST] no hay actualización disponible para v' + app.getVersion());
          }
        } catch (e) {
          console.log('[UPDATETEST-ERR] ' + (e && (e.stack || e.message) || e));
        }
        app.quit();
      }, 3000);
    });
  }
}

// Arrastre y soltamiento de archivos: no navegar a file://
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(() => {
  // Borra restos de actualizaciones que ya no aplican (asar viejos, scripts).
  try { cleanupUpdatesDir(); } catch (e) { /* no bloquear el arranque */ }
  createWindow();
  // Si la instalación no trae el analizador de voz (p. ej. actualización ligera
  // desde una versión sin Rust), se descarga solo una vez en segundo plano.
  setTimeout(() => { ensureVoiceAnalyzer().catch(() => {}); }, 5000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ================= Actualización ligera (solo app.asar) =================
// El instalador NSIS pesa ~82 MB porque incluye Electron. Para actualizar solo
// cambia la app (main.js, preload.js, index.html y sus dependencias, ~4 MB), así
// que se descarga únicamente ese archivo y se sustituye al cerrar la app.
// El instalador completo sigue existiendo para la primera instalación.
const APP_UPDATE_INFO_URL = 'https://github.com/isaac117q/reproductor-musica/releases/latest/download/latest-app.json';
const APP_UPDATE_ASAR_URL = 'https://github.com/isaac117q/reproductor-musica/releases/latest/download/app.asar';

function updCmp(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function updatesDir() { return path.join(app.getPath('userData'), 'updates'); }
function pendingUpdateFile() { return path.join(updatesDir(), 'pending.json'); }
function readPendingUpdate() {
  try { return JSON.parse(fs.readFileSync(pendingUpdateFile(), 'utf8')); } catch (e) { return null; }
}
function clearPendingUpdate() {
  // Borra también el .asar descargado: antes se quedaba en disco para siempre
  // cada vez que la versión pendiente ya estaba instalada.
  try {
    const p = readPendingUpdate();
    if (p && p.file) { try { fs.unlinkSync(p.file); } catch (e) { /* ya no existe */ } }
    if (p && p.exeFile) { try { fs.unlinkSync(p.exeFile); } catch (e) { /* ya no existe */ } }
  } catch (e) { /* pending ilegible */ }
  try { fs.unlinkSync(pendingUpdateFile()); } catch (e) { /* ya no existe */ }
}

// Limpieza al arrancar: si hay una actualización pendiente más nueva se
// conserva (se aplicará al cerrar); si no, se borran restos de intentos
// anteriores (asar descargado, script suelto). Así no se acumulan 4 MB por
// cada vez que falla una actualización.
function cleanupUpdatesDir() {
  const p = readPendingUpdate();
  const valida = p && p.file && fs.existsSync(p.file) &&
    updCmp(p.version, app.getVersion()) > 0;
  if (valida) return;
  try { fs.unlinkSync(pendingUpdateFile()); } catch (e) { /* no existe */ }
  try {
    for (const f of fs.readdirSync(updatesDir())) {
      if (/^app-.*\.asar$/i.test(f) || /^voice-analyzer-.*\.exe$/i.test(f) || f === 'apply-update.ps1') {
        try { fs.unlinkSync(path.join(updatesDir(), f)); } catch (e) { /* en uso */ }
      }
    }
  } catch (e) { /* sin carpeta */ }
}

async function fetchLightUpdateInfo() {
  const r = await fetch(APP_UPDATE_INFO_URL + '?t=' + Date.now(), {
    headers: { 'User-Agent': 'reproductor-musica', 'Cache-Control': 'no-cache' },
    cache: 'no-store'
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j.version) return null;
  return j;
}

// Descarga app.asar (y el .exe del analizador de voz, si la release lo incluye)
// con progreso (el botón "Actualizar" muestra el porcentaje).
async function downloadLightUpdate(info) {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
  const hasExe = !!(info && info.exe && info.exe.sha256);
  const asarMax = hasExe ? 88 : 100;
  const res = await fetch(APP_UPDATE_ASAR_URL + '?t=' + Date.now(), {
    headers: { 'User-Agent': 'reproductor-musica', 'Cache-Control': 'no-cache' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || Number(info.size) || 0;
  const chunks = [];
  let received = 0, lastPct = -1;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = Buffer.from(step.value);
      chunks.push(chunk);
      received += chunk.length;
      const pct = total ? Math.min(asarMax, Math.round(received * asarMax / total)) : 50;
      if (pct !== lastPct) {
        lastPct = pct;
        send('update-progress', { percent: pct, transferred: received, total });
      }
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    chunks.push(buf);
    received = buf.length;
    send('update-progress', { percent: asarMax, transferred: received, total });
  }
  const buf = Buffer.concat(chunks);
  if (info.size && buf.length !== Number(info.size)) {
    throw new Error('La descarga no tiene el tamaño esperado');
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (info.sha256 && sha256.toLowerCase() !== String(info.sha256).toLowerCase()) {
    throw new Error('La actualización descargada no coincide');
  }
  const dir = updatesDir();
  await fsp.mkdir(dir, { recursive: true });
  const ver = String(info.version).replace(/[^\w.-]/g, '');
  const file = path.join(dir, 'app-' + ver + '.asar');
  await fsp.writeFile(file, buf);

  // `.exe` del analizador de voz (Rust). Si no se puede descargar, se ignora:
  // la app seguirá usando el analizador JS como respaldo.
  let exeFile = null, exeSha = null;
  if (hasExe) {
    send('update-progress', { percent: 91, total, transferred: total });
    const exeName = String(info.exe.file || 'voice-analyzer.exe').replace(/[^\w.-]/g, '');
    const exeDest = path.join(dir, 'voice-analyzer-' + ver + '.exe');
    if (fs.existsSync(exeDest)) {
      try {
        const old = await fsp.readFile(exeDest);
        const oldSha = crypto.createHash('sha256').update(old).digest('hex');
        if (oldSha.toLowerCase() === String(info.exe.sha256).toLowerCase()) {
          exeFile = exeDest; exeSha = oldSha;
        }
      } catch (e) { /* se vuelve a descargar */ }
    }
    if (!exeFile) {
      try {
        const er = await fetch('https://github.com/isaac117q/reproductor-musica/releases/latest/download/' +
          encodeURIComponent(exeName) + '?t=' + Date.now(), {
          headers: { 'User-Agent': 'reproductor-musica', 'Cache-Control': 'no-cache' },
          cache: 'no-store'
        });
        if (er.ok) {
          const ebuf = Buffer.from(await er.arrayBuffer());
          if (!info.exe.size || ebuf.length === Number(info.exe.size)) {
            const esha = crypto.createHash('sha256').update(ebuf).digest('hex');
            if (esha.toLowerCase() === String(info.exe.sha256).toLowerCase()) {
              await fsp.writeFile(exeDest, ebuf);
              exeFile = exeDest; exeSha = esha;
            }
          }
        }
      } catch (e) {
        await appendDebug('actualización: no se pudo descargar el analizador: ' + (e && e.message || e));
      }
    }
    send('update-progress', { percent: 100, total, transferred: total });
  }

  await fsp.writeFile(pendingUpdateFile(), JSON.stringify({
    version: info.version, file, sha256, size: buf.length,
    exeFile, exeSha
  }));
  await appendDebug('actualización ligera descargada: v' + info.version + ' (' + buf.length + ' bytes)' +
    (exeFile ? ' + analizador ' + (fs.existsSync(exeFile) ? fs.statSync(exeFile).size : 0) + ' bytes' : ''));
  send('update-downloaded', info.version);
  return { ok: true, version: info.version, size: buf.length };
}

function appAsarPath() {
  if (!app.isPackaged) return null;
  return path.join(path.dirname(process.execPath), 'resources', 'app.asar');
}

// Auto-reparación del analizador de voz: si falta en resources (por ejemplo,
// tras una actualización ligera desde una versión anterior sin Rust), descarga
// el .exe publicado en la última release y lo deja junto a app.asar.
let ensuredVoiceAnalyzer = false;
async function ensureVoiceAnalyzer() {
  if (!app.isPackaged || ensuredVoiceAnalyzer) return;
  ensuredVoiceAnalyzer = true;
  const exeName = process.platform === 'win32' ? 'voice-analyzer.exe' : 'voice-analyzer';
  const dest = path.join(process.resourcesPath, exeName);
  try {
    const info = await fetchLightUpdateInfo();
    if (!info || !info.exe || !info.exe.sha256) return;
    const want = String(info.exe.sha256).toLowerCase();
    if (fs.existsSync(dest)) {
      const cur = await fsp.readFile(dest);
      const sha = crypto.createHash('sha256').update(cur).digest('hex');
      if (sha.toLowerCase() === want) return;
    }
    const url = 'https://github.com/isaac117q/reproductor-musica/releases/latest/download/' +
      encodeURIComponent(String(info.exe.file || exeName));
    const r = await fetch(url + '?t=' + Date.now(), {
      headers: { 'User-Agent': 'reproductor-musica', 'Cache-Control': 'no-cache' },
      cache: 'no-store'
    });
    if (!r.ok) { await appendDebug('motor de voz: HTTP ' + r.status); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (info.exe.size && buf.length !== Number(info.exe.size)) {
      await appendDebug('motor de voz: tamaño inesperado'); return;
    }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha.toLowerCase() !== want) { await appendDebug('motor de voz: sha no coincide'); return; }
    const tmp = dest + '.tmp';
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, dest).catch(async () => { await fsp.writeFile(dest, buf); try { await fsp.unlink(tmp); } catch (e) {} });
    await appendDebug('motor de voz descargado: ' + exeName + ' (' + buf.length + ' bytes)');
  } catch (e) {
    await appendDebug('motor de voz: ' + (e && e.message || e));
  }
}

// Al cerrar la app: un script oculto espera a que termine el proceso y
// sustituye resources/app.asar. No hace falta instalar nada ni descargar el exe.
//
// Importante: un proceso hijo lanzado con spawn() desde Electron se muere al
// cerrar la app (Windows lo elimina con el resto de procesos del trabajo). Por
// eso ahora se usa el Programador de tareas de Windows, que ejecuta el script
// fuera de la app y sí sobrevive al cierre. Si no se puede crear la tarea, se
// intenta el método anterior como respaldo.
function scheduleApplyUpdateOnQuit(relanzar) {
  const p = readPendingUpdate();
  if (!p || !p.file || !fs.existsSync(p.file)) return false;
  if (updCmp(p.version, app.getVersion()) <= 0) { clearPendingUpdate(); return false; }
  const target = appAsarPath();
  if (!target || !fs.existsSync(target)) return false;
  const dir = updatesDir();
  const script = path.join(dir, 'apply-update.ps1');
  const log = path.join(dir, 'apply-update.log');
  const taskName = 'ReproductorMusicaUpdate_' + process.pid;
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ver = String(p.version).replace(/[^\w.-]/g, '');
  const exeName = process.platform === 'win32' ? 'voice-analyzer.exe' : 'voice-analyzer';
  const exeTarget = path.join(path.dirname(process.execPath), 'resources', exeName);
  const hasExe = !!(p.exeFile && fs.existsSync(p.exeFile));
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    // Esperar a que la app termine de verdad (el usuario puede tardar en cerrar).
    'Start-Sleep -Milliseconds 600',
    'Wait-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 400',
    // La app puede tardar un momento en soltar app.asar: se reintenta la copia
    // hasta 30 veces (12 s). Antes un solo intento podía fallar en silencio.
    '$ok = $false',
    'for ($i = 0; $i -lt 30; $i++) {',
    '  Copy-Item -LiteralPath ' + q(p.file) + ' -Destination ' + q(target) + ' -Force',
    '  if ($?) { $ok = $true; break }',
    '  Start-Sleep -Milliseconds 400',
    '}',
    'if ($ok) {',
    '  Remove-Item -LiteralPath ' + q(p.file) + ' -Force',
    hasExe ? '  $okExe = $false' : '',
    hasExe ? '  for ($j = 0; $j -lt 30; $j++) {' : '',
    hasExe ? '    Copy-Item -LiteralPath ' + q(p.exeFile) + ' -Destination ' + q(exeTarget) + ' -Force' : '',
    hasExe ? '    if ($?) { $okExe = $true; break }' : '',
    hasExe ? '    Start-Sleep -Milliseconds 300' : '',
    hasExe ? '  }' : '',
    hasExe ? '  if ($okExe) { Remove-Item -LiteralPath ' + q(p.exeFile) + ' -Force }' : '',
    '  Remove-Item -LiteralPath ' + q(pendingUpdateFile()) + ' -Force',
    "  Add-Content -LiteralPath " + q(log) + " -Value ('OK ' + (Get-Date -Format s) + ' v" + ver + "')",
    '} else {',
    "  Add-Content -LiteralPath " + q(log) + " -Value ('FALLO ' + (Get-Date -Format s) + ' v" + ver + "')",
    '}',
    'schtasks /delete /tn ' + q(taskName) + ' /f 2>$null',
    'Remove-Item -LiteralPath ' + q(script) + ' -Force',
    // Abrir la app de nuevo solo cuando el usuario pulsó "Instalar".
    relanzar ? 'if ($ok) { Start-Process -FilePath ' + q(process.execPath) + ' }' : ''
  ].filter(Boolean).join('\r\n');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(script, ps, 'utf8');
  } catch (e) {
    return false;
  }
  // 1) Programador de tareas: el proceso vive fuera de Electron y sobrevive.
  try {
    const tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + script + '"';
    // Hora de inicio válida (2 minutos en el futuro); la tarea se ejecuta ya con
    // /run, pero schtasks rechaza una hora pasada.
    const t = new Date(Date.now() + 120000);
    const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const c = spawnSync('schtasks.exe',
      ['/create', '/tn', taskName, '/tr', tr, '/sc', 'once', '/st', hhmm, '/f', '/it'],
      { windowsHide: true, stdio: 'ignore' });
    if (c && c.status === 0) {
      spawnSync('schtasks.exe', ['/run', '/tn', taskName], { windowsHide: true, stdio: 'ignore' });
      appendDebug('actualización ligera programada: tarea ' + taskName + (relanzar ? ' (con reinicio)' : ''));
      return true;
    }
    const err = c && (c.error ? c.error.message : 'código ' + c.status);
    appendDebug('no se pudo crear la tarea de actualización: ' + err);
  } catch (e) {
    appendDebug('error creando la tarea de actualización: ' + (e && e.message || e));
  }
  // 2) Respaldo: PowerShell suelto (puede no sobrevivir al cierre de Electron).
  try {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
      { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

let applyingLightUpdate = false;
app.on('before-quit', () => {
  if (applyingLightUpdate) return;
  applyingLightUpdate = true;
  // Si el usuario ya pulsó "Instalar", el script va con reinicio y no debe
  // reescribirse aquí sin él.
  if (!readPendingUpdate()) return;
  scheduleApplyUpdateOnQuit(false);
});

// IPC para actualizaciones
ipcMain.handle('check-for-updates', async () => {
  // 1) Intentar la actualización ligera (app.asar). Si existe en la última
  //    release, se descarga solo eso y no el instalador completo.
  let light = null;
  try { light = await fetchLightUpdateInfo(); } catch (e) { light = null; }
  if (light && updCmp(light.version, app.getVersion()) > 0) {
    // Si ya se descargó esa misma versión, no se vuelve a bajar (antes cada
    // pulsación de "Actualizar" descargaba otros 3,55 MB aunque ya estuviera).
    const pend = readPendingUpdate();
    if (pend && pend.file && fs.existsSync(pend.file) &&
        updCmp(pend.version, app.getVersion()) > 0 &&
        updCmp(pend.version, light.version) >= 0) {
      const win = mainWindow || BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-progress', { percent: 100 });
        win.webContents.send('update-downloaded', pend.version);
      }
      return { ok: true, available: true, version: pend.version, light: true, ready: true };
    }
    downloadLightUpdate(light).catch(err => {
      const win = mainWindow || BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-error', String(err && err.message || err));
      }
      appendDebug('actualización ligera: error ' + (err && err.message || err));
    });
    return { ok: true, available: true, version: light.version, light: true };
  }
  // 2) Si esa release no publicó app.asar, usar el instalador de siempre.
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo;
    const available = !!(result && result.isUpdateAvailable);
    return { ok: true, available, version: available && info ? info.version : null };
  } catch (e) {
    return { ok: false, error: e && e.message || String(e) };
  }
});

ipcMain.handle('install-update', async () => {
  if (readPendingUpdate()) {
    // El script se programa ANTES de salir (app.exit no dispara before-quit) y
    // se marca con reinicio: al terminar de copiar, vuelve a abrir la app.
    const ok = scheduleApplyUpdateOnQuit(true);
    if (!ok) return { ok: false, error: 'no se pudo programar la instalación' };
    setTimeout(() => { try { app.exit(0); } catch (e) { } }, 500);
    return { ok: true, restarting: true };
  }
  autoUpdater.quitAndInstall();
  return { ok: true, restarting: true };
});

// Versión real de la app (la insignia de la barra superior ya no se queda fija
// en una versión vieja escrita a mano).
ipcMain.handle('app-version', () => app.getVersion());

// Consulta silenciosa de la última versión publicada. NO descarga nada: solo
// sirve para poner el punto de aviso en el botón "Actualizar". La descarga y la
// instalación siguen siendo manuales (botón + cerrar la app).
ipcMain.handle('latest-version', async () => {
  try {
    const r = await fetch('https://api.github.com/repos/isaac117q/reproductor-musica/releases/latest', {
      headers: { 'User-Agent': 'reproductor-musica', 'Accept': 'application/vnd.github+json' }
    });
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const j = await r.json();
    return {
      ok: true,
      version: String(j && j.tag_name || '').replace(/^v/i, ''),
      url: j && j.html_url
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});
