(function () {
  'use strict';
  var KEY = 'studyhub.plan.v1';
  var THEME_KEY = 'studyhub.theme.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DAY = 86400000;

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseKey(k) {
    var p = k.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
  function dateCN(d) {
    var w = '日一二三四五六'[d.getDay()];
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' + w;
  }
  function defaults() {
    return {
      v: 1,
      examDate: '2026-12-19',
      remindTime: '20:30',
      tasks: [
        { id: 'seed-1', title: '英语：背 20 个四级词', subject: '英语', date: todayKey(), done: false },
        { id: 'seed-2', title: '听力：精听 1 篇真题', subject: '英语', date: todayKey(), done: false },
        { id: 'seed-3', title: '数学：做 10 道错题', subject: '数学', date: todayKey(), done: false }
      ],
      seeded: true,
      notified: {},
      updatedAt: Date.now()
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return defaults();
      s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
      s.notified = s.notified && typeof s.notified === 'object' ? s.notified : {};
      // 清掉 90 天前的旧任务，避免 localStorage 越来越重
      var cut = Date.now() - 90 * DAY;
      s.tasks = s.tasks.filter(function (t) { return parseKey(t.date || todayKey()).getTime() >= cut; });
      return Object.assign(defaults(), s);
    } catch (e) { return defaults(); }
  }
  var state = load();
  var syncing = false, pushTimer = null;
  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    queuePush();
  }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function cloud() { return window.STUDY_CLOUD; }
  function queuePush() {
    if (syncing || !cloud() || !cloud().user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      cloud().push('study_plan', state).then(function () {
        var a = $('#accountTop'); if (a) a.title = '已同步 ' + new Date().toLocaleTimeString();
      }).catch(function () {});
    }, 900);
  }
  function pullPlan() {
    var c = cloud();
    if (!c || !c.user) return;
    c.pull('study_plan').then(function (row) {
      if (!row || !row.data || !row.data.updatedAt) { queuePush(); return; }
      if (row.data.updatedAt > (state.updatedAt || 0)) {
        syncing = true;
        state = Object.assign(defaults(), row.data);
        saveLocal(); render(); syncing = false;
        toast('已从云端同步计划');
      } else if ((state.updatedAt || 0) > row.data.updatedAt) {
        queuePush();
      }
    }).catch(function () {});
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }
  function uid() { return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function todayTasks() { return state.tasks.filter(function (t) { return t.date === todayKey(); }); }
  function doneByDate() {
    var map = {};
    state.tasks.forEach(function (t) { if (t.done) map[t.date] = (map[t.date] || 0) + 1; });
    return map;
  }
  function streak() {
    var map = doneByDate(), n = 0, d = startOfDay(new Date());
    // 今天还没完成时，从昨天开始算，避免中午就把连续打断
    if (!map[todayKey(d)]) d = new Date(d.getTime() - DAY);
    for (var i = 0; i < 400; i++) {
      var k = todayKey(d);
      if (!map[k]) break;
      n++;
      d = new Date(d.getTime() - DAY);
    }
    return n;
  }
  function weekDates() {
    var d = startOfDay(new Date());
    var dow = (d.getDay() + 6) % 7; // Monday = 0
    var monday = new Date(d.getTime() - dow * DAY);
    var arr = [];
    for (var i = 0; i < 7; i++) arr.push(new Date(monday.getTime() + i * DAY));
    return arr;
  }
  function weekDone() {
    var map = doneByDate(), n = 0;
    weekDates().forEach(function (d) { n += map[todayKey(d)] || 0; });
    return n;
  }

  function render() {
    var now = new Date();
    $('#heroDate').textContent = dateCN(now);
    var exam = state.examDate ? startOfDay(new Date(state.examDate)) : null;
    var left = exam ? Math.ceil((exam.getTime() - startOfDay(now).getTime()) / DAY) : null;
    $('#daysLeft').textContent = left === null ? '—' : (left >= 0 ? left : 0);
    var badge = left === null ? '先定一个考试日期' : left <= 14 ? '该收心了' : left <= 45 ? '时间刚好，别急' : '时间还够，慢慢来';
    $('#heroBadge').textContent = badge;
    $('#heroLede').textContent = left !== null && left <= 30
      ? '离考试不远了。今天不用做很多，先把最小的一步走掉。'
      : '不用一次把所有事做完。先把今天最小的那一步走掉。';

    var ts = todayTasks();
    var done = ts.filter(function (t) { return t.done; }).length;
    $('#todayDone').textContent = done;
    $('#streak').textContent = streak();
    $('#weekDone').textContent = weekDone();
    $('#taskCount').textContent = done + ' / ' + ts.length;
    $('#taskList').innerHTML = ts.length ? ts.map(taskHTML).join('') :
      '<div class="empty-task">今天还没有安排。写一件 10 分钟能完成的小事就好。</div>';

    $('#weekGrid').innerHTML = weekDates().map(function (d) {
      var k = todayKey(d), n = doneByDate()[k] || 0;
      var total = state.tasks.filter(function (t) { return t.date === k; }).length || 1;
      var pct = Math.min(100, Math.round(n * 100 / total));
      return '<div class="day ' + (k === todayKey() ? 'today' : '') + '">' +
        '<div class="dow">' + '一二三四五六日'[((d.getDay() + 6) % 7)] + '</div>' +
        '<div class="num">' + d.getDate() + '</div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="cnt">' + (n ? n + ' 项' : '—') + '</div></div>';
    }).join('');

    $('#examDate').value = state.examDate || '';
    $('#remindTime').value = state.remindTime || '20:30';
    updateReminderState();
  }

  function taskHTML(t) {
    return '<div class="task ' + (t.done ? 'done' : '') + '" data-id="' + t.id + '">' +
      '<button class="task-check" data-act="toggle" aria-label="' + (t.done ? '标记未完成' : '标记完成') + '">✓</button>' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-subject">' + esc(t.subject || '其他') + '</span>' +
      '<button class="task-del" data-act="del" aria-label="删除">×</button></div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addTask(e) {
    e.preventDefault();
    var input = $('#taskInput');
    var title = input.value.trim();
    if (!title) { input.focus(); return; }
    state.tasks.unshift({ id: uid(), title: title, subject: $('#taskSubject').value, date: todayKey(), done: false });
    input.value = '';
    save(); render(); toast('已加入今天的计划');
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var row = btn.closest('[data-id]');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (btn.getAttribute('data-act') === 'toggle') {
      t.done = !t.done;
      if (t.done) toast('完成一件，记上了');
      save(); render();
    } else if (btn.getAttribute('data-act') === 'del') {
      state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
      save(); render();
    }
  }

  function updateReminderState() {
    var el = $('#reminderState');
    if (!('Notification' in window)) { el.textContent = '不支持'; return; }
    if (Notification.permission === 'granted') { el.textContent = '已开启'; return; }
    if (Notification.permission === 'denied') { el.textContent = '被拦截'; return; }
    el.textContent = '未开启';
  }

  function requestNotify() {
    if (!('Notification' in window)) { toast('这个浏览器不支持通知'); return; }
    if (Notification.permission === 'granted') { toast('提醒已经开着'); return; }
    Notification.requestPermission().then(function (p) {
      updateReminderState();
      toast(p === 'granted' ? '提醒已开启' : '通知权限没有打开');
    });
  }
  function showNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try { new Notification(title, { body: body, tag: 'studyhub-' + todayKey() }); return true; }
    catch (e) { return false; }
  }
  function testReminder() {
    if (!showNotification('学习台 · 试一下', '这是晚上的复习提醒。现在能弹出来，之后就会按这个时间提醒你。')) {
      toast('先在浏览器里允许通知');
    } else toast('提醒已弹出');
  }
  function checkReminder() {
    if (!state.remindTime) return;
    var now = new Date();
    var hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (hm !== state.remindTime) return;
    if (state.notified && state.notified[todayKey()] === state.remindTime) return;
    state.notified[todayKey()] = state.remindTime;
    save();
    var ts = todayTasks();
    var left = ts.filter(function (t) { return !t.done; }).length;
    showNotification('学习台 · 该收尾了', left ? '今天还有 ' + left + ' 项没完成，回来收一下。' : '今天的任务都完成了，来打个勾。');
    toast('到复习时间了');
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').textContent = t === 'dark' ? '☀' : '☾';
    localStorage.setItem(THEME_KEY, t);
  }
  function initTheme() {
    var t = localStorage.getItem(THEME_KEY);
    if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(t);
  }

  function initCloud() {
    var c = cloud();
    if (!c || !c.ready) return;
    c.onChange(function (u) {
      var a = $('#accountTop');
      if (a) a.textContent = u ? (u.email || '已登录').split('@')[0] : '登录';
      if (u) pullPlan();
    });
    window.addEventListener('online', function () { pullPlan(); });
  }

  function init() {
    initTheme();
    initCloud();
    render();
    $('#addTaskForm').addEventListener('submit', addTask);
    $('#taskList').addEventListener('click', onClick);
    $('#clearDone').addEventListener('click', function () {
      state.tasks = state.tasks.filter(function (t) { return !(t.date === todayKey() && t.done); });
      save(); render(); toast('已清掉今天完成的');
    });
    $('#examDate').addEventListener('change', function () {
      state.examDate = this.value; save(); render();
    });
    $('#remindTime').addEventListener('change', function () {
      state.remindTime = this.value; save(); updateReminderState();
    });
    $('#saveReminder').addEventListener('click', function () {
      requestNotify();
      state.remindTime = $('#remindTime').value || '20:30';
      save(); toast('提醒时间已保存');
    });
    $('#testReminder').addEventListener('click', testReminder);
    $('#notifyBtn').addEventListener('click', requestNotify);
    $('#themeBtn').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    setInterval(checkReminder, 30000);
    checkReminder();
  }
  init();
})();
