/* ==========================================================================
   德法题库 · 验证码门禁（云端一次性核销 + 离线通行证兜底）
   1. 页面正文默认隐藏（body.gate-lock .app{display:none}），必须先过门禁；
   2. 验证码只存 SHA-256 前 16 位哈希，源码里看不到明文码；
   3. 主人码本地直放；普通码走 CFG.api（Cloudflare Worker）一次性核销；
   4. Worker 不可达（网络受限）时，可让发放人用管理台签一张离线通行证，
      通行证用 ECDSA P-256 签名、绑定本机设备码，页面用公钥离线验签。
   ========================================================================== */
(function () {
  var CFG = {"salt": "df2026-gate-0713", "owner": "256dc5db7645fe66", "codes": ["1cd58f5c8bafa76a", "7a0d1fe61851984b", "35bd0eb34003ca95", "99b93e39362f5b59", "f2599b2e2947130e", "324d1dd13a678398", "b5fa14a68c5a555e", "d5741899e296048d", "1888adaab76e50f8", "9f8c8e9f7cf69327", "4545f8a463f68663", "c5aa45365ac48095", "4037fa457298edb9", "21eab171bd4d26dd", "2ac27d394026a848", "312c7dae1624790f", "2ae1eab2dd11aa36", "729221bc1b396f8d", "4a282e65317b601a", "e457d757fcdcc194", "8fdb358a65b10649", "f7e94d4467026ee1", "6dca45b8adc11ea5", "0926756b83649d95", "d32699bbf7ec034b", "2eb44b3b634d63b2", "1fcf796a5fccc064", "3129aa87ce91532b", "fa286595b8fc5cdf", "61f1be283b910e36", "a31a40c20a76acef", "26d3e000c7770980", "420cae0b40e8329b", "492671e78c9048e0", "9597a0b2bef60241", "56002211e1e9d8d1", "abd6977cb1e6f07d", "af62a9d1f24aa0a2", "11080438e8f14df7", "191ce211b6d4dabc", "d5724a1715b05761", "e72970ec56e6dc59", "1f6498b73dbfcce6", "f7f287fa46ece79e", "ab1a52785e503c3a", "0221155a006bc9ba", "ecb3109cc4d82ab6", "02d6e7b44dcb62fe", "480005de807bffcb", "a1dfee35373b791f", "515cc3f2ded10735", "e5cbabe1a43b1014", "5a2d4af57de0712a", "b50988484c2d73db", "f51f84c304bc4006", "162bf2cfdc80aa25", "7540d8742eab0d97", "4f8950402219f694", "b9435a765511a052", "04f98f3c6375992d"], "days": 180, "api": "https://defa-gate.wulei2757678400.workers.dev", "pubkey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmBs3wzd4mLTr+Cwp7XGIUWAL4tcagZL7wx6qjnCMKWrSJS1EXyLKe+0EfrS0hawUd0Fal5LGWkWUB3C7kXXd1g=="};
  var KEY_TOK = 'dfquiz_gate_v1';
  var KEY_USED = 'dfquiz_used_v1';
  var KEY_DEV = 'dfquiz_dev_v1';
  var OVERLAY_ID = 'gate-overlay';

  /* ---------- SHA-256（纯 JS，file:// 下也能用） ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        c2 = str.charCodeAt(++i);
        cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function sha256Hex(ascii) {
    var bytes = utf8Bytes(String(ascii)), i, j;
    var byteLen = bytes.length;
    var bitLenHi = Math.floor((byteLen * 8) / 4294967296);
    var bitLenLo = (byteLen * 8) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff);
    bytes.push((bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);

    var H = H0.slice(), w = new Array(64);
    for (j = 0; j < bytes.length; j += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = ((bytes[j + i * 4] << 24) | (bytes[j + i * 4 + 1] << 16) | (bytes[j + i * 4 + 2] << 8) | bytes[j + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + hh) >>> 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  /* ---------- 基础工具 ---------- */
  function norm(s) { return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmtCode(s) {
    s = norm(s).slice(0, 14);
    if (s.length <= 2) return s;
    var tail = s.slice(2), parts = [];
    for (var i = 0; i < tail.length; i += 4) parts.push(tail.slice(i, i + 4));
    return 'DF-' + parts.join('-');
  }
  function b64urlBytes(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 设备码 ---------- */
  var ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function makeDev() {
    var s = '', i;
    for (i = 0; i < 8; i++) s += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
    return s.slice(0, 4) + '-' + s.slice(4);
  }
  function deviceCode() {
    var d = read(KEY_DEV, '');
    if (!d || String(d).length < 8) { d = makeDev(); write(KEY_DEV, d); }
    return d;
  }

  /* ---------- 凭证 ---------- */
  function tokenOK() {
    var t = read(KEY_TOK, null);
    if (!t || !t.h) return false;
    if (!t.o && t.e && Date.now() > t.e) return false;
    return true;
  }

  /* ---------- 门禁 UI ---------- */
  var CSS = [
    'body.gate-lock > *:not(#gate-overlay){display:none !important}',
    'body.gate-lock{overflow:hidden}',
    '#gate-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(120% 120% at 20% 0%,#F8F5EC 0%,#EFEDE5 45%,#E6E1D3 100%);',
    'font-family:var(--sans,"Noto Sans SC",system-ui,sans-serif);color:var(--ink,#16211E);padding:24px;overflow:auto}',
    '#gate-overlay .gcard{width:min(440px,100%);background:var(--surface,#FCFAF3);border:1px solid var(--line,#DDD8C9);',
    'border-radius:18px;box-shadow:0 2px 4px rgba(22,33,30,.05),0 24px 60px rgba(22,33,30,.12);padding:34px 30px 26px}',
    '#gate-overlay .gbrand{font-family:var(--serif,"Noto Serif SC",serif);font-size:13px;letter-spacing:.12em;color:var(--muted,#77837C);',
    'text-align:center;margin-bottom:18px}',
    '#gate-overlay h2{font-family:var(--serif,"Noto Serif SC",serif);font-size:22px;line-height:1.35;margin:0 0 10px;text-align:center;font-weight:600}',
    '#gate-overlay .gsub{font-size:13px;line-height:1.7;color:var(--ink-2,#3F4C46);text-align:center;margin:0 0 22px}',
    '#gate-overlay input,#gate-overlay textarea{width:100%;box-sizing:border-box;padding:13px 15px;font-size:16px;letter-spacing:.04em;',
    'text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid var(--line,#DDD8C9);border-radius:12px;',
    'background:#fff;color:var(--ink,#16211E);outline:none}',
    '#gate-overlay textarea{min-height:84px;text-align:left;font-size:12px;word-break:break-all;line-height:1.5}',
    '#gate-overlay input:focus,#gate-overlay textarea:focus{border-color:var(--green,#1E5A47);box-shadow:0 0 0 3px rgba(30,90,71,.12)}',
    '#gate-overlay button{width:100%;margin-top:12px;padding:13px;font-size:15px;font-weight:600;color:#fff;background:var(--green,#1E5A47);',
    'border:0;border-radius:12px;cursor:pointer;font-family:inherit;transition:filter .15s}',
    '#gate-overlay button:hover{filter:brightness(1.07)}',
    '#gate-overlay button:disabled{opacity:.65;cursor:default}',
    '#gate-overlay .gmsg{min-height:20px;margin-top:12px;font-size:13px;line-height:1.6;text-align:center;color:var(--red,#A03A2A)}',
    '#gate-overlay .gmsg.ok{color:var(--green,#1E5A47)}',
    '#gate-overlay .gmore{margin-top:14px;text-align:center}',
    '#gate-overlay .gmore a{font-size:12px;color:var(--muted,#77837C);text-decoration:underline;cursor:pointer;text-underline-offset:3px}',
    '#gate-off{padding:16px;border:1px dashed #CFD8CB;border-radius:12px;margin-top:14px}',
    '#gate-off .dev{font-family:ui-monospace,Menlo,monospace;font-size:18px;letter-spacing:.12em;color:var(--green,#1E5A47);',
    'text-align:center;margin:8px 0 4px}',
    '#gate-off .tiny{font-size:12px;color:var(--muted,#77837C);line-height:1.7}',
    '#gate-off .gfoot{margin-top:12px;padding-top:12px;border-top:1px solid var(--line,#DDD8C9);font-size:12px;color:var(--muted,#77837C);text-align:center}'
  ].join('');

  function inject() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.innerHTML =
      '<div class="gcard">' +
      '<div class="gbrand">学习台 · 数学与英语</div>' +
      '<h2>输入验证码开始练习</h2>' +
      '<p class="gsub">学习台内部题库，验证码一次发放、仅限本人使用。<br>通过后会在本机留下凭证，下次打开无需重复输入。</p>' +
      '<form id="gate-form" autocomplete="off">' +
      '<input id="gate-input" type="text" inputmode="latin" placeholder="DF-XXXX-XXXX-XXXX" spellcheck="false" autocomplete="off" maxlength="19">' +
      '<button id="gate-btn" type="submit">进入学习台</button>' +
      '</form>' +
      '<div id="gate-msg" class="gmsg"></div>' +
      '<div class="gmore"><a id="gate-offlink">网络受限打不开验证服务？用离线通行证 →</a></div>' +
      '<div id="gate-off" style="display:none">' +
      '<div class="tiny">1）下面是本机设备码，发给发放人；2）发放人从管理台签一张通行证给你；3）把通行证粘回下面。</div>' +
      '<div class="dev" id="gate-dev">—</div>' +
      '<div class="tiny" style="text-align:center"><a id="gate-devcopy" style="color:var(--green,#1E5A47)">复制设备码</a></div>' +
      '<textarea id="gate-pass" placeholder="粘贴通行证（一串字母数字和点号）" spellcheck="false"></textarea>' +
      '<button id="gate-use-pass" type="button">用通行证进入</button>' +
      '<div class="gfoot">通行证绑定本机设备码，换设备无效 · 遇到问题联系发放人</div>' +
      '</div>' +
      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#DDD8C9);' +
      'font-size:12px;line-height:1.7;color:var(--muted,#77837C);text-align:center">验证码由出题人统一发放</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  function setMsg(text, ok) {
    var el = document.getElementById('gate-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'gmsg' + (ok ? ' ok' : '');
  }

  function unlock() {
    var ov = document.getElementById(OVERLAY_ID);
    if (ov) ov.remove();
    document.body.classList.remove('gate-lock');
  }

  function saveToken(hash, isOwner, expiry) {
    write(KEY_TOK, {
      h: hash,
      o: isOwner ? 1 : 0,
      at: Date.now(),
      e: isOwner ? 0 : (expiry || (Date.now() + (CFG.days || 180) * 86400000))
    });
  }

  function markUsed(hash) {
    var used = read(KEY_USED, []);
    if (used.indexOf(hash) === -1) { used.push(hash); write(KEY_USED, used); }
  }

  /* ---------- 云端核销（无预检 + 重试） ---------- */
  function postJSON(url, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        reject(new Error('timeout'));
      }, timeoutMs || 12000);
      fetch(url, {
        method: 'POST',
        // text/plain 属于简单请求，不触发 CORS 预检，弱网/受限网络下更容易通过
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
        cache: 'no-store'
      }).then(function (r) {
        return r.text();
      }).then(function (txt) {
        if (done) return;
        done = true; clearTimeout(timer);
        try { resolve(JSON.parse(txt)); } catch (e) { reject(new Error('bad-response')); }
      }).catch(function (err) {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(err);
      });
    });
  }

  function remoteCheck(code, hash) {
    if (!CFG.api) return Promise.resolve({ ok: true, local: true });
    var tries = 0;
    function attempt() {
      tries++;
      return postJSON(CFG.api, { code: code, hash: hash }, 12000).then(function (j) {
        return { ok: !!j.ok, msg: j.msg || '' };
      }).catch(function (err) {
        if (tries >= 3) throw err;
        return new Promise(function (r) { setTimeout(r, 1200 * tries); }).then(attempt);
      });
    }
    return attempt();
  }

  function submit(code) {
    var n = norm(code);
    if (n.length < 8) { setMsg('验证码格式不正确，应为 DF-XXXX-XXXX-XXXX'); return; }
    var hash = sha256Hex(CFG.salt + n).slice(0, 16);
    var isOwner = hash === CFG.owner;
    var known = CFG.codes.indexOf(hash) !== -1;
    if (!isOwner && !known && !CFG.api) { setMsg('验证码无效，请核对字符（注意 0/O、1/I 易混）'); return; }

    if (isOwner) {
      saveToken(hash, true);
      setMsg('验证通过，正在进入…', true);
      setTimeout(unlock, 200);
      return;
    }

    var btn = document.getElementById('gate-btn');
    btn.disabled = true;
    setMsg('正在校验…', true);

    remoteCheck(n, hash).then(function (res) {
      if (!res.ok) throw new Error(res.msg || '该验证码已被使用或已失效');
      if (!res.local) {
        var used = read(KEY_USED, []);
        if (used.indexOf(hash) !== -1) throw new Error('该验证码已在本机使用过');
        markUsed(hash);
      }
      saveToken(hash, false);
      setMsg('验证通过，正在进入…', true);
      setTimeout(unlock, 260);
    }).catch(function (err) {
      var msg = (err && err.message) || '';
      var isNet = /timeout|bad-response|Failed to fetch|NetworkError|Load failed|abort/i.test(msg) ||
        /^fetch/i.test(msg);
      if (isNet) {
        setMsg('连不上校验服务（' + (msg === 'timeout' ? '请求超时' : '网络受限') + '）。可先换手机流量重试，或在下方用离线通行证进入。');
        showOffline(true);
      } else {
        setMsg(msg || '校验失败，请稍后再试');
      }
      btn.disabled = false;
    });
  }

  /* ---------- 离线通行证 ---------- */
  function showOffline(show) {
    var box = document.getElementById('gate-off');
    if (!box) return;
    box.style.display = show ? '' : 'none';
    var dev = document.getElementById('gate-dev');
    if (dev) dev.textContent = deviceCode();
  }

  function verifyPass(passText) {
    var parts = String(passText || '').trim().split('.');
    if (parts.length !== 2) return Promise.reject(new Error('通行证格式不对，请整串复制'));
    var payloadStr, sig, dev = deviceCode();
    try {
      payloadStr = new TextDecoder('utf-8').decode(b64urlBytes(parts[0]));
      sig = b64urlBytes(parts[1]);
    } catch (e) { return Promise.reject(new Error('通行证内容无法解析')); }

    var payload;
    try { payload = JSON.parse(payloadStr); } catch (e) { return Promise.reject(new Error('通行证内容无法解析')); }
    if (norm(payload.d) !== norm(dev)) return Promise.reject(new Error('这张通行证是给别的设备的，本机设备码是 ' + dev));

    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return Promise.reject(new Error('当前浏览器不支持离线验签，请换 Chrome/Edge 或换手机流量在线校验'));
    }
    return crypto.subtle.importKey('spki', b64urlBytes(CFG.pubkey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (key) {
        return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(payloadStr));
      })
      .then(function (ok) {
        if (!ok) throw new Error('通行证签名无效，请让发放人重新签发');
        if (payload.e && Date.now() > payload.e) throw new Error('通行证已过期，请让发放人重新签发');
        return payload;
      });
  }

  function boot() {
    if (tokenOK()) { document.body.classList.remove('gate-lock'); return; }
    document.body.classList.add('gate-lock');
    inject();
    var input = document.getElementById('gate-input');
    var form = document.getElementById('gate-form');
    input.addEventListener('input', function () {
      var pos = input.selectionStart;
      input.value = fmtCode(input.value);
      try { input.setSelectionRange(pos, pos); } catch (e) {}
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit(input.value);
    });

    document.getElementById('gate-offlink').addEventListener('click', function () { showOffline(true); });
    document.getElementById('gate-devcopy').addEventListener('click', function () {
      var dev = document.getElementById('gate-dev').textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dev);
        else {
          var ta = document.createElement('textarea');
          ta.value = dev; document.body.appendChild(ta); ta.select(); document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setMsg('设备码已复制', true);
      } catch (e) { setMsg('复制失败，请手动选中 ' + dev); }
    });
    document.getElementById('gate-use-pass').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      setMsg('正在验证通行证…', true);
      verifyPass(document.getElementById('gate-pass').value).then(function (payload) {
        saveToken('offline-' + norm(deviceCode()), false, payload.e || 0);
        setMsg('通行证有效，正在进入…', true);
        setTimeout(unlock, 240);
      }).catch(function (err) {
        setMsg(err && err.message ? err.message : '通行证无效');
        btn.disabled = false;
      });
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.__gateSha256 = sha256Hex;   // 便于离线自测
  window.__gateVerifyPass = verifyPass;
})();
