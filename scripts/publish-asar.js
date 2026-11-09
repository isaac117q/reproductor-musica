// Publica la actualización ligera en la release de GitHub:
//   - app.asar            (solo la app, ~4 MB; no incluye Electron)
//   - latest-app.json     (versión, tamaño y SHA-256 de cada archivo)
//   - voice-analyzer.exe  (motor de voz en Rust, si existe)
// Se ejecuta DESPUÉS de `npm run dist -- --publish always`.
// Uso:  $env:GH_TOKEN="..."; npm run publish:asar
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const owner = 'isaac117q';
const repo = 'reproductor-musica';
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const asarPath = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const infoPath = path.join(root, 'dist', 'latest-app.json');
const exePath = path.join(root, 'rust-voice', 'voice-analyzer.exe');

if (!fs.existsSync(asarPath)) {
  console.error('No existe ' + asarPath + '. Ejecuta antes: npm run dist');
  process.exit(1);
}

function hashOf(file) {
  const buf = fs.readFileSync(file);
  return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

const asar = hashOf(asarPath);
const info = { version, file: 'app.asar', size: asar.size, sha256: asar.sha256 };

let exe = null;
if (fs.existsSync(exePath)) {
  try {
    const h = hashOf(exePath);
    exe = { file: 'voice-analyzer.exe', size: h.size, sha256: h.sha256 };
    info.exe = exe;
    console.log('voice-analyzer.exe: ' + (h.size / 1024 / 1024).toFixed(2) + ' MB');
    console.log('exe sha256: ' + h.sha256);
  } catch (e) {
    console.log('aviso: no se pudo leer voice-analyzer.exe: ' + e.message);
  }
} else {
  console.log('aviso: no existe rust-voice/voice-analyzer.exe (se publicará sin motor Rust)');
}

fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + '\n', 'utf8');
console.log('app.asar: ' + (asar.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('sha256: ' + asar.sha256);

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.log('Sin GH_TOKEN: solo se generó dist/latest-app.json (no se subió nada).');
  process.exit(0);
}

const api = 'https://api.github.com/repos/' + owner + '/' + repo;
const headers = {
  Authorization: 'Bearer ' + token,
  'User-Agent': 'reproductor-musica-publish',
  Accept: 'application/vnd.github+json'
};

async function json(url, opts) {
  const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts && opts.headers) } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url + ': ' + await r.text());
  return r.json();
}

async function main() {
  const tag = 'v' + version;
  const release = await json(api + '/releases/tags/' + tag);
  console.log('Release ' + tag + ' (id ' + release.id + ')');

  const assets = await json(api + '/releases/' + release.id + '/assets?per_page=100');
  const names = ['app.asar', 'latest-app.json'];
  if (exe) names.push('voice-analyzer.exe');
  for (const name of names) {
    const old = assets.find(a => a.name === name);
    if (old) {
      await json(api + '/releases/assets/' + old.id, { method: 'DELETE' });
      console.log('  borrado anterior: ' + name);
    }
  }

  const uploads = [['app.asar', asarPath], ['latest-app.json', infoPath]];
  if (exe) uploads.push(['voice-analyzer.exe', exePath]);

  for (const [name, file] of uploads) {
    const data = fs.readFileSync(file);
    const r = await fetch(
      'https://uploads.github.com/repos/' + owner + '/' + repo + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name),
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(data.length)
        },
        body: data
      }
    );
    if (!r.ok) throw new Error('Subida de ' + name + ': HTTP ' + r.status + ' ' + await r.text());
    const j = await r.json();
    console.log('  subido: ' + j.name + ' (' + j.size + ' bytes)');
  }
  console.log('Listo: la app ya puede actualizarse (app.asar' + (exe ? ' + analizador Rust' : '') + ').');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
