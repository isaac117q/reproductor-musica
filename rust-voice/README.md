# voice-analyzer (Rust) — analizador de voz para el reproductor

Módulo nativo que detecta **frases vocales** y **ataques (onsets)** en una canción y
devuelve el **mismo formato** que ya usa `index.html`:

```json
{
  "sample_rate": 44100,
  "duration": 10.0,
  "frames": 1719,
  "hop": 256,
  "phrases": [
    { "t": 1.03, "end": 2.94, "eff": 0.526 },
    { "t": 4.53, "end": 6.43, "eff": 0.768 },
    { "t": 8.03, "end": 9.44, "eff": 0.433 }
  ],
  "onsets": [1.03, 2.93, 4.53, 8.03, 9.43]
}
```

- `t` / `end`: inicio y fin de cada frase vocal (segundos).
- `eff`: proporción de energía en la banda vocal (250–3400 Hz) dentro de la frase.
- `onsets`: instantes de ataque de voz/sílaba.

> Igual que el analizador JS actual: **solo informa**. No mueve la letra; la app decide
> si aplica corrección con `refineSyncedToVoice` / `refineWordsToVoice`.

---

## 1. Probar el algoritmo AHORA (sin instalar Rust)

```bash
cd rust-voice
node demo.mjs
```

Genera `demo-sintetico.wav` (10 s con 3 "frases cantadas") y ejecuta el mismo
algoritmo en JS para que veas la salida JSON real.

---

## 2. Compilar el binario Rust

Instala Rust una vez:

```powershell
winget install Rustlang.Rustup
# o: https://rustup.rs
```

Luego:

```bash
cd rust-voice
cargo build --release
```

Salida:

```
rust-voice/target/release/voice-analyzer.exe
```

Uso directo:

```bash
voice-analyzer cancion.wav
```

> **Nota MP3/MP4**: `hound` solo lee WAV. Para MP3/OGG/FLAC cambia la dependencia a
> `symphonia` (decodifica MP3, AAC/MP4, OGG, FLAC y WAV). El resto del algoritmo no cambia:
> solo hay que reemplazar `load_mono()` por un decodificador de symphonia.
>
> Alternativa sin cambiar Rust: en el renderer ya decodificas el audio con WebAudio
> (`analyzeVoice`); puedes enviar el **PCM crudo** (Float32Array) al binario por stdin.

---

## 3. Integrarlo en la app Electron

### `main.js`

```js
const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

ipcMain.handle('analyze-voice-rust', async (_e, filePath) => {
  const exe = process.platform === 'win32' ? 'voice-analyzer.exe' : 'voice-analyzer';
  const bin = path.join(__dirname, 'rust-voice', 'target', 'release', exe);
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [filePath], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err || 'exit ' + code));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
});
```

### `preload.js`

```js
analyzeVoice: (filePath) => ipcRenderer.invoke('analyze-voice-rust', filePath),
```

### `index.html` — dentro de `maybeAlignToVoice()`

Reemplaza el análisis JS por Rust **con fallback**:

```js
// 1) Intenta el motor Rust
let A = null;
if (g.analyzeVoice) {
  try { A = await g.analyzeVoice(fp); }
  catch (e) { dbg('rust: ' + (e && e.message || e)); }
}

// 2) Si falla, usa el analizador JS actual (sin tocar nada más)
if (!A || !A.phrases || !A.phrases.length) {
  A = await Promise.race([
    analyzeVoice(bytes),
    new Promise(res => setTimeout(() => res(null), 30000))
  ]);
}
```

Todo lo demás (`voiceSyncInfo`, `refineWordsToVoice`, `refineSyncedToVoice`,
`paintWords`, los 32 estilos de letras) sigue igual, porque el objeto `A` tiene el
mismo formato.

---

## 4. Empaquetar el binario con la app

En `package.json` → `build.files` agrega el ejecutable compilado:

```json
"extraResources": [
  { "from": "rust-voice/target/release/voice-analyzer.exe", "to": "voice-analyzer.exe" }
]
```

Y en `main.js` usa `process.resourcesPath` en producción:

```js
const bin = app.isPackaged
  ? path.join(process.resourcesPath, 'voice-analyzer.exe')
  : path.join(__dirname, 'rust-voice', 'target', 'release', 'voice-analyzer.exe');
```

> Recuerda que la **actualización ligera** actual solo reemplaza `app.asar`. Si el
> binario Rust cambia, hay que subirlo también en la release (o empaquetarlo dentro
> de `app.asar` con `asarUnpack`).

---

## 5. Por qué merece la pena

| Tarea | JS actual | Rust |
|---|---|---|
| FFT + bandas de voz | WebAudio (ok) | `rustfft` (mucho más rápido) |
| Detección de onsets/frases | heurística JS | igual pero ~10–50× más rápida |
| Analizar un álbum entero | CPU alta, bloquea | rápido, paralelizable con `rayon` |
| Precisión | buena | buena + umbrales adaptativos |

Si quieres, el siguiente paso es que instales Rust y compilamos el binario para
probarlo con una canción real (MP3) usando `symphonia`.
