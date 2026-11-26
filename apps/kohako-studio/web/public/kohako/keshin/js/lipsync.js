// マイクの音から、いま出ている母音（あ・い・う・え・お）と声の大きさを推定する。外部の部品は使わない。
//
//   しくみ: 声を 11kHz ほどへ落とし、線形予測（LPC）で声道の響き（フォルマント F1・F2）を求め、
//           母音ごとの F1・F2 の中心との近さから、5 つの母音の重み（合計 1）を出す。
//           母音の中心は、話す人の声で登録し直せる（calibrate）。登録が無いときは、一般的な値に「声の高さ」の倍率を掛けて使う。
//   遅れ : 解析の窓が約 40ms、出力のならしが約 50ms
//
// 使い方:
//   const ls = await startLipSync();      // マイクの許可を求める
//   const r = ls.read();                  // 毎フレーム呼ぶ。{ vol: 0〜1, voiced: 0〜1, w: {a,i,u,e,o}, f1, f2 }
//   ls.calibrate('a', 1000).then(...)     // 「あ」と言っている間に呼ぶと、その声を「あ」として覚える
export const VOWELS = ['a', 'i', 'u', 'e', 'o'];
// 一般的な日本語の母音のフォルマント（Hz。成人男性寄りの値。scale で声の高さに合わせる）
const BASE = { a: [780, 1250], i: [290, 2300], u: [330, 1350], e: [480, 1900], o: [480, 850] };
const KEY = 'keshin2d.lipsync.v1';

export function loadSettings() {
  const d = { gate: 0.012, gain: 1, scale: 1.15, centers: null };
  try { Object.assign(d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 保存が使えない環境では既定値 */ }
  return d;
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify({ gate: s.gate, gain: s.gain, scale: s.scale, centers: s.centers })); } catch (e) { /* 同上 */ }
}

// LPC（自己相関法 + レビンソン・ダービン）。戻り値は予測係数 a[1..P]（a[0] = 1）
export function lpc(x, P) {
  const n = x.length, R = new Float64Array(P + 1);
  for (let k = 0; k <= P; k++) { let s = 0; for (let i = k; i < n; i++) s += x[i] * x[i - k]; R[k] = s; }
  if (R[0] < 1e-9) return null;
  R[0] *= 1.0001;                                   // 少しだけ白色雑音を足して安定させる
  const a = new Float64Array(P + 1), t = new Float64Array(P + 1);
  a[0] = 1; let E = R[0];
  for (let i = 1; i <= P; i++) {
    let acc = R[i];
    for (let j = 1; j < i; j++) acc += a[j] * R[i - j];
    const k = -acc / E;
    t.set(a);
    for (let j = 1; j < i; j++) a[j] = t[j] + k * t[i - j];
    a[i] = k; E *= 1 - k * k;
    if (E <= 0) return null;
  }
  return a;
}
// LPC の響きの山（フォルマント）を、低いほうから探す
export function formants(a, fs) {
  const P = a.length - 1, pk = [];
  let p2 = 0, p1 = 0;
  for (let f = 150; f <= 3600; f += 20) {
    const w = (2 * Math.PI * f) / fs; let re = 1, im = 0;
    for (let k = 1; k <= P; k++) { re += a[k] * Math.cos(k * w); im -= a[k] * Math.sin(k * w); }
    const p = 1 / (re * re + im * im);
    if (p1 > p2 && p1 >= p && f > 190) pk.push([f - 20, p1]);
    p2 = p1; p1 = p;
  }
  return pk;
}

// F2 は、F1 より上の山のうち、いちばん強いもの（声が高いと、倍音の弱い山が間に出るので、最初の山を取ると外れる）
export function pickF2(pk, f1) {
  let best = null;
  for (const q of pk) if (q[0] >= Math.max(f1 + 250, 650) && q[0] <= 3000 && (!best || q[1] > best[1])) best = q;
  return best;
}

