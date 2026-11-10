// Analizador de voz para el reproductor de música — v2 (Rust)
//
// Uso:  voice-analyzer <archivo>
// Acepta MP3, MP4/M4A (AAC), OGG/Vorbis, FLAC y WAV (vía symphonia).
//
// Salida JSON (mismo contrato que usa index.html):
//   { engine:"rust", sample_rate, duration, step, phrases:[{t,end,eff}], onsets:[...] }
//   `eff` = segundos cantados dentro de la frase (no un ratio), igual que el JS.
//
// Mejoras de esta versión:
//   1. ONSETS con SPECTRAL FLUX (suma de incrementos del espectro), más preciso
//      que la subida bruta de RMS.
//   2. DETECCIÓN DE VOZ con HNR (relación armónico/ruido) estimada por
//      autocorrelación (FFT inversa del espectro de potencia en la banda vocal).
//   3. SUAVIZADO ADAPTATIVO POR CANCIÓN: la ventana de suavizado y los umbrales
//      se derivan de la propia canción (percentiles + intervalo entre ataques).
//   4. Campo "engine":"rust" para que la app marque el .lrc y fuerce una única
//      re-análisis al cambiar de motor.
//
// Igual que antes: NO mueve la letra, solo informa.

use std::env;
use std::fs::File;
use std::path::Path;
use std::process;

use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde::Serialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Serialize, Clone)]
struct Phrase {
    t: f32,
    end: f32,
    eff: f32,
}

#[derive(Serialize)]
struct Analysis {
    engine: &'static str,
    sample_rate: u32,
    duration: f32,
    step: f32,
    phrases: Vec<Phrase>,
    onsets: Vec<f32>,
}

fn load_audio(path: &str) -> Result<(Vec<f32>, u32), String> {
    let file = File::open(path).map_err(|e| format!("abrir archivo: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("detectar formato: {e}"))?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "sin pista de audio".to_string())?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decodificador: {e}"))?;

    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(format!("leer paquete: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                let channels = spec.channels.count().max(1);
                let mut sbuf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                sbuf.copy_interleaved_ref(decoded);
                for frame in sbuf.samples().chunks(channels) {
                    mono.push(frame.iter().sum::<f32>() / channels as f32);
                }
            }
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("decodificar: {e}")),
        }
    }
    if mono.is_empty() {
        return Err("audio sin muestras".to_string());
    }
    Ok((mono, sample_rate))
}

struct Biquad {
    b0: f32, b1: f32, b2: f32, a1: f32, a2: f32,
    x1: f32, x2: f32, y1: f32, y2: f32,
}
impl Biquad {
    fn new(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0,
               x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
    fn highpass(fs: f32, f0: f32, q: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let c = w0.cos();
        let a = w0.sin() / (2.0 * q);
        Self::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + a, -2.0 * c, 1.0 - a)
    }
    fn lowpass(fs: f32, f0: f32, q: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let c = w0.cos();
        let a = w0.sin() / (2.0 * q);
        Self::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + a, -2.0 * c, 1.0 - a)
    }
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x;
        self.y2 = self.y1; self.y1 = y;
        y
    }
}

fn percentile(sorted: &[f32], p: f32) -> f32 {
    if sorted.is_empty() { return 0.0; }
    let idx = ((sorted.len() as f32 * p) as usize).min(sorted.len() - 1);
    sorted[idx]
}

