(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const daysUntil = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const a = new Date(y, m - 1, d);
    const b = new Date();
    b.setHours(0, 0, 0, 0);
    return Math.round((a - b) / 864e5);
  };

  // ---------- state ----------
  const state = {
    mode: 'demo',
    backend: false,
    easy: LS.get('bl.easy', false),
    mtEngine: '',
    languages: [],
    lang: LS.get('bl.lang', 'en'),
    level: LS.get('bl.level', 5),
    notices: LS.get('bl.notices', []),
    currentId: null,
    file: null,
    chat: [],
  };
  const save = () => LS.set('bl.notices', state.notices);
  const current = () => state.notices.find((n) => n.id === state.currentId) || null;
  const langInfo = (code = state.lang) => state.languages.find((l) => l.code === code) || { code: 'en', name: 'English', speech: 'en-US' };

  // ---------- i18n ----------
  function t(key) {
    const d = window.BL_I18N;
    return (d[state.lang] && d[state.lang][key]) || d.en[key] || key;
  }
  function applyI18n() {
    $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    $$('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
    $$('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', t(n.dataset.i18nTitle)); });
    const hasUi = Boolean(window.BL_I18N[state.lang]);
    document.documentElement.lang = hasUi ? state.lang : 'en';
    document.documentElement.dir = hasUi && langInfo().rtl ? 'rtl' : 'ltr';
    $('#levelLabel').textContent = t('lvl' + state.level);
    renderMode();
  }

  // ---------- ui utils ----------
  let toastTimer;
  function toast(msg, kind) {
    const n = $('#toast');
    n.textContent = msg;
    n.className = 'toast' + (kind === 'error' ? ' error' : '');
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { n.hidden = true; }, kind === 'error' ? 6000 : 2500);
  }
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch {
      const ta = el('textarea', { class: 'sr' });
      ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast(t('copied')); } catch { toast('Copy failed', 'error'); }
      ta.remove();
    }
  }
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    try { return new Date(y, m - 1, d).toLocaleDateString(state.lang, { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return iso; }
  };
  const fmtTime = (hm) => {
    if (!hm) return '';
    const [h, m] = hm.split(':').map(Number);
    try { return new Date(2000, 0, 1, h, m).toLocaleTimeString(state.lang, { hour: 'numeric', minute: '2-digit' }); } catch { return hm; }
  };
  function dueLabel(iso) {
    const n = daysUntil(iso);
    if (n < 0) return { text: t('overdue'), cls: 'overdue' };
    if (n === 0) return { text: t('today'), cls: 'soon' };
    if (n === 1) return { text: t('tomorrow'), cls: 'soon' };
    return { text: t('inDays').replace('{n}', n), cls: n <= 3 ? 'soon' : '' };
  }
  const dirFor = (code) => (langInfo(code).rtl ? 'rtl' : 'ltr');
  const safeEmail = (e) => (/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(e) ? e : '');
  const safePhone = (p) => p.replace(/[^\d+]/g, '');

  // Where the AI call goes when there is no server: straight from the browser to Anthropic,
  // using the user's own key (kept only in this browser's localStorage).
  const browserAi = {
    enabled: () => Boolean(LS.get('bl.key', '')),
    async callJson({ system, content, history = [], maxTokens = 3000 }) {
      let res;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': LS.get('bl.key', ''),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({ model: LS.get('bl.model', '') || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [...history, { role: 'user', content }] }),
        });
      } catch { throw new Error('Could not reach the AI service. Check your internet connection.'); }
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        let detail = msg.slice(0, 160);
        try { detail = JSON.parse(msg).error.message; } catch { /* keep raw text */ }
        throw new Error(res.status === 401 ? 'Your API key was rejected (401). Check it in AI settings.' : `AI error ${res.status}: ${detail}`);
      }
      const data = await res.json();
      return window.BLEngine.extractJson((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
    },
  };
  let engine = null;
  async function localApi(path, body) {
    if (!window.BLEngine) throw new Error('The app engine failed to load. Reload the page.');
    engine = engine || window.BLEngine.createEngine({ ai: browserAi });
    const fn = { '/api/analyze': engine.analyze, '/api/reply': engine.reply, '/api/ask': engine.ask, '/api/compose': engine.compose }[path];
    if (!fn) throw new Error('Unknown action');
    return fn(body);
  }
  async function api(path, body) {
    if (!state.backend) return localApi(path, body);
    let res;
    try {
      res = await fetch(path.replace(/^\//, ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Error('Cannot reach the server. Check your connection.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const noteFallback = (res) => { if (res && res.fallback) toast('AI unavailable, using the offline version. ' + (res.reason || ''), 'error'); };

  // ---------- free translation (on-device first, then a free online service) ----------
  async function mt(texts, from, to) {
    const cfg = LS.get('bl.mt', { online: true, email: '' });
    const r = await BLTranslate.translateTexts(texts, {
      from, to, email: cfg.email, allowOnline: cfg.online !== false,
      redact: window.BLEngine.redact, hide: ($('#hideNames').value || '').split(','),
      onProgress: (d, n) => { $('#status').textContent = `${t('translating')} ${d}/${n}`; },
    });
    state.mtEngine = r.engine;
    return r.texts;
  }
  async function mtSafe(texts, from, to) {
    try { return await mt(texts, from, to); } catch (e) { toast(e.message, 'error'); state.mtEngine = 'failed'; return texts; }
  }
  const mtLabel = (e) => (e === 'device' ? 'on your device' : e === 'online' ? 'with MyMemory (a free service)' : '');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  async function translateAnalysis(base, to) {
    const a = clone(base);
    a.title_en = base.title_en || base.title;
    a.summary_en = base.summary_en || base.summary;
    a.uncertain = ['Machine translation. It can contain mistakes: check dates, prices and requirements against the original or with the school.', ...base.uncertain.filter((u) => !/^Demo mode/.test(u))];
    const refs = [];
    const add = (o, k) => { if (typeof o[k] === 'string' && o[k].trim()) refs.push([o, k]); };
    add(a, 'title'); add(a, 'summary');
    a.key_points.forEach((_, i) => add(a.key_points, i));
    a.actions.forEach((x) => { add(x, 'task'); add(x, 'due_text'); });
    a.events.forEach((x) => { add(x, 'title'); add(x, 'notes'); });
    a.money.forEach((x) => add(x, 'purpose'));
    a.bring.forEach((x) => add(x, 'item'));
    a.contacts.forEach((x) => add(x, 'role'));
    a.glossary.forEach((x) => add(x, 'plain'));
    a.questions_to_ask.forEach((_, i) => add(a.questions_to_ask, i));
    a.uncertain.forEach((_, i) => add(a.uncertain, i));
    const out = await mt(refs.map(([o, k]) => o[k]), 'en', to);
    refs.forEach(([o, k], i) => { o[k] = out[i]; });
    if (state.mtEngine) a.uncertain[0] += ` (${mtLabel(state.mtEngine) || 'translated'})`;
    return a;
  }
  async function buildTranslated(base, to) {
    try { return await translateAnalysis(base, to); } catch (e) {
      toast(e.message, 'error');
      const a = clone(base);
      a.uncertain = [`Could not translate to ${langInfo(to).name}: ${e.message} Showing English.`, ...a.uncertain.filter((u) => !/^Demo mode/.test(u))];
      return a;
    }
  }
  async function retranslateCurrent() {
    const n = current();
    if (!n || !n.base || n.language === state.lang) return;
    $('#status').textContent = t('translating');
    const next = state.lang === 'en' ? clone(n.base) : await buildTranslated(n.base, state.lang);
    next.actions.forEach((x, i) => { if (n.analysis.actions[i]) x.done = n.analysis.actions[i].done; });
    next.bring.forEach((x, i) => { if (n.analysis.bring[i]) x.done = n.analysis.bring[i].done; });
    n.analysis = next; n.language = state.lang; save();
    $('#status').textContent = '';
  }

  // ---------- speech ----------
  function speak(text, rate) {
    if (!('speechSynthesis' in window)) return toast(t('noSpeech'), 'error');
    speechSynthesis.cancel();
    const code = langInfo().speech || 'en-US';
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang.toLowerCase() === code.toLowerCase()) || voices.find((v) => v.lang.toLowerCase().startsWith(code.slice(0, 2).toLowerCase()));
    if (voices.length && !voice) toast(t('noSpeech'), 'error');
    const chunks = text.match(/[^.!?。！？\n]+[.!?。！？]*/g) || [text];
    for (const c of chunks) {
      const u = new SpeechSynthesisUtterance(c.trim());
      u.lang = code; u.rate = rate; if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    }
  }
  const stopSpeech = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  function dictate(target, btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Voice input is not supported in this browser.', 'error');
    const r = new SR();
    r.lang = langInfo().speech || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => { const s = e.results[0][0].transcript; target.value = (target.value ? target.value + ' ' : '') + s; };
    r.onerror = () => toast('Could not hear you. Try again.', 'error');
    r.onend = () => btn.classList.remove('rec');
    btn.classList.add('rec');
    try { r.start(); } catch { btn.classList.remove('rec'); }
  }

  // ---------- files / OCR ----------
  const toBase64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
  async function prepareFile(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 6 * 1024 * 1024) throw new Error('That PDF is too large (max 6 MB).');
      return { mediaType: 'application/pdf', data: await toBase64(file) };
    }
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = el('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { mediaType: 'image/jpeg', data: await toBase64(blob) };
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($(`script[src="${src}"]`)) return res();
      const s = el('script', { src });
      s.onload = res; s.onerror = () => rej(new Error('Could not load the OCR engine (needs internet).'));
      document.head.append(s);
    });
  }
  async function ocr(file, onProgress) {
    if (file.type === 'application/pdf') throw new Error('Demo mode cannot read PDFs. Paste the text instead.');
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const worker = await window.Tesseract.createWorker('eng', 1, { logger: (m) => m.status && onProgress(`${m.status} ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`) });
    try { return (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
  }
  function setFile(file) {
    state.file = file || null;
    $('#fileName').textContent = file ? file.name || 'photo' : '';
  }

  // ---------- header / settings ----------
  function renderMode() {
    const badge = $('#modeBadge');
    badge.textContent = state.mode === 'ai' ? t('aiBadge') : t('demoBadge');
    const banner = $('#demoBanner');
    banner.hidden = state.mode === 'ai';
    banner.textContent = t('demoBanner');
    if (!state.backend && state.mode !== 'ai') banner.append(el('button', { type: 'button', class: 'btn small primary', onclick: toggleAiPanel }, 'Settings'));
  }
  function toggleAiPanel() {
    const panel = $('#aiPanel');
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    const cfg = LS.get('bl.mt', { online: true, email: '' });
    $('#mtOnline').checked = cfg.online !== false;
    $('#mtEmail').value = cfg.email || '';
    $('#keyBlock').hidden = state.backend;
    $('#aiKey').value = '';
    $('#aiModel').value = LS.get('bl.model', '');
    $('#aiStatus').textContent = !state.backend && LS.get('bl.key', '') ? 'A key is saved on this device.' : '';
    panel.scrollIntoView({ block: 'nearest' });
  }
  function applyPrefs() {
    const fs = LS.get('bl.fs', 16);
    document.documentElement.style.setProperty('--fs', fs + 'px');
    const dark = LS.get('bl.dark', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const hc = LS.get('bl.hc', false);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (hc) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
    $('#themeBtn').setAttribute('aria-pressed', String(dark));
    const legible = LS.get('bl.legible', false);
    if (legible) document.documentElement.dataset.font = 'legible'; else delete document.documentElement.dataset.font;
    $('#fontBtn').setAttribute('aria-pressed', String(legible));
    $('#easyBtn').setAttribute('aria-pressed', String(state.easy));
    $('#contrastBtn').setAttribute('aria-pressed', String(hc));
  }

  // ---------- tabs ----------
  function showTab(name) {
    $$('[role=tab]').forEach((b) => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (name === 'notices') renderNotices();
    if (name === 'reply') fillNoticeSelect($('#replyNotice'));
    if (name === 'ask') { fillNoticeSelect($('#askNotice')); renderSuggest(); }
  }
  function fillNoticeSelect(sel) {
    const keep = sel.value || state.currentId || '';
    sel.replaceChildren(el('option', { value: '', text: t('noneNotice') }), ...state.notices.map((n) => el('option', { value: n.id, text: n.analysis.title })));
    sel.value = state.notices.some((n) => n.id === keep) ? keep : '';
  }

  // ---------- analyze ----------
  async function runAnalyze() {
    const text = $('#noticeText').value.trim();
    if (!text && !state.file) return toast(t('needInput'), 'error');
    const btn = $('#analyzeBtn');
    btn.disabled = true;
    $('#status').textContent = t('working');
    try {
      const payload = { text, language: state.lang, level: state.level, today: localISO(), redact: $('#redact').checked, hideNames: $('#hideNames').value };
      if (state.file) {
        if (state.mode === 'ai') payload.file = await prepareFile(state.file);
        else {
          const extracted = await ocr(state.file, (s) => { $('#status').textContent = 'Reading photo… ' + s; });
          payload.text = (text ? text + '\n' : '') + extracted;
          $('#noticeText').value = payload.text;
          setFile(null);
        }
      }
      const res = await api('/api/analyze', payload);
      let analysis = res.analysis;
      let base = null;
      if (res.mode === 'demo') {
        base = res.analysis;
        if (state.lang !== 'en') { $('#status').textContent = t('translating'); state.mtEngine = ''; analysis = await buildTranslated(base, state.lang); }
      }
      const notice = { id: uid(), createdAt: Date.now(), language: state.lang, level: state.level, mode: res.mode, fallback: Boolean(res.fallback), sourceText: res.source_text || payload.text || '', analysis, base };
      state.notices.unshift(notice);
      state.notices = state.notices.slice(0, 100);
      save();
      state.currentId = notice.id;
      state.chat = [];
      renderResult();
      refreshDueBanner();
      noteFallback(res);
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      $('#status').textContent = '';
    }
  }

  function highlight(text) {
    const re = /(\$\s?\d[\d,]*(?:\.\d{2})?|\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b)/gi;
    const out = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(text))) {
      out.append(document.createTextNode(text.slice(last, m.index)), el('mark', { text: m[0] }));
      last = m.index + m[0].length;
    }
    out.append(document.createTextNode(text.slice(last)));
    return out;
  }

  const eventFor = (n, a) => ({ title: a.task.length > 80 ? a.task.slice(0, 77) + '…' : a.task, date: a.due_date, notes: n.analysis.title });
  const allEvents = (n) => [
    ...n.analysis.events,
    ...n.analysis.actions.filter((a) => a.due_date).map((a) => ({ ...eventFor(n, a), title: `${t('due')}: ${eventFor(n, a).title}` })),
  ];

  function calButtons(ev) {
    return el('span', { class: 'toolbar' },
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => download('bridgeline-event.ics', BLICS.build([ev]), 'text/calendar') }, '📅 .ics'),
      el('a', { class: 'btn small ghost', href: BLICS.googleUrl(ev), target: '_blank', rel: 'noopener noreferrer' }, 'Google'));
  }

  // ---------- sharing ----------
  function shareText(n) {
    const a = n.analysis;
    const lines = [a.title, '', a.summary];
    if (a.actions.length) {
      lines.push('', t('whatToDo') + ':');
      a.actions.forEach((x) => lines.push('• ' + x.task + (x.due_date ? ` (${fmtDate(x.due_date)})` : x.due_text ? ` (${x.due_text})` : '')));
    }
    lines.push('', '— Bridgeline');
    return lines.join('\n');
  }
  function shareButtons(text, subject) {
    const enc = encodeURIComponent(text);
    return el('span', { class: 'toolbar' },
      el('a', { class: 'btn small ghost', href: 'https://wa.me/?text=' + enc, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
      el('a', { class: 'btn small ghost', href: 'sms:?&body=' + enc }, 'SMS'),
      el('a', { class: 'btn small ghost', href: `mailto:?subject=${encodeURIComponent(subject || 'Bridgeline')}&body=${enc}` }, 'Email'),
      el('button', { type: 'button', class: 'btn small ghost', onclick: () => copyText(text) }, t('copy')));
  }
  function setEasy(on) {
    state.easy = on; LS.set('bl.easy', on);
    $('#easyBtn').setAttribute('aria-pressed', String(on));
    renderResult();
  }
  function renderEasy(n) {
    const a = n.analysis;
    const dir = dirFor(n.language);
    const speakText = [a.title, a.summary, ...a.actions.map((x) => x.task + (x.due_text ? '. ' + x.due_text : ''))].join('. ');
    const list = el('ul', { class: 'list' }, a.actions.map((act) => {
      const due = act.due_date ? dueLabel(act.due_date) : null;
      const cb = el('input', { type: 'checkbox', 'aria-label': act.task, onchange: (e) => { act.done = e.target.checked; li.classList.toggle('done', act.done); save(); refreshDueBanner(); } });
      cb.checked = act.done;
      const li = el('li', { class: 'item' + (act.done ? ' done' : '') }, cb,
        el('div', { class: 'txt', dir }, el('div', { text: act.task }), due && el('div', { class: 'meta' }, el('span', { class: 'due ' + due.cls, text: `${fmtDate(act.due_date)} · ${due.text}` }))));
      return li;
    }));
    $('#result').replaceChildren(el('div', { class: 'stack easy' },
      el('div', { class: 'card' },
        el('h2', { text: a.title, dir }),
        el('div', { class: 'summary', dir, text: a.summary }),
        el('div', { class: 'toolbar' },
          el('button', { type: 'button', class: 'btn primary big', onclick: () => speak(speakText, 0.9) }, '🔊 ' + t('listen')),
          el('button', { type: 'button', class: 'btn ghost', onclick: stopSpeech }, '⏹ ' + t('stop')))),
      a.actions.length > 0 && section('✅ ' + t('whatToDo'), list),
      el('div', { class: 'toolbar' }, shareButtons(shareText(n), a.title), el('button', { type: 'button', class: 'btn ghost', onclick: () => setEasy(false) }, t('showAll')))));
  }
  function printFlyer() {
    document.body.classList.add('print-teacher');
    window.addEventListener('afterprint', () => document.body.classList.remove('print-teacher'), { once: true });
    window.print();
  }

  function renderResult() {
    const host = $('#result');
    host.replaceChildren();
    const n = current();
    if (!n) return;
    if (state.easy) return renderEasy(n);
    const a = n.analysis;
    const dir = dirFor(n.language);
    const speakText = [a.title, a.summary, ...a.actions.map((x) => x.task + (x.due_text ? '. ' + x.due_text : ''))].join('. ');
    const rate = el('input', { type: 'range', min: '0.6', max: '1.3', step: '0.1', value: '0.9', 'aria-label': 'Speed' });
    let showOrig = false;
    const splitHost = el('div');

    const head = el('div', { class: 'result-head' },
      el('div', {},
        el('h2', { text: a.title, dir }),
        el('div', { class: 'tags' },
          el('span', { class: 'tag ' + a.urgency, text: t('urgency' + a.urgency[0].toUpperCase() + a.urgency.slice(1)) }),
          el('span', { class: 'tag', text: t('cat_' + a.category) }),
          a.sender && el('span', { class: 'tag', text: a.sender }),
          a.detected_language && el('span', { class: 'tag', text: a.detected_language }),
          el('span', { class: 'conf' }, t('confidence'), el('meter', { min: '0', max: '1', low: '0.5', high: '0.75', optimum: '1', value: String(a.confidence), 'aria-label': t('confidence') })))),
      el('div', { class: 'toolbar' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => speak(speakText, Number(rate.value)) }, '🔊 ' + t('listen')),
        el('button', { type: 'button', class: 'btn ghost', onclick: stopSpeech }, '⏹ ' + t('stop')),
        el('label', {}, rate),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => copyText(`${a.title}\n\n${a.summary}\n\n${a.actions.map((x) => '• ' + x.task + (x.due_text ? ' (' + x.due_text + ')' : '')).join('\n')}`) }, t('copy')),
        navigator.share && el('button', { type: 'button', class: 'btn ghost', onclick: () => navigator.share({ title: a.title, text: `${a.title}\n\n${a.summary}` }).catch(() => {}) }, t('share')),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => window.print() }, t('print'))));

    const summaryBlock = el('div', {},
      el('div', { class: 'summary', dir, text: a.summary }),
      a.key_points.length > 0 && el('ul', { dir }, a.key_points.map((k) => el('li', { text: k }))));

    function paintSplit() {
      splitHost.replaceChildren();
      splitHost.className = showOrig ? 'split' : '';
      splitHost.append(summaryBlock);
      if (showOrig) splitHost.append(el('div', {}, el('h3', { text: t('original') }), el('div', { class: 'original' }, highlight(n.sourceText || '(not available)'))));
    }
    const origToggle = el('label', { class: 'check' }, el('input', { type: 'checkbox', onchange: (e) => { showOrig = e.target.checked; paintSplit(); } }), t('showOriginal'));
    paintSplit();

    const cardMain = el('div', { class: 'card' }, head, splitHost, origToggle, el('div', { class: 'toolbar' }, shareButtons(shareText(n), a.title), el('button', { type: 'button', class: 'btn small ghost', onclick: () => setEasy(true) }, t('easy'))), el('p', { class: 'muted small' }, t('savedLocal')));
    const stack = el('div', { class: 'stack' }, cardMain);

    if (a.uncertain.length || n.fallback) {
      stack.append(el('div', { class: 'warnbox', dir }, el('strong', { text: '⚠ ' + t('doubleCheck') }), el('ul', {}, a.uncertain.map((u) => el('li', { text: u })))));
    }

    if (a.actions.length) {
      const list = el('ul', { class: 'list' });
      a.actions.forEach((act, i) => {
        const due = act.due_date ? dueLabel(act.due_date) : null;
        const cb = el('input', { type: 'checkbox', 'aria-label': act.task, onchange: (e) => { act.done = e.target.checked; li.classList.toggle('done', act.done); save(); refreshDueBanner(); } });
        cb.checked = act.done;
        const li = el('li', { class: 'item' + (act.done ? ' done' : '') },
          cb,
          el('div', { class: 'txt', dir },
            el('div', { text: act.task }),
            el('div', { class: 'meta' },
              el('span', { class: 'tag ' + act.priority, text: t('type_' + act.type) }),
              act.due_date && el('span', { class: 'due ' + due.cls, text: `${fmtDate(act.due_date)} · ${due.text}` }),
              !act.due_date && act.due_text && el('span', { class: 'due', text: act.due_text }),
              act.due_date && calButtons({ ...eventFor(n, act), title: `${t('due')}: ${eventFor(n, act).title}` }))));
        list.append(li);
      });
      stack.append(section('✅ ' + t('whatToDo'), list));
    }

    if (a.events.length) {
      stack.append(section('📅 ' + t('dates'), el('ul', { class: 'list' }, a.events.map((ev) => el('li', { class: 'item' },
        el('div', { class: 'txt', dir },
          el('strong', { text: ev.title }),
          el('div', { class: 'meta' },
            el('span', { class: 'due', text: `${fmtDate(ev.date)}${ev.start_time ? ' · ' + fmtTime(ev.start_time) + (ev.end_time ? '–' + fmtTime(ev.end_time) : '') : ''}` }),
            ev.location && el('span', { class: 'muted', text: ev.location }),
            calButtons(ev))))))));
    }
    const evs = allEvents(n);
    if (evs.length) {
      stack.append(el('div', { class: 'toolbar' }, el('button', { type: 'button', class: 'btn primary', onclick: () => download('bridgeline.ics', BLICS.build(evs), 'text/calendar') }, '📅 ' + t('addAll'))));
    }

    if (a.money.length) stack.append(section('💵 ' + t('money'), el('ul', { class: 'list' }, a.money.map((m) => el('li', { class: 'item', dir }, el('strong', { text: m.amount }), el('span', { class: 'txt', text: m.purpose + (m.due_date ? ` (${fmtDate(m.due_date)})` : '') }))))));

    if (a.bring.length) {
      stack.append(section('🎒 ' + t('bring'), el('ul', { class: 'list' }, a.bring.map((b) => {
        const cb = el('input', { type: 'checkbox', 'aria-label': b.item, onchange: (e) => { b.done = e.target.checked; save(); } });
        cb.checked = b.done;
        return el('li', { class: 'item' }, cb, el('span', { class: 'txt', dir, text: b.item }));
      }))));
    }

    if (a.contacts.length) {
      stack.append(section('☎ ' + t('contacts'), el('ul', { class: 'list' }, a.contacts.map((c) => el('li', { class: 'item', dir },
        el('div', { class: 'txt' }, el('strong', { text: c.name || '' }), c.role && el('span', { class: 'muted', text: ' · ' + c.role }),
          el('div', { class: 'meta' },
            safeEmail(c.email) && el('a', { href: 'mailto:' + safeEmail(c.email), text: c.email }),
            safePhone(c.phone).length >= 7 && el('a', { href: 'tel:' + safePhone(c.phone), text: c.phone }))))))));
    }

    if (a.glossary.length) {
      const dl = el('dl', { class: 'glossary', dir }, a.glossary.flatMap((g) => [el('dt', { text: g.term }), el('dd', { text: g.plain })]));
      stack.append(el('details', { class: 'card' }, el('summary', { class: 'label', text: '📖 ' + t('words') }), dl));
    }

    if (a.questions_to_ask.length) {
      stack.append(section('💬 ' + t('askSchool'), el('ul', { dir }, a.questions_to_ask.map((q) => el('li', {}, el('button', { type: 'button', class: 'btn link', onclick: () => { showTab('reply'); $('#replyText').value = q; fillNoticeSelect($('#replyNotice')); $('#replyNotice').value = n.id; } }, q))))));
    }

    stack.append(el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'btn primary', onclick: () => { showTab('reply'); $('#replyNotice').value = n.id; } }, '✉ ' + t('replyToSchool')),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { showTab('ask'); $('#askNotice').value = n.id; renderSuggest(); } }, '❓ ' + t('askAbout'))));
    host.append(stack);
  }
  function section(title, body) { return el('div', { class: 'card' }, el('h2', { text: title }), body); }

  // ---------- My notices ----------
  function nextDue(n) {
    return n.analysis.actions.filter((x) => !x.done && x.due_date).map((x) => x.due_date).concat(n.analysis.events.map((e) => e.date)).filter((d) => daysUntil(d) >= 0).sort()[0] || '';
  }
  function upcomingItems(days) {
    const items = [];
    for (const n of state.notices) {
      n.analysis.actions.forEach((a) => { if (a.due_date && !a.done && daysUntil(a.due_date) <= days) items.push({ n, a, date: a.due_date, label: a.task, kind: 'action' }); });
      n.analysis.events.forEach((e) => { const d = daysUntil(e.date); if (d >= 0 && d <= days) items.push({ n, date: e.date, label: e.title, kind: 'event' }); });
    }
    return items.sort((x, y) => x.date.localeCompare(y.date));
  }
  function renderNotices() {
    const agenda = $('#agenda');
    const items = upcomingItems(14);
    const body = items.length
      ? el('ul', { class: 'list' }, items.map((it) => {
          const due = dueLabel(it.date);
          const li = el('li', { class: 'item' },
            it.kind === 'action' ? el('input', { type: 'checkbox', 'aria-label': it.label, onchange: (e) => { it.a.done = e.target.checked; save(); renderNotices(); refreshDueBanner(); } }) : el('span', { 'aria-hidden': 'true', text: '📅' }),
            el('div', { class: 'txt' }, el('div', { text: it.label }), el('div', { class: 'meta' }, el('span', { class: 'due ' + due.cls, text: `${fmtDate(it.date)} · ${due.text}` }), el('span', { class: 'muted', text: it.n.analysis.title }))));
          return li;
        }))
      : el('p', { class: 'muted', text: t('nothingSoon') });
    const digest = ['Bridgeline: ' + t('agenda'), '', ...items.map((it) => `• ${fmtDate(it.date)} — ${it.label} (${it.n.analysis.title})`)].join('\n');
    agenda.replaceChildren(section('🗓 ' + t('agenda'), el('div', {}, body, items.length > 0 && el('div', { class: 'toolbar' }, shareButtons(digest, 'Bridgeline: ' + t('agenda'))))));

    const list = $('#noticeList');
    if (!state.notices.length) return list.replaceChildren(el('div', { class: 'card muted', text: t('noNotices') }));
    const sorted = [...state.notices].sort((x, y) => (nextDue(x) || '9999').localeCompare(nextDue(y) || '9999'));
    list.replaceChildren(...sorted.map((n) => {
      const total = n.analysis.actions.length;
      const done = n.analysis.actions.filter((x) => x.done).length;
      const nd = nextDue(n);
      return el('div', { class: 'card' },
        el('div', { class: 'result-head' },
          el('div', {}, el('h2', { text: n.analysis.title, dir: dirFor(n.language) }), el('div', { class: 'tags' },
            el('span', { class: 'tag ' + n.analysis.urgency, text: t('urgency' + n.analysis.urgency[0].toUpperCase() + n.analysis.urgency.slice(1)) }),
            nd && el('span', { class: 'tag', text: `${t('due')} ${fmtDate(nd)}` }),
            total > 0 && el('progress', { max: String(total), value: String(done), 'aria-label': `${done}/${total}` }))),
          el('div', { class: 'toolbar' },
            el('button', { type: 'button', class: 'btn primary small', onclick: () => { state.currentId = n.id; state.chat = []; showTab('analyze'); renderResult(); $('#result').scrollIntoView({ behavior: 'smooth' }); } }, t('open')),
            el('button', { type: 'button', class: 'btn danger small', onclick: () => { if (confirm(t('delete') + '?')) { state.notices = state.notices.filter((x) => x.id !== n.id); if (state.currentId === n.id) { state.currentId = null; $('#result').replaceChildren(); } save(); renderNotices(); refreshDueBanner(); } } }, t('delete')))),
        el('p', { class: 'muted', dir: dirFor(n.language), text: n.analysis.summary.slice(0, 180) + (n.analysis.summary.length > 180 ? '…' : '') }));
    }));
  }

  function refreshDueBanner() {
    const soon = upcomingItems(3).filter((i) => i.kind === 'action' || daysUntil(i.date) <= 1);
    const b = $('#dueBanner');
    b.hidden = soon.length === 0;
    if (soon.length) b.textContent = '⏰ ' + t('soonBanner').replace('{list}', soon.slice(0, 3).map((i) => `${i.label.length > 50 ? i.label.slice(0, 47).replace(/\s+\S*$/, '') + '…' : i.label} (${dueLabel(i.date).text})`).join(' · '));
    return soon;
  }
  async function enableReminders() {
    if (!('Notification' in window)) return toast('Notifications are not supported here. Use the calendar button instead.', 'error');
    const perm = await Notification.requestPermission();
    LS.set('bl.notify', perm === 'granted');
    toast(perm === 'granted' ? 'On. You will get a reminder when you open Bridgeline and something is due soon.' : 'Notifications were blocked.', perm === 'granted' ? undefined : 'error');
    maybeNotify();
  }
  function maybeNotify() {
    if (!LS.get('bl.notify', false) || !('Notification' in window) || Notification.permission !== 'granted') return;
    const today = localISO();
    if (LS.get('bl.notified', '') === today) return;
    const soon = upcomingItems(3);
    if (!soon.length) return;
    LS.set('bl.notified', today);
    new Notification('Bridgeline', { body: soon.slice(0, 3).map((i) => `${i.label.slice(0, 60)} (${dueLabel(i.date).text})`).join('\n'), icon: 'icon.svg' });
  }

  // ---------- Reply ----------
  async function runReply() {
    const parentText = $('#replyText').value.trim();
    const intent = $('#replyIntent').value;
    if (!parentText && intent === 'custom') return toast(t('needInput'), 'error');
    const n = state.notices.find((x) => x.id === $('#replyNotice').value);
    $('#replyBtn').disabled = true; $('#replyStatus').textContent = t('working');
    try {
      const mtOn = state.mode !== 'ai' && state.lang !== 'en';
      const sendText = mtOn && parentText ? (await mtSafe([parentText], state.lang, 'en'))[0] : parentText;
      const res = await api('/api/reply', { parentText: sendText, intent, language: state.lang, notice: n ? { title: n.analysis.title_en || n.analysis.title, summary_en: n.analysis.summary_en || n.analysis.summary, sender: n.analysis.sender } : null });
      noteFallback(res);
      if (mtOn && res.mode === 'demo') {
        res.reply.back_translation = (await mtSafe([res.reply.message_en], 'en', state.lang))[0];
        res.reply.notes = `Machine translation${mtLabel(state.mtEngine) ? ' ' + mtLabel(state.mtEngine) : ''}. Read the English before you send it.`;
      }
      const r = res.reply;
      const msg = el('textarea', { rows: '8', 'aria-label': t('englishMessage') });
      msg.value = r.message_en;
      const to = n && n.analysis.contacts.map((c) => safeEmail(c.email)).find(Boolean);
      $('#replyOut').replaceChildren(el('div', { class: 'card stack' },
        el('h2', { text: t('englishMessage') }),
        el('p', { class: 'muted small', text: r.subject }),
        msg,
        el('div', { class: 'toolbar' },
          el('button', { type: 'button', class: 'btn primary', onclick: () => copyText(msg.value) }, t('copy')),
          el('a', { class: 'btn ghost', href: `mailto:${to || ''}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(msg.value)}` }, '✉ ' + t('sendMail'))),
        r.back_translation && el('div', { class: 'warnbox', dir: dirFor(state.lang) }, el('strong', { text: t('backCheck') }), el('p', { text: r.back_translation })),
        r.notes && el('p', { class: 'muted', dir: dirFor(state.lang), text: r.notes })));
    } catch (e) { toast(e.message, 'error'); } finally { $('#replyBtn').disabled = false; $('#replyStatus').textContent = ''; }
  }

  // ---------- Ask ----------
  function renderSuggest() {
    const n = state.notices.find((x) => x.id === $('#askNotice').value);
    $('#askSuggest').replaceChildren(...(n ? n.analysis.questions_to_ask.slice(0, 4).map((q) => el('button', { type: 'button', class: 'chip', onclick: () => { $('#askInput').value = q; } }, q)) : []));
  }
  function paintChat() {
    $('#chatLog').replaceChildren(...state.chat.map((m) => el('div', { class: 'bubble ' + (m.role === 'user' ? 'user' : 'bot'), dir: dirFor(state.lang) }, m.content, m.quote && el('blockquote', { dir: 'auto', text: m.quote }))));
  }
  async function runAsk() {
    const q = $('#askInput').value.trim();
    const n = state.notices.find((x) => x.id === $('#askNotice').value);
    if (!n) return toast(t('noneNotice'), 'error');
    if (!q) return toast(t('needInput'), 'error');
    state.chat.push({ role: 'user', content: q });
    paintChat(); $('#askInput').value = '';
    $('#askBtn').disabled = true;
    try {
      const history = state.chat.slice(0, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      const mtOn = state.mode !== 'ai' && state.lang !== 'en';
      const qSend = mtOn ? (await mtSafe([q], state.lang, 'en'))[0] : q;
      const res = await api('/api/ask', { question: qSend, noticeText: n.sourceText || n.analysis.summary_en || n.analysis.summary, language: state.lang, level: state.level, history });
      noteFallback(res);
      const answer = mtOn && res.mode === 'demo' && res.found ? (await mtSafe([res.answer], 'en', state.lang))[0] : res.answer;
      state.chat.push({ role: 'bot', content: answer, quote: res.quote });
    } catch (e) { state.chat.push({ role: 'bot', content: e.message }); } finally { $('#askBtn').disabled = false; paintChat(); }
  }

  // ---------- Teacher ----------
  function paintClarity() {
    const host = $('#clarityOut');
    const txt = $('#teacherText').value;
    if (!txt.trim()) return host.replaceChildren();
    const c = BLEngine.clarity.score(txt, { today: localISO() });
    host.replaceChildren(el('div', { class: 'card clarity' },
      el('div', { class: 'meter-row' }, el('strong', { text: `Clarity score ${c.score}/100` }), el('progress', { max: '100', value: String(c.score), 'aria-label': 'Clarity score' })),
      el('ul', { class: 'checks' }, c.checks.map((ch) => el('li', { class: ch.ok ? 'ok' : 'bad' }, (ch.ok ? '✓ ' : '✗ ') + ch.label, !ch.ok && el('div', { class: 'muted small', text: ch.tip }))))));
  }
  function paintTeacherMeter() {
    paintClarity();
    const r = BLEngine.readability.analyze($('#teacherText').value);
    $('#teacherMeter').replaceChildren(el('span', {}, `${t('readability')}: `), el('strong', { text: r.words ? `grade ${r.grade} · ${r.label}` : '—' }), el('span', { text: r.words ? `${r.words} words` : '' }));
  }
  function renderTeacherLangs() {
    const picked = new Set(LS.get('bl.tlangs', ['es', 'zh', 'vi', 'ar']));
    const host = $('#teacherLangs');
    host.replaceChildren(...state.languages.filter((l) => l.code !== 'en').map((l) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(picked.has(l.code)), title: l.name,
      onclick: (e) => { picked.has(l.code) ? picked.delete(l.code) : picked.add(l.code); e.currentTarget.setAttribute('aria-pressed', String(picked.has(l.code))); LS.set('bl.tlangs', [...picked]); },
    }, l.native)));
  }
  async function runTeacher() {
    const message = $('#teacherText').value.trim();
    if (!message) return toast(t('needInput'), 'error');
    const languages = LS.get('bl.tlangs', ['es', 'zh', 'vi', 'ar']).slice(0, 8);
    $('#teacherBtn').disabled = true; $('#teacherStatus').textContent = t('working');
    try {
      const res = await api('/api/compose', { message, languages, level: state.level });
      noteFallback(res);
      if (res.mode === 'demo') {
        res.translations = [];
        for (const code of languages) {
          try { res.translations.push({ code, language: langInfo(code).name, text: (await mt([res.plain_english], 'en', code))[0] }); }
          catch (e) { res.translations.push({ code, language: langInfo(code).name, text: `(Could not translate: ${e.message})` }); }
        }
      }
      const after = BLEngine.readability.analyze(res.plain_english);
      const blocks = [];
      const mk = (title, text, dir) => { const ta = el('textarea', { rows: '6', dir: dir || 'ltr', 'aria-label': title }); ta.value = text; return el('div', { class: 'card tr-card' }, el('h2', { text: title }), ta, el('div', { class: 'toolbar' }, el('button', { type: 'button', class: 'btn small ghost', onclick: () => copyText(ta.value) }, t('copy')))); };
      blocks.push(mk('English (plain)', res.plain_english));
      if (res.sms_en) blocks.push(mk(`Text message (English) · ${res.sms_en.length} characters`, res.sms_en));
      res.translations.forEach((tr) => blocks.push(mk(tr.language, tr.text, dirFor(tr.code))));
      const all = [`Subject: ${res.subject}`, '', 'ENGLISH', res.plain_english, ...res.translations.flatMap((x) => ['', x.language.toUpperCase(), x.text])].join('\n');
      $('#teacherOut').replaceChildren(el('div', { class: 'stack' },
        el('div', { class: 'card' }, el('div', { class: 'meter-row' }, el('span', {}, `${t('afterSimplify')}: `), el('strong', { text: `grade ${after.grade} · ${after.label}` }), el('span', { text: res.subject })),
          res.tips.length > 0 && el('ul', {}, res.tips.map((x) => el('li', { text: x }))),
          el('div', { class: 'toolbar' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => download('family-message.txt', all, 'text/plain') }, '⬇ .txt'), el('button', { type: 'button', class: 'btn ghost', onclick: printFlyer }, '🖨 Print flyer'))),
        ...blocks));
    } catch (e) { toast(e.message, 'error'); } finally { $('#teacherBtn').disabled = false; $('#teacherStatus').textContent = ''; }
  }

  // ---------- backup ----------
  function restore(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result));
        if (!Array.isArray(data.notices)) throw new Error('bad');
        const ids = new Set(state.notices.map((n) => n.id));
        data.notices.filter((n) => n && n.id && n.analysis && !ids.has(n.id)).forEach((n) => state.notices.push(n));
        save(); renderNotices(); refreshDueBanner(); toast('Restored');
      } catch { toast('That file is not a Bridgeline backup.', 'error'); }
    };
    fr.readAsText(file);
  }

  // ---------- init ----------
  async function init() {
    applyPrefs();
    let health = null;
    try {
      const r = await fetch('api/health');
      if (r.ok && /json/.test(r.headers.get('content-type') || '')) health = await r.json();
    } catch { /* no server: run fully in the browser */ }
    state.backend = Boolean(health);
    state.mode = health ? health.mode : LS.get('bl.key', '') ? 'ai' : 'demo';
    state.languages = window.BLEngine ? window.BLEngine.LANGUAGES : [{ code: 'en', name: 'English', native: 'English', speech: 'en-US' }];

    $('#lang').replaceChildren(...state.languages.map((l) => el('option', { value: l.code, text: l.native === l.name ? l.name : `${l.native} (${l.name})` })));
    if (!state.languages.some((l) => l.code === state.lang)) state.lang = 'en';
    $('#lang').value = state.lang;
    $('#level').value = String(state.level);
    $('#sampleChips').replaceChildren(...window.BL_SAMPLES.map((s) => el('button', { type: 'button', class: 'chip', onclick: () => { $('#noticeText').value = s.text; setFile(null); } }, s.label)));
    $('#lang').addEventListener('change', async (e) => { state.lang = e.target.value; LS.set('bl.lang', state.lang); stopSpeech(); applyI18n(); renderResult(); if (current() && current().base && current().language !== state.lang) { await retranslateCurrent(); renderResult(); renderNotices(); } });
    $('#level').addEventListener('change', (e) => { state.level = Number(e.target.value); LS.set('bl.level', state.level); $('#levelLabel').textContent = t('lvl' + state.level); });

    $$('[role=tab]').forEach((b) => {
      b.addEventListener('click', () => showTab(b.dataset.tab));
      b.addEventListener('keydown', (e) => {
        const tabs = $$('[role=tab]'); const i = tabs.indexOf(b);
        const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1;
        if (j >= 0) { tabs[j].focus(); showTab(tabs[j].dataset.tab); }
      });
    });

    $('#fontPlus').addEventListener('click', () => { LS.set('bl.fs', Math.min(24, LS.get('bl.fs', 16) + 2)); applyPrefs(); });
    $('#fontMinus').addEventListener('click', () => { LS.set('bl.fs', Math.max(13, LS.get('bl.fs', 16) - 2)); applyPrefs(); });
    $('#easyBtn').addEventListener('click', () => setEasy(!state.easy));
    $('#fontBtn').addEventListener('click', () => { LS.set('bl.legible', !LS.get('bl.legible', false)); applyPrefs(); });
    $('#themeBtn').addEventListener('click', () => { LS.set('bl.dark', document.documentElement.dataset.theme !== 'dark'); applyPrefs(); });
    $('#contrastBtn').addEventListener('click', () => { LS.set('bl.hc', !LS.get('bl.hc', false)); applyPrefs(); });

    $('#analyzeBtn').addEventListener('click', runAnalyze);
    $('#clearBtn').addEventListener('click', () => { $('#noticeText').value = ''; setFile(null); $('#result').replaceChildren(); });
    for (const id of ['cameraInput', 'fileInput']) $('#' + id).addEventListener('change', (e) => { if (e.target.files[0]) setFile(e.target.files[0]); e.target.value = ''; });
    const zone = $('#dropZone');
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
    document.addEventListener('paste', (e) => { const f = [...(e.clipboardData ? e.clipboardData.files : [])][0]; if (f && /^(image\/|application\/pdf)/.test(f.type)) setFile(f); });

    $('#replyBtn').addEventListener('click', runReply);
    $('#replyMic').addEventListener('click', (e) => dictate($('#replyText'), e.currentTarget));
    $('#askBtn').addEventListener('click', runAsk);
    $('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); });
    $('#askMic').addEventListener('click', (e) => dictate($('#askInput'), e.currentTarget));
    $('#askNotice').addEventListener('change', () => { state.chat = []; paintChat(); renderSuggest(); });
    $('#teacherBtn').addEventListener('click', runTeacher);
    $('#teacherTpl').replaceChildren(el('option', { value: '', text: 'Start from a template…' }), ...window.BL_TEMPLATES.map((x) => el('option', { value: x.id, text: x.label })));
    $('#teacherTpl').addEventListener('change', (e) => { const tpl = window.BL_TEMPLATES.find((x) => x.id === e.target.value); if (tpl) { $('#teacherText').value = tpl.text; paintTeacherMeter(); } });
    $('#teacherText').addEventListener('input', paintTeacherMeter);

    $('#allIcs').addEventListener('click', () => {
      const evs = state.notices.flatMap((n) => allEvents(n).filter((e) => daysUntil(e.date) >= 0));
      evs.length ? download('bridgeline-all.ics', BLICS.build(evs), 'text/calendar') : toast(t('nothingSoon'), 'error');
    });
    $('#remindBtn').addEventListener('click', enableReminders);
    $('#backupBtn').addEventListener('click', () => download('bridgeline-backup.json', JSON.stringify({ version: 1, notices: state.notices }, null, 2), 'application/json'));
    $('#restoreInput').addEventListener('change', (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
    $('#wipeBtn').addEventListener('click', () => { if (confirm(t('clearAll') + '?')) { state.notices = []; state.currentId = null; LS.del('bl.notices'); $('#result').replaceChildren(); renderNotices(); refreshDueBanner(); } });
    $('#dueBanner').addEventListener('click', () => showTab('notices'));

    $('#aiBtn').addEventListener('click', toggleAiPanel);
    $('#aiSave').addEventListener('click', () => {
      LS.set('bl.mt', { online: $('#mtOnline').checked, email: $('#mtEmail').value.trim() });
      if (!state.backend) {
        const key = $('#aiKey').value.trim();
        if (key) { LS.set('bl.key', key); state.mode = 'ai'; }
        LS.set('bl.model', $('#aiModel').value.trim());
      }
      renderMode(); $('#aiPanel').hidden = true; toast(state.mode === 'ai' ? 'Saved. AI is on.' : 'Saved.');
    });
    $('#aiRemove').addEventListener('click', () => {
      LS.del('bl.key'); state.mode = 'demo'; renderMode(); $('#aiKey').value = ''; $('#aiStatus').textContent = 'Key removed from this device.';
    });

    renderTeacherLangs();
    paintTeacherMeter();
    applyI18n();
    refreshDueBanner();
    maybeNotify();
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init().catch((err) => {
    console.error(err);
    const b = $('#dueBanner');
    b.hidden = false;
    b.textContent = '⚠ Bridgeline could not start: ' + err.message + '. Try reloading the page.';
  });
})();
