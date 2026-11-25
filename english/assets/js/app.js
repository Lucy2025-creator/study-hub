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
  function defaults() {
    return { v: 1, answers: {}, wrong: {}, reviews: {}, writing: {}, translation: {}, attempted: {} };
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return defaults();
      var s = JSON.parse(raw);
      return Object.assign(defaults(), s || {});
    } catch (e) { return defaults(); }
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

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
    var out = [];
    (exam.listening.groups || []).forEach(function (g) {
      (g.questions || []).forEach(function (q) { out.push('L-' + q.n); });
    });
    Object.keys(exam.cloze.answers || {}).forEach(function (n) { out.push('C-' + n); });
    (exam.matching.statements || []).forEach(function (s) { out.push('M-' + s.n); });
    (exam.reading || []).forEach(function (p) { (p.questions || []).forEach(function (q) { out.push('R-' + q.n); }); });
    return out;
  }
  function keyAnswer(exam, key) {
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
  function keyLabel(exam, key) {
    var type = key.split('-')[0], n = key.split('-')[1];
    var names = { L: '听力', C: '选词', M: '匹配', R: '阅读' };
    return (names[type] || type) + ' 第 ' + n + ' 题';
  }
  function keySection(key) {
    return { L: 'listening', C: 'cloze', M: 'matching', R: 'reading' }[key.split('-')[0]] || 'reading';
  }

  /* ---------- stats / review ---------- */
  function answeredCount() { return Object.keys(state.answers).length; }
  function correctCount() {
    var c = 0;
    Object.keys(state.answers).forEach(function (k) {
      var e = EXAMS[0]; if (!e) return;
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
      state.wrong[key] = { key: key, label: keyLabel(EXAMS[0], key), exam: EXAMS[0].id, section: keySection(key), at: Date.now() };
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
      '<div class="cet-meta"><div><b>' + EXAMS.length + '</b><span>套真题（样卷）</span></div>' +
        '<div><b>' + answered + '</b><span>已作答</span></div>' +
        '<div><b>' + correct + '</b><span>答对</span></div>' +
        '<div><b>' + due + '</b><span>待复习</span></div></div></section>' +
      '<div class="cet-grid"><div class="cet-card"><div class="eyebrow">CURRENT SET</div><h2>2025.06 四级第一套</h2>' +
        '<p class="muted" style="font-size:13px">先把一套卷跑通：作文 → 听力 → 选词 → 匹配 → 阅读 → 翻译。2025.06 听力音频已接入；选词、阅读答案键可提交判分。</p>' +
        '<div class="exam-card" style="margin-top:14px"><div><h3>' + esc(exam.title) + '</h3><div class="meta">' + esc(exam.source) + '</div></div>' +
        '<a class="btn primary" href="#/exam/' + exam.id + '">开始这套 →</a></div>' +
        '<div class="tiny muted">提示：听力题干在音频中播放；卷面只给选项，先完整听一遍再作答。</div></div>' +
      '<div class="cet-card"><div class="eyebrow">GUIDES</div><h2>五类题型指导</h2>' +
        '<div style="display:flex;flex-direction:column;gap:7px;margin-top:12px">' +
        guides.map(function (g) { return '<a href="#/guides?focus=' + g[0] + '" style="display:flex;justify-content:space-between;gap:10px;text-decoration:none;padding:9px 10px;border:1px solid var(--line);border-radius:9px;color:var(--ink);font-size:13.5px"><span><b>' + g[1] + '</b> <span class="muted">' + g[2] + '</span></span><span>›</span></a>'; }).join('') +
        '</div><div class="divider"></div><a class="btn sm" href="../">回学习台制定计划 →</a></div></div>' +
      '<div class="section-head"><div><div class="eyebrow">SAMPLE EXAM</div><h2>样卷结构</h2></div><span class="tiny muted">2025.06 · CET-4 · Set 1</span></div>' +
      '<div class="guide-grid">' +
        ['作文 · 30 分钟', '听力 · 25 分钟', '选词填空', '长篇匹配', '仔细阅读', '翻译 · 30 分钟'].map(function (x, i) {
          return '<div class="guide-card"><h3>' + x + '</h3><p>' + ['观点类作文，120–180 词', '新闻/长对话/短文，25 题', '10 空，15 选 10', '10 题，A–M 段落', '两篇，10 题', '中国文化/社会话题'][i] + '</p><a class="btn sm ghost" href="#/exam/' + exam.id + '?sec=' + ['writing','listening','cloze','matching','reading','translation'][i] + '">打开 →</a></div>';
        }).join('') + '</div>';
  }

  function viewBank() {
    return '<div class="page-head"><div><h1>题库</h1><div class="sub">' + EXAMS.length + ' 套真题 · 四级为主，六级进阶</div></div></div>' +
      EXAMS.map(function (e) {
        return '<div class="exam-card"><div><div class="meta">' + e.level + ' · ' + e.year + '.' + String(e.month).padStart(2, '0') + ' · 第 ' + e.set + ' 套</div><h3>' + esc(e.title) + '</h3><div class="meta">' + esc(e.source) + '</div></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn sm" href="#/exam/' + e.id + '?sec=writing">作文</a><a class="btn sm" href="#/exam/' + e.id + '?sec=listening">听力</a><a class="btn sm" href="#/exam/' + e.id + '?sec=reading">阅读</a><a class="btn sm primary" href="#/exam/' + e.id + '">整套</a></div></div>';
      }).join('') +
      '<div class="empty" style="margin-top:18px"><b>批量真题正在接入</b><p class="muted">2014.06–2025.12 的 PDF/音频会按套卷入库；当前先以 2025.06 第一套作为样卷。</p></div>';
  }

  function tabs(exam, sec) {
    var list = [['writing', '作文'], ['listening', '听力'], ['cloze', '选词'], ['matching', '匹配'], ['reading', '阅读'], ['translation', '翻译']];
    return '<div class="section-tabs">' + list.map(function (x) {
      return '<a class="' + (x[0] === sec ? 'on' : '') + '" href="#/exam/' + exam.id + '?sec=' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div>';
  }

  function viewExam(route) {
    var exam = examById(route.param) || EXAMS[0];
    if (!exam) return '<div class="empty">还没有真题数据</div>';
    var sec = route.query.sec || 'writing';
    var html = '<div class="exam-head"><div><div class="eyebrow">' + exam.level + ' · ' + exam.year + '.' + String(exam.month).padStart(2, '0') + ' · SET ' + exam.set + '</div><h1>' + esc(exam.title) + '</h1><div class="tiny muted">' + esc(exam.source) + '</div></div><a class="btn sm ghost" href="#/bank">← 题库</a></div>' + tabs(exam, sec);
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
        return qBlock('L-' + q.n, q.n, '', q.options, '');
      }).join('');
    }).join('');
    return '<div class="cet-card"><div class="section-title">Part II · Listening</div>' + note +
      '<div class="tiny muted" style="margin-bottom:8px">CET 听力题干在音频中播放，卷面只给选项；先听音频，再选答案。</div>' + groups +
      '<div class="exam-actions"><button class="btn primary" data-grade="listening">提交本节</button><span class="tiny muted">共 ' + countListening(exam) + ' 题</span></div><div id="gradeResult"></div></div>';
  }

  function sectionCloze(exam) {
    var c = exam.cloze;
    var body = c.passage.replace(/___(\d+)___/g, function (m, n) {
      return '<select class="blank-select" data-q="C-' + n + '"><option value="">__</option>' + c.bank.map(function (b) { return '<option value="' + b[0] + '">' + b[0] + '</option>'; }).join('') + '</select>';
    });
    return '<div class="cet-card"><div class="section-title">Part III · Section A · 选词填空</div>' +
      '<div class="word-bank">' + c.bank.map(function (b) { return '<span><b>' + b[0] + '</b>' + esc(b[1]) + '</span>'; }).join('') + '</div>' +
      '<div class="passage">' + body.split('\n\n').map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>' +
      '<div class="exam-actions"><button class="btn primary" data-grade="cloze">提交本节</button><span class="tiny muted">10 个空 · 每个词最多用一次</span></div><div id="gradeResult"></div></div>';
  }

  function sectionMatching(exam) {
    var letters = 'ABCDEFGHIJKLM'.split('').map(function (x) { return '<option value="' + x + '">' + x + '</option>'; }).join('');
    return '<div class="cet-card"><div class="section-title">Part III · Section B · 长篇阅读匹配</div>' +
      '<p class="tiny muted">' + esc(exam.matching.note || '') + '</p>' +
      exam.matching.statements.map(function (s) {
        return '<div class="match-row"><div class="txt"><b>' + s.n + '.</b> ' + esc(s.text) + '</div><select class="match-select" data-q="M-' + s.n + '"><option value="">—</option>' + letters + '</select></div>';
      }).join('') +
      '<div class="exam-actions"><button class="btn primary" data-grade="matching">提交本节</button><span class="tiny muted">7 题 · 段落可重复</span></div><div id="gradeResult"></div></div>';
  }

  function sectionReading(exam) {
    return '<div class="cet-card"><div class="section-title">Part III · Section C · 仔细阅读</div>' +
      exam.reading.map(function (p) {
        return '<h3 style="margin:16px 0 8px">' + esc(p.title) + '</h3><div class="passage">' + p.passage.split('\n\n').map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>' +
          p.questions.map(function (q) { return qBlock('R-' + q.n, q.n, q.stem, q.options, ''); }).join('');
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
    var exam = EXAMS[0]; if (!exam) return;
    var keys = [];
    if (section === 'listening') keys = allKeys(exam).filter(function (k) { return k[0] === 'L'; });
    if (section === 'cloze') keys = allKeys(exam).filter(function (k) { return k[0] === 'C'; });
    if (section === 'matching') keys = allKeys(exam).filter(function (k) { return k[0] === 'M'; });
    if (section === 'reading') keys = allKeys(exam).filter(function (k) { return k[0] === 'R'; });
    var total = keys.length, right = 0, missing = 0;
    keys.forEach(function (k) {
      var el = document.querySelector('input[data-q="' + k + '"]:checked') || document.querySelector('select[data-q="' + k + '"]');
      var val = el ? el.value : '';
      if (!val) missing++;
      if (String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase()) right++;
      state.answers[k] = val;
      schedule(k, String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase());
      if (el && el.type === 'radio') {
        var label = el.closest('.choice');
        if (label) label.classList.add(val && String(val).toUpperCase() === String(keyAnswer(exam, k)).toUpperCase() ? 'correct' : 'wrong');
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
    if (!keys.length) return '<div class="page-head"><div><h1>错题本</h1><div class="sub">做错的题会自动进来</div></div></div><div class="empty"><div style="font-size:34px">∅</div><h3>还没有错题</h3><p>先去做一套样卷，错题会自动收进来。</p><a class="btn primary" href="#/exam/' + (EXAMS[0] ? EXAMS[0].id : '') + '">开始样卷 →</a></div>';
    return '<div class="page-head"><div><h1>错题本</h1><div class="sub">' + keys.length + ' 道 · 按最近错误排序</div></div></div><div class="cet-card">' +
      keys.sort(function (a, b) { return (state.wrong[b].at || 0) - (state.wrong[a].at || 0); }).map(function (k) {
        var w = state.wrong[k];
        return '<div class="wrong-item"><div><b>' + esc(w.label) + '</b><div class="tiny muted">' + new Date(w.at).toLocaleDateString('zh-CN') + ' · ' + esc(w.section) + '</div></div><div style="display:flex;gap:6px"><span class="tag warm">待复习</span><a class="btn sm" href="#/exam/' + w.exam + '?sec=' + w.section + '">重做</a></div></div>';
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
      '<p class="tiny muted" style="margin-top:14px">当前统计基于样卷；批量真题接入后会按套卷/题型/年份拆分。</p></div>' +
      '<div class="cet-card"><div class="eyebrow">REVIEW</div><h2>艾宾浩斯</h2><p class="tiny muted">错题与答对题都会进入复习队列：1 / 2 / 4 / 7 / 15 / 30 / 60 天。</p>' +
      (due.length ? '<div class="wrong-item"><div><b>' + due.length + ' 道到期</b><div class="tiny muted">' + due.slice(0, 4).map(function (k) { return esc(keyLabel(EXAMS[0], k)); }).join('、') + '</div></div><a class="btn sm primary" href="#/wrong">去复习</a></div>' : '<div class="empty" style="padding:22px">今天没有到期复习</div>') +
      '</div></div>';
  }

  function viewAccount() {
    return '<div class="page-head"><div><h1>账号与云同步</h1><div class="sub">与数学站共用同一套 Supabase 账号；英语站同步表正在接入</div></div></div>' +
      '<div class="cet-card account-box"><h2>当前状态</h2><p>英语站的答题记录先保存在本机。接入 `cet_state` / `cet_traces` 后，会和数学站使用同一个登录账号，实现进度、错题、作文/译文草稿跨设备同步。</p>' +
      '<p class="tiny muted">下一步：复用数学站的 Supabase publishable key，新增英语状态表与 RLS 策略。</p><a class="btn" href="https://lucy2025-creator.github.io/math-analysis-quiz/#/account">去数学站登录 →</a></div>';
  }

  /* ---------- events ---------- */
  function render() {
    var route = hashRoute();
    setNav(route.name);
    var html = '';
    if (route.name === 'home') html = viewHome();
    else if (route.name === 'bank') html = viewBank();
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
    if (b.dataset.grade) { grade(b.dataset.grade); return; }
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
    if (b.id === 'themeBtn') { toggleTheme(); }
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

  window.addEventListener('hashchange', render);
  render();
})();