fn sorted_copy(v: &[f32]) -> Vec<f32> {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    s
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("uso: voice-analyzer <archivo.mp3|m4a|ogg|flac|wav>");
        process::exit(2);
    }

    let (samples, sr) = match load_audio(&args[1]) {
        Ok(v) => v,
        Err(e) => { eprintln!("{e}"); process::exit(1); }
    };

    let duration = samples.len() as f32 / sr as f32;

    // Banda vocal 250–3400 Hz (para RMS/autocorrelación)
    let mut hp = Biquad::highpass(sr as f32, 250.0, 0.7);
    let mut lp = Biquad::lowpass(sr as f32, 3400.0, 0.7);
    let filtered: Vec<f32> = samples.iter().map(|&s| lp.process(hp.process(s))).collect();

    const FRAME: usize = 1024;
    let hop = ((sr as f32 * 0.02).round() as usize).max(1);
    let n = if filtered.len() >= FRAME {
        (filtered.len() - FRAME) / hop + 1
    } else {
        0
    };

    let empty = |dur: f32, step: f32| Analysis {
        engine: "rust",
        sample_rate: sr,
        duration: dur,
        step,
        phrases: Vec::new(),
        onsets: Vec::new(),
    };

    if n < 12 {
        println!("{}", serde_json::to_string(&empty(duration, hop as f32 / sr as f32)).unwrap());
        return;
    }

    // Ventana Hann
    let mut hann = vec![0.0f32; FRAME];
    for (i, w) in hann.iter_mut().enumerate() {
        *w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FRAME - 1) as f32).cos());
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FRAME);
    let ifft = planner.plan_fft_inverse(FRAME);
    let mut buf = vec![Complex32::new(0.0, 0.0); FRAME];
    let mut power = vec![Complex32::new(0.0, 0.0); FRAME];
    let mut prev_mag = vec![0.0f32; FRAME / 2];

    let bin_hz = sr as f32 / FRAME as f32;
    let min_lag = ((sr as f32 / 400.0) as usize).max(1);
    let max_lag = (((sr as f32 / 70.0) as usize).min(FRAME / 2 - 1)).max(min_lag + 1);

    let mut rms = vec![0.0f32; n];
    let mut vocal_ratio = vec![0.0f32; n];
    let mut hnr = vec![0.0f32; n];
    let mut flux = vec![0.0f32; n];

    for f in 0..n {
        let start = f * hop;
        let mut sum_sq = 0.0f32;
        for i in 0..FRAME {
            let v = filtered[start + i];
            sum_sq += v * v;
            buf[i] = Complex32::new(v * hann[i], 0.0);
        }
        rms[f] = (sum_sq / FRAME as f32).sqrt();

        fft.process(&mut buf);

        let mut total = 0.0f32;
        let mut vocal = 0.0f32;
        let mut fx = 0.0f32;
        for k in 0..FRAME / 2 {
            let mag = buf[k].norm();
            total += mag;
            let hz = k as f32 * bin_hz;
            let in_vocal = hz >= 250.0 && hz <= 3400.0;
            if in_vocal { vocal += mag; }
            // Spectral flux: solo incrementos positivos
            let d = mag - prev_mag[k];
            if d > 0.0 { fx += d; }
            prev_mag[k] = mag;
            power[k] = if in_vocal {
                Complex32::new(mag * mag, 0.0)
            } else {
                Complex32::new(0.0, 0.0)
            };
        }
        for k in FRAME / 2..FRAME {
            power[k] = Complex32::new(0.0, 0.0);
        }

        vocal_ratio[f] = if total > 1e-9 { vocal / total } else { 0.0 };
        flux[f] = if total > 1e-9 { fx / total } else { 0.0 };

        // HNR: autocorrelación (IFFT del espectro de potencia vocal) y pico en
        // el rango de pitch humano 70–400 Hz.
        ifft.process(&mut power);
        let ac0 = power[0].re / FRAME as f32;
        let mut rmax = 0.0f32;
        if ac0 > 1e-9 {
            for lag in min_lag..=max_lag {
                let r = (power[lag].re / FRAME as f32) / ac0;
                if r > rmax { rmax = r; }
            }
        }
        hnr[f] = rmax.clamp(0.0, 1.0);
    }

    // ---- 3) Suavizado adaptativo por canción ----
    // Se estima el ritmo de ataques (IOI = intervalo entre picos de flux) y se
    // ajusta la ventana de suavizado de la envolvente.
    if env::var("RMS_DUMP").is_ok() {
        let fs_ = hop as f32 / sr as f32;
        for f in 0..n {
            println!("{:.3},{:.5},{:.3}", f as f32 * fs_, rms[f], hnr[f]);
        }
        return;
    }
    let flux_sorted = sorted_copy(&flux);
    let f90 = percentile(&flux_sorted, 0.90);
    let mut peaks: Vec<usize> = Vec::new();
    for f in 1..n - 1 {
        if flux[f] >= f90 && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1] {
            peaks.push(f);
        }
    }
    let mut iois: Vec<f32> = Vec::new();
    for w in peaks.windows(2) {
        let d = (w[1] - w[0]) as f32;
        if d > 0.0 { iois.push(d); }
    }
    let med_ioi = if iois.is_empty() {
        6.0
    } else {
        iois.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        iois[iois.len() / 2]
    };
    let smooth_len = ((med_ioi * 0.5).round() as usize).clamp(2, 8);
    let half = smooth_len / 2;
    let mut rms_s = vec![0.0f32; n];
    for f in 0..n {
        let a = f.saturating_sub(half);
        let b = (f + half).min(n - 1);
        let mut s = 0.0f32;
        for k in a..=b { s += rms[k]; }
        rms_s[f] = s / (b - a + 1) as f32;
    }

    // Umbrales por percentiles (adaptativos a la mezcla)
    let rs = sorted_copy(&rms_s);
    let noise = percentile(&rs, 0.20);
    let loud = percentile(&rs, 0.92);
    let range = loud - noise;
    if range <= 0.003 {
        println!("{}", serde_json::to_string(&empty(duration, hop as f32 / sr as f32)).unwrap());
        return;
    }
    let th_on = noise + range * 0.30;
    let th_off = noise + range * 0.15;

    // Umbral de HNR adaptativo: percentil 35 entre las tramas con energía.
    let mut hv: Vec<f32> = (0..n).filter(|&f| rms_s[f] > th_on).map(|f| hnr[f]).collect();
    hv.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let hnr_thr = if hv.is_empty() { 0.28 } else { percentile(&hv, 0.25) }.clamp(0.22, 0.62);

    // Modulación silábica (voz cambia de energía cada sílaba; instrumentos sostenidos no)
    const W: usize = 13;
    let mut slow = vec![0.0f32; n];
    let mut acc = 0.0f32;
    for f in 0..n {
        acc += rms_s[f];
        if f >= W { acc -= rms_s[f - W]; }
        slow[f] = acc / (f + 1).min(W) as f32;
    }
    let mut modv = vec![0.0f32; n];
    for f in 0..n { modv[f] = (rms_s[f] - slow[f]).abs(); }
    let mut mark = vec![0.0f32; n];
    for f in 0..n {
        let lo = f.saturating_sub(1);
        let hi = (f + 1).min(n - 1);
        let mut s = 0.0f32;
        for k in lo..=hi { s += modv[k]; }
        mark[f] = s / (hi - lo + 1) as f32;
    }
    let ms = sorted_copy(&mark);
    let m_noise = percentile(&ms, 0.30);
    let m_loud = percentile(&ms, 0.90);
    let m_range = (m_loud - m_noise).max(1e-6);
    let m_on = m_noise + m_range * 0.30;
    let m_off = m_noise + m_range * 0.15;

    // Actividad vocal: energía + banda vocal + armonicidad (HNR) + modulación
    let active: Vec<bool> = (0..n)
        .map(|f| rms_s[f] > th_on && vocal_ratio[f] > 0.08 && hnr[f] >= hnr_thr && mark[f] >= m_on)
        .collect();

    // Frases
    let frame_sec = hop as f32 / sr as f32;
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut is_active = false;
    let mut start_f = 0usize;
    let mut quiet = 0usize;
    for f in 0..n {
        if !is_active {
            if active[f] {
                is_active = true;
                start_f = f;
                quiet = 0;
            }
        } else if rms_s[f] >= th_off && mark[f] >= m_off && hnr[f] >= hnr_thr * 0.9 {
            quiet = 0;
        } else {
            quiet += 1;
            if quiet >= 8 {
                runs.push((start_f, f - quiet));
                is_active = false;
            }
        }
    }
    if is_active {
        runs.push((start_f, n - 1));
    }

    // Suavizado adaptativo de las pausas: fusión según el IOI medido
    let merge_gap = (med_ioi * frame_sec * 3.0).clamp(0.45, 1.2);
    let mut phrases: Vec<Phrase> = Vec::new();
    for (a, b) in runs {
        let t0 = a as f32 * frame_sec;
        let t1 = (b + 1) as f32 * frame_sec;
        if t1 - t0 < 0.18 { continue; }
        if let Some(last) = phrases.last_mut() {
            if t0 - last.end < merge_gap {
                last.end = last.end.max(t1);
                continue;
            }
        }
        phrases.push(Phrase { t: t0, end: t1, eff: 0.0 });
    }

    // eff = segundos cantados dentro de la frase
    for p in phrases.iter_mut() {
        let i0 = (p.t / frame_sec).ceil() as usize;
        let i1 = ((p.end / frame_sec).ceil() as usize).min(n);
        let mut c = 0usize;
        for f in i0..i1 {
            if rms_s[f] >= th_off { c += 1; }
        }
        p.eff = c as f32 * frame_sec;
    }

    // ---- 1) Onsets por spectral flux ----
    let in_phrase = |t: f32| phrases.iter().any(|p| t >= p.t - 0.06 && t <= p.end);
    let mut fv: Vec<f32> = Vec::new();
    for f in 0..n {
        let t = f as f32 * frame_sec;
        if in_phrase(t) && rms_s[f] >= th_off {
            fv.push(flux[f]);
        }
    }
    fv.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let f_thr = if fv.is_empty() { f32::INFINITY } else { percentile(&fv, 0.70) };

    let mut onsets: Vec<f32> = Vec::new();
    let mut last_p: isize = -10;
    if n >= 5 {
        for f in 2..n - 2 {
            let t = f as f32 * frame_sec;
            if !in_phrase(t) || rms_s[f] < th_off { continue; }
            if flux[f] < f_thr { continue; }
            if flux[f] < flux[f - 1] || flux[f] < flux[f + 1]
                || flux[f] < flux[f - 2] || flux[f] < flux[f + 2] { continue; }
            if (f as isize) - last_p < 5 { continue; }
            last_p = f as isize;
            onsets.push(t);
        }
    }

    let out = Analysis {
        engine: "rust",
        sample_rate: sr,
        duration,
        step: frame_sec,
        phrases,
        onsets,
    };
    println!("{}", serde_json::to_string(&out).unwrap());
}
