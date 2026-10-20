/* ============================================================
   《地藏菩萨本愿经》逐段精读 —— 应用逻辑
   纯静态、无依赖；进度与笔记保存在浏览器 localStorage。
   ============================================================ */
(function () {
  'use strict';

  var BOOK = window.BOOK || null;

  /* ----------------------------- 站点文案 ----------------------------- */
  var CONFIG = window.SITE_CONFIG;

  /* ----------------------------- 存储 ----------------------------- */
  var LS = {
    settings: 'dizang.settings.v1',
    progress: 'dizang.progress.v1',
    notes: 'dizang.notes.v1',
    last: 'dizang.last.v1',
    swipeHint: 'dizang.swipeHint.v1'
  };

  var DEFAULT_SETTINGS = {
    theme: 'paper',
    fontSize: 'm',
    writing: 'horizontal',
    defaultMode: 'focus',
    defaultReveal: 'hidden',
    speechRate: '0.9',
    script: 'simplified'
  };

  var FONT_SIZE = { s: '17px', m: '19px', l: '21.5px', xl: '24px' };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { toast('本机存储不可用，请导出备份保存笔记'); return false; }
  }

  /* --------- 本地数据规范化 ---------
     进度：{ [id]: { done, pos, revealed:{}, at } }
     笔记：{ [id]: { text, at } }
     旧版本的笔记是纯字符串、也没有 at，这里统一升级。
     at = 0 表示「登录前就存在的旧数据」：同步时只会补上云端还没有的小节，
     不会覆盖云端更新的记录。 */
  function normalizeProgress(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      var e = raw[id];
      if (!e || typeof e !== 'object') return;
      out[id] = {
        done: !!e.done,
        pos: Number.isInteger(e.pos) && e.pos >= 0 ? e.pos : 0,
        revealed: e.revealed && typeof e.revealed === 'object' ? e.revealed : {},
        at: Number.isFinite(e.at) ? e.at : 0
      };
    });
    return out;
  }

  function normalizeNotes(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      var e = raw[id];
      if (typeof e === 'string') { out[id] = { text: e, at: 0 }; return; }
      if (!e || typeof e !== 'object') return;
      out[id] = { text: typeof e.text === 'string' ? e.text : '', at: Number.isFinite(e.at) ? e.at : 0 };
    });
    return out;
  }

  var settings = Object.assign({}, DEFAULT_SETTINGS, load(LS.settings, {}));
  var progress = normalizeProgress(load(LS.progress, {}));
  var mynotes = normalizeNotes(load(LS.notes, {}));


  var state = {
    mode: settings.defaultMode === 'flow' ? 'flow' : 'focus',
    reader: null,      // {ci, si, pos, revealed:{}}
    searchQuery: '',
    glossaryCh: 'all',
    unused: null
  };

  /* ----------------------------- 工具 ----------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var FLAT_CACHE = null;
  function flatSections() {
    if (FLAT_CACHE) return FLAT_CACHE;
    if (!BOOK) return [];
    var arr = [];
    BOOK.chapters.forEach(function (ch, ci) {
      ch.sections.forEach(function (sec, si) {
        arr.push({ ci: ci, si: si, ch: ch, sec: sec });
      });
    });
    FLAT_CACHE = arr;
    return arr;
  }

  /** 全书顺序上相邻的一节（delta = -1 上一品，1 下一品） */
  function neighborSection(ci, si, delta) {
    var flat = flatSections();
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].ci === ci && flat[i].si === si) return flat[i + delta] || null;
    }
    return null;
  }

  /** 这一品是否有过实际的阅读动作（只是打开过、什么都没做不算） */
  function hasReadMark(p) {
    if (!p) return false;
    if (p.done) return true;
    if (Number.isFinite(p.pos) && p.pos > 0) return true;
    if (p.revealed && Object.keys(p.revealed).length) return true;
    return Number.isFinite(p.at) && p.at > 0;
  }

  /** 读到过的、全书顺序最靠后的一节 */
  function furthestRead() {
    var flat = flatSections();
    for (var i = flat.length - 1; i >= 0; i--) {
      if (hasReadMark(progress[flat[i].sec.id])) return flat[i];
    }
    return null;
  }

  /** 全书第一处还没标记掌握的小节 */
  function firstUnreadSection() {
    var flat = flatSections();
    for (var i = 0; i < flat.length; i++) {
      if (!(progress[flat[i].sec.id] && progress[flat[i].sec.id].done)) return flat[i];
    }
    return flat[0] || null;
  }

  /** 首页的「继续阅读」按钮：主标题 + 目的地（篇 · 节） */
  function resumeButton(entry, primary, label) {
    var ch = BOOK.chapters[entry.ci];
    var sec = ch.sections[entry.si];
    return '<a class="btn' + (primary ? ' primary' : '') + ' resume" href="#/read/' + entry.ci + '/' + entry.si + '"' +
      ' title="' + escapeAttr(ch.title + ' · ' + sec.title) + '">' +
      '<span class="rb-label">' + escapeHtml(label) + '</span>' +
      '<span class="rb-sub">' + escapeHtml(ch.title) + ' · 第 ' + sec.number + ' 品</span></a>';
  }

  function secProgress(id) {
    if (!progress[id]) progress[id] = { done: false, pos: 0, revealed: {}, at: 0 };
    if (!progress[id].revealed || typeof progress[id].revealed !== 'object') progress[id].revealed = {};
    if (!Number.isFinite(progress[id].at)) progress[id].at = 0;
    return progress[id];
  }

  /* --------- 保存并通知云同步 --------- */
  function persistProgress() { return save(LS.progress, progress); }
  function persistNotes() { return save(LS.notes, mynotes); }
  /** 打上修改时间，供多设备之间逐节比较新旧 */
  function touch(entry) { entry.at = Date.now(); return entry; }

  /* --------- 逐段精读的推进逻辑（按钮、键盘、滑动共用） --------- */
  function focusState() {
    if (!state.reader) return null;
    var sec = BOOK.chapters[state.reader.ci] && BOOK.chapters[state.reader.ci].sections[state.reader.si];
    if (!sec) return null;
    var pr = secProgress(sec.id);
    return { sec: sec, pr: pr, pos: pr.pos || 0 };
  }
  function focusReveal() {
    var f = focusState(); if (!f) return;
    f.pr.revealed[f.pos] = true;
    touch(f.pr); persistProgress();
    // Reveal in place; rebuilding the route would reset the scroll position.
    var explanation = $('#focusTrans');
    if (explanation) {
      explanation.hidden = false;
      explanation.classList.add('reveal');
    }
    var revealButton = $('#revealBtn');
    if (revealButton) {
      revealButton.id = 'nextPair';
      revealButton.textContent = f.pos < f.sec.pairs.length - 1 ? '下一段 →' : '读完了';
    }
  }
  function focusNext() {
    var f = focusState(); if (!f) return;
    f.pr.pos = Math.min(f.sec.pairs.length, f.pos + 1);
    touch(f.pr); persistProgress(); route();
  }
  /** 跳到另一节；pos 省略时沿用那一节自己保存的位置 */
  function goToSection(entry, pos) {
    var sec = entry && BOOK.chapters[entry.ci] && BOOK.chapters[entry.ci].sections[entry.si];
    if (!sec) return false;
    if (typeof pos === 'number') {
      var pr = secProgress(sec.id);
      pr.pos = Math.max(0, Math.min(pos, sec.pairs.length));
      touch(pr); persistProgress();
    }
    navigate('#/read/' + entry.ci + '/' + entry.si);
    return true;
  }
  /* 第一节按「上一段」＝ 回到上一品的最后一句 */
  function focusPrev() {
    var f = focusState(); if (!f) return;
    if (f.pos <= 0) {
      var prev = neighborSection(state.reader.ci, state.reader.si, -1);
      if (!prev) return;
      goToSection(prev, Math.max(0, prev.sec.pairs.length - 1));
      return;
    }
    f.pr.pos = Math.max(0, f.pos - 1);
    touch(f.pr); persistProgress(); route();
  }
  /* 先展开白话，已展开则进下一段；读完后进入下一品 */
  function focusAdvance() {
    var f = focusState(); if (!f) return;
    if (f.pos >= f.sec.pairs.length) {
      var next = neighborSection(state.reader.ci, state.reader.si, 1);
      if (!next) { toast('这已经是最后一品了'); return; }
      goToSection(next);
      return;
    }
    if (!f.pr.revealed[f.pos] && settings.defaultReveal !== 'shown') focusReveal();
    else focusNext();
  }

  function chapterStats(ch) {
    var done = 0, total = ch.sections.length;
    ch.sections.forEach(function (s) { if (progress[s.id] && progress[s.id].done) done++; });
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  function overallStats() {
    var done = 0, total = 0;
    if (BOOK) BOOK.chapters.forEach(function (ch) {
      total += ch.sections.length;
      ch.sections.forEach(function (s) { if (progress[s.id] && progress[s.id].done) done++; });
    });
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  /* --------- 把注释里的词语在原文里标出来，可点击 --------- */
  // 注释词条里可能带拼音（如「夙（sù）心」）或用顿号并列（如「石、斗」），
  // 匹配时先去掉拼音，再逐个尝试候选词。
  function stripPinyin(t) { return String(t).replace(/[（(][^）)]*[）)]/g, ''); }
  function matchKey(text, term) {
    var base = stripPinyin(term).trim();
    var cands = [base];
    if (/[、，,;；/]/.test(base)) cands = cands.concat(base.split(/[、，,;；/]/));
    cands = cands.map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length >= 1; })
      .sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < cands.length; i++) {
      if (text.indexOf(cands[i]) !== -1) return cands[i];
    }
    return null;
  }

  function decorate(text, notes) {
    var out = escapeHtml(text);
    if (!notes || !notes.length) return out;
    var items = notes
      .map(function (n) { return { t: n.term, e: n.explain, m: matchKey(out, n.term) }; })
      .filter(function (n) { return n.m; })
      .sort(function (a, b) { return b.m.length - a.m.length; });

    var matches = [];
    items.forEach(function (it) {
      var from = 0, idx;
      while ((idx = out.indexOf(it.m, from)) !== -1) {
        matches.push({ start: idx, end: idx + it.m.length, note: it });
        from = idx + it.m.length;
        if (it.m.length <= 1) break; // 单字词只标第一处，避免满屏标红
      }
    });
    matches.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var chosen = [], last = -1;
    matches.forEach(function (m) { if (m.start >= last) { chosen.push(m); last = m.end; } });

    var res = '', pos = 0;
    chosen.forEach(function (m) {
      res += out.slice(pos, m.start);
      res += '<span class="term" data-term="' + escapeAttr(m.note.t) + '" data-explain="' + escapeAttr(m.note.e) + '">' +
        out.slice(m.start, m.end) + '</span>';
      pos = m.end;
    });
    res += out.slice(pos);
    return res;
  }

  /* ----------------------------- 主题 / 设置 ----------------------------- */
  function applySettings() {
    var root = document.documentElement;
    root.dataset.theme = settings.theme || 'paper';
    document.body.style.setProperty('--reading-size', FONT_SIZE[settings.fontSize] || FONT_SIZE.m);
    document.body.classList.toggle('writing-vertical', settings.writing === 'vertical');
    $$('.seg').forEach(function (seg) {
      var key = seg.dataset.setting;
      $$('button', seg).forEach(function (b) {
        b.classList.toggle('on', String(settings[key]) === String(b.dataset.val));
      });
    });
  }
  function setSetting(key, val) {
    settings[key] = val;
    save(LS.settings, settings);
    applySettings();
  }

  /* ----------------------------- 朗读 ----------------------------- */
  var voiceCache = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (voiceCache) return voiceCache;
    var vs = window.speechSynthesis.getVoices() || [];
    voiceCache = vs.filter(function (v) { return /zh|Chinese/i.test(v.lang + ' ' + v.name); })[0] || null;
    return voiceCache;
  }
  function speak(text, rate) {
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持朗读功能'); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = parseFloat(rate || settings.speechRate) || 0.9;
    var v = pickVoice(); if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = function () { voiceCache = null; pickVoice(); };
  }

  /* ----------------------------- 浮层 / 提示 ----------------------------- */
  function showPopover(el) {
    var pop = $('#popover');
    pop.innerHTML = '<b>' + escapeHtml(el.dataset.term) + '</b>' + escapeHtml(el.dataset.explain);
    pop.hidden = false;
    var r = el.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    var top = r.top - ph - 10;
    pop.classList.toggle('below', top < 8);
    if (top < 8) top = r.bottom + 10;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hidePopover() { $('#popover').hidden = true; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }

  /* ----------------------------- 路由 ----------------------------- */
  function navigate(hash) { location.hash = hash; }

  function route() {
    hidePopover();
    var h = (location.hash || '#/').replace(/^#/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    var view = $('#view');
    view.classList.toggle('wide', parts[0] === 'glossary' || parts.length === 0);
    if (parts[0] !== 'read') state.reader = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    if (!BOOK) {
      view.innerHTML = '<div class="empty"><h2>内容数据还没生成</h2>' +
        '<p>请先在项目目录运行 <code>python3 build.py</code> 生成 <code>book.js</code>。</p></div>';
      return;
    }

    if (parts.length === 0) renderHome(view);
    else if (parts[0] === 'ch') renderChapter(view, parseInt(parts[1], 10));
    else if (parts[0] === 'read') renderReader(view, parseInt(parts[1], 10), parseInt(parts[2], 10));
    else if (parts[0] === 'glossary') renderGlossary(view);
    else if (parts[0] === 'mynotes') renderMyNotes(view);
    else if (parts[0] === 'guide') renderGuide(view);
    else renderHome(view);

    // 高亮导航
    var key = parts[0] === 'read' || parts[0] === 'ch' ? 'home' : (parts[0] || 'home');
    $$('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === key);
    });
    // 手机端：阅读时把底部标签栏换成逐句操作条
    var focusMode = parts[0] === 'read' && state.mode === 'focus';
    document.body.classList.toggle('in-reader', parts[0] === 'read');
    document.body.classList.toggle('focus-mode', focusMode);
    if (focusMode) hintSwipeOnce();

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* 触屏上没有「空格 → 下一段」这类提示，第一次进逐段精读时口头交代一次滑动手势 */
  function isTouchReading() {
    if (window.innerWidth > 720) return false;
    if ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window) return true;
    return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  }
  function hintSwipeOnce() {
    if (!isTouchReading() || load(LS.swipeHint, false)) return;
    save(LS.swipeHint, true);
    setTimeout(function () { toast('左滑看下一段，右滑回上一段'); }, 700);
  }

  /* ----------------------------- 首页 ----------------------------- */
  function lotus() {
    return '<svg class="lotus" viewBox="0 0 240 200" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M120 157C72 132 79 78 120 28C161 78 168 132 120 157Z"/><path d="M120 157C65 154 38 109 46 59C96 69 123 107 120 157Z"/><path d="M120 157C175 154 202 109 194 59C144 69 117 107 120 157Z"/><path d="M120 157C74 172 28 151 13 109C67 101 102 117 120 157Z"/><path d="M120 157C166 172 212 151 227 109C173 101 138 117 120 157Z"/><path d="M120 157V87M52 177Q120 198 188 177M70 185Q120 201 170 185"/></g></svg>';
  }

  function renderHome(view) {
    var ov=overallStats(),last=load(LS.last,null);
    var entry=last&&BOOK.chapters[last.ci]&&BOOK.chapters[last.ci].sections[last.si]?last:firstUnreadSection();
    var html='<section class="hero sutra-hero"><div class="hero-copy"><div class="eyebrow">'+escapeHtml(CONFIG.notebookName)+' <span> / </span> 十三品 · 三卷</div><h1>地藏菩萨<br><span class="title-rest">本愿经</span></h1><div class="edition-label">原典 · 完整白话 · 阅读提示</div><div class="tagline">'+escapeHtml(CONFIG.tagline)+'</div><p class="lead">'+escapeHtml(CONFIG.description)+'</p><div class="hero-actions">'+resumeButton(entry,true,last?'继续上次阅读':'从第一品读起')+'<a class="quiet-link" href="#/guide">读经之前 ↗</a></div></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><span class="art-top">愿 · 行</span>'+lotus()+'<span class="art-bottom">慈悲 · 智慧 · 回向</span><span class="art-stamp">本愿</span></div></section>';
    html+='<div class="reading-summary"><div><span class="summary-label">我的阅读</span><strong>'+ov.done+'<small> / 13 品已读完</small></strong></div><div class="summary-progress"><div class="bar"><i style="width:'+ov.pct+'%"></i></div><span>'+ov.pct+'% · 一段经文，一点体会</span></div><a href="#/mynotes">查看札记 →</a></div>';
    html+='<section class="catalog"><header class="catalog-head"><div><span class="eyebrow">KṢITIGARBHA · ORIGINAL VOWS</span><h2>十三品目录</h2></div><label class="catalog-search"><span aria-hidden="true">⌕</span><input id="chapterFilter" type="search" aria-label="查找品名或主题" placeholder="查找品名、布施、回向…"></label></header>';
    html+='<div class="catalog-filters" role="group" aria-label="经卷范围"><button class="chip on" data-catalog="all" aria-pressed="true">全经 · 13</button><button class="chip" data-catalog="0" aria-pressed="false">卷上 · 4</button><button class="chip" data-catalog="1" aria-pressed="false">卷中 · 5</button><button class="chip" data-catalog="2" aria-pressed="false">卷下 · 4</button><span>依经次第</span></div><div class="chapter-catalog">';
    flatSections().forEach(function(e){var sec=e.sec,p=progress[sec.id]||{},done=p.done;
      html+='<a class="sutra-card" data-ci="'+e.ci+'" data-keywords="'+escapeAttr(sec.number+' '+sec.title+' '+sec.theme+' '+sec.intro)+'" href="#/read/'+e.ci+'/'+e.si+'"><div class="card-number">'+String(sec.number).padStart(2,'0')+'</div><div class="card-copy"><div class="card-top"><span>'+escapeHtml(e.ch.title)+' · '+sec.pairs.length+' 段</span><span>'+(done?'已读完 ✓':'')+'</span></div><h3>'+escapeHtml(sec.name)+'</h3><p>'+escapeHtml(sec.theme)+'</p></div><span class="card-arrow">↗</span></a>';
    });
    html+='</div><p id="catalogEmpty" class="empty" hidden>没有找到这一品，试试「本愿」「布施」或「存亡」。</p><p class="catalog-count" id="catalogCount" aria-live="polite">共 13 品 · 153 段经文与白话译文</p></section>';
    html+='<section class="reading-note"><span class="small-seal">愿</span><div><h3>愿有所依，行有所至。</h3><p>以通行三卷十三品经文为底本。白话逐句展开原文意思，阅读提示补充背景与理解线索。读完一段，也可以记下一件愿意在生活中实践的善事。</p><a href="#/guide">经名、版本与注解说明 →</a></div></section>';
    view.innerHTML=html;
    var filter='all';function applyFilter(){var q=$('#chapterFilter').value.trim().toLowerCase(),count=0;$$('.sutra-card').forEach(function(c){c.hidden=!((filter==='all'||c.dataset.ci===filter)&&c.dataset.keywords.toLowerCase().includes(q));if(!c.hidden)count++;});$('#catalogEmpty').hidden=count>0;$('#catalogCount').textContent='共 '+count+' 品';}
    $('#chapterFilter').addEventListener('input',applyFilter);$$('[data-catalog]').forEach(function(b){b.addEventListener('click',function(){filter=b.dataset.catalog;$$('[data-catalog]').forEach(function(x){x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});applyFilter();});});
  }

  function renderGuide(view){
    view.innerHTML='<div class="crumb"><a href="#/">目录</a> / 读经之前</div><header class="chapter-head"><div class="eyebrow">A NOTE BEFORE READING</div><h1>读懂经文，也照见自己的行。</h1><div class="ch-sub">经文、白话译文、阅读提示与个人札记，各有其位置。</div></header><div class="guide-content prose">'+
    '<h2>经名与内容</h2><p>本站采用通行经名《地藏菩萨本愿经》，民间也称《地藏经》。地藏菩萨常被尊称为地藏王菩萨，尊称与经典正式题名有所不同。传统题署为唐于阗国三藏沙门实叉难陀译；经的成立与译出问题在研究中存在讨论，题署不代表本项目完成了历史考证。</p>'+
    '<h2>全经的阅读脉络</h2><p><strong>卷上第一至第四品</strong>：法会缘起、地藏过去身的愿行，以及众生业缘。<strong>卷中第五至第九品</strong>：知苦止恶、礼敬修福、利益存亡、善知识与称佛名号。<strong>卷下第十至第十三品</strong>：布施回向、护法、见闻利益与佛的最后付嘱。</p><p>本版收录十三品正文的 153 个自然段，不将网页附带的炉香赞、净业真言、开经偈及卷末赞等课诵仪轨混入正文。通行课诵本常分三卷；大正藏 T0412 编为两卷，卷数差异不等于品数差异。</p>'+
    '<h2>原文从哪里来</h2><p>正文整理自<a href="https://zh.wikisource.org/wiki/地藏菩薩本願經" target="_blank" rel="noopener noreferrer">维基文库《地藏菩萨本愿经》三卷</a>，保留其段落和文字，并提供简体与来源繁体切换。每品有来源链接，便于核对。</p><p>曾与 CBETA 大正藏 T13 No.412 的十三品作去标点、简化字形后的文本比对；存在异体字、措辞及少量语句差异，未统一改写底本。本版不是校勘本，也不宣称文字无误。具体出处与处理方式见项目 SOURCES.md。</p>'+
    '<h2>怎样阅读白话与提示</h2><p>全经 153 段均配有<strong>完整白话译文</strong>，依原文次序翻译各句意思，保留叙事、问答、数字和清单，并对长段落重新分段，方便阅读。原有的概括、背景与解释放在译文下方可展开的「阅读提示」中。白话传达经文所述内容，阅读提示帮助理解语境，两者分开显示。名词可点红色词语查看，也可到「名词」汇总页查找。译文与提示由 AI 辅助撰写，不是法师或宗派的正式讲记，尚未经过佛教学者或法师逐条审定。</p><p>业报、地狱、神通、感应与功德利益，应放在佛教经典的信仰和劝修语境中理解。不可用来反向判定贫病、残障或遭难者的品德，也不可把诵持次数当作健康、财运或安全的保证。涉及病苦、临终和生产的段落，宗教关怀应尊重当事人意愿，并与现实照护并行。</p>'+
    '<h2>从阅读到实践</h2><p>可留意三条贯穿线索：由救亲扩展为普遍慈悲；从微小善根开始，反复修习而不退；把布施和善行回向更广大的众生。第十品的「下心含笑、软言慰谕」与第七品的「闻健自修」，尤其适合联系日常生活。</p>'+
    '<h2>阅读与记录</h2><p>逐段模式下，点击经文或「看白话」展开完整译文；译文下方的「阅读提示」可按需展开；空格、右方向键前进，左方向键返回。可用段落目录直接跳转，也可切换通篇对照。设置中选择纸色、字号、横竖排与简繁经文。每品读完后可标记完成，并记录自己的体会。</p><p>笔记与进度仅存于当前浏览器，和易经站分别保存，不自动跨设备同步。设置中可导出 JSON 备份，在另一设备导入；清理浏览器数据之前先备份。</p>'+
    '<h2>致谢</h2><p>基础阅读交互与样式源自 <a href="https://github.com/Redwallen/liaofan-sizun" target="_blank" rel="noopener noreferrer">Redwallen / liaofan-sizun</a>，本版在 Sunhow 易经阅读器基础上改造，保留 MIT 许可。古代经文属于公有领域，电子转录出处与新增注解授权见 SOURCES.md。</p></div><a class="btn primary" href="#/read/0/0">开始阅读第一品 →</a>';
  }

  function toChineseNum(n) {
    return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'][n] || String(n);
  }

  /* ----------------------------- 章节页 ----------------------------- */
  function renderChapter(view, ci) {
    var ch = BOOK.chapters[ci];
    if (!ch) { view.innerHTML = '<div class="empty"><h2>没有这一篇</h2></div>'; return; }
    var st = chapterStats(ch);
    var prev = BOOK.chapters[ci - 1], next = BOOK.chapters[ci + 1];

    var html = '';
    html += '<div class="crumb"><a href="#/">目录</a> / 第' + toChineseNum(ci + 1) + '卷</div>';
    html += '<header class="chapter-head">';
    html += '<div class="ch-no">第 ' + toChineseNum(ci + 1) + ' 卷 · 共 ' + ch.sections.length + ' 品</div>';
    html += '<h1>' + escapeHtml(ch.title) + '</h1>';
    if (ch.subtitle) html += '<div class="ch-sub">' + escapeHtml(ch.subtitle) + '</div>';
    html += '</header>';

    html += '<div class="overall"><div class="ring" style="--p:' + st.pct + '"><b>' + st.pct + '%</b></div>' +
            '<div class="overall-text"><strong>已读完 ' + st.done + ' / ' + st.total + ' 品</strong>' +
            '<span>' + (st.pct === 100 ? '这一卷已经读完了。' : '一品一品来，不必急。') + '</span></div>' +
            '<a class="btn primary" href="#/read/' + ci + '/' + firstUnreadIndex(ch) + '">' +
            (st.done ? '继续阅读' : '开始阅读') + '</a></div>';

    if (ch.intro) html += '<div class="chapter-intro">' + paragraphs(ch.intro) + '</div>';

    html += '<div class="sec-list">';
    ch.sections.forEach(function (sec, si) {
      var p = progress[sec.id] || {};
      html += '<a class="sec-item' + (p.done ? ' done' : '') + '" href="#/read/' + ci + '/' + si + '">';
      html += '<span class="sec-no">' + sec.number + '</span>';
      html += '<span class="sec-title">' + escapeHtml(sec.title) + '</span>';
      if (mynotes[sec.id] && mynotes[sec.id].text) html += '<span class="sec-meta">有笔记</span>';
      html += '<span class="sec-meta">' + sec.pairs.length + ' 段</span>';
      if (p.done) html += '<span class="sec-check">✓</span>';
      html += '</a>';
    });
    html += '</div>';

    html += '<div class="reader-foot">';
    if (prev) html += '<a class="btn ghost small" href="#/ch/' + (ci - 1) + '">← ' + escapeHtml(prev.title) + '</a>';
    html += '<span class="spacer"></span>';
    if (next) html += '<a class="btn ghost small" href="#/ch/' + (ci + 1) + '">' + escapeHtml(next.title) + ' →</a>';
    html += '</div>';

    view.innerHTML = html;
  }

  function paragraphs(text) {
    return String(text).split(/\n+/).filter(Boolean).map(function (p) {
      return '<p>' + escapeHtml(p) + '</p>';
    }).join('');
  }

  function firstUnreadIndex(ch) {
    for (var i = 0; i < ch.sections.length; i++) {
      if (!(progress[ch.sections[i].id] && progress[ch.sections[i].id].done)) return i;
    }
    return 0;
  }

  /* ----------------------------- 阅读页 ----------------------------- */
  function renderReader(view, ci, si) {
    var ch = BOOK.chapters[ci];
    if (!ch || !ch.sections[si]) { view.innerHTML = '<div class="empty"><h2>没有这一品</h2><p><a href="#/">回到目录</a></p></div>'; return; }
    var sec = ch.sections[si];
    if (settings.script === 'traditional') sec = Object.assign({},sec,{pairs:sec.pairs.map(function(p){return Object.assign({},p,{orig:p.traditional});}),notes:sec.notes.map(function(n){return Object.assign({},n,{term:n.traditional||n.term});})});
    var pr = secProgress(sec.id);
    save(LS.last, { ci: ci, si: si });

    state.reader = { ci: ci, si: si, id: sec.id };

    var html = '';
    html += '<div class="reader">';

    // 顶部
    html += '<div class="reader-top">';
    html += '<a href="#/ch/' + ci + '">' + escapeHtml(ch.title) + '</a><span>/</span>';
    html += '<span class="rt-title">第 ' + sec.number + ' 品</span>';
    html += '<span class="spacer"></span>';
    html += '<div class="seg-control">' +
            '<button data-mode="focus" class="' + (state.mode === 'focus' ? 'on' : '') + '">逐段精读</button>' +
            '<button data-mode="flow" class="' + (state.mode === 'flow' ? 'on' : '') + '">通篇对照</button></div>';
    html += '<button class="btn small ghost" id="speakSection">朗读</button>';
    if (state.mode === 'flow') html += '<button class="btn small ghost" id="toggleAll">全部展开</button>';
    html += '</div>';

    html += '<header class="sec-heading">';
    html += '<div class="sec-pos">' + escapeHtml(ch.title) + ' · ' + (si + 1) + ' / ' + ch.sections.length + '</div>';
    html += '<h1>' + escapeHtml(sec.title) + '</h1>';
    html += '</header>';

    html += '<div class="reading-context"><div><span class="eyebrow">本品提要</span><p>' + escapeHtml(sec.intro) + '</p></div><label class="passage-picker">段落目录<select id="passageSelect" aria-label="选择经文段落">' + sec.pairs.map(function(p,i){return '<option value="'+i+'"'+(i===pr.pos?' selected':'')+'>'+String(i+1).padStart(2,'0')+' · '+escapeHtml(p.label)+'</option>';}).join('') + (pr.pos >= sec.pairs.length ? '<option value="'+sec.pairs.length+'" selected>本品已读完</option>' : '') + '</select></label></div>';


    var allRevealed = sec.pairs.every(function (_, i) { return pr.revealed[i]; });
    var defaultShown = settings.defaultReveal === 'shown';

    if (state.mode === 'focus') {
      html += renderFocus(sec, pr, allRevealed, defaultShown);
    } else {
      html += renderFlow(sec, pr, defaultShown);
    }

    // 注释
    var paragraphNotes = state.mode === 'focus' && sec.pairs[pr.pos] ? sec.notes.filter(function(n){return sec.pairs[pr.pos].orig.includes(n.term);}) : sec.notes;
    if (paragraphNotes && paragraphNotes.length) {
      html += '<section class="panel"><div class="panel-head"><h3>名词注解</h3>' +
              '<span class="count">' + paragraphNotes.length + ' 条</span></div>' +
              '<div class="note-cards">';
      paragraphNotes.forEach(function (n) {
        html += '<div class="note-card"><b>' + escapeHtml(n.term) + '</b>' + escapeHtml(n.explain) + '</div>';
      });
      html += '</div></section>';
    }

    // 心得
    if (sec.insight) {
      html += '<section class="panel"><div class="panel-head"><h3>这一品在说什么</h3></div>' +
              '<div class="insight-card"><span class="ilabel">阅读线索</span>' + escapeHtml(sec.insight) + '</div></section>';
    }

    html += '<div class="source-note">白话译文与阅读提示为 AI 辅助整理 · <a href="' + escapeAttr(sec.source) + '" target="_blank" rel="noopener noreferrer">核对本品原文 ↗</a></div>';
    var before = neighborSection(ci, si, -1), after = neighborSection(ci, si, 1);
    html += '<nav class="gua-neighbors" aria-label="相邻品">' + (before ? '<a href="#/read/'+before.ci+'/'+before.si+'">← '+escapeHtml(before.sec.name)+'品</a>':'<span>全书起点</span>') + '<a href="#/">十三品目录</a>' + (after ? '<a href="#/read/'+after.ci+'/'+after.si+'">'+escapeHtml(after.sec.name)+'品 →</a>':'<span>全书终章</span>') + '</nav>';

    // 我的笔记
    html += '<section class="panel mynote-box"><div class="panel-head"><h3>我的笔记</h3>' +
            '<span class="spacer"></span><span class="count" id="noteState"></span></div>' +
            '<textarea aria-label="我的笔记" id="myNote" placeholder="写点自己的想法、疑问或要记住的话…（自动保存在本机）"></textarea>' +
            '</section>';

    html += '</div>';
    view.innerHTML = html;

    $('#passageSelect').addEventListener('change', function(e) { pr.pos = Number(e.target.value); touch(pr); persistProgress(); route(); if (state.mode === 'flow') { var selected = $('[data-pair="'+pr.pos+'"]'); if(selected) selected.scrollIntoView({block:'start',behavior:'smooth'}); } });

    // 恢复笔记
    var ta = $('#myNote');
    if (ta) {
      ta.value = (mynotes[sec.id] && mynotes[sec.id].text) || '';
      var stateEl = $('#noteState');
      if (ta.value) stateEl.textContent = '已保存';
      var timer = null;
      ta.addEventListener('input', function () {
        clearTimeout(timer);
        (function () {
          // 清空也要记录（空文本 = 已删除的墓碑），否则其它设备会把旧笔记传回来
          mynotes[sec.id] = { text: ta.value, at: Date.now() };
          var saved = persistNotes();
          if (!saved) { stateEl.textContent = '保存失败，请导出备份'; return; }
          stateEl.textContent = ta.value
            ? '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : '已清空';
        })();
      });
    }
  }

  function renderTranslation(pair) {
    return '<span class="tlabel">白话译文</span><div class="plain-translation">' + escapeHtml(pair.trans) + '</div>' +
      (pair.annotation ? '<details class="reading-tip"><summary>阅读提示 · 背景与解释</summary><div>' + escapeHtml(pair.annotation) + '</div></details>' : '');
  }

  function renderFocus(sec, pr, allRevealed, defaultShown) {
    var pos = Math.min(pr.pos || 0, sec.pairs.length);
    var html = '<div class="focus-stage">';

    // 进度点
    html += '<div class="dots">';
    sec.pairs.forEach(function (_, i) {
      var cls = i === pos ? 'now' : (pr.revealed[i] || defaultShown || i < pos ? 'seen' : '');
      html += '<button type="button" aria-label="跳至' + escapeAttr(sec.pairs[i].label) + '" class="' + cls + '" data-dot="' + i + '"></button>';
    });
    html += '</div>';

    if (pos >= sec.pairs.length) {
      html += '<div class="finish-box" style="margin:auto">' +
              '<p>这一品的 ' + sec.pairs.length + ' 段都读完了。</p>' +
              '<button class="btn primary" id="markDone2">' + (pr.done ? '✓ 已读完（点击取消）' : '标记本品已读完') + '</button>' +
              '</div>';
      html += '</div>';
      html += renderFocusBar(sec, pr, pos, false, true);
      return html;
    }

    var pair = sec.pairs[pos];
    var shown = pr.revealed[pos] || defaultShown;
    html += '<div class="focus-body">';
    html += '<div class="passage-label">' + escapeHtml(pair.label) + ' <span>' + (pos + 1) + ' / ' + sec.pairs.length + '</span></div>';
    html += '<p class="orig-line" tabindex="0" role="button" aria-label="展开本段白话" id="focusOrig">' + decorate(pair.orig, sec.notes) + '</p>';
    html += '<div class="trans-box' + (shown ? ' reveal' : '') + '" id="focusTrans"' + (shown ? '' : ' hidden') + '>' +
            renderTranslation(pair) + '</div>';
    html += '</div>';

    html += '</div>';
    html += renderFocusBar(sec, pr, pos, shown, false);
    return html;
  }

  /* 逐段精读的操作条：渲染在白色卡片之外，靠 CSS 固定在视口底部，始终可见。
     手机上没有键盘、也看不到「空格 →」的提示，所以读完整一节时这里必须给出
     一个能点的「下一品」，不能只靠滑动。 */
  function renderFocusBar(sec, pr, pos, shown, finished) {
    var prevS = neighborSection(state.reader.ci, state.reader.si, -1);
    var nextS = neighborSection(state.reader.ci, state.reader.si, 1);
    var canPrev = pos > 0 || !!prevS;

    var html = '<div class="focus-actions"><div class="fa-inner">';
    html += '<button class="btn small" id="prevPair"' + (canPrev ? '' : ' disabled') + '>上一段</button>';
    if (finished) {
      if (nextS) {
        html += '<a class="btn small primary" href="#/read/' + nextS.ci + '/' + nextS.si + '">下一品 →</a>';
      } else {
        html += '<a class="btn small primary" href="#/">回到目录</a>';
      }
    } else if (!shown) {
      html += '<button class="btn small primary" id="revealBtn">看白话</button>';
    } else if (pos < sec.pairs.length - 1) {
      html += '<button class="btn small primary" id="nextPair">下一段 →</button>';
    } else {
      html += '<button class="btn small primary" id="nextPair">读完了</button>';
    }
    var tip = finished
      ? (nextS ? '空格 → 下一品' : '这已经是全书最后一品')
      : '点原文也能显示白话 · 空格 → 下一段';
    html += '<span class="tip">' + tip + '</span>';
    html += '</div></div>';
    return html;
  }

  function renderFlow(sec, pr, defaultShown) {
    var html = '<div class="flow-list">';
    sec.pairs.forEach(function (pair, i) {
      var shown = pr.revealed[i] || defaultShown;
      html += '<div class="pair' + (shown ? ' opened' : '') + '" data-pair="' + i + '">';
      html += '<div class="passage-label">' + escapeHtml(pair.label) + '</div>';
      html += '<p class="orig-line" tabindex="0" role="button" aria-label="切换本段白话">' + decorate(pair.orig, sec.notes) + '</p>';
      html += '<div class="pair-click-hint">点击这一段，看白话译文</div>';
      html += '<div class="trans-box reveal">' + renderTranslation(pair) + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // 通篇模式没有逐句操作条，标记入口放在整节末尾
    html += '<div class="flow-foot"><button class="btn' + (pr.done ? '' : ' primary') + '" id="markDone">' +
            (pr.done ? '✓ 已读完（点击取消）' : '标记本品已读完') + '</button></div>';
    return html;
  }

  /* ----------------------------- 字词表 ----------------------------- */
  function renderGlossary(view) {
    var all = [];
    BOOK.chapters.forEach(function (ch, ci) {
      ch.sections.forEach(function (sec) {
        (sec.notes || []).forEach(function (n) {
          all.push({ term: n.term, explain: n.explain, ch: ci, chTitle: ch.title, sec: sec });
        });
      });
    });
    if (state.glossaryCh !== 'all') all = all.filter(function(n){return n.ch === state.glossaryCh;});
    // 去重（同一词条、同一解释）
    var seen = {}, uniq = [];
    all.forEach(function (n) {
      var k = n.term + '|' + n.explain;
      if (!seen[k]) { seen[k] = 1; uniq.push(n); }
    });
    uniq.sort(function (a, b) { return a.term.localeCompare(b.term, 'zh'); });

    var filtered = uniq;

    var html = '';
    html += '<div class="crumb"><a href="#/">目录</a> / 名词注解</div>';
    html += '<header class="chapter-head"><h1>名词注解</h1>' +
            '<div class="ch-sub">当前范围 ' + uniq.length + ' 条，按词语排序</div></header>';
    html += '<div class="glossary-filter">';
    html += '<button class="chip' + (state.glossaryCh === 'all' ? ' on' : '') + '" data-gch="all">全部</button>';
    BOOK.chapters.forEach(function (ch, ci) {
      html += '<button class="chip' + (state.glossaryCh === ci ? ' on' : '') + '" data-gch="' + ci + '">' + escapeHtml(ch.title) + '</button>';
    });
    html += '</div>';

    html += '<div class="glossary-grid">';
    filtered.forEach(function (n) {
      html += '<div class="gloss-item" data-goto="' + n.ch + '/' + BOOK.chapters[n.ch].sections.indexOf(n.sec) + '">';
      html += '<span class="g-ch">' + escapeHtml(n.chTitle) + '</span>';
      html += '<b>' + escapeHtml(n.term) + '</b>';
      html += '<p>' + escapeHtml(n.explain) + '</p>';
      html += '<div class="g-src">出自：' + escapeHtml(n.sec.title) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    if (!filtered.length) html += '<div class="empty">这一类还没有词条。</div>';

    view.innerHTML = html;
  }

  /* ----------------------------- 我的笔记 ----------------------------- */
  function renderMyNotes(view) {
    var entries = [];
    BOOK.chapters.forEach(function (ch, ci) {
      ch.sections.forEach(function (sec, si) {
        if (mynotes[sec.id] && mynotes[sec.id].text) {
          entries.push({ ci: ci, si: si, ch: ch, sec: sec, text: mynotes[sec.id].text });
        }
      });
    });
    var html = '';
    html += '<div class="crumb"><a href="#/">目录</a> / 我的笔记</div>';
    html += '<header class="chapter-head"><h1>我的笔记</h1>' +
            '<div class="ch-sub">共 ' + entries.length + ' 条 · 只保存在本机浏览器</div></header>';
    if (!entries.length) {
      html += '<div class="empty"><h2>还没有笔记</h2><p>读到有想法的地方，在页面底部写几句，就会出现在这里。</p>' +
              '<p style="margin-top:16px"><a class="btn primary" href="#/">去阅读</a></p></div>';
    } else {
      html += '<div class="mynote-list">';
      entries.forEach(function (e) {
        html += '<div class="mynote-entry">';
        html += '<div class="me-head"><b>' + escapeHtml(e.sec.title) + '</b>' +
                '<span>' + escapeHtml(e.ch.title) + ' · 第 ' + e.sec.number + ' 品</span></div>';
        html += '<div class="me-body">' + escapeHtml(e.text) + '</div>';
        html += '<div class="me-actions"><a class="btn ghost small" href="#/read/' + e.ci + '/' + e.si + '">回到这一品</a></div>';
        html += '</div>';
      });
      html += '</div>';
    }
    view.innerHTML = html;
  }

  /* ----------------------------- 搜索 ----------------------------- */
  function buildIndex() {
    var idx = [];
    BOOK.chapters.forEach(function (ch, ci) {
      ch.sections.forEach(function (sec, si) {
        idx.push({
          ci: ci, si: si,
          chTitle: ch.title,
          title: sec.title,
          orig: sec.pairs.map(function (p) { return p.orig + ' ' + p.traditional; }).join(''),
          trans: sec.pairs.map(function (p) { return p.trans; }).join(' '),
          notes: (sec.notes || []).map(function (n) { return n.term + '：' + n.explain; }).join(' ') + ' ' + sec.pairs.map(function(p){return p.annotation || '';}).join(' ')
        });
      });
    });
    return idx;
  }
  var SEARCH_INDEX = null;

  function doSearch(q) {
    if (!SEARCH_INDEX) SEARCH_INDEX = buildIndex();
    q = q.trim();
    if (!q) return [];
    var lq = q.toLowerCase();
    var res = [];
    SEARCH_INDEX.forEach(function (it) {
      var fields = [
        { name: 'title', text: it.title },
        { name: 'orig', text: it.orig },
        { name: 'trans', text: it.trans },
        { name: 'notes', text: it.notes }
      ];
      var best = null;
      fields.forEach(function (f) {
        var t = f.text, lt = t.toLowerCase(), i = lt.indexOf(lq);
        if (i === -1) return;
        var snippet = t.slice(Math.max(0, i - 24), i + q.length + 40);
        if (!best || f.name === 'title') best = { field: f.name, snippet: snippet, at: i };
      });
      if (best) {
        var score = (best.field === 'title' ? 100 : 0) + (best.field === 'orig' ? 10 : 0);
        res.push({ it: it, best: best, score: score, count: (it.orig.split(q).length - 1) + (it.trans.split(q).length - 1) });
      }
    });
    res.sort(function (a, b) { return (b.score + b.count * 3) - (a.score + a.count * 3); });
    return res;
  }

  function renderSearchResults(q) {
    var box = $('#searchResults');
    if (!q.trim()) {
      box.innerHTML = '<p class="search-hint">输入关键词，例如「本愿」「布施」「回向」「善知识」。</p>';
      return;
    }
    var res = doSearch(q);
    if (!res.length) {
      box.innerHTML = '<p class="search-hint">没有找到「' + escapeHtml(q) + '」。换个词试试？</p>';
      return;
    }
    var html = '<div class="sr-group">找到 ' + res.length + ' 品</div>';
    res.slice(0, 40).forEach(function (r) {
      html += '<a class="sr-item" href="#/read/' + r.it.ci + '/' + r.it.si + '">';
      html += '<div class="sr-ch">' + escapeHtml(r.it.chTitle) + '</div>';
      html += '<div class="sr-title">' + hl(r.it.title, q) + '</div>';
      html += '<div class="sr-text">' + hl(r.best.snippet, q) + '…</div>';
      html += '</a>';
    });
    box.innerHTML = html;
  }
  function hl(text, q) {
    var e = escapeHtml(text);
    var eq = escapeHtml(q);
    if (!eq) return e;
    try {
      return e.replace(new RegExp(eq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (m) {
        return '<mark>' + m + '</mark>';
      });
    } catch (err) { return e; }
  }

  /* ----------------------------- 抽屉 / 弹层开关 ----------------------------- */
  function openSettings() {
    $('#settingsDrawer').hidden = false;
    $('#drawerMask').hidden = false;
    $('#closeSettings').focus();
  }
  function closeSettings() {
    $('#settingsDrawer').hidden = true;
    $('#drawerMask').hidden = true;
  }
  function openSearch() {
    $('#searchModal').hidden = false;
    $('#searchMask').hidden = false;
    var inp = $('#searchInput');
    inp.value = state.searchQuery || '';
    renderSearchResults(inp.value);
    setTimeout(function () { inp.focus(); }, 30);
  }
  function closeSearch() {
    $('#searchModal').hidden = true;
    $('#searchMask').hidden = true;
  }

  /* ----------------------------- 事件绑定 ----------------------------- */
  function bindOnce() {
    window.addEventListener('hashchange', route);

    $('#settingsBtn').addEventListener('click', openSettings);
    $('#tabSettings').addEventListener('click', openSettings);
    $('#closeSettings').addEventListener('click', closeSettings);
    $('#drawerMask').addEventListener('click', closeSettings);

    $('#searchBtn').addEventListener('click', openSearch);
    $('#closeSearch').addEventListener('click', closeSearch);
    $('#searchMask').addEventListener('click', closeSearch);
    $('#searchInput').addEventListener('input', function (e) {
      state.searchQuery = e.target.value;
      renderSearchResults(e.target.value);
    });

    // 设置项
    $$('.seg').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-val]');
        if (!b) return;
        setSetting(seg.dataset.setting, b.dataset.val);
        if (seg.dataset.setting === 'script') { route(); }
        if (seg.dataset.setting === 'defaultMode') {
          // 立即切换当前阅读视图
          if (/^#\/read\//.test(location.hash)) {
            state.mode = b.dataset.val === 'flow' ? 'flow' : 'focus';
            route();
          } else {
            state.mode = b.dataset.val === 'flow' ? 'flow' : 'focus';
          }
        }
      });
    });

    $('#resetProgress').addEventListener('click', function () {
      var msg = '确定清除本网站的阅读进度与笔记吗？此操作不可撤销，请先导出备份。';
      if (!confirm(msg)) return;
      progress = {};
      mynotes = {};
      save(LS.progress, progress);
      save(LS.notes, mynotes);
      save(LS.last, null);
      toast('已清除');
      route();
    });

    // 主视图事件委托
    var view = $('#view');
    view.addEventListener('click', function (e) {
      var t = e.target;

      // 词条
      var term = t.closest('.term');
      if (term) { e.stopPropagation(); showPopover(term); return; }


      // 模式切换
      var modeBtn = t.closest('[data-mode]');
      if (modeBtn) { state.mode = modeBtn.dataset.mode; route(); return; }

      // 进度点
      var dot = t.closest('[data-dot]');
      if (dot && state.reader) {
        var pr = secProgress(state.reader.id);
        pr.pos = parseInt(dot.dataset.dot, 10);
        touch(pr); persistProgress();
        route();
        return;
      }

      // 逐句：看白话 / 上下句
      if ((t.closest('#revealBtn') || t.closest('#focusOrig')) && state.reader) {
        focusReveal();
        return;
      }
      if (t.closest('#nextPair') && state.reader) {
        focusNext();
        return;
      }
      if (t.closest('#prevPair') && state.reader) {
        focusPrev();
        return;
      }

      // 通篇：展开某句
      var pair = t.closest('.pair');
      if (pair && !t.closest('.term') && !t.closest('.trans-box')) {
        var i = parseInt(pair.dataset.pair, 10);
        pair.classList.toggle('opened');
        if (state.reader) {
          var pr5 = secProgress(state.reader.id);
          if (pair.classList.contains('opened')) pr5.revealed[i] = true;
          else delete pr5.revealed[i];
          touch(pr5); persistProgress();
        }
        return;
      }

      // 标记已读完
      if ((t.closest('#markDone') || t.closest('#markDone2')) && state.reader) {
        var pr6 = secProgress(state.reader.id);
        pr6.done = !pr6.done;
        touch(pr6); persistProgress();
        toast(pr6.done ? '已标记为读完' : '已取消标记');
        route();
        return;
      }

      // 朗读（整节）
      if (t.closest('#speakSection') && state.reader) {
        var sec2 = BOOK.chapters[state.reader.ci].sections[state.reader.si];
        speak(sec2.pairs.map(function (x) { return settings.script === 'traditional' ? x.traditional : x.orig; }).join(''));
        return;
      }

      // 通篇模式：全部展开 / 收起
      if (t.closest('#toggleAll') && state.reader) {
        var pairs = $$('.pair', view);
        var allOpen = pairs.length > 0 && pairs.every(function (p) { return p.classList.contains('opened'); });
        var prT = secProgress(state.reader.id);
        pairs.forEach(function (p) {
          var i = parseInt(p.dataset.pair, 10);
          p.classList.toggle('opened', !allOpen);
          if (allOpen) delete prT.revealed[i]; else prT.revealed[i] = true;
        });
        touch(prT); persistProgress();
        t.closest('#toggleAll').textContent = allOpen ? '全部展开' : '全部收起';
        return;
      }

      // 字词表筛选
      var chip = t.closest('[data-gch]');
      if (chip) {
        state.glossaryCh = chip.dataset.gch === 'all' ? 'all' : parseInt(chip.dataset.gch, 10);
        route();
        return;
      }
      var gi = t.closest('[data-goto]');
      if (gi) {
        var parts = gi.dataset.goto.split('/');
        navigate('#/read/' + parts[0] + '/' + parts[1]);
        return;
      }
    });

    // 点击空白关闭浮层
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.term') && !e.target.closest('#popover')) hidePopover();
    });
    // 点击搜索结果后关闭搜索面板
    $('#searchResults').addEventListener('click', function (e) {
      if (e.target.closest('.sr-item')) closeSearch();
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') { closeSearch(); closeSettings(); hidePopover(); return; }
      if (typing) return;
      if (!$('#searchModal').hidden || !$('#settingsDrawer').hidden) return;
      if (e.key === 'Enter' && document.activeElement && document.activeElement.matches('.orig-line')) { e.preventDefault(); document.activeElement.click(); return; }
      if (e.key === ' ' && document.activeElement && document.activeElement.matches('button,a,[role=button]')) return;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); openSearch(); return;
      }
      if (!state.reader || state.mode !== 'focus' || /^#\/read\//.test(location.hash) === false) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault();
        focusAdvance();
      } else if (e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault();
        focusPrev();
      } else if (e.key === 'r') {
        e.preventDefault();
        focusReveal();
      }
    });

    // 手机滑动：左滑下一段（先展开白话），右滑上一段
    var touchStart = null;
    view.addEventListener('touchstart', function (e) {
      if (!state.reader || state.mode !== 'focus' || !/^#\/read\//.test(location.hash)) { touchStart = null; return; }
      var t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY, target: e.target };
    }, { passive: true });
    view.addEventListener('touchend', function (e) {
      var s = touchStart; touchStart = null;
      if (!s) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - s.x, dy = t.clientY - s.y;
      // 水平位移要够大、且明显大于垂直位移，避免和滚动、点击冲突
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      var el = s.target;
      if (el && el.closest && (el.closest('.btn') || el.closest('.term') || el.closest('a') || el.closest('textarea') || el.closest('.dots'))) return;
      if (dx < 0) focusAdvance(); else focusPrev();
    }, { passive: true });

    window.addEventListener('resize', hidePopover);
    window.addEventListener('scroll', hidePopover, { passive: true });
  }

  /* ----------------------------- 启动 ----------------------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (location.protocol !== 'https:' && !local) return; // file:// 下不注册
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  function bindBackup() {
    $('#exportData').addEventListener('click', function(){
      var payload={format:'dizang-reader',version:1,exportedAt:new Date().toISOString(),progress:progress,notes:mynotes};
      var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='dizang-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);toast('已导出阅读备份');
    });
    $('#importData').addEventListener('click',function(){$('#importFile').click();});
    $('#importFile').addEventListener('change',async function(e){
      var file=e.target.files[0];if(!file)return;
      try{
        if(file.size>5*1024*1024)throw new Error('备份文件不能超过 5 MB');
        var data=JSON.parse(await file.text());
        if(data.format!=='dizang-reader'||data.version!==1||!data.notes||!data.progress||Array.isArray(data.notes)||Array.isArray(data.progress)||typeof data.notes!=='object'||typeof data.progress!=='object')throw new Error('请选择地藏经注解导出的备份文件');
        var valid={};flatSections().forEach(function(e){valid[e.sec.id]=e.sec;});
        var incomingNotes={}, incomingProgress={};
        Object.keys(data.notes).forEach(function(id){
          var v=data.notes[id];if(!valid[id]||!v||typeof v.text!=='string'||v.text.length>200000||!Number.isFinite(v.at)||v.at<0)throw new Error('备份中的笔记格式不正确');
          incomingNotes[id]={text:v.text,at:v.at};
        });
        Object.keys(data.progress).forEach(function(id){
          var v=data.progress[id];if(!valid[id]||!v||typeof v.done!=='boolean'||!Number.isInteger(v.pos)||v.pos<0||v.pos>valid[id].pairs.length||!Number.isFinite(v.at)||v.at<0||!v.revealed||typeof v.revealed!=='object'||Array.isArray(v.revealed))throw new Error('备份中的进度格式不正确');
          var revealed={};Object.keys(v.revealed).forEach(function(k){if(!/^\d+$/.test(k)||Number(k)>=valid[id].pairs.length||v.revealed[k]!==true)throw new Error('备份中的句子标记不正确');revealed[k]=true;});
          incomingProgress[id]={done:v.done,pos:v.pos,at:v.at,revealed:revealed};
        });
        var count=Object.keys(incomingNotes).filter(function(k){return incomingNotes[k].text;}).length;
        if(!confirm('导入 '+count+' 条笔记和 '+Object.keys(incomingProgress).length+' 品阅读记录？同一品会保留修改时间较新的记录。'))return;
        Object.keys(incomingNotes).forEach(function(id){if(!mynotes[id]||incomingNotes[id].at>mynotes[id].at)mynotes[id]=incomingNotes[id];});
        Object.keys(incomingProgress).forEach(function(id){if(!progress[id]||incomingProgress[id].at>progress[id].at)progress[id]=incomingProgress[id];});
        var notesSaved=persistNotes(), progressSaved=persistProgress();route();toast(notesSaved&&progressSaved?'备份已合并导入':'导入到内存，存储失败，请立即导出备份');
      }catch(err){toast(err.message||'无法读取这个备份文件');}finally{e.target.value='';}
    });
  }

  function bindDialogAccessibility() {
    function trap(e){
      var dialog=!$('#settingsDrawer').hidden?$('#settingsDrawer'):(!$('#searchModal').hidden?$('#searchModal'):null);
      if(!dialog||e.key!=='Tab')return;
      var controls=$$('button,input,select,a[href]',dialog).filter(function(el){return !el.disabled&&!el.hidden&&el.getClientRects().length;});
      if(!controls.length)return;
      var first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}
    }
    document.addEventListener('keydown',trap);
  }

  function boot() {
    applySettings();
    bindOnce();
    bindBackup();
    bindDialogAccessibility();
    document.title = CONFIG.documentTitle || CONFIG.title + " · " + CONFIG.subtitle;
    $(".brand-text strong").textContent=CONFIG.title;
    $(".brand-text em").textContent=CONFIG.subtitle;
    route();
    registerSW();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
