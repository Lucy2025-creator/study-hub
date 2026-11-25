/* 学习台共用 Supabase 客户端：同一 origin 下，主导站与英语站共享登录态 */
(function () {
  'use strict';
  var cfg = window.MAQ_SUPABASE || {};
  var listeners = [];
  var client = null, user = null, ready = false;

  function emit() {
    listeners.forEach(function (fn) { try { fn(user); } catch (e) {} });
  }
  if (cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient) {
    try {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      ready = true;
    } catch (e) { console.warn('Supabase init failed', e); }
  }

  async function init() {
    if (!client) { emit(); return; }
    try {
      var r = await client.auth.getSession();
      user = r.data && r.data.session ? r.data.session.user : null;
    } catch (e) { user = null; }
    emit();
    client.auth.onAuthStateChange(function (_event, session) {
      user = session ? session.user : null;
      emit();
    });
  }

  async function signIn(email, password) {
    if (!client) throw new Error('云同步未配置');
    var r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    user = r.data.user;
    emit();
    return user;
  }
  async function signUp(email, password, name) {
    if (!client) throw new Error('云同步未配置');
    var r = await client.auth.signUp({ email: email, password: password, options: { data: { display_name: name || '' } } });
    if (r.error) throw r.error;
    return r.data;
  }
  async function signOut() {
    if (client) await client.auth.signOut();
    user = null; emit();
  }
  async function reset(email) {
    if (!client) throw new Error('云同步未配置');
    var r = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (r.error) throw r.error;
  }
  async function pull(table) {
    if (!client || !user) return null;
    var r = await client.from(table).select('*').eq('user_id', user.id).maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }
  async function push(table, data) {
    if (!client || !user) return false;
    var r = await client.from(table).upsert({
      user_id: user.id, data: data, client_updated_at: Date.now()
    }, { onConflict: 'user_id' });
    if (r.error) throw r.error;
    return true;
  }
  function realtime(table, cb) {
    if (!client || !user) return null;
    return client.channel('study-' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table: table, filter: 'user_id=eq.' + user.id }, cb)
      .subscribe();
  }
  function onChange(fn) { listeners.push(fn); fn(user); }

  window.STUDY_CLOUD = {
    get ready() { return ready; },
    get user() { return user; },
    client: client,
    onChange: onChange,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    reset: reset,
    pull: pull,
    push: push,
    realtime: realtime
  };
  init();
})();
