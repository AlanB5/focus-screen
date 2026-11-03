(() => {
  const KEY = 'focus-session';
  const MAX_AGE = 12 * 60 * 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const setup = $('setup'), session = $('session'), taskEl = $('task'), timerEl = $('timer');
  const input = $('task-input'), minutesEl = $('minutes'), startBtn = $('start');

  let state = null;      // { task, totalMs, endAt, remainingMs (when paused), paused, done }
  let tick = null, wakeLock = null, beeped = false;

  // ---------- storage ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const save = () => { try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY); } catch {} };

  // ---------- wake lock ----------
  async function keepAwake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
  }
  function releaseAwake() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (state && !state.paused && !state.done) keepAwake(); render(); }
  });

  // ---------- audio ----------
  let ctx = null;
  function beep() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      [0, 0.35, 0.7].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(0.4, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.25);
        o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.3);
      });
    } catch {}
  }
  // iOS needs a user gesture to unlock audio; do it on first touch.
  const unlock = () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch {} };
  document.addEventListener('touchend', unlock, { once: true });
  document.addEventListener('click', unlock, { once: true });

  // ---------- rendering ----------
  const pad = (n) => String(n).padStart(2, '0');
  function remaining() {
    if (!state) return 0;
    return state.paused ? state.remainingMs : Math.max(0, state.endAt - Date.now());
  }
  function fitTask() {
    const len = taskEl.textContent.trim().length;
    taskEl.classList.toggle('long', len > 40 && len <= 80);
    taskEl.classList.toggle('longer', len > 80);
  }
  function render() {
    if (!state) return;
    const ms = remaining();
    if (ms <= 0 && !state.done) { state.done = true; save(); clearInterval(tick); tick = null; releaseAwake(); if (!beeped) { beeped = true; beep(); } }
    if (state.done) { timerEl.textContent = 'DONE'; timerEl.className = 'done'; return; }
    const s = Math.ceil(ms / 1000);
    timerEl.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    timerEl.className = state.paused ? 'paused' : '';
  }
  function startTicking() { if (!tick) tick = setInterval(render, 250); render(); }

  // ---------- session control ----------
  function showSession() {
    setup.hidden = true; session.hidden = false;
    taskEl.textContent = state.task; fitTask();
    beeped = state.done;
    if (!state.paused && !state.done) keepAwake();
    startTicking();
  }
  function begin(task, minutes) {
    const totalMs = minutes * 60 * 1000;
    state = { task, totalMs, endAt: Date.now() + totalMs, remainingMs: totalMs, paused: false, done: false };
    save(); showSession();
  }
  function togglePause() {
    if (!state || state.done) return;
    if (state.paused) { state.endAt = Date.now() + state.remainingMs; state.paused = false; keepAwake(); }
    else { state.remainingMs = remaining(); state.paused = true; releaseAwake(); }
    save(); render();
  }
  function showSetup(prefill) {
    session.hidden = true; setup.hidden = false;
    if (prefill) input.value = prefill;
  }

  // ---------- setup UI ----------
  let chosen = 25;
  minutesEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-min]'); if (!b) return;
    chosen = +b.dataset.min;
    minutesEl.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x === b));
  });
  function go() { const t = input.value.trim(); if (!t) { input.focus(); return; } input.blur(); begin(t, chosen); }
  startBtn.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

  // ---------- in-session gestures ----------
  timerEl.addEventListener('click', () => {
    if (state && state.done) { state = null; save(); showSetup(''); return; }
    togglePause();
  });
  taskEl.addEventListener('click', () => {
    if (taskEl.contentEditable === 'true') return;
    taskEl.contentEditable = 'true'; taskEl.focus();
    const r = document.createRange(); r.selectNodeContents(taskEl); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  function commitEdit() {
    if (taskEl.contentEditable !== 'true') return;
    taskEl.contentEditable = 'false';
    const t = taskEl.textContent.trim() || state.task;
    taskEl.textContent = t; state.task = t; save(); fitTask();
  }
  taskEl.addEventListener('blur', commitEdit);
  taskEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); taskEl.blur(); } });

  // block pinch-zoom / double-tap zoom / rubber-band scroll
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || taskEl.contentEditable !== 'true') e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300 && e.target !== input && taskEl.contentEditable !== 'true') e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // ---------- boot ----------
  async function boot() {
    const saved = load();
    if (saved && !saved.done) { state = saved; showSession(); return; }
    let remote = null;
    try {
      const r = await fetch(`task.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) remote = await r.json();
    } catch {}
    const fresh = remote && typeof remote.task === 'string' && remote.task.trim() && remote.minutes > 0
      && remote.set_at && (Date.now() - Date.parse(remote.set_at)) < MAX_AGE;
    if (fresh) { begin(remote.task.trim(), +remote.minutes); return; }
    showSetup(remote && remote.task ? remote.task : '');
  }
  boot();
})();