export async function startLipSync(settings = loadSettings()) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  const ac = new AudioContext();
  const an = ac.createAnalyser();
  an.fftSize = 2048; an.smoothingTimeConstant = 0;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const dec = Math.max(1, Math.round(ac.sampleRate / 11025)), fs = ac.sampleRate / dec;
  const n = Math.floor(buf.length / dec), x = new Float64Array(n);
  const P = Math.round(fs / 1000) + 3;
  const st = { vol: 0, voiced: 0, w: { a: 0, i: 0, u: 0, e: 0, o: 0 }, f1: 0, f2: 0 };
  let lastT = performance.now(), cal = null;

  const centers = () => {
    const c = {};
    for (const v of VOWELS) c[v] = (settings.centers && settings.centers[v]) || [BASE[v][0] * settings.scale, BASE[v][1] * settings.scale];
    return c;
  };
  function analyse() {
    an.getFloatTimeDomainData(buf);
    let sum = 0, zc = 0;
    for (let i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; if (i && (buf[i] >= 0) !== (buf[i - 1] >= 0)) zc++; }
    const rms = Math.sqrt(sum / buf.length);
    const zcr = (zc * ac.sampleRate) / (2 * buf.length);                 // おおよその周波数（高いと、さ行などの息の音）
    // 間引き（平均でならしてから落とす）→ 高域を持ち上げる → 窓
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0; for (let j = 0; j < dec; j++) s += buf[i * dec + j];
      s /= dec;
      x[i] = (s - 0.97 * prev) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
      prev = s;
    }
    let f1 = 0, f2 = 0;
    if (rms > settings.gate * 0.6) {
      const a = lpc(x, P);
      if (a) {
        const pk = formants(a, fs);
        const c1 = pk.find((q) => q[0] >= 220 && q[0] <= 1200);
        if (c1) { f1 = c1[0]; const c2 = pickF2(pk, f1); if (c2) f2 = c2[0]; }
      }
    }
    return { rms, zcr, f1, f2 };
  }
  function read() {
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const r = analyse();
    const level = Math.min(1, Math.max(0, (r.rms - settings.gate) / (settings.gate * 9)) * settings.gain);
    const ok = r.f1 > 0 && r.f2 > 0 && r.zcr < 3000;
    // 音量は、上がるときは速く、下がるときは少しゆっくり（語尾でぱたんと閉じない）
    st.vol += (level - st.vol) * (1 - Math.exp(-dt / (level > st.vol ? 0.03 : 0.075)));
    st.voiced += ((ok && level > 0.02 ? 1 : 0) - st.voiced) * (1 - Math.exp(-dt / 0.05));
    if (ok && level > 0.02) {
      st.f1 += (r.f1 - st.f1) * (st.f1 ? 0.5 : 1); st.f2 += (r.f2 - st.f2) * (st.f2 ? 0.5 : 1);
      const C = centers(), d = {};
      let s = 0;
      for (const v of VOWELS) {
        const a = Math.log(st.f1 / C[v][0]), b = Math.log(st.f2 / C[v][1]);
        d[v] = Math.exp(-(a * a + b * b) / (2 * 0.2 * 0.2)) + 1e-6; s += d[v];
      }
      const k = 1 - Math.exp(-dt / 0.05);
      for (const v of VOWELS) st.w[v] += (d[v] / s - st.w[v]) * k;
      if (cal && cal.v) { cal.n++; cal.f1 += Math.log(r.f1); cal.f2 += Math.log(r.f2); }
    }
    return st;
  }
  // 今の声を、母音 v の中心として覚える（ms ミリ秒のあいだ集める）。read() が毎フレーム呼ばれていること
  function calibrate(v, ms = 1000) {
    return new Promise((resolve) => {
      cal = { v, n: 0, f1: 0, f2: 0 };
      setTimeout(() => {
        const c = cal; cal = null;
        if (c.n < 8) { resolve(null); return; }
        settings.centers = settings.centers || {};
        settings.centers[v] = [Math.round(Math.exp(c.f1 / c.n)), Math.round(Math.exp(c.f2 / c.n))];
        saveSettings(settings); resolve(settings.centers[v]);
      }, ms);
    });
  }
  return { read, calibrate, settings, stop: () => { for (const t of stream.getTracks()) t.stop(); ac.close(); } };
}
