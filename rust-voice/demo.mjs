// Demo del MISMO algoritmo del analizador Rust, en JS, para ver la salida
// sin necesidad de tener Rust instalado.
//
// Genera un WAV sintético con "frases cantadas" (tonos con armónicos) y silencios,
// ejecuta el análisis y muestra el JSON con el formato que consume index.html.
//
// Uso:  node demo.mjs

import fs from 'fs';
import path from 'path';

const SR = 44100;
const SECONDS = 10;

// --- 1) Genera señal sintética: frases vocales en 1-3s, 4.5-6.5s, 8-9.5s ---
const total = SR * SECONDS;
const x = new Float32Array(total);
function tone(start, end, freq, amp) {
  const a = Math.floor(start * SR), b = Math.floor(end * SR);
  for (let i = a; i < b && i < total; i++) {
    const t = (i - a) / SR;
    // Envolvente suave para que tenga ataques claros
    const env = Math.min(1, t / 0.05) * Math.min(1, (end - start - t) / 0.08);
    const s =
      Math.sin(2 * Math.PI * freq * t) * 0.6 +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.25 +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.15;
    x[i] += s * amp * Math.max(0, env);
  }
}
tone(1.0, 3.0, 220, 0.35);
tone(4.5, 6.5, 260, 0.35);
tone(8.0, 9.5, 200, 0.35);
// Ruido suave de fondo
for (let i = 0; i < total; i++) x[i] += (Math.random() - 0.5) * 0.01;

// --- 2) Escribe WAV PCM 16 bits (para poder pasárselo también al binario Rust) ---
const wavPath = path.join(process.cwd(), 'demo-sintetico.wav');
{
  const bytes = total * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < total; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(wavPath, buf);
}

// --- 3) Mismo algoritmo que src/main.rs ---
const FRAME = 1024, HOP = 256;
const VOCAL_LO = 250, VOCAL_HI = 3400;

function analyze(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const hann = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME - 1)));

  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  const rms = new Float32Array(frames);
  const vocalRatio = new Float32Array(frames);
  const binHz = sampleRate / FRAME;

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let sumSq = 0;
    const re = new Float32Array(FRAME), im = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      const v = samples[start + i];
      sumSq += v * v;
      re[i] = v * hann[i];
    }
    rms[f] = Math.sqrt(sumSq / FRAME);
    fft(re, im);
    let totalMag = 0, vocalMag = 0;
    for (let k = 0; k < FRAME / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      totalMag += mag;
      const hz = k * binHz;
      if (hz >= VOCAL_LO && hz <= VOCAL_HI) vocalMag += mag;
    }
    vocalRatio[f] = totalMag > 1e-9 ? vocalMag / totalMag : 0;
  }

  let mean = 0;
  for (let i = 0; i < frames; i++) mean += rms[i];
  mean /= frames;
  let varSum = 0;
  for (let i = 0; i < frames; i++) varSum += (rms[i] - mean) ** 2;
  const std = Math.sqrt(varSum / frames);
  const rmsThr = Math.max(mean + 0.35 * std, 0.004);

  const active = new Uint8Array(frames);
  for (let i = 0; i < frames; i++) active[i] = rms[i] > rmsThr && vocalRatio[i] > 0.12 ? 1 : 0;

  const frameDur = HOP / sampleRate;
  const phrases = [];
  let i = 0;
  while (i < frames) {
    if (!active[i]) { i++; continue; }
    const begin = i;
    let last = i, j = i + 1;
    while (j < frames) {
      if (active[j]) { last = j; j++; }
      else {
        let k = j;
        while (k < frames && !active[k]) k++;
        const gap = (k - j) * frameDur;
        if (k < frames && gap < 0.35) j = k;
        else break;
      }
    }
    const t = begin * frameDur;
    const end = (last + 1) * frameDur;
    if (end - t >= 0.15) {
      let effSum = 0, effN = 0;
      for (let idx = begin; idx <= last; idx++) { effSum += vocalRatio[idx]; effN++; }
      phrases.push({ t, end, eff: effSum / effN });
    }
    i = Math.max(j, i + 1);
  }

  const onsets = [];
  for (let i = 1; i < frames; i++) {
    const prev = rms[i - 1], cur = rms[i];
    const rise = cur > prev * 1.7 && cur > rmsThr;
    const fromSilence = prev < rmsThr * 1.15 && cur >= rmsThr;
    if ((rise || fromSilence) && vocalRatio[i] > 0.10) {
      const t = i * frameDur;
      if (!onsets.length || t - onsets[onsets.length - 1] > 0.12) onsets.push(t);
    }
  }

  return { sample_rate: sampleRate, duration, frames, hop: HOP, phrases, onsets };
}

// FFT iterativa simple (radix-2)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = nRe;
      }
    }
  }
}

const result = analyze(x, SR);
// Redondear tiempos para que el JSON sea legible
const pretty = {
  ...result,
  duration: +result.duration.toFixed(2),
  phrases: result.phrases.map(p => ({ t: +p.t.toFixed(2), end: +p.end.toFixed(2), eff: +p.eff.toFixed(3) })),
  onsets: result.onsets.map(t => +t.toFixed(2)),
};

console.log('WAV generado:', wavPath);
console.log('Frases vocales detectadas:', pretty.phrases.length);
console.log('Onsets detectados:', pretty.onsets.length);
console.log(JSON.stringify(pretty, null, 2));
