// キーの形（model.json の keyEye・keyMouth）で、目と口を動かす。
// 差分シートの各コマを「キーの形」（絵 + 線）として持ち、キーとキーの間を、線の変形でつなぐ。絵は入れ替えない:
//   どのキーの絵も、「今の線」へ変形してから、重みを付けて重ねる（同じ線に乗っているので、重ねても二重にならない）。
// Live2D でモデラーが手で作るキーフォームを、画像生成のシートから作ったもの。
//
//   目: キーごとに、上まつげの帯の上のふち T・下のふち B・下まぶたの線 L（白目の列ごと）。絵は、まつげだけ（瞳と白目は別のパーツ）。
//       軸は 開き o（0〜1.2）・笑い s（0〜1）・傾き（−1 困り 〜 +1 にらみ）・ジト目・ぎゅっと閉じる。
//   口: キーごとに、外形の上の線 U・下の線 Lo と、左右の口角。重みは、表情と口パクが決める。
//
// 重ね方: キーの絵を、足して 1 になる重みで「加算」した 1 枚を作ってから、画面に重ねる（makeLayer）。2 枚を半透明で順に重ねると、
// 下の肌が透けて、切り替わりの途中でまつげが薄くなる。

export function setupKeyShapes(env) {
  const { gl, model, byName, eyes, makeTexture, makeMesh, drawRaw, clamp, lerp, sstep } = env;
  const out = [0, 0];

  // ---- 目 ----------------------------------------------------------------------
  const BASE = [['closed', 0], ['o20', 0.2], ['o50', 0.5], ['o70', 0.7], ['open', 1], ['wide', 1.2]];
  const ROWS = 8;   // 上の端 / T / T と B のまん中 / B / B〜L を 3 等分する 2 本 / L / 下の端
  function makeKeyEye(key) {
    const KE = model.keyEye && model.keyEye[key];
    if (!KE) return null;
    const e = eyes[key], n = e.n, xa = e.xa;
    const K = {};
    const mk = (nm, L, k, fAbove) => {
      const nx = Math.max(6, Math.ceil(L.w / 9)), nv = (nx + 1) * ROWS;
      const rest = new Float32Array(nv * 2), uv = new Float32Array(nv * 2), col = new Int16Array(nx + 1), idx = [];
      for (let i = 0; i <= nx; i++) {
        const x = L.x + (L.w * i) / nx, j = clamp(Math.round(x - xa), 0, n - 1);
        col[i] = j;
        const T = k.T[j], B = Math.max(k.B[j], T + 1), Lw = Math.max(k.L[j], B);
        const top = Math.min(L.y, T - 1), bot = Math.max(L.y + L.h, Lw + 1);
        const ys = [top, T, (T + B) / 2, B, B + (Lw - B) / 3, B + (2 * (Lw - B)) / 3, Lw, bot];
        for (let r = 0; r < ROWS; r++) {
          const v = i * ROWS + r;
          rest[v * 2] = x; rest[v * 2 + 1] = ys[r];
          uv[v * 2] = i / nx; uv[v * 2 + 1] = (ys[r] - L.y) / L.h;
          if (i < nx && r < ROWS - 1) idx.push(v, v + ROWS, v + 1, v + 1, v + ROWS, v + ROWS + 1);
        }
      }
      const mesh = makeMesh(new Float32Array(nv * 2), uv, new Uint16Array(idx));
      return { nm, L, k, nx, col, rest, mesh, tex: makeTexture(L.img), w: 0, fAbove, closed: !!k.closed };
    };
    const arr = (v) => Float32Array.from(v);
    for (const nm in KE) {
      const L = byName['目キー_' + nm + key];
      if (!L || !KE[nm].T) continue;
      const k = { T: arr(KE[nm].T), B: arr(KE[nm].B), L: arr(KE[nm].L), closed: KE[nm].closed };
      K[nm] = mk(nm, L, k, 1);
    }
    if (!K.open || !K.closed) return null;
    // under: 下まつげと二重の線。二重の線（帯より上）は、帯の動きの 4 割だけついていく（形は変えない）
    // corner: 目尻・目頭の線。目が細くなると、まつげの帯に隠れて消える
    const under = byName['目キー_under' + key] ? mk('under', byName['目キー_under' + key], K.open.k, 0.4) : null;
    const corner = byName['目キー_corner' + key] ? mk('corner', byName['目キー_corner' + key], K.open.k, 1) : null;
    // crease: 二重の線。半目のコマ（model.keyEyeCrease）から取った、端から端まで途切れない 1 本。まつげの下に敷いて、帯の動きの 4 割だけ動かす。
    // 開いた目では、左半分が、まつげの帯とはねの下に隠れる（描かれた絵と同じ）。目を閉じると、帯が下がって、線の全体が、まぶたに残る
    // （開いた目のコマから取ると、見えている右の 4 割しか取れず、閉じた目の上に、短い切れ端が浮いた）
    const ck = model.keyEyeCrease, cL = byName['目キー_crease' + key];
    const crease = cL && ck && K[ck] ? mk('crease', cL, K[ck].k, 0.4) : null;
    const has = (nm) => !!K[nm];
    // 途中のキー（o20・o50・o70）を置く「開きの値」は、名前の数字ではなく、その絵の実際の開き（目のまん中あたりの、上下のまぶたの間の高さ ÷ 開いた目の高さ）にする。
    // 描かせたコマは、指示どおりの開きにならない（kurage02: 「ほぼ閉じ（2 割）」のコマの開きが 35% あった）。名前の数字の位置に置くと、
    // 開きの値と見た目の開きが比例せず、閉じる速さが区間ごとに変わる（最後の 0.2 → 0 だけ、ほかの 3 倍の速さで閉じた）。
    // 面積ではなく、高さで測る（面積は、目が細くなると幅も縮むぶん、早く減る。まぶたの動く速さを、そろえたい）
    const area = (nm) => { const k = K[nm].k; let s = 0; for (let i = Math.floor(n * 0.25); i < Math.ceil(n * 0.75); i++) s += Math.max(k.L[i] - k.B[i], 0); return s; };
    let base = BASE.filter(([nm]) => has(nm)).map(([nm, v]) => [nm, v]);
    {
      const a0 = area('open'), mid = base.filter(([nm]) => nm !== 'closed' && nm !== 'open' && nm !== 'wide');
      const cal = mid.map(([nm]) => area(nm) / Math.max(a0, 1));
      if (a0 > 1 && cal.every((v, i) => v > 0.03 && v < 0.97 && (i === 0 || v > cal[i - 1] + 0.03))) mid.forEach((e, i) => { e[1] = cal[i]; });
    }
    const T = new Float32Array(n), B = new Float32Array(n), Lw = new Float32Array(n);
    const ke = { K, under, T, B, Lw, apert: 1 };
    const add = (k, w) => { if (!w) return; for (let i = 0; i < n; i++) { T[i] += w * k.T[i]; B[i] += w * k.B[i]; Lw[i] += w * k.L[i]; } };
    // 開き o での、ふつうの目の線と絵の重み（となりの 2 つのキーの間）
    const baseW = (o, f, wt) => {
      let a = base[0], b = base[0], t = 0;
      if (o >= base[base.length - 1][1]) a = b = base[base.length - 1];
      else for (let i = 0; i < base.length - 1; i++) if (o >= base[i][1] && o <= base[i + 1][1]) { a = base[i]; b = base[i + 1]; t = (o - a[1]) / (b[1] - a[1]); break; }
      wt[a[0]] = (wt[a[0]] || 0) + f * (1 - t); wt[b[0]] = (wt[b[0]] || 0) + f * t;
    };
    const wG = {}, wI = {};
    const REST = clamp(typeof model.keyEyeRest === 'number' ? model.keyEyeRest : 1, 0.6, 1);
    const XF = (t) => sstep(0.38, 0.62, t);                                               // 絵を入れ替える、短い間
    // そのキーで使う絵。途中のキー（o20・o50・o70）と見開き（wide）は、線だけを使い、絵は、開いた目（open）の絵を変形して使う。
    // 絵が替わるのは、閉じる直前（閉じた目のキーと、いちばん近い途中のキーの間のまん中）の 1 回だけ。
    // 途中のキーの絵も使うと、入れ替わる所が増えて、止めた値（半目 0.5 など）が、ちょうど入れ替わりの途中に当たり、2 枚が重なって見える
    const pic = (nm) => ((nm === 'o20' || nm === 'o50' || nm === 'o70' || nm === 'wide') && K.open ? 'open' : nm);
    ke.update = (o, s, tilt, jito, shut) => {
      o = clamp(o, 0, 1.2); s = has('smileClosed') && has('smileNarrow') ? clamp(s, 0, 1) : 0;
      const o1 = Math.min(o, 1);
      // ふだんの開き（model.keyEyeRest）: 開きの値 1 を、開いた目のキーの REST 倍の開きにする（シートの開いた目が、基準画像より開いて描かれたとき）。
      // 0〜1 は 0〜REST へ、1〜1.2（見開き）は REST〜1.2 へ
      if (REST < 1) o = o <= 1 ? o * REST : REST + (o - 1) * (1.2 - REST) / 0.2;
      const sad = has('sad') ? clamp(-tilt, 0, 1) * o1 : 0, gl_ = has('glare') ? clamp(tilt, 0, 1) * o1 : 0, jt = has('jito') ? clamp(jito, 0, 1) * o1 : 0;
      const sh = has('shut') ? clamp(shut, 0, 1) : 0;
      // --- 線: ふつうの目（開き）と笑った目（開き）を s で混ぜ、傾き・ジト目は、開いた目との差を足す
      for (const k in wG) wG[k] = 0;
      baseW(o, 1 - s, wG);
      if (s > 0) { wG.smileClosed = (wG.smileClosed || 0) + s * (1 - o1); wG.smileNarrow = (wG.smileNarrow || 0) + s * o1; }
      if (sh > 0 && wG.closed) { wG.shut = (wG.shut || 0) + wG.closed * sh; wG.closed *= 1 - sh; }
      T.fill(0); B.fill(0); Lw.fill(0);
      for (const k in wG) if (wG[k]) add(K[k].k, wG[k]);
      const md = sad + gl_ + jt;
      if (md > 0) { add(K.open.k, -md); if (sad) add(K.sad.k, sad); if (gl_) add(K.glare.k, gl_); if (jt) add(K.jito.k, jt); }
      let ap = 0, ap0 = 0;
      const ko = K.open.k;
      for (let i = 0; i < n; i++) {
        if (Lw[i] < B[i]) { const m = (Lw[i] + B[i]) / 2; Lw[i] = B[i] = m; }
        if (T[i] > B[i] - 2) T[i] = B[i] - 2;
        ap += Lw[i] - B[i]; ap0 += ko.L[i] - ko.B[i];
        // 白目: 上のふちは、まつげの帯の下のふちと同じだけ、下のふちは、下まぶたの線と同じだけ動かす
        const hgt = Lw[i] - B[i];
        e.Ut[i] = B[i] - Math.min(4, hgt);            // 開きが無い列（目頭・目尻の外、閉じた目）では、もぐらせない（高さ 0 にして消す）
        e.Lt[i] = Math.max(Lw[i] + Math.min(1.5, hgt), e.Ut[i]);
      }
      ke.apert = ap / Math.max(ap0, 1);
      // --- 絵の重み（足して 1）。2 枚の絵を半々に溶かすと、帯から上へ出る毛（絵ごとに位置が違う）が、二重に薄く見える。
      // 線は、なめらかに動かしたまま、**絵は、いつも 1 枚だけ**にして、切り替わる所の短い間（XF）だけ、重ねて入れ替える。
      // 前は、区間の半分で溶かし、傾き・ジト目・笑いは、強さのぶんだけ溶かしていた: 止めた値（表情の 目の開き 1.1、傾き 0.35、笑い 0.7、
      // カメラで追った半目）で、2 枚が半透明のまま重なって、はねが二重に見えた
      for (const k in wI) wI[k] = 0;
      // (1) ふつうの目: 開き o の、となりの 2 キーの絵。o50・o70・wide は、線だけを使い、絵は、開いた目（open）の絵を変形して使う
      //     （ふだんの開き 0.6〜1.2 を、1 枚の絵だけで通す。絵が替わるのは、まばたきで通りすぎる、半目より下だけ）
      {
        let a = base[0], b = base[0], t = 0;
        if (o >= base[base.length - 1][1]) a = b = base[base.length - 1];
        else for (let i = 0; i < base.length - 1; i++) if (o >= base[i][1] && o <= base[i + 1][1]) { a = base[i]; b = base[i + 1]; t = (o - a[1]) / Math.max(b[1] - a[1], 1e-6); break; }
        const pa = pic(a[0]), pb = pic(b[0]), x = pa === pb ? 0 : XF(t);
        wI[pa] = (wI[pa] || 0) + 1 - x; wI[pb] = (wI[pb] || 0) + x;
      }
      // ぎゅっと閉じる: 閉じた目の絵のぶんを、入れ替える
      if (sh > 0 && wI.closed) { const x = XF(sh); wI.shut = (wI.shut || 0) + wI.closed * x; wI.closed *= 1 - x; }
      // (2) 笑い: 笑った目の絵（開いていれば 細めた目、閉じていれば ⌒）へ、入れ替える
      if (s > 0) {
        const x = XF(s), nr = XF(o1);
        if (x > 0) { for (const k in wI) wI[k] *= 1 - x; wI.smileNarrow = (wI.smileNarrow || 0) + x * nr; wI.smileClosed = (wI.smileClosed || 0) + x * (1 - nr); }
      }
      // (3) 傾き・ジト目: いちばん強いものの絵へ、入れ替える（2 つが同じくらい強いときだけ、分ける）
      if (md > 0) {
        const x = XF(Math.min(md, 1));
        if (x > 0) {
          const p4 = (v) => v * v * v * v, q = p4(sad) + p4(gl_) + p4(jt);
          for (const k in wI) wI[k] *= 1 - x;
          if (sad) wI.sad = (wI.sad || 0) + x * p4(sad) / q;
          if (gl_) wI.glare = (wI.glare || 0) + x * p4(gl_) / q;
          if (jt) wI.jito = (wI.jito || 0) + x * p4(jt) / q;
        }
      }
      for (const nm in K) K[nm].w = wI[nm] || 0;
    };
    const place = (q, dy = 0) => {
      const m = q.mesh, d = m.pos, r = q.rest, k = q.k;
      for (let i = 0; i <= q.nx; i++) {
        const j = q.col[i], Tc = T[j], Bc = B[j];
        // このキーで、目の開きが無い列（閉じた目、目頭・目尻の外）は、今の目が開いていても、開きのぶんを引き伸ばさない
        // （帯の下のふちの 1 行が、開きいっぱいに縦へ伸びて、縞になる）。帯の下は、帯と一緒に動かす
        const flat = k.L[j] - k.B[j] < 2, Lc = flat ? Bc : Lw[j];
        const x = e.lashX(r[i * ROWS * 2]);
        const v0 = i * ROWS;
        for (let rr = 0; rr < ROWS; rr++) {
          let y;
          switch (rr) {
            case 0: y = r[v0 * 2 + 1] + (Tc - k.T[j]) * q.fAbove; break;
            case 1: y = k.T[j] + (Tc - k.T[j]) * q.fAbove; break;
            case 2: y = (k.T[j] + (Tc - k.T[j]) * q.fAbove + Bc) / 2; break;
            case 3: y = Bc; break;
            case 4: y = Bc + (Lc - Bc) / 3; break;
            case 5: y = Bc + (2 * (Lc - Bc)) / 3; break;
            case 6: y = Lc; break;
            default: y = r[(v0 + 7) * 2 + 1] + (Lc - Math.max(k.L[j], Math.max(k.B[j], k.T[j] + 1)));
          }
          e.group.apply(x, y + dy, out);
          d[(v0 + rr) * 2] = out[0]; d[(v0 + rr) * 2 + 1] = out[1];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    };
    // 下まつげ・目尻の線・二重の線（開いた目から取った 1 枚）。いつも見せる。ふつうに重ねる
    ke.drawUnder = () => {
      if (crease) { place(crease); drawRaw(crease.mesh, crease.tex, 1); }
      if (under) { place(under); drawRaw(under.mesh, under.tex, 1); }
      // 目尻の線と影は、開いた目の形のまま、まつげの帯について動かすだけなので、目が細くなると、白目との境目で、ぎざぎざにずれる。
      // 開きが 9 割を切ったら消しはじめ、6 割で消す（前は 7.5 割〜3 割。半目で、灰色の ぎざぎざ が目尻に残った）
      const ca = sstep(0.62, 0.92, ke.apert);
      if (corner && ca > 0.004) { place(corner); drawRaw(corner.mesh, corner.tex, ca); }
    };
    // まつげ（キーの絵を、重みで加算する。makeLayer の中で呼ぶ）
    ke.drawLash = (dy = 0) => { for (const nm in K) { const q = K[nm]; if (q.w > 0.004) { place(q, dy); drawRaw(q.mesh, q.tex, q.w); } } };
    return ke;
  }

  // ---- 口 ----------------------------------------------------------------------
  const NC = 24, MR = 7, PADX = 9, PADY = 7, STROKE = 6;
  const SHARP = typeof model.mouthKeySharp === 'number' ? model.mouthKeySharp : 0;
  function makeKeyMouth(group) {
    const KM = model.keyMouth;
    if (!KM) return null;
    const K = {}, names = [];
    for (const nm in KM.keys) {
      const L = byName['口キー_' + nm], k = KM.keys[nm];
      if (!L) continue;
      const N = k.U.length, U = Float32Array.from(k.U), Lo = Float32Array.from(k.Lo);
      const cols = NC + 3, nv = cols * MR;   // 左の余白 + NC+1 列 + 右の余白
      const rest = new Float32Array(nv * 2), uv = new Float32Array(nv * 2), uu = new Float32Array(cols), idx = [];
      for (let c = 0; c < cols; c++) {
        const u = clamp((c - 1) / NC, 0, 1), f = u * (N - 1), i0 = Math.min(Math.floor(f), N - 2), t = f - i0;
        const x = c === 0 ? k.xa - PADX : c === cols - 1 ? k.xb + PADX : k.xa + (k.xb - k.xa) * u;
        const Uy = lerp(U[i0], U[i0 + 1], t), Ly = Math.max(lerp(Lo[i0], Lo[i0 + 1], t), Uy + 1), sw = Math.min(STROKE, (Ly - Uy) / 2);
        const ys = [Uy - PADY, Uy, Uy + sw, (Uy + Ly) / 2, Ly - sw, Ly, Ly + PADY];
        uu[c] = c === 0 ? -1 : c === cols - 1 ? 2 : u;
        for (let r = 0; r < MR; r++) {
          const v = c * MR + r;
          rest[v * 2] = x; rest[v * 2 + 1] = ys[r];
          uv[v * 2] = (x - L.x) / L.w; uv[v * 2 + 1] = (ys[r] - L.y) / L.h;
          if (c < cols - 1 && r < MR - 1) idx.push(v, v + MR, v + 1, v + 1, v + MR, v + MR + 1);
        }
      }
      K[nm] = { nm, L, xa: k.xa, xb: k.xb, U, Lo, N, open: !!k.open, cols, uu, mesh: makeMesh(new Float32Array(nv * 2), uv, new Uint16Array(idx)), tex: makeTexture(L.img), wg: 0, wi: 0 };
      names.push(nm);
    }
    if (!K.closed) return null;
    const N = K.closed.N, cur = { xa: 0, xb: 0, U: new Float32Array(N), Lo: new Float32Array(N) };
    const W = {};                      // なめらかに追いかけた重み
    for (const nm of names) W[nm] = nm === 'closed' ? 1 : 0;
    const km = { K, names, W, cur, has: (nm) => !!K[nm], openAmt: 0 };
    // target: { キーの名前: 重み }。rate: 追いかける速さ（1/秒）
    km.step = (target, dt, rate) => {
      let s = 0;
      for (const nm of names) s += Math.max(target[nm] || 0, 0);
      const k = 1 - Math.exp(-dt * rate);
      let sw = 0;
      for (const nm of names) { const tg = s > 1e-4 ? Math.max(target[nm] || 0, 0) / s : (nm === 'closed' ? 1 : 0); W[nm] += (tg - W[nm]) * k; sw += W[nm]; }
      for (const nm of names) W[nm] /= sw || 1;
    };
    km.update = () => {
      // 形: 重みで、口角と上下の線を混ぜる
      cur.xa = cur.xb = 0; cur.U.fill(0); cur.Lo.fill(0);
      let wo = 0, wl = 0;
      for (const nm of names) {
        const w = W[nm], q = K[nm];
        if (w < 1e-4) continue;
        cur.xa += w * q.xa; cur.xb += w * q.xb;
        for (let i = 0; i < N; i++) { cur.U[i] += w * q.U[i]; cur.Lo[i] += w * q.Lo[i]; }
        if (q.open) wo += w; else wl += w;
      }
      km.openAmt = wo;
      // 母音ごとの形の足し（avatar.js の KM_SHAPE。操作パネルの「母音の口の大きさ」）: 重みで混ぜた倍率で、閉じた口のまん中の線から
      // 縦に伸び縮み（開き）、口のまん中から横に伸び縮み（幅）、上下にずらす（口の幅の 0.12 倍が 1）。絵は、この線に沿って変形する
      const SM = km.shapeMod;
      if (SM) {
        let sx = 0, sy = 0, dy = 0, ws = 0;
        for (const nm of names) { const w = W[nm]; if (w < 1e-4) continue; const m = SM[nm]; sx += w * (m ? m.width : 1); sy += w * (m ? m.open : 1); dy += w * (m ? m.y : 0); ws += w; }
        if (ws > 0) { sx /= ws; sy /= ws; dy /= ws; }
        if (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4 || Math.abs(dy) > 1e-4) {
          const c = (cur.xa + cur.xb) / 2, oy = dy * 0.12 * (cur.xb - cur.xa), KC = K.closed;
          cur.xa = c + (cur.xa - c) * sx; cur.xb = c + (cur.xb - c) * sx;
          for (let i = 0; i < N; i++) { const m = (KC.U[i] + KC.Lo[i]) / 2; cur.U[i] = m + (cur.U[i] - m) * sy + oy; cur.Lo[i] = m + (cur.Lo[i] - m) * sy + oy; }
        }
      }
      // 絵: 口の中が見えるキー（open）と、線だけのキーは、半々に溶かさない（口の中が薄く透けて見える）。
      // 開いたキーの重みが少しでも入ったら、開いたキーの絵にする（線だけの絵は、開く所ですぐ消える）
      const f = sstep(0.03, 0.2, wo);
      for (const nm of names) { const q = K[nm]; q.wi = q.open ? (wo > 1e-4 ? (W[nm] / wo) * f : 0) : (wl > 1e-4 ? (W[nm] / wl) * (1 - f) : 0); }
      if (wl <= 1e-4 && wo > 1e-4) for (const nm of names) { const q = K[nm]; if (q.open) q.wi = W[nm] / wo; }
      if (wo <= 1e-4) for (const nm of names) { const q = K[nm]; if (!q.open) q.wi = W[nm] / (wl || 1); }
      // 口の中が見えるキーどうしの絵は、重みの大きい方を優先する（model.mouthKeySharp = べき。書かなければ前と同じ = 重みのまま溶かす）。
      // 閉じた口にも歯が見える絵柄（ギザ歯など）では、閉じた口と開いた口の絵を半々に溶かすと、歯が二重に透けて見えた。形（線）は、重みのまま混ぜる
      if (SHARP > 0) {
        let so = 0, sp = 0;
        for (const nm of names) { const q = K[nm]; if (q.open && q.wi > 0) { so += q.wi; sp += Math.pow(q.wi, SHARP); } }
        if (sp > 0) for (const nm of names) { const q = K[nm]; if (q.open && q.wi > 0) q.wi = so * Math.pow(q.wi, SHARP) / sp; }
      }
    };
    const place = (q) => {
      const m = q.mesh, d = m.pos;
      for (let c = 0; c < q.cols; c++) {
        const u = clamp(q.uu[c], 0, 1), f = u * (N - 1), i0 = Math.min(Math.floor(f), N - 2), t = f - i0;
        const x = q.uu[c] < 0 ? cur.xa - PADX : q.uu[c] > 1 ? cur.xb + PADX : cur.xa + (cur.xb - cur.xa) * u;
        const Uy = lerp(cur.U[i0], cur.U[i0 + 1], t), Ly = Math.max(lerp(cur.Lo[i0], cur.Lo[i0 + 1], t), Uy + 1), sw = Math.min(STROKE, (Ly - Uy) / 2);
        const ys = [Uy - PADY, Uy, Uy + sw, (Uy + Ly) / 2, Ly - sw, Ly, Ly + PADY];
        for (let r = 0; r < MR; r++) {
          group.apply(x, ys[r], out);
          const v = c * MR + r;
          d[v * 2] = out[0]; d[v * 2 + 1] = out[1];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    };
    km.draw = () => { for (const nm of names) { const q = K[nm]; if (q.wi > 0.004) { place(q); drawRaw(q.mesh, q.tex, q.wi); } } };
    return km;
  }

  return { makeKeyEye, makeKeyMouth };
}
