'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const KEYS = { enter: '\r', up: '\x1b[A', down: '\x1b[B', esc: '\x1b', ctrlc: '\x03' };
  const REASONS = {
    'process-exit': 'CLI が終了しました。下の「状態を確認」で結果を確かめてください。',
    'stopped-by-owner': 'セッションを終了しました。',
    idle: '一定時間操作がなかったため終了しました。',
    'max-duration': '最大時間に達したため終了しました。',
    shutdown: 'サーバー再起動のため終了しました。'
  };
  let term = null, fit = null, ws = null, current = null, done = false;
  // URLs announced as OSC 8 hyperlinks (agy) are complete even when the visible
  // text is cut by a scrolled box; keep a short tail to match across chunks.
  let osc8 = [], tail = '';
  function scanOsc8(d) {
    const s = tail + d;
    const re = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)(?:\x07|\x1b\\)/g;
    let m;
    while ((m = re.exec(s)) !== null) { if (!osc8.includes(m[1])) osc8.push(m[1]); }
    tail = s.slice(-4096);
  }

  function setMsg(t) { $('#session-msg').textContent = t || ''; }
  function setProviderButtons(disabled) {
    document.querySelectorAll('.providers button').forEach((b) => { b.disabled = disabled; });
  }

  // Long OAuth URLs wrap in a narrow terminal; join wrapped rows before matching.
  function collectLinks() {
    if (!term) return;
    const buf = term.buffer.active;
    let text = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      text += (line.isWrapped ? '' : '\n') + line.translateToString(true);
    }
    const found = osc8.slice();
    (text.match(/https:\/\/[^\s"'<>]+/g) || []).forEach((u) => { if (!found.includes(u) && !osc8.some((o) => o.startsWith(u))) found.push(u); });
    const list = $('#link-list');
    list.textContent = '';
    found.forEach((u) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = u.length > 80 ? u.slice(0, 77) + '...' : u;
      li.appendChild(a); list.appendChild(li);
    });
    $('#links').hidden = found.length === 0;
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function sendInput(d) { if (d) send({ t: 'in', d: d }); }

  function ensureTerm() {
    if (term) return;
    term = new window.Terminal({ convertEol: false, fontSize: 13, scrollback: 2000, cursorBlink: true });
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('#term'));
    term.onData((d) => sendInput(d));
  }

  function connect(provider, attach) {
    current = provider; done = false;
    $('#session').hidden = false;
    $('#session-label').textContent = '(' + provider + ')';
    ensureTerm();
    fit.fit();
    setProviderButtons(true);
    const q = new URLSearchParams({ provider: provider, cols: String(term.cols), rows: String(term.rows) });
    if (attach) q.set('attach', '1');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?' + q);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.t === 'attached') { setMsg('接続しました。'); }
      else if (m.t === 'out') { scanOsc8(m.d); term.write(m.d, collectLinks); }
      else if (m.t === 'exit') { done = true; setMsg(REASONS[m.reason] || '終了しました。'); finish(); }
      else if (m.t === 'error') {
        done = true;
        setMsg(m.msg === 'ended' ? 'このログインは既に終了しています。「状態を確認」で結果を確かめてください。' : m.msg === 'busy' ? '別のログイン (' + (m.running || '?') + ') が進行中です。終了させてから選び直してください。' : '開始できませんでした。');
        finish();
      }
    };
    ws.onclose = () => {
      if (done) return;
      // The phone may drop the socket while the OAuth tab is open: re-attach.
      setMsg('再接続中…');
      setTimeout(() => { if (!done && current) connect(current, true); }, 1500);
    };
  }

  function finish() {
    current = null;
    setProviderButtons(false);
    if (ws) { try { ws.close(); } catch (_) {} }
  }

  document.querySelectorAll('.providers button').forEach((b) => {
    b.addEventListener('click', () => {
      if (term) term.reset();
      osc8 = []; tail = '';
      $('#link-list').textContent = ''; $('#links').hidden = true;
      connect(b.dataset.provider);
    });
  });
  document.querySelectorAll('.keys button').forEach((b) => {
    b.addEventListener('click', () => sendInput(KEYS[b.dataset.key]));
  });
  $('#paste-send').addEventListener('click', () => { sendInput($('#paste-input').value); $('#paste-input').value = ''; });
  $('#paste-send-enter').addEventListener('click', () => { sendInput($('#paste-input').value + '\r'); $('#paste-input').value = ''; });
  $('#stop').addEventListener('click', async () => {
    done = true;
    send({ t: 'stop' });
    try { await fetch('/api/session/stop', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
    setMsg(REASONS['stopped-by-owner']);
    finish();
  });

  const LABEL = {
    ok: '保存あり', incomplete: '保存あり(期限情報なし)', missing: '未ログイン', unreadable: '読めない',
    unsupported: '形式不明', policy_disallowed: 'API鍵(許可外)', not_read: '読まない契約'
  };
  $('#status').addEventListener('click', async () => {
    const tbody = $('#status-table tbody');
    tbody.textContent = '';
    let data;
    try { data = await (await fetch('/api/status', { credentials: 'same-origin' })).json(); }
    catch (_) { setMsg('状態を取得できませんでした。'); return; }
    (data.providers || []).forEach((p) => {
      const tr = document.createElement('tr');
      const notes = [];
      if (p.relogin_in_hours !== undefined) notes.push('再ログイン期限まで約' + p.relogin_in_hours + '時間');
      if (p.last_refresh_hours_ago !== undefined) notes.push('最終更新 ' + p.last_refresh_hours_ago + '時間前');
      if (p.last_run_auth_failure_at || p.last_run_success_at) {
        const fail = p.last_run_auth_failure_at || 0, ok = p.last_run_success_at || 0;
        notes.push('直近の実行: ' + (fail > ok ? '認証失敗' : '成功'));
      }
      [p.provider, LABEL[p.metadata] || p.metadata, notes.join(' / ') || '-'].forEach((t) => {
        const td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    $('#status-table').hidden = false;
    if (data.login_running) setMsg('ログイン処理 (' + data.login_running + ') が進行中です。');
  });

  // Resume an unfinished login (e.g. the page was reloaded after the OAuth tab).
  fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()).then((s) => {
    if (s.running) connect(s.running, true);
  }).catch(() => {});
})();
