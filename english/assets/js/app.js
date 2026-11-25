(function () {
  'use strict';
  var DATA = window.CET_DATA || { meta: {}, exams: [] };
  var EXAMS = DATA.exams || [];
  var LS = 'cet.state.v1', THEME = 'studyhub.theme.v1';
  var app = document.getElementById('app');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DAY = 86400000;
  var REVIEW_DAYS = [1, 2, 4, 7, 15, 30, 60];

  var state = load();
  var practice = null;
  function defaults() {
    return { v: 1, answers: {}, wrong: {}, reviews: {}, writing: {}, translation: {}, attempted: {}, updatedAt: Date.now() };
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return defaults();
      var s = JSON.parse(raw);
      s = Object.assign(defaults(), s || {});
      var eid = EXAMS[0] && EXAMS[0].id;
      if (eid) {
        ['answers', 'reviews', 'wrong'].forEach(function (field) {
          var src = s[field] || {}, dst = {};
          Object.keys(src).forEach(function (k) {
            var nk = k.indexOf('|') >= 0 ? k : eid + '|' + k;
            dst[nk] = src[k];
            if (field === 'wrong' && dst[nk] && typeof dst[nk] === 'object') dst[nk].key = nk;
          });
          s[field] = dst;
        });
      }
      return s;
    } catch (e) { return defaults(); }
  }
  var syncing = false, pushTimer = null;
  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}
    queuePush();
  }
  function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }
  function cloud() { return window.STUDY_CLOUD; }
  function queuePush() {
    if (syncing || !cloud() || !cloud().user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      cloud().push('cet_state', state).then(function () {
        var el = $('#syncState'); if (el) el.textContent = '已同步 ' + new Date().toLocaleTimeString();
      }).catch(function () {});
    }, 800);
  }
  function pullCloud() {
    var c = cloud();
    if (!c || !c.user) return;
    c.pull('cet_state').then(function (row) {
      if (!row || !row.data || !row.data.updatedAt) { queuePush(); return; }
      if (row.data.updatedAt > (state.updatedAt || 0)) {
        syncing = true;
        state = Object.assign(defaults(), row.data);
        saveLocal(); render(); syncing = false;
        toast('已从云端同步答题记录');
      } else if ((state.updatedAt || 0) > row.data.updatedAt) {
        queuePush();
      }
    }).catch(function () {});
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }
  function examById(id) { return EXAMS.filter(function (e) { return e.id === id; })[0]; }
  function hashRoute() {
    var h = (location.hash || '#/home').replace(/^#/, '');
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      h = h.slice(0, qi);
    }
    var seg = h.split('/').filter(Boolean);
    return { name: seg[0] || 'home', param: seg[1] || '', query: q };
  }
  function navigate(h) { if (location.hash === h) render(); else location.hash = h; }

  /* ---------- question helpers ---------- */
  function allKeys(exam) {
    var out = [], p = exam.id + '|';
    (exam.listening.groups || []).forEach(function (g) {
      (g.questions || []).forEach(function (q) { out.push(p + 'L-' + q.n); });
    });
    Object.keys(exam.cloze.answers || {}).forEach(function (n) { out.push(p + 'C-' + n); });
    (exam.matching.statements || []).forEach(function (s) { out.push(p + 'M-' + s.n); });
    (exam.reading || []).forEach(function (p2) { (p2.questions || []).forEach(function (q) { out.push(p + 'R-' + q.n); }); });
    return out;
  }
  function keyAnswer(exam, fullKey) {
    var key = String(fullKey).indexOf('|') >= 0 ? String(fullKey).split('|')[1] : fullKey;
    var p = key.split('-'), type = p[0], n = p[1];
    if (type === 'C') return exam.cloze.answers[n];
    if (type === 'M') { var m = (exam.matching.statements || []).filter(function (s) { return String(s.n) === n; })[0]; return m && m.answer; }
    if (type === 'R') {
      for (var i = 0; i < (exam.reading || []).length; i++) {
        var q = (exam.reading[i].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (q) return q.answer;
      }
    }
    if (type === 'L') {
      for (var j = 0; j < (exam.listening.groups || []).length; j++) {
        var lq = (exam.listening.groups[j].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (lq) return lq.answer;
      }
    }
    return '';
  }
  function keyLabel(exam, fullKey) {
    var key = String(fullKey).indexOf('|') >= 0 ? String(fullKey).split('|')[1] : fullKey;
    var type = key.split('-')[0], n = key.split('-')[1];
    var names = { L: '听力', C: '选词', M: '匹配', R: '阅读' };
    return (names[type] || type) + ' 第 ' + n + ' 题';
  }
  function keySection(fullKey) {
    var key = String(fullKey).indexOf('|') >= 0 ? String(fullKey).split('|')[1] : fullKey;
    return { L: 'listening', C: 'cloze', M: 'matching', R: 'reading' }[key.split('-')[0]] || 'reading';
  }
  var STOP = ('the and for that with this from have has had not but you your they them their there what when where which who whom whose into over under about after before more most some such than then also only very can could would should will just like make made many much its it’s don’t didn’t isn’t are was were been being one two three').split(' ');
  function wordsOf(text) {
    var out = {}, arr = String(text || '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [];
    arr.forEach(function (w) { w = w.replace(/^['-]+|['-]+$/g, ''); if (w.length >= 4 && STOP.indexOf(w) < 0) out[w] = 1; });
    return Object.keys(out).slice(0, 12);
  }
  function questionText(exam, fullKey) {
    var key = String(fullKey).split('|')[1] || String(fullKey);
    var p = key.split('-'), type = p[0], n = p[1];
    if (type === 'C') return exam.cloze.passage;
    if (type === 'M') { var s = (exam.matching.statements || []).filter(function (x) { return String(x.n) === n; })[0]; return s ? s.text : ''; }
    if (type === 'R') {
      for (var i = 0; i < (exam.reading || []).length; i++) {
        var q = (exam.reading[i].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (q) return q.stem + ' ' + Object.keys(q.options).map(function (k) { return q.options[k]; }).join(' ');
      }
    }
    if (type === 'L') {
      for (var j = 0; j < (exam.listening.groups || []).length; j++) {
        var lq = (exam.listening.groups[j].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (lq) return Object.keys(lq.options).map(function (k) { return lq.options[k]; }).join(' ');
      }
    }
    return '';
  }
  function wrongWords() {
    var counts = {};
    Object.keys(state.wrong).forEach(function (k) {
      (state.wrong[k].words || []).forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 16).map(function (w) { return [w, counts[w]]; });
  }
  function examForKey(k) { var id = String(k).split('|')[0]; return examById(id) || EXAMS[0]; }
  function hasAnswers(exam) { return allKeys(exam).length > 0 && allKeys(exam).every(function (k) { return !!keyAnswer(exam, k); }); }

  /* ---------- stats / review ---------- */
  function answeredCount() { return Object.keys(state.answers).length; }
  function correctCount() {
    var c = 0;
    Object.keys(state.answers).forEach(function (k) {
      var e = examForKey(k); if (!e) return;
      if (String(state.answers[k]).toUpperCase() === String(keyAnswer(e, k)).toUpperCase()) c++;
    });
    return c;
  }
  function dueList() {
    var now = Date.now();
    return Object.keys(state.reviews).filter(function (k) {
      var r = state.reviews[k]; return r && r.nextAt && r.nextAt <= now && (r.stage || 0) < REVIEW_DAYS.length;
    });
  }
  function schedule(key, correct) {
    var r = state.reviews[key] || { stage: 0 };
    if (!correct) r.stage = 0;
    else r.stage = Math.min(REVIEW_DAYS.length, (r.stage || 0) + 1);
    r.lastAt = Date.now();
    r.nextAt = r.stage >= REVIEW_DAYS.length ? 0 : Date.now() + REVIEW_DAYS[r.stage] * DAY;
    state.reviews[key] = r;
    if (!correct) {
      var e = examForKey(key);
      state.wrong[key] = { key: key, label: keyLabel(e, key), exam: e.id, section: keySection(key), at: Date.now(), words: wordsOf(questionText(e, key)), cause: '' };
    } else if (r.stage >= REVIEW_DAYS.length) {
      delete state.wrong[key];
    }
  }

  /* ---------- views ---------- */
  function viewHome() {
    var exam = EXAMS[0];
    var correct = correctCount(), answered = answeredCount(), due = dueList().length;
    var guides = [
      ['writing', '作文', '立场、三段、模板与检查清单'],
      ['listening', '听力', '预读选项、信号词、同义替换'],
      ['reading', '阅读', '选词、匹配、仔细阅读定位'],
      ['cloze', '选词填空', '词性、搭配、复现'],
      ['translation', '翻译', '拆分、主干、文化词']
    ];
    return '<section class="cet-hero"><div class="eyebrow">CET-4 / CET-6 · 真题练习</div>' +
      '<h1>把真题，<em>做透</em>。</h1>' +
      '<p class="lede">四级为主，六级进阶。作文、听力、选词、匹配、阅读、翻译分开练；错题进本子，按艾宾浩斯回来。</p>' +
      '<div class="cet-meta"><div><b>' + EXAMS.length + '</b><span>套真题</span></div>' +
        '<div><b>' + answered + '</b><span>已作答</span></div>' +
        '<div><b>' + correct + '</b><span>答对</span></div>' +
        '<div><b>' + due + '</b><span>待复习</span></div></div></section>' +
      '<div class="cet-grid"><div class="cet-card"><div class="eyebrow">CURRENT SET</div><h2>' + esc(exam.title) + '</h2>' +
        '<p class="muted" style="font-size:13px">先把一套卷跑通：作文 → 听力 → 选词 → 匹配 → 阅读 → 翻译。' + (exam.listening.audio ? '听力音频已接入；' : '听力音频待接入；') + '选词、阅读答案键可提交判分。</p>' +
        '<div class="exam-card" style="margin-top:14px"><div><h3>' + esc(exam.title) + '</h3><div class="meta">' + esc(exam.source) + '</div></div>' +
        '<a class="btn primary" href="#/exam/' + exam.id + '">开始这套 →</a></div>' +
        '<div class="tiny muted">提示：听力题干在音频中播放；卷面只给选项，先完整听一遍再作答。</div></div>' +
      '<div class="cet-card"><div class="eyebrow">GUIDES</div><h2>五类题型指导</h2>' +
        '<div style="display:flex;flex-direction:column;gap:7px;margin-top:12px">' +
        guides.map(function (g) { return '<a href="#/guides?focus=' + g[0] + '" style="display:flex;justify-content:space-between;gap:10px;text-decoration:none;padding:9px 10px;border:1px solid var(--line);border-radius:9px;color:var(--ink);font-size:13.5px"><span><b>' + g[1] + '</b> <span class="muted">' + g[2] + '</span></span><span>›</span></a>'; }).join('') +
        '</div><div class="divider"></div><a class="btn sm" href="../">回学习台制定计划 →</a></div></div>' +
      '<div class="section-head"><div><div class="eyebrow">SELECTED SET</div><h2>套卷结构</h2></div><span class="tiny muted">' + exam.year + '.' + String(exam.month).padStart(2, '0') + ' · ' + exam.level + ' · Set ' + exam.set + '</span></div>' +
      '<div class="guide-grid">' +
        ['作文 · 30 分钟', '听力 · 25 分钟', '选词填空', '长篇匹配', '仔细阅读', '翻译 · 30 分钟'].map(function (x, i) {
          return '<div class="guide-card"><h3>' + x + '</h3><p>' + ['观点类作文，120–180 词', '新闻/长对话/短文，25 题', '10 空，15 选 10', '10 题，A–M 段落', '两篇，10 题', '中国文化/社会话题'][i] + '</p><a class="btn sm ghost" href="#/exam/' + exam.id + '?sec=' + ['writing','listening','cloze','matching','reading','translation'][i] + '">打开 →</a></div>';
        }).join('') + '</div>';
  }

  function examProgress(e) {
    var keys = allKeys(e), ans = 0, right = 0;
    keys.forEach(function (k) {
      if (state.answers[k]) { ans++; if (String(state.answers[k]).toUpperCase() === String(keyAnswer(e, k)).toUpperCase()) right++; }
    });
    return { total: keys.length, answered: ans, correct: right };
  }
  function examWrong(e) { return allKeys(e).some(function (k) { return !!state.wrong[k]; }); }
  function viewBank(route) {
    var q = (route && route.query) || {};
    var levels = [], years = [];
    EXAMS.forEach(function (e) { if (levels.indexOf(e.level) < 0) levels.push(e.level); if (years.indexOf(e.year) < 0) years.push(e.year); });
    years.sort(function (a, b) { return b - a; });
    var list = EXAMS.filter(function (e) {
      if (q.level && e.level !== q.level) return false;
      if (q.year && String(e.year) !== String(q.year)) return false;
      if (q.status === 'wrong' && !examWrong(e)) return false;
      if (q.status === 'due' && !allKeys(e).some(function (k) { return state.reviews[k] && state.reviews[k].nextAt && state.reviews[k].nextAt <= Date.now(); })) return false;
      if (q.status === 'new' && examProgress(e).answered) return false;
      if (q.q) {
        var hay = (e.title + ' ' + e.source).toLowerCase();
        if (hay.indexOf(String(q.q).toLowerCase()) < 0) return false;
      }
      return true;
    });
    function chip(key, val, label, on) {
      var nq = Object.assign({}, q); delete nq.page; if (val) nq[key] = val; else delete nq[key];
      var qs = Object.keys(nq).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(nq[k]); }).join('&');
      return '<a class="fchip ' + (on ? 'on' : '') + '" href="#/bank' + (qs ? '?' + qs : '') + '">' + esc(label) + '</a>';
    }
    var per = 20;
    var page = Math.max(1, parseInt(q.page || 1, 10));
    var pages = Math.max(1, Math.ceil(list.length / per));
    if (page > pages) page = pages;
    var paged = list.slice((page - 1) * per, page * per);
    function pageLink(n) {
      var nq = Object.assign({}, q); nq.page = String(n);
      var qs = Object.keys(nq).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(nq[k]); }).join('&');
      return '<a class="page-btn ' + (n === page ? 'on' : '') + '" href="#/bank?' + qs + '">' + n + '</a>';
    }
    var filters = '<div class="filterbar"><div class="fgroup">' + chip('level', '', '全部', !q.level) + levels.map(function (l) { return chip('level', l, l, q.level === l); }).join('') + '</div>' +
      '<div class="fgroup">' + chip('year', '', '全部年份', !q.year) + years.map(function (y) { return chip('year', String(y), y, String(q.year) === String(y)); }).join('') + '</div>' +
      '<div class="fgroup">' + [['', '全部状态'], ['new', '未做'], ['wrong', '有错题'], ['due', '待复习']].map(function (x) { return chip('status', x[0], x[1], (q.status || '') === x[0]); }).join('') + '</div>' +
      '<form class="searchbox" data-exam-search><input class="input" name="q" value="' + esc(q.q || '') + '" placeholder="搜套卷 / 年份…"><button class="btn sm">搜索</button></form></div>';
    return '<div class="page-head"><div><h1>题库</h1><div class="sub">' + EXAMS.length + ' 套真题 · 当前 ' + list.length + ' 套 · 第 ' + page + '/' + pages + ' 页</div></div><a class="btn primary sm" href="#/select">选题练习 →</a></div>' + filters +
      (paged.length ? paged.map(function (e) {
        var p = examProgress(e), pct = p.total ? Math.round(p.answered * 100 / p.total) : 0;
        return '<div class="exam-card"><div class="exam-main"><div class="meta">' + e.level + ' · ' + e.year + '.' + String(e.month).padStart(2, '0') + ' · 第 ' + e.set + ' 套' + (hasAnswers(e) ? '' : ' · 答案待接入') + '</div><h3>' + esc(e.title) + '</h3><div class="meta">' + esc(e.source) + ' · 已答 ' + p.answered + '/' + p.total + ' · 正确率 ' + (p.answered ? Math.round(p.correct * 100 / p.answered) + '%' : '—') + '</div><div class="ebar"><i style="width:' + pct + '%"></i></div></div>' +
          '<div class="exam-actions"><a class="btn sm" href="#/exam/' + e.id + '?sec=writing">作文</a><a class="btn sm" href="#/exam/' + e.id + '?sec=listening">听力</a><a class="btn sm" href="#/exam/' + e.id + '?sec=reading">阅读</a><a class="btn sm primary" href="#/exam/' + e.id + '">整套</a></div></div>';
      }).join('') : '<div class="empty" style="margin-top:18px"><b>没有符合条件的套卷</b><p class="muted">换个年份或状态试试。</p></div>') +
      '<div class="pager">' + (page > 1 ? '<a class="page-btn" href="#/bank?' + Object.keys(Object.assign({}, q, {page: String(page - 1)})).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(Object.assign({}, q, {page: String(page - 1)})[k]); }).join('&') + '">‹ 上一页</a>' : '') +
        Array.from({length: pages}, function (_, i) { return i + 1; }).slice(Math.max(0, page - 3), Math.min(pages, page + 2)).map(pageLink).join('') +
        (page < pages ? '<a class="page-btn" href="#/bank?' + Object.keys(Object.assign({}, q, {page: String(page + 1)})).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(Object.assign({}, q, {page: String(page + 1)})[k]); }).join('&') + '">下一页 ›</a>' : '') +
        '</div><div class="tiny muted" style="margin-top:10px">共 ' + EXAMS.length + ' 套 · 四级 2020–2025，六级 2015–2025；2014–2019 四级仍在补。</div>';
  }

  function tabs(exam, sec) {
    var list = [['writing', '作文'], ['listening', '听力'], ['cloze', '选词'], ['matching', '匹配'], ['reading', '阅读'], ['translation', '翻译']];
    return '<div class="section-tabs">' + list.map(function (x) {
      return '<a class="' + (x[0] === sec ? 'on' : '') + '" href="#/exam/' + exam.id + '?sec=' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div>';
  }

  /* ---------- question-level selection (aligned with math site modes) ---------- */
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function allRefs() {
    var out = [];
    EXAMS.forEach(function (e) {
      allKeys(e).forEach(function (k) {
        out.push({ key: k, exam: e, section: keySection(k) });
      });
    });
    return out;
  }
  function refQ(r) {
    var key = r.key.split('|')[1], p = key.split('-'), t = p[0], n = p[1];
    if (t === 'L') {
      for (var i = 0; i < (r.exam.listening.groups || []).length; i++) {
        var q = (r.exam.listening.groups[i].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (q) return q;
      }
    }
    if (t === 'M') return (r.exam.matching.statements || []).filter(function (x) { return String(x.n) === n; })[0];
    if (t === 'R') {
      for (var j = 0; j < (r.exam.reading || []).length; j++) {
        var rq = (r.exam.reading[j].questions || []).filter(function (x) { return String(x.n) === n; })[0];
        if (rq) return rq;
      }
    }
    return null;
  }
  function sectionName(s) { return { listening: '听力', cloze: '选词', matching: '匹配', reading: '阅读' }[s] || s; }
  function viewSelect() {
    var years = []; EXAMS.forEach(function (e) { if (years.indexOf(e.year) < 0) years.push(e.year); }); years.sort(function (a, b) { return b - a; });
    var secs = [['listening', '听力'], ['cloze', '选词'], ['matching', '匹配'], ['reading', '阅读']];
    return '<div class="page-head"><div><h1>选题练习</h1><div class="sub">按范围、题型、状态抽题；和数学站一样支持随机/未做/错题/全部</div></div><a class="btn sm ghost" href="#/bank">← 题库</a></div>' +
      '<form class="cet-card select-form" data-select-form><div class="select-grid">' +
      '<label>等级<select name="level"><option value="">全部</option><option>CET4</option><option>CET6</option></select></label>' +
      '<label>年份<select name="year"><option value="">全部</option>' + years.map(function (y) { return '<option>' + y + '</option>'; }).join('') + '</select></label>' +
      '<label>模式<select name="mode"><option value="random">随机抽题</option><option value="unseen">只抽未做</option><option value="wrong">只抽错题</option><option value="ratio">按题型比例</option><option value="all">全部（按顺序）</option></select></label>' +
      '<label>数量<input class="input" type="number" name="count" min="1" max="200" value="20"></label></div>' +
      '<div class="select-secs"><b>题型</b>' + secs.map(function (x) { return '<label class="sec-check"><input type="checkbox" name="sec" value="' + x[0] + '" checked>' + x[1] + '</label>'; }).join('') + '</div>' +
      '<div class="ratio-line"><b>比例模式</b><span>听力 <input type="number" name="ratio-listening" min="0" max="50" value="5"></span><span>选词 <input type="number" name="ratio-cloze" min="0" max="50" value="5"></span><span>匹配 <input type="number" name="ratio-matching" min="0" max="50" value="5"></span><span>阅读 <input type="number" name="ratio-reading" min="0" max="50" value="5"></span></div>' +
      '<div class="exam-actions"><button class="btn primary">开始练习</button><span class="tiny muted">听力题会显示该套音频（已接入的）或原文；答案提交后自动判分。</span></div></form>';
  }
  function startPractice(form) {
    var secs = $$('input[name=sec]:checked', form).map(function (x) { return x.value; });
    var level = form.level.value, year = form.year.value, mode = form.mode.value;
    var count = Math.max(1, Math.min(200, parseInt(form.count.value || '20', 10)));
    var refs = allRefs().filter(function (r) {
      if (level && r.exam.level !== level) return false;
      if (year && String(r.exam.year) !== year) return false;
      if (secs.indexOf(r.section) < 0) return false;
      if (mode === 'unseen' && state.answers[r.key]) return false;
      if (mode === 'wrong' && !state.wrong[r.key]) return false;
      return true;
    });
    if (!refs.length) { toast('这个范围没有题'); return; }
    if (mode === 'ratio') {
      var picked = [];
      secs.forEach(function (s) {
        var n = Math.max(0, parseInt((form['ratio-' + s] || {}).value || '0', 10));
        picked = picked.concat(shuffle(refs.filter(function (r) { return r.section === s; })).slice(0, n));
      });
      refs = shuffle(picked);
    } else {
      if (mode === 'random') refs = shuffle(refs);
      if (mode !== 'all') refs = refs.slice(0, count);
    }
    if (!refs.length) { toast('没有可抽的题'); return; }
    practice = { items: refs, result: null, startedAt: Date.now() };
    navigate('#/practice');
  }
  function viewPractice() {
    if (!practice || !practice.items.length) return '<div class="empty" style="margin-top:30px"><b>还没有选题</b><p class="muted">去题库或选题页选一组题。</p><a class="btn primary" href="#/select">去选题</a></div>';
    var items = practice.items;
    var audioExams = {};
    var html = '<div class="page-head"><div><h1>练习 · ' + items.length + ' 题</h1><div class="sub">' + items.slice(0, 4).map(function (r) { return esc(r.exam.title); }).join(' · ') + (items.length > 4 ? ' …' : '') + '</div></div><a class="btn sm ghost" href="#/select">重选</a></div>';
    var groups = {};
    items.forEach(function (r) { if (r.section === 'listening' && r.exam.listening.audio) audioExams[r.exam.id] = r.exam.listening.audio; });
    var aud = Object.keys(audioExams);
    if (aud.length) html += '<div class="cet-card"><div class="audio-note">音频（按套卷）</div>' + aud.map(function (id) { return '<div class="practice-audio"><b>' + esc(id) + '</b><audio controls src="' + esc(audioExams[id]) + '"></audio></div>'; }).join('') + '</div>';
    html += '<div class="cet-card practice-list">';
    items.forEach(function (r, idx) {
      var q = refQ(r), key = r.key;
      html += '<div class="practice-item"><div class="tiny muted">' + esc(r.exam.title) + ' · ' + sectionName(r.section) + '</div>';
      if (r.section === 'cloze') {
        var n = key.split('|')[1].split('-')[1];
        html += '<div class="practice-cloze"><b>选词第 ' + n + ' 空</b><select class="blank-select" data-q="' + key + '"><option value="">__</option>' + r.exam.cloze.bank.map(function (b) { return '<option value="' + b[0] + '">' + b[0] + '</option>'; }).join('') + '</select><details class="transcript-box"><summary>看选词段落</summary><div class="passage">' + r.exam.cloze.passage.replace(/___(\d+)___/g, '（$1）').split('\n\n').map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></details></div>';
      } else if (r.section === 'matching') {
        html += '<div class="practice-match"><div>' + esc(q ? q.text : '') + '</div><select class="match-select" data-q="' + key + '"><option value="">—</option>' + 'ABCDEFGHIJKLMNO'.split('').map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('') + '</select></div>';
      } else if (q) {
        html += qBlock(key, q.n, q.stem || '', q.options || {}, '');
      } else {
        html += '<div class="tiny muted">题目待接入</div>';
      }
      html += '</div>';
    });
    html += '<div class="exam-actions"><button class="btn primary" data-grade="practice">提交判分</button><span class="tiny muted">已答 <b id="pracAns">0</b> / ' + items.length + '</span></div>' +
      (practice.result ? '<div class="grade-result"><b>' + practice.result.right + ' / ' + practice.result.ans + ' 正确</b>，未答 ' + practice.result.missing + ' 题；已记录到错题/复习。</div>' : '') + '</div>';
    return html;
  }
  function gradePractice() {
    if (!practice) return;
    var ans = 0, right = 0, missing = 0;
    practice.items.forEach(function (r) {
      var el = document.querySelector('input[data-q="' + r.key + '"]:checked') || document.querySelector('select[data-q="' + r.key + '"]');
      var val = el ? el.value : '';
      if (!val) { missing++; return; }
      ans++;
      var ok = String(val).toUpperCase() === String(keyAnswer(r.exam, r.key)).toUpperCase();
      if (ok) right++;
      state.answers[r.key] = val;
      schedule(r.key, ok);
    });
    save();
    practice.result = { ans: ans, right: right, missing: missing, total: practice.items.length };
    render();
  }

  function viewExam(route) {
    var exam = examById(route.param) || EXAMS[0];
    if (!exam) return '<div class="empty">还没有真题数据</div>';
    var sec = route.query.sec || 'writing';
    var html = '<div class="exam-head"><div><div class="eyebrow">' + exam.level + ' · ' + exam.year + '.' + String(exam.month).padStart(2, '0') + ' · SET ' + exam.set + '</div><h1>' + esc(exam.title) + '</h1><div class="tiny muted">' + esc(exam.source) + '</div></div><a class="btn sm ghost" href="#/bank">← 题库</a></div>' + tabs(exam, sec) +
      (hasAnswers(exam) ? '' : '<div class="kb-section-note">这套的答案键还没接入，当前只展示题面；提交判分已关闭，避免把未接入答案误判成错题。</div>');
    if (sec === 'writing') html += sectionWriting(exam);
    else if (sec === 'listening') html += sectionListening(exam);
    else if (sec === 'cloze') html += sectionCloze(exam);
    else if (sec === 'matching') html += sectionMatching(exam);
    else if (sec === 'reading') html += sectionReading(exam);
    else html += sectionTranslation(exam);
    return html;
  }

  function sectionWriting(exam) {
    var val = state.writing[exam.id] || '';
    return '<div class="cet-card"><div class="section-title">Part I · Writing</div>' +
      '<div class="prompt-box">' + esc(exam.writing.prompt) + '<div class="cn">' + esc(exam.writing.cn) + '</div></div>' +
      '<div class="mini-label">写作提纲 / 可用句式</div><ul class="guide-list">' + exam.writing.guide.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="mini-label">我的作文 <span class="muted" id="wordCount">' + countWords(val) + ' words</span></div>' +
      '<textarea class="write-area" data-writing="' + exam.id + '" placeholder="Write your essay here...">' + esc(val) + '</textarea>' +
      '<div class="exam-actions"><button class="btn primary" data-save-writing="' + exam.id + '">保存作文</button><span class="tiny muted">只保存在本机，云同步接入后会一起同步。</span></div></div>';
  }

  function sectionListening(exam) {
    var note = exam.listening.audio ? '<div class="audio-box"><div class="audio-note">听力音频</div><audio controls src="' + esc(exam.listening.audio) + '"></audio></div>' : '<div class="audio-box"><div class="audio-note">' + esc(exam.listening.note || '听力音频待接入。') + '</div></div>';
    var groups = exam.listening.groups.map(function (g) {
      return '<div class="group-intro">' + esc(g.intro) + '</div>' + g.questions.map(function (q) {
        return qBlock(exam.id + '|L-' + q.n, q.n, '', q.options, '');
      }).join('') + (g.transcript ? '<div class="transcript-tools"><button class="btn sm ghost" data-speak="' + esc(g.transcript) + '">🔊 朗读原文</button><details class="transcript-box"><summary>听力原文 / 精读</summary><pre>' + esc(g.transcript) + '</pre></details></div>' : '');
    }).join('');
    return '<div class="cet-card"><div class="section-title">Part II · Listening</div>' + note +
      '<div class="tiny muted" style="margin-bottom:8px">CET 听力题干在音频中播放，卷面只给选项；先听音频，再选答案。</div>' + groups +
      '<div class="exam-actions"><button class="btn primary" data-grade="listening">提交本节</button><span class="tiny muted">共 ' + countListening(exam) + ' 题</span></div><div id="gradeResult"></div></div>';
  }

  function sectionCloze(exam) {
    var c = exam.cloze;
    var body = c.passage.replace(/___(\d+)___/g, function (m, n) {
      return '<select class="blank-select" data-q="' + exam.id + '|C-' + n + '"><option value="">__</option>' + c.bank.map(function (b) { return '<option value="' + b[0] + '">' + b[0] + '</option>'; }).join('') + '</select>';
    });
    return '<div class="cet-card"><div class="section-title">Part III · Section A · 选词填空</div>' +
      '<div class="word-bank">' + c.bank.map(function (b) { return '<span><b>' + b[0] + '</b>' + esc(b[1]) + '</span>'; }).join('') + '</div>' +
      '<div class="passage">' + body.split('\n\n').map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>' +
      '<div class="exam-actions"><button class="btn primary" data-grade="cloze">提交本节</button><span class="tiny muted">10 个空 · 每个词最多用一次</span></div><div id="gradeResult"></div></div>';
  }

  function sectionMatching(exam) {
    var letters = 'ABCDEFGHIJKLMNO'.split('').map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('');
    var paras = exam.matching.paragraphs || {};
    var pk = Object.keys(paras).sort();
    var paraHtml = pk.length ? '<details class="para-box"><summary>展开 ' + pk.length + ' 个段落（A–' + pk[pk.length - 1] + '）</summary>' +
      pk.map(function (k) { return '<p><b>' + k + ')</b> ' + esc(paras[k]) + '</p>'; }).join('') + '</details>' : '';
    return '<div class="cet-card"><div class="section-title">Part III · Section B · 长篇阅读匹配</div>' +
      '<p class="tiny muted">' + esc(exam.matching.note || '') + '</p>' + paraHtml +
      exam.matching.statements.map(function (s) {
        return '<div class="match-row"><div class="txt"><b>' + s.n + '.</b> ' + esc(s.text) + '</div><select class="match-select" data-q="' + exam.id + '|M-' + s.n + '"><option value="">—</option>' + letters + '</select></div>';
      }).join('') +
      '<div class="exam-actions"><button class="btn primary" data-grade="matching">提交本节</button><span class="tiny muted">' + exam.matching.statements.length + ' 题 · 段落可重复</span></div><div id="gradeResult"></div></div>';
  }

  function sectionReading(exam) {
    return '<div class="cet-card"><div class="section-title">Part III · Section C · 仔细阅读</div>' +
      exam.reading.map(function (p) {
        return '<h3 style="margin:16px 0 8px">' + esc(p.title) + '</h3><div class="passage">' + p.passage.split('\n\n').map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>' +
          p.questions.map(function (q) { return qBlock(exam.id + '|R-' + q.n, q.n, q.stem, q.options, ''); }).join('');
      }).join('') +
      '<div class="exam-actions"><button class="btn primary" data-grade="reading">提交本节</button><span class="tiny muted">' + exam.reading.reduce(function (n, p) { return n + p.questions.length; }, 0) + ' 题</span></div><div id="gradeResult"></div></div>';
  }

  function sectionTranslation(exam) {
    var val = state.translation[exam.id] || '';
    return '<div class="cet-card"><div class="section-title">Part IV · Translation</div>' +
      '<div class="prompt-box">' + esc(exam.translation.prompt) + '</div>' +
      '<div class="mini-label">翻译步骤</div><ul class="guide-list">' + exam.translation.guide.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="mini-label">我的译文</div><textarea class="write-area" data-translation="' + exam.id + '" placeholder="Translate the passage here...">' + esc(val) + '</textarea>' +
      '<div class="exam-actions"><button class="btn primary" data-save-translation="' + exam.id + '">保存译文</button></div></div>';
  }

  function qBlock(key, n, stem, options, extra) {
    return '<div class="q-block" data-key="' + key + '"><div class="q-head"><span class="q-num">' + n + '</span><div class="q-stem">' + (stem ? esc(stem) : '听音频，选出正确答案。') + '</div></div>' +
      '<div class="choices">' + Object.keys(options).map(function (k) {
        return '<label class="choice"><input type="radio" name="q-' + key + '" value="' + k + '" data-q="' + key + '"><span><b>' + k + ')</b> ' + esc(options[k]) + '</span></label>';
      }).join('') + '</div></div>';
  }

  function countWords(s) { return (String(s || '').trim().match(/[A-Za-z0-9’'-]+/g) || []).length; }
  function countListening(exam) { return exam.listening.groups.reduce(function (n, g) { return n + g.questions.length; }, 0); }

  /* ---------- grading ---------- */
  function grade(section) {
    var exam = examById(hashRoute().param) || EXAMS[0]; if (!exam) return;
    if (!hasAnswers(exam)) { toast('这套答案键还没接入，暂不判分'); return; }
    var keys = [];
    function typeOf(k) { return String(k).split('|')[1].charAt(0); }
    if (section === 'listening') keys = allKeys(exam).filter(function (k) { return typeOf(k) === 'L'; });
    if (section === 'cloze') keys = allKeys(exam).filter(function (k) { return typeOf(k) === 'C'; });
    if (section === 'matching') keys = allKeys(exam).filter(function (k) { return typeOf(k) === 'M'; });
    if (section === 'reading') keys = allKeys(exam).filter(function (k) { return typeOf(k) === 'R'; });
    var total = keys.length, right = 0, missing = 0;
    keys.forEach(function (k) {
      var el = document.querySelector('input[data-q="' + k + '"]:checked') || document.querySelector('select[data-q="' + k + '"]');
      var val = el ? el.value : '';
      if (!val) { missing++; return; }
      if (String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase()) right++;
      state.answers[k] = val;
      schedule(k, String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase());
      if (el && el.type === 'radio') {
        var label = el.closest('.choice');
        if (label) label.classList.add(String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase() ? 'correct' : 'wrong');
      }
    });
    save();
    var box = $('#gradeResult');
    if (box) {
      var good = right === total && missing === 0;
      box.className = 'result-box ' + (good ? 'good' : 'bad');
      box.innerHTML = '<b>' + right + ' / ' + total + '</b> 正确' + (missing ? ' · ' + missing + ' 题未答' : '') + '<br><span class="tiny">答案已记录；错题会进错题本并按 1/2/4/7/15/30/60 天安排复习。</span>';
    }
    toast('本节已提交');
  }

  /* ---------- wrong / guides / stats ---------- */
  function viewWrong() {
    var keys = Object.keys(state.wrong);
    if (!keys.length) return '<div class="page-head"><div><h1>错题本</h1><div class="sub">做错的题会自动进来</div></div></div><div class="empty"><div style="font-size:34px">∅</div><h3>还没有错题</h3><p>先去做一套真题，错题会自动收进来。</p><a class="btn primary" href="#/exam/' + (EXAMS[0] ? EXAMS[0].id : '') + '">开始样卷 →</a></div>';
    return '<div class="page-head"><div><h1>错题本</h1><div class="sub">' + keys.length + ' 道 · 按最近错误排序</div></div></div><div class="cet-card">' +
      keys.sort(function (a, b) { return (state.wrong[b].at || 0) - (state.wrong[a].at || 0); }).map(function (k) {
        var w = state.wrong[k];
        var causes = ['', '词汇不认识', '长难句没读懂', '定位/同义替换', '听力没跟上', '粗心/看错', '时间不够'];
        return '<div class="wrong-item"><div class="wrong-main"><b>' + esc(w.label) + '</b><div class="tiny muted">' + new Date(w.at).toLocaleDateString('zh-CN') + ' · ' + esc(w.section) + ' · ' + (w.words || []).slice(0, 5).map(esc).join(' / ') + '</div>' +
          '<select class="cause-select" data-cause="' + esc(k) + '">' + causes.map(function (c) { return '<option value="' + esc(c) + '"' + (w.cause === c ? ' selected' : '') + '>' + (c || '选错因…') + '</option>'; }).join('') + '</select></div>' +
          '<div style="display:flex;gap:6px"><span class="tag warm">待复习</span><a class="btn sm" href="#/exam/' + w.exam + '?sec=' + w.section + '">重做</a></div></div>';
      }).join('') + '</div>';
  }

  function viewGuides(route) {
    var focus = route.query.focus || '';
    var guides = [
      { id: 'writing', title: '作文 · 先立场，后展开', intro: '四级作文不是比谁词大，是比谁在 30 分钟内把观点写清楚、结构完整、错误少。', points: ['审题 2 分钟：圈出话题、对象、任务（观点/建议/现象）。', '立场要明确：第一段最后一句必须让阅卷人知道你到底支持什么。', '主体两段：每段一个理由，用“具体场景 + 结果”展开，不要堆空话。', '结尾给方案或重申，不要引入新论点。', '检查：主谓一致、冠词、可数不可数、拼写、字数。'] },
      { id: 'listening', title: '听力 · 预读和信号词', intro: '听力不是听懂每个词，是在音频里抓到和选项对应的那一下。', points: ['利用 Directions 时间预读选项，圈名词、数字、转折词。', '新闻关注开头 5 秒：who / what / where / result。', '长对话关注问答：第二个说话人常给答案。', '听到 but / however / actually / in fact 立刻提高注意。', '同义替换是核心：选项不会原词复现，注意近义表达。', '没听清就放过，别拖累下一题。'] },
      { id: 'cloze', title: '选词填空 · 先词性，后搭配', intro: '15 选 10，先给每个词标词性，再按空格语法位置筛。', points: ['先通读首句和每段首句，抓主题。', '给词库标：n. / v. / adj. / adv.，注意一词多性。', '按空格前后判断词性：冠词后多名词，be 后多形容词/过去分词。', '固定搭配优先：constitute a reputation、vary behavior。', '最后检查时态、单复数、主谓一致。'] },
      { id: 'reading', title: '阅读 · 题干定位，选项排雷', intro: '仔细阅读先题干、后原文；匹配题先找专有名词和数字。', points: ['仔细阅读：题干关键词回原文定位，答案在定位句及上下句。', '警惕绝对化选项：all / never / only / must 多为错。', '匹配题：先读题干圈专有名词、数字、极端词，再扫段落。', '段落可重复，不要假设一一对应。', '选词填空和匹配先做有把握的，别在一题上耗太久。'] },
      { id: 'translation', title: '翻译 · 先拆句，再补主干', intro: '四级翻译按段给分，先保证每句有主语和谓语，再处理修饰。', points: ['先拆成短句，一句一个主干。', '不会的词用解释：hybrid rice = a kind of rice developed by crossing different varieties。', '中文并列多，英文用 and / while / which 连接，避免逗号连写。', '数字、比较级、被动语态是常见扣分点。', '最后检查：时态统一、冠词、单复数、拼写。'] }
    ];
    return '<div class="page-head"><div><h1>题型指南</h1><div class="sub">先方法，再刷题；每类都给可执行的步骤</div></div></div><div class="guide-grid">' +
      guides.map(function (g) {
        return '<div class="guide-card" id="guide-' + g.id + '" style="' + (focus === g.id ? 'border-color:var(--warm)' : '') + '"><h3>' + g.title + '</h3><p>' + g.intro + '</p><ul>' + g.points.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>';
  }

  function viewStats() {
    var keys = Object.keys(state.answers);
    var correct = correctCount();
    var due = dueList();
    return '<div class="page-head"><div><h1>统计</h1><div class="sub">先看趋势，不追求一次全对</div></div></div>' +
      '<div class="cet-grid"><div class="cet-card"><div class="eyebrow">OVERVIEW</div><h2>练习概览</h2>' +
      '<div class="cet-meta"><div><b>' + keys.length + '</b><span>已作答</span></div><div><b>' + correct + '</b><span>答对</span></div><div><b>' + (keys.length ? Math.round(correct * 100 / keys.length) + '%' : '—') + '</b><span>正确率</span></div><div><b>' + due.length + '</b><span>待复习</span></div></div>' +
      '<p class="tiny muted" style="margin-top:14px">当前统计覆盖题库全部套卷；可按题型、年份在题库里筛。</p></div>' +
      '<div class="cet-card"><div class="eyebrow">REVIEW</div><h2>艾宾浩斯</h2><p class="tiny muted">错题与答对题都会进入复习队列：1 / 2 / 4 / 7 / 15 / 30 / 60 天。</p>' +
      (due.length ? '<div class="wrong-item"><div><b>' + due.length + ' 道到期</b><div class="tiny muted">' + due.slice(0, 4).map(function (k) { return esc(keyLabel(examForKey(k), k)); }).join('、') + '</div></div><a class="btn sm primary" href="#/wrong">去复习</a></div>' : '<div class="empty" style="padding:22px">今天没有到期复习</div>') +
      '</div></div>' +
      (function () {
        var vocab = wrongWords();
        var causes = {};
        Object.keys(state.wrong).forEach(function (k) {
          var c = state.wrong[k].cause || '未标注';
          causes[c] = (causes[c] || 0) + 1;
        });
        return '<div class="cet-card" style="margin-top:16px"><div class="eyebrow">WEAK POINTS</div><h2>常错词汇与错因</h2>' +
          (vocab.length ? '<div class="vocab-cloud">' + vocab.map(function (x) { return '<span>' + esc(x[0]) + '<em>' + x[1] + '</em></span>'; }).join('') + '</div>' : '<p class="tiny muted">做错几题后，这里会自动汇总常错词汇。</p>') +
          '<div class="cause-grid">' + Object.keys(causes).map(function (c) { return '<div><b>' + esc(c) + '</b><span>' + causes[c] + ' 题</span></div>'; }).join('') + '</div></div>';
      })();
  }

  function viewAccount() {
    var c = cloud();
    var head = '<div class="page-head"><div><h1>账号与云同步</h1><div class="sub">与数学站共用同一个 Supabase 账号 · 英语答题/作文/译文跨设备同步</div></div></div>';
    if (!c || !c.ready) {
      return head + '<div class="cet-card account-box"><h2>云同步未配置</h2><p>当前缺少 Supabase 配置，英语站只保存在本机。补上 publishable key 后即可登录。</p></div>';
    }
    if (c.user) {
      return head + '<div class="cet-card account-box"><h2>已登录</h2><p><b>' + esc(c.user.email) + '</b></p>' +
        '<p class="tiny muted">本机记录会在登录后与云端合并；之后每次答题、保存作文/译文都会自动推送。</p>' +
        '<div class="exam-actions"><button class="btn primary" data-account="push">立即上传本机</button><button class="btn" data-account="pull">从云端拉取</button><button class="btn ghost" data-account="logout">退出登录</button></div>' +
        '<div class="tiny muted" id="syncState" style="margin-top:10px">已连接 Supabase</div></div>';
    }
    return head + '<div class="cet-grid"><div class="cet-card"><h2>登录</h2><p class="tiny muted">用数学站同一个邮箱和密码登录。</p>' +
      '<form data-auth-form="login" class="auth-form"><label>邮箱<input type="email" name="email" required autocomplete="email"></label><label>密码<input type="password" name="password" required autocomplete="current-password"></label><button class="btn primary" type="submit">登录</button></form>' +
      '<button class="btn sm ghost" data-account="reset" style="margin-top:8px">忘记密码</button><div class="tiny muted" id="authMsg" style="margin-top:8px"></div></div>' +
      '<div class="cet-card"><h2>注册</h2><p class="tiny muted">没有账号就在这边注册；和数学站是同一个 Supabase 用户体系。</p>' +
      '<form data-auth-form="signup" class="auth-form"><label>昵称<input name="name" autocomplete="nickname"></label><label>邮箱<input type="email" name="email" required autocomplete="email"></label><label>密码（至少 6 位）<input type="password" name="password" required minlength="6" autocomplete="new-password"></label><button class="btn primary" type="submit">注册</button></form><div class="tiny muted" id="signupMsg" style="margin-top:8px"></div></div></div>';
  }

  /* ---------- events ---------- */
  function render() {
    var route = hashRoute();
    setNav(route.name);
    var html = '';
    if (route.name === 'home') html = viewHome();
    else if (route.name === 'bank') html = viewBank(route);
    else if (route.name === 'select') html = viewSelect(route);
    else if (route.name === 'practice') html = viewPractice(route);
    else if (route.name === 'exam') html = viewExam(route);
    else if (route.name === 'wrong') html = viewWrong();
    else if (route.name === 'guides') html = viewGuides(route);
    else if (route.name === 'stats') html = viewStats();
    else if (route.name === 'account') html = viewAccount();
    else html = viewHome();
    app.innerHTML = html;
    if (route.name === 'exam' && route.query.sec === 'writing') {
      var ta = $('[data-writing]');
      if (ta) ta.addEventListener('input', function () { var wc = $('#wordCount'); if (wc) wc.textContent = countWords(ta.value) + ' words'; });
    }
    window.scrollTo(0, 0);
  }
  function setNav(name) {
    $$('.mainnav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-nav') === name); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.grade) { if (b.dataset.grade === 'practice') gradePractice(); else grade(b.dataset.grade); return; }
    if (b.dataset.saveWriting) {
      var ta = $('[data-writing]');
      state.writing[b.dataset.saveWriting] = ta ? ta.value : '';
      save(); toast('作文已保存到本机');
      return;
    }
    if (b.dataset.saveTranslation) {
      var tt = $('[data-translation]');
      state.translation[b.dataset.saveTranslation] = tt ? tt.value : '';
      save(); toast('译文已保存到本机');
      return;
    }
    if (b.dataset.speak) {
      if (!window.speechSynthesis) { toast('浏览器不支持朗读'); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(b.dataset.speak);
      u.lang = 'en-US'; u.rate = 0.9;
      speechSynthesis.speak(u);
      toast('正在朗读原文（合成音，非原音频）');
      return;
    }
    if (b.dataset.account) { handleAccount(b.dataset.account); return; }
    if (b.id === 'themeBtn') { toggleTheme(); }
  });

  async function handleAccount(action) {
    var c = cloud();
    if (!c) return;
    if (action === 'logout') { await c.signOut(); toast('已退出登录'); render(); return; }
    if (action === 'push') {
      try { await c.push('cet_state', state); toast('已上传本机记录'); }
      catch (e) { toast('上传失败：' + (e.message || '网络错误')); }
      return;
    }
    if (action === 'pull') {
      try {
        var row = await c.pull('cet_state');
        if (row && row.data) { state = Object.assign(defaults(), row.data); saveLocal(); render(); toast('已从云端拉取'); }
        else toast('云端还没有记录');
      } catch (e) { toast('拉取失败：' + (e.message || '网络错误')); }
      return;
    }
    if (action === 'reset') {
      var email = prompt('输入注册邮箱，发送重置密码邮件：');
      if (!email) return;
      try { await c.reset(email.trim()); toast('重置邮件已发送，请查收'); }
      catch (e) { toast('发送失败：' + (e.message || '网络错误')); }
      return;
    }
  }

  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-cause]');
    if (!sel) return;
    var k = sel.getAttribute('data-cause');
    if (state.wrong[k]) { state.wrong[k].cause = sel.value; save(); toast('错因已记下'); }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.matches('[data-select-form]')) {
      e.preventDefault();
      startPractice(e.target);
      return;
    }
    if (!e.target.matches('[data-exam-search]')) return;
    e.preventDefault();
    var val = (e.target.querySelector('input[name=q]') || {}).value || '';
    navigate('#/bank' + (val.trim() ? '?q=' + encodeURIComponent(val.trim()) : ''));
  });

  document.addEventListener('submit', async function (e) {
    if (!e.target.matches('[data-auth-form]')) return;
    e.preventDefault();
    var c = cloud(); if (!c) { toast('云同步未配置'); return; }
    var f = e.target, type = f.dataset.authForm;
    var email = (f.querySelector('[name=email]') || {}).value || '';
    var password = (f.querySelector('[name=password]') || {}).value || '';
    var name = (f.querySelector('[name=name]') || {}).value || '';
    try {
      if (type === 'login') {
        await c.signIn(email.trim(), password);
        await pullCloud(); render(); toast('登录成功');
      } else {
        var r = await c.signUp(email.trim(), password, name);
        var msg = $('#signupMsg');
        if (msg) msg.textContent = r.session ? '注册成功，已登录。' : '注册成功，请查收确认邮件后再登录。';
        if (r.session) { await pullCloud(); render(); }
      }
    } catch (err) {
      var box = type === 'login' ? $('#authMsg') : $('#signupMsg');
      if (box) box.textContent = (err.message || '操作失败') + '（请确认邮箱/密码，或检查邮箱确认）';
    }
  });

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem(THEME, cur);
    var btn = $('#themeBtn'); if (btn) btn.textContent = cur === 'dark' ? '☀' : '☾';
  }
  (function initTheme() {
    var t = localStorage.getItem(THEME) || (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
    var btn = $('#themeBtn'); if (btn) btn.textContent = t === 'dark' ? '☀' : '☾';
  })();

  function initCloud() {
    var c = cloud();
    if (!c || !c.ready) return;
    c.onChange(function (u) {
      if (u) pullCloud();
      if (hashRoute().name === 'account') render();
    });
    window.addEventListener('online', function () { pullCloud(); });
  }

  initCloud();
  window.addEventListener('hashchange', render);
  render();
})();
