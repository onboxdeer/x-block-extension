(function () {
  'use strict';

  // ==================== 所有页面都显示按钮，帖子详情页才可扫描 ====================
  let inited = false;
  let lastPath = location.pathname;
  const isStatusPage = () => /\/[^\/]+\/status\/\d+/.test(location.pathname);
  function tryInit() {
    if (!inited) {
      inited = true;
      loadWords();
      loadBlocked();
      buildUI();
    } else {
      // SPA 路由变化：仅记录路径（不自动扫描，由用户点击「扫描」触发）
      if (lastPath !== location.pathname) {
        lastPath = location.pathname;
      }
    }
  }

  // ==================== 常量 ====================
  const VERSION = '3.0.0';
  const LS_WORDS = 'xbk_words_v1';
  const LS_BLOCKED = 'xbk_blocked_v1';
  const CATS = ['广告/诈骗', '辱骂/人身攻击', '歧视/仇恨', '骚扰/引战'];

  // 默认词语列表（可增删、可重置）
  const DEFAULT_WORDS = {
    '广告/诈骗': ['免费', '加我', '私信', 'dm me', 'crypto', 'bitcoin', '比特币', '虚拟币', '币圈', '躺赚', '兼职', '刷单', '返利', '加群', '拉群', 'telegram', 'link in bio', '稳赚', '代购', '扫码', '加微信', '红包', 'giveaway', '赚钱', '理财'],
    '辱骂/人身攻击': ['傻逼', '傻x', '煞笔', '脑残', '智障', '弱智', '废物', '垃圾', '妈的', '去死', '吃屎', '畜生', '王八蛋', '狗东西', 'fuck', 'shit', 'bitch', 'asshole', 'idiot', 'stupid', 'loser', 'trash'],
    '歧视/仇恨': ['nigger', 'chink', '白皮猪', '黑鬼', '黄皮狗', '支那'],
    '骚扰/引战': ['喷子', '带节奏', '钓鱼', '引战', '找骂']
  };

  // ==================== 工具函数 ====================
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ==================== 状态 ====================
  let words = clone(DEFAULT_WORDS);   // { 类别: [词语,...] }
  let candidates = [];                // [{name, isAuthor, total, matched:[{text,hits:[{cat,word}]}], checked}]
  let blocked = {};                   // name -> ts
  let stopping = false;

  // ==================== 词语列表持久化 ====================
  function loadWords() {
    try {
      const raw = localStorage.getItem(LS_WORDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') { words = parsed; return; }
      }
    } catch (e) {}
    words = clone(DEFAULT_WORDS);
  }
  function saveWords() { localStorage.setItem(LS_WORDS, JSON.stringify(words)); }
  function loadBlocked() { try { blocked = JSON.parse(localStorage.getItem(LS_BLOCKED) || '{}'); } catch (e) { blocked = {}; } }
  function saveBlocked() { localStorage.setItem(LS_BLOCKED, JSON.stringify(blocked)); }

  // ==================== 匹配 ====================
  function matchText(text) {
    // normalize 消除变体选择符/零宽字符干扰；另生成"去 emoji"版本，避免昵称中 emoji 隔开文字导致匹配失败
    const clean = String(text || '').normalize('NFC')
      .replace(/[\u200B-\u200F\uFE0F\u2060\uFEFF]/g, '')
      .toLowerCase();
    let noEmoji = clean;
    try { noEmoji = clean.replace(/\p{Extended_Pictographic}/gu, ''); } catch (e) {}
    const hits = [];
    const added = new Set();
    for (const cat of CATS) {
      for (const w of (words[cat] || [])) {
        const wClean = String(w || '').normalize('NFC')
          .replace(/[\u200B-\u200F\uFE0F\u2060\uFEFF]/g, '')
          .toLowerCase();
        if (!wClean) continue;
        let wNoEmoji = wClean;
        try { wNoEmoji = wClean.replace(/\p{Extended_Pictographic}/gu, ''); } catch (e) {}
        const key = cat + '|' + w;
        if ((clean.includes(wClean) || (wNoEmoji && noEmoji.includes(wNoEmoji))) && !added.has(key)) {
          added.add(key);
          hits.push({ cat, word: w });
        }
      }
    }
    return hits;
  }
  function uniqWords(hits) {
    const set = new Set();
    hits.forEach(h => set.add(h.word));
    return Array.from(set);
  }

  // 判断字符串去掉 emoji 后是否还有文字（纯 emoji/图片则无文字，返回 false）
  function hasText(s) {
    let t = String(s || '').replace(/[\u200B-\u200F\uFE0F\u2060\uFEFF]/g, '');
    try { t = t.replace(/\p{Extended_Pictographic}/gu, ''); } catch (e) {}
    return t.trim().length > 0;
  }

  // ==================== 滚动工具（X 滚动容器是页面内部元素，不是 window） ====================
  // X 网页版的滚动容器通常是 div[data-testid="primaryColumn"] 或 main，
  // window.scrollTo 对它们无效。这里向上查找可滚动元素并滚动它。
  function getScrollContainer() {
    // 候选：primaryColumn、main、以及 body 往上最近的 overflow 容器
    const cands = [
      'div[data-testid="primaryColumn"]',
      'div[data-testid="conversation"]',
      'main',
      'div[data-testid="layout"]',
      '#react-root'
    ];
    for (const sel of cands) {
      const el = $(sel);
      if (!el) continue;
      // 找一个可滚动的后代或自身
      let cur = el;
      const walk = [cur];
      while (walk.length) {
        const n = walk.shift();
        if (n.scrollHeight > n.clientHeight + 20) return n;
        walk.push(...Array.from(n.children || []).slice(0, 8));
      }
    }
    // 兜底：document 滚动
    return document.scrollingElement || document.documentElement;
  }

  function scrollContainerTo(container, y) {
    try {
      container.scrollTop = y;
      // 同时尝试 window（部分页面 window 也可滚）
      window.scrollTo(0, y);
    } catch (e) {}
  }

  // ==================== 扫描专用滚动（保持原逻辑，勿改动） ====================
  // 用 scrollIntoView 滚到当前最后一个推文元素（浏览器自动滚正确的容器，
  // 触发 X 加载更多评论；X 加载出新推文后循环滚动，逐步向下加载）
  function scrollToLastTweet() {
    const arts = $$('article[data-testid="tweet"]');
    const last = arts[arts.length - 1];
    if (last) {
      try { last.scrollIntoView({ block: 'end', behavior: 'instant' }); } catch (e) {}
      return;
    }
    // 兜底
    try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
    const c = getScrollContainer();
    if (c) { try { c.scrollTop = c.scrollHeight; } catch (e) {} }
  }

  // 滚动回评论区顶部：用 scrollIntoView 滚到第一条推文（浏览器自动找正确的滚动容器，
  // 用户环境已验证 scrollIntoView 有效；不要用 scrollTop/window.scrollTo——对 X 内部滚动容器无效）
  function scrollToTopOfThread() {
    const arts = $$('article[data-testid="tweet"]');
    const first = arts[0];
    if (first) {
      try { first.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) {}
      return;
    }
    try { window.scrollTo(0, 0); } catch (e) {}
    const c = getScrollContainer();
    if (c) { try { c.scrollTop = 0; } catch (e) {} }
  }

  // ==================== 扫描（智能提前结束，避免无谓等待） ====================
  async function expandComments(expandRounds, scrollRounds) {
    // 兼容 X 各种"展开回复"按钮措辞
    const isShowMore = (b) => /(显示更多回复|查看更多回复|展开回复|查看回复|显示全部回复|Show more replies|View more replies|Show all replies|More replies)/i.test(b.innerText || '');
    const clickShowMore = () => $$('button').filter(isShowMore).forEach(b => { try { b.click(); } catch (e) {} });
    // 1) 展开"显示更多回复"：没有可点的按钮就立即结束，不再傻等
    for (let i = 0; i < expandRounds; i++) {
      const btns = $$('button').filter(isShowMore);
      if (!btns.length) break;
      clickShowMore();
      await wait(300);
    }
    // 2) 滚动加载：以"页面总高度是否还在增长"判断是否到底（X 评论区是虚拟滚动，
    //    滚动时会卸载顶部旧评论，评论条数可能不增长，但页面高度会持续增加）
    let noGrowCount = 0;
    let lastHeight = document.body.scrollHeight;
    for (let i = 0; i < scrollRounds; i++) {
      scrollToLastTweet();
      await wait(600);
      clickShowMore();
      await wait(250);
      const h = document.body.scrollHeight;
      if (h <= lastHeight) { noGrowCount++; if (noGrowCount >= 2) break; }
      else noGrowCount = 0;
      lastHeight = h;
    }
    // 回到顶部（scrollIntoView 驱动，可靠；scrollTop/window.scrollTo 对 X 内部容器无效）
    scrollToTopOfThread();
  }

  // ==================== 评论收集（支持多次累加：先扫当前可见，滚动后再追加，合并去重） ====================
  let scanMap = new Map();   // name -> rec（跨多次收集累加）
  let scanSeen = new Set();  // name|txt 去重
  let scanOrder = 0;         // 记录每个账号在评论流中的首次出现顺序（拉黑时按此顺序单向滚动）

  function collectComments() {
    const mainAuthor = (location.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '');
    // 优先只扫"对话串"（主帖+全部回复），找不到再退回主栏
    const root = $('div[data-testid="conversation"]') || $('div[data-testid="primaryColumn"]') || document;
    const articles = $$('article[data-testid="tweet"]', root);
    articles.forEach(art => {
      // 1) 找用户名：多级兜底
      let name = '';
      const nameLink = $('div[data-testid="User-Name"] a[href^="/"]', art)
        || $$('a[href^="/"]', art).find(a => {
          const h = a.getAttribute('href') || '';
          return /^\/[^\/]+\/?$/.test(h) && !h.includes('/status/') && !h.startsWith('/i/');
        });
      if (nameLink) {
        const href = nameLink.getAttribute('href') || '';
        const m = href.match(/^\/([^\/]+)\/?$/);
        if (m) name = m[1].replace(/^@/, '');
      }
      if (!name) return;
      // 2) 显示名（昵称）：按 @ 句柄分界取前面部分。X 的 User-Name 里显示名一定在 @句柄之前，
      //    此法完全不依赖容器选择器或空白分词，emoji 被渲染成 <img> 也不影响文字提取。
      const nameDiv = $('div[data-testid="User-Name"]', art);
      let displayName = '';
      if (nameDiv) {
        const full = (nameDiv.innerText || nameDiv.textContent || '');
        const atIdx = full.indexOf('@');
        displayName = (atIdx >= 0 ? full.slice(0, atIdx) : full)
          .replace(/\s+/g, ' ')
          .trim()
          .normalize('NFC')
          .replace(/[\u200B-\u200F\uFE0F\u2060\uFEFF]/g, '');
      }
      // 3) 正文（正文为空不跳过——昵称匹配是核心需求，纯图片/emoji 评论也要扫描昵称）
      const txtEl = $('[data-testid="tweetText"]', art);
      const txt = (txtEl && txtEl.innerText || '').trim();
      const key = name + '|' + txt;
      if (scanSeen.has(key)) return;
      scanSeen.add(key);
      const hits = hasText(txt) ? matchText(txt) : [];
      // 昵称和正文分别处理：昵称只有 emoji（无文字）则不匹配，否则正常匹配
      const nameHits = hasText(displayName) ? matchText(displayName) : [];
      let rec = scanMap.get(name);
      if (!rec) {
        rec = { name, displayName, isAuthor: name === mainAuthor, total: 0, matched: [], nameHits: [], order: scanOrder++ };
        scanMap.set(name, rec);
      }
      if (!rec.displayName && displayName) rec.displayName = displayName;
      rec.total++;
      if (hits.length) rec.matched.push({ text: txt, hits });
      if (nameHits.length && !rec.nameHits.length) rec.nameHits = nameHits;
    });
  }

  function finishScan() {
    // 评论或名称命中关键词都列入；帖子作者默认不勾选，防止误拉黑楼主
    candidates = Array.from(scanMap.values())
      .filter(c => c.matched.length > 0 || c.nameHits.length > 0)
      .sort((a, b) => (b.matched.length + b.nameHits.length) - (a.matched.length + a.nameHits.length))
      .map(c => ({ ...c, checked: !c.isAuthor }));
    renderCandidates();
    log('扫描完成：共 ' + scanSeen.size + ' 条评论，命中 ' + candidates.length + ' 个账号');
  }

  async function scanAll() {
    if (elScanBtn.disabled) return;
    if (!isStatusPage()) {
      elList.innerHTML = '<div id="xbk-empty">请在帖子详情页使用：打开任意一条帖子（网址含 /status/）后，这里会自动列出命中词语的账号。</div>';
      $('#xbk-countInfo').textContent = '';
      setProg(0, 0, '当前页面不是帖子详情页');
      log('当前不是帖子详情页。请打开任意一条帖子（网址含 /status/）后再扫描。');
      return;
    }
    elScanBtn.disabled = true;
    elScanBtn.textContent = '扫描中…';
    setProg(0, 1, '正在扫描…');
    // 清空上一次的命中结果，重新开始
    candidates = [];
    elList.innerHTML = '<div id="xbk-empty">正在扫描评论和昵称…</div>';
    $('#xbk-countInfo').textContent = '';
    updateCount();
    // 第 1 遍：先收集当前可见的评论（防止滚动后虚拟滚动卸载顶部评论）
    scanMap = new Map();
    scanSeen = new Set();
    scanOrder = 0;
    collectComments();
    // 展开"显示更多回复"并滚动加载更多（固定深度：展开 20、滚动 6，配合智能提前结束）
    await expandComments(20, 6);
    // 第 2 遍：滚动后再补扫一遍新加载的评论（与第 1 遍合并去重）
    collectComments();
    finishScan();
    // 确保回到评论区顶部（拉黑时从顶部开始单向滚动；scrollIntoView 驱动才可靠）
    scrollToTopOfThread();
    elScanBtn.disabled = false;
    elScanBtn.textContent = '扫描评论和昵称';
    setProg(1, 1, candidates.length ? '命中 ' + candidates.length + ' 个账号，请确认后拉黑' : '未发现命中账号');
  }

  // ==================== UI 模拟点击拉黑（全自动含确认，不调用任何接口） ====================
  // 点击「⋯ → 屏蔽 → 自动确认」，与手动操作一致；确认框会自动点掉，无需人工干预
  // 注意：X 评论区是虚拟滚动，滚动加载新评论会卸载顶部旧评论。
  // 若目标用户不在当前 DOM，先滚动定位（回顶 → scrollIntoView 分段下滚，滚动中展开折叠区），
  // 找到后滚到屏幕中央再执行屏蔽。
  // 注意：必须是非 async 的普通函数！否则调用处拿到的是 Promise 而非 DOM 元素，
  // 导致 querySelector/querySelectorAll 报"not a function"（这是此前一系列诡异 bug 的根源）。
  function findTweetByName(name) {
    const arts = $$('article[data-testid="tweet"]');
    const want = '/' + name.toLowerCase();
    // 兼容 href 大小写、尾斜杠、查询参数（如 /xxx?source=...）
    const norm = (h) => String(h || '').toLowerCase().split('?')[0].replace(/\/+$/, '');
    for (const a of arts) {
      const links = $$('a[href^="/"]', a);
      for (const l of links) {
        if (norm(l.getAttribute('href')) === want) return a;
      }
    }
    return null;
  }

  // 点击所有"显示更多回复"按钮（展开折叠的深层评论，让它们渲染进 DOM）
  function clickShowMore() {
    $$('button').filter(b => /(显示更多回复|查看更多回复|展开回复|查看回复|显示全部回复|Show more replies|View more replies|Show all replies|More replies)/i.test(b.innerText || '')).forEach(b => { try { b.click(); } catch (e) {} });
  }

  // 强制关闭可能残留的菜单/确认框（X 打开弹层时会锁定页面滚动 overflow:hidden，
  // 若不关干净会导致后续滚动全部失效——这正是"扫描能滚、拉黑不能滚"的原因之一）
  function dismissModals() {
    try { document.body.click(); } catch (e) {}
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    } catch (e) {}
  }

  // 清除 X 残留的滚动锁：X 打开菜单/确认框时会设置 overflow:hidden 锁住滚动容器，
  // 关闭弹层后若不主动清掉，后续所有滚动（scrollIntoView/scrollTop）都会失效。
  // 这正是"扫描能滚（无弹层）、拉黑不滚（屏蔽过用户后残留锁）"的根因，必须强制清除。
  function unlockScroll() {
    const els = [document.documentElement, document.body];
    const c = getScrollContainer();
    if (c && els.indexOf(c) < 0) els.push(c);
    els.forEach(el => {
      try {
        if (el && el.style) {
          const ov = (el.style.overflow || '') + ' ' + (el.style.overflowX || '') + ' ' + (el.style.overflowY || '');
          if (/hidden|clip/i.test(ov)) {
            el.style.overflow = '';
            el.style.overflowX = '';
            el.style.overflowY = '';
          }
        }
      } catch (e) {}
    });
  }

  // 获取当前实际滚动位置（容器或 window，取较大值）
  function currentScrollY() {
    const c = getScrollContainer();
    const a = c ? c.scrollTop : 0;
    const b = window.scrollY || document.documentElement.scrollTop || 0;
    return Math.max(a, b);
  }

  async function locateAndBlock(name) {
    try {
      // 先关闭可能残留的菜单/确认框，并清除滚动锁（不处理则无法下拉）
      dismissModals();
      unlockScroll();
      await wait(300);
      // 1) 直接在当前 DOM 里找（不做回顶/scrollIntoView——那会触发 X 虚拟滚动重渲染，卸载目标评论）
      let art = null;
      try {
        art = findTweetByName(name);
      } catch (e) {}
      if (art) {
        return await blockVisibleTweet(art, name);
      }
      // 2) 找不到才滚动加载更多再找（真实滚动位置增长判断，不能看 body.scrollHeight）
      let noGrowCount = 0;
      let lastY = currentScrollY();
      for (let i = 0; i < 80; i++) {
        scrollToLastTweet();
        await wait(600);
        clickShowMore();
        await wait(250);
        art = findTweetByName(name);
        if (art) return blockVisibleTweet(art, name);
        const y = currentScrollY();
        if (y <= lastY) {
          noGrowCount++;
          if (noGrowCount === 1) {
            unlockScroll();
            await wait(200);
            scrollToLastTweet();
            await wait(400);
            const y2 = currentScrollY();
            if (y2 > y) { noGrowCount = 0; lastY = y2; }
          }
          if (noGrowCount >= 3) break;
        } else {
          noGrowCount = 0;
          lastY = y;
        }
      }
      return { ok: false, reason: 'not_found' };
    } catch (e) {
      const err = String((e && (e.message || e)) || e);
      try { console.error('[xbk] locateAndBlock 异常 @' + name, e); } catch (ee) {}
      return { ok: false, reason: 'exception', err };
    }
  }

  async function blockVisibleTweet(art, name) {
    try {
      // 关键：不读 isConnected（油猴 sandbox 下跨 realm 读取会误报），
      // 也不 scrollIntoView（会触发 X 虚拟滚动重渲染、使节点真正失效）。
      // 策略：直接用传入节点点 ⋯；若菜单没弹出，重新 findTweetByName 再点，最多 3 轮。
      let cur = art;
      let opened = false;
      for (let round = 0; round < 3 && !opened; round++) {
        if (!cur) cur = findTweetByName(name);
        if (!cur) { await wait(500); cur = findTweetByName(name); continue; }
        // 找 ⋯ 按钮：多级兜底（X 改版后 testid/aria-label 可能变化）
        let caret = null;
        try {
          caret = $('[data-testid="caret"]', cur)
            || $('[data-testid="iconButton"]', cur)
            || $('button[aria-haspopup="menu"]', cur)
            || $('button[aria-label*="更多"]', cur)
            || $('button[aria-label*="More"]', cur);
        } catch (e) {}
        if (!caret) {
          cur = findTweetByName(name);
          await wait(500);
          continue;
        }
        try { caret.click(); } catch (e) {}
        await wait(300);
        // 匹配屏蔽项：先用标准 menuitem，再兜底放宽（X 改版可能用其他结构）
        let item = $$('div[role="menuitem"]').find(m => /(block|屏蔽|拉黑)/i.test(m.innerText || m.textContent || ''));
        if (!item) {
          item = $$('div[role="menuitem"], div[role="menu"] div, span[role="menuitem"], [role="menu"] button').find(m => {
            const t = (m.innerText || m.textContent || '').trim();
            return t && t.length < 60 && /(block|屏蔽|拉黑)/i.test(t);
          });
        }
        if (item) {
          try { item.click(); } catch (e) {}
          opened = true;
          break;
        }
        // 菜单没弹出：关掉残留，重新查找节点再试
        document.body.click();
        await wait(300);
        cur = findTweetByName(name);
      }
      if (!opened) { document.body.click(); return { ok: false, reason: 'no_block_item' }; }
      // 等待确认对话框出现，并自动点击「屏蔽/Block」确认按钮
      const btn = await waitForConfirmBtn(3000);
      if (!btn) { document.body.click(); return { ok: false, reason: 'no_confirm' }; }
      // 短暂停顿 500ms，让用户能看到屏蔽确认弹窗再消失
      await wait(500);
      try { btn.click(); } catch (e) {
        const err = String((e && (e.message || e)) || e);
        return { ok: false, reason: 'exception', err };
      }
      await wait(500);
      dismissModals(); // 关闭可能残留的弹层
      unlockScroll();  // 清除 X 残留的 overflow:hidden 滚动锁，避免影响下一个用户
      return { ok: true };
    } catch (e) {
      const err = String((e && (e.message || e)) || e);
      try { console.error('[xbk] blockVisibleTweet 异常 @' + name, e); } catch (ee) {}
      return { ok: false, reason: 'exception', err };
    }
  }

  async function blockViaUI(name) {
    try {
      return await locateAndBlock(name);
    } catch (e) {
      const err = String((e && (e.message || e)) || e);
      try { console.error('[xbk] blockViaUI 异常 @' + name, e); } catch (ee) {}
      return { ok: false, reason: 'exception', err };
    }
  }

  // 轮询等待 X 的屏蔽确认框，返回确认按钮（多种对话框/按钮选择器兜底）
  async function waitForConfirmBtn(timeoutMs) {
    const start = Date.now();
    const matchText = (b) => {
      const txt = ((b && (b.textContent || b.innerText)) || '').trim();
      return /^(block|屏蔽|拉黑)\s*$/i.test(txt);
    };
    while (Date.now() - start < timeoutMs) {
      const dialog = $('div[role="dialog"]')
                   || $('[role="alertdialog"]')
                   || $('[data-testid="sheetDialog"]')
                   || $('[data-testid="confirmationSheet"]');
      // 优先：X 官方确认按钮 data-testid
      if (dialog) {
        const btn = $('[data-testid="confirmationSheetConfirm"]', dialog);
        if (btn) return btn;
        // 兜底 1：对话框内按钮文案匹配（兼容各种本地化）
        const txtBtn = $$('button', dialog).find(matchText);
        if (txtBtn) return txtBtn;
      }
      // 兜底 2：页面任意位置匹配文案（对话框结构变化时的最后保险）
      const anyBtn = $$('button').find(matchText);
      if (anyBtn) return anyBtn;
      await wait(300);
    }
    return null;
  }

  async function blockOne(name) {
    // 仅使用模拟点击（不调用任何接口，最稳、不受接口变更影响；确认框自动点掉）
    const r = await blockViaUI(name);
    if (r.ok) return { ok: true };
    const reasonText = {
      not_found: '未找到该用户评论',
      no_menu: '未找到菜单按钮',
      no_block_item: '未找到屏蔽选项',
      no_confirm: '确认框未出现',
      exception: '操作异常'
    }[r.reason] || '拉黑失败';
    return { ok: false, msg: reasonText };
  }

  // ==================== 批量拉黑（评论区原地拉黑） ====================
  // 思路：回到"评论区下拉定位 + 原地屏蔽"方案（已验证可行）。
  // 对每个目标用户：先在评论区滚动定位（scrollIntoView 驱动），找到后点 ⋯ → 屏蔽 → 自动确认。
  // 若评论区确实找不到（账号异常/已注销），记录失败并继续下一个。
  async function startBlocking(names) {
    stopping = false;
    // 按评论流中的位置排序，让滚动单向推进
    const ordered = names.slice().sort((a, b) => {
      const ca = candidates.find(c => c.name === a);
      const cb = candidates.find(c => c.name === b);
      return (ca ? ca.order : 0) - (cb ? cb.order : 0);
    });
    // 先滚动到帖子最顶部（无论用户当前在页面哪个位置），确保拉黑从顶部开始、位置可靠
    scrollToTopOfThread();
    await wait(600);
    // 与扫描相同的"展开 + 滚动加载"：先把评论区完整加载一遍。
    setProg(0, ordered.length, '正在加载评论…');
    await expandComments(20, 6);
    let ok = 0, fail = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (stopping) { log('已手动停止'); break; }
      const name = ordered[i];
      if (blocked[name]) { log('跳过已拉黑 @' + name); continue; }
      setProg(i + 1, ordered.length, '正在拉黑 @' + name);
      const r = await blockOne(name);
      if (r.ok) { blocked[name] = Date.now(); saveBlocked(); ok++; log('✓ 已拉黑 @' + name); }
      else { fail++; log('✗ @' + name + '：' + (r.msg || '拉黑失败')); }
      // 内置随机间隔防风控（2.5s ~ 4s）
      if (i < ordered.length - 1) await wait(2500 + Math.floor(Math.random() * 1500));
    }
    setProg(ordered.length, ordered.length, ok + ' 成功 / ' + fail + ' 失败');
    log('本次完成：成功 ' + ok + '，失败 ' + fail + '。可在 x.com/settings/blocked 查看');
    renderCandidates();
    // 完成提示 toast（1.5 秒后自动消失）
    if (fail) showToast('拉黑完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个', 'warn');
    else showToast('拉黑完成：成功 ' + ok + ' 个账号', 'success');
  }

  // ==================== UI 元素 ====================
  let elLauncher, elPanel, elBody, elList, elLog, elBar, elProg, elScanBtn;

  function buildUI() {
    const dark = (getComputedStyle(document.documentElement).colorScheme || '').includes('dark');
    const c = dark
      ? { bg: '#15202b', fg: '#e7e9ea', sub: '#8b98a5', border: '#38444d', soft: '#1e2a38', mark: '#f5c400', markBg: '#3a2e00', btnBg: '#253341' }
      : { bg: '#ffffff', fg: '#0f1419', sub: '#536471', border: '#cfd9de', soft: '#f7f9fa', mark: '#f5c400', markBg: '#fff7d6', btnBg: '#eff3f4' };

    const style = document.createElement('style');
    style.textContent = `
      #xbk-launcher{position:fixed;right:0;top:36%;z-index:2147483000;background:#1d9bf0;color:#fff;border:0;border-radius:12px 0 0 12px;padding:12px 7px;cursor:pointer;font:600 13px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;writing-mode:vertical-rl;letter-spacing:2px;box-shadow:-2px 2px 10px rgba(0,0,0,.18);transition:opacity .2s}
      #xbk-launcher:hover{background:#1a8cd8}
      #xbk-panel{position:fixed;top:0;right:0;height:100vh;width:430px;max-width:94vw;background:${c.bg};color:${c.fg};border-left:1px solid ${c.border};box-shadow:-8px 0 28px rgba(0,0,0,.22);z-index:2147483000;display:flex;flex-direction:column;transform:translateX(102%);transition:transform .25s ease;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
      #xbk-panel.open{transform:translateX(0)}
      #xbk-panel *{box-sizing:border-box}
      #xbk-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:${c.soft};border-bottom:1px solid ${c.border};font-weight:700;font-size:14px;position:sticky;top:0;z-index:2}
      #xbk-head button{margin-left:auto;border:0;background:transparent;color:${c.sub};font-size:18px;cursor:pointer;padding:0 4px}
      #xbk-body{padding:12px 14px;overflow-y:auto;flex:1}
      .xbk-sec{margin-bottom:12px}
      .xbk-sec-title{font-weight:700;font-size:13px;margin-bottom:6px;color:${c.fg}}
      .xbk-btn{padding:6px 12px;border:1px solid ${c.border};border-radius:8px;background:${c.btnBg};color:${c.fg};cursor:pointer;font-size:12px}
      .xbk-btn:hover{filter:brightness(.95)}
      .xbk-btn.primary{background:#1d9bf0;border-color:#1d9bf0;color:#fff;font-weight:600}
      .xbk-btn.primary:hover{background:#1a8cd8}
      /* 扫描按钮与一键拉黑按钮同尺寸（全宽、等高、文字居中） */
      .xbk-btn.xbk-big{width:100%;padding:9px 12px;font-size:14px;font-weight:700;text-align:center}
      .xbk-btn.danger{background:#f4212e;border-color:#f4212e;color:#fff;font-weight:700;font-size:14px;padding:9px 12px;width:100%;text-align:center}
      .xbk-btn:disabled{opacity:.45;cursor:not-allowed}
      .xbk-inline{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
      .xbk-inline input[type=number]{width:62px;padding:4px 6px;border:1px solid ${c.border};border-radius:6px;background:${c.bg};color:${c.fg};font-size:12px}
      .xbk-inline input[type=text]{flex:1;min-width:120px;padding:5px 8px;border:1px solid ${c.border};border-radius:6px;background:${c.bg};color:${c.fg};font-size:12px}
      .xbk-inline select{padding:4px 6px;border:1px solid ${c.border};border-radius:6px;background:${c.bg};color:${c.fg};font-size:12px}
      .xbk-cat{font-size:11px;color:${c.sub};font-weight:600;margin:8px 0 3px}
      .xbk-chips{display:flex;flex-wrap:wrap;gap:4px}
      .xbk-chip{display:inline-flex;align-items:center;gap:3px;background:${c.soft};border:1px solid ${c.border};border-radius:12px;padding:1px 8px;font-size:12px;color:${c.fg}}
      .xbk-chip .del{cursor:pointer;color:${c.sub};font-weight:700;padding:0 2px;font-size:13px}
      .xbk-chip .del:hover{color:#f4212e}
      .xbk-addbar{display:flex;gap:6px;margin-top:6px}
      details.xbk-details{border:1px solid ${c.border};border-radius:10px;padding:8px 10px}
      summary{cursor:pointer;font-weight:600;font-size:13px}
      #xbk-list{max-height:44vh;overflow-y:auto;border:1px solid ${c.border};border-radius:10px;padding:6px 8px;background:${c.soft}}
      .xbk-item{border-bottom:1px solid ${c.border};padding:7px 2px}
      .xbk-item:last-child{border-bottom:0}
      .xbk-item .head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      .xbk-item .name{font-weight:700;color:#1d9bf0}
      .xbk-tag{font-size:11px;color:${c.sub};background:${c.btnBg};border-radius:10px;padding:0 7px}
      .xbk-tag.author{color:#b45309;background:rgba(245,196,0,.18)}
      .xbk-tag.namehit{color:#7c3aed;background:rgba(124,58,237,.12)}
      .xbk-tag.blocked{color:#16a34a;background:rgba(22,163,74,.14)}
      .xbk-cmt{margin:3px 0 3px 24px;font-size:12px;color:${c.fg};background:${c.bg};border-left:2px solid ${c.border};padding:3px 8px;border-radius:0 6px 6px 0;word-break:break-all}
      .xbk-cmt mark{background:${c.mark};color:#111;border-radius:3px;padding:0 2px}
      #xbk-empty{color:${c.sub};text-align:center;padding:16px 6px}
      .xbk-prog{height:8px;background:${c.btnBg};border-radius:5px;overflow:hidden;margin:8px 0 4px}
      .xbk-prog i{display:block;height:100%;width:0;background:#1d9bf0;transition:width .3s}
      #xbk-progTxt{font-size:11px;color:${c.sub};margin-bottom:4px}
      #xbk-log{max-height:120px;overflow-y:auto;background:#0f1419;color:#cfe3f0;border-radius:8px;padding:6px 8px;font:11px/1.5 Menlo,Consolas,monospace;margin-top:6px}
      #xbk-log div{white-space:pre-wrap;word-break:break-all}
      .xbk-note{font-size:11px;color:${c.sub};margin-top:8px}
    `;
    document.head.appendChild(style);

    // 右侧启动按钮
    elLauncher = document.createElement('button');
    elLauncher.id = 'xbk-launcher';
    elLauncher.textContent = '批量拉黑';
    elLauncher.title = '打开/收起 评论拉黑助手';
    document.body.appendChild(elLauncher);

    // 右侧面板
    elPanel = document.createElement('div');
    elPanel.id = 'xbk-panel';
    elPanel.innerHTML = `
      <div id="xbk-head">🛡 评论拉黑助手 <span style="font-weight:400;color:${c.sub};font-size:11px">v${VERSION}</span>
        <button id="xbk-close" title="收起">×</button>
      </div>
      <div id="xbk-body">
        <details class="xbk-details xbk-sec" id="xbk-wordBox">
          <summary>① 触发词语列表（评论内容 / 用户名 / 显示名 包含即命中）</summary>
          <div id="xbk-wordList"></div>
          <div class="xbk-addbar">
            <input type="text" id="xbk-wordInput" placeholder="输入词语，多个用逗号/空格/换行分隔">
            <select id="xbk-wordCat">${CATS.map(c => '<option' + (c === '骚扰/引战' ? ' selected' : '') + '>' + c + '</option>').join('')}</select>
            <button class="xbk-btn primary" id="xbk-wordAdd">添加</button>
          </div>
          <div class="xbk-inline" style="margin-top:6px">
            <button class="xbk-btn" id="xbk-wordReset" style="font-size:11px">重置为默认列表</button>
            <span style="font-size:11px;color:${c.sub}">点词语上的 × 可删除</span>
          </div>
        </details>

        <div class="xbk-sec">
          <div class="xbk-sec-title">③ 命中账号 <span id="xbk-countInfo" style="color:${c.sub};font-weight:400"></span></div>
          <div id="xbk-list"><div id="xbk-empty">点击「② 扫描评论和昵称」后，这里会列出命中词语的账号及其评论内容。</div></div>
          <div class="xbk-inline" style="margin-top:6px">
            <button class="xbk-btn" id="xbk-all">全选</button>
            <button class="xbk-btn" id="xbk-none">全不选</button>
            <button class="xbk-btn" id="xbk-copy">复制名单</button>
            <span style="font-size:11px;color:${c.sub}">取消勾选可避免误拉黑</span>
          </div>
        </div>

        <button class="xbk-btn primary xbk-big" id="xbk-scan" style="margin-bottom:5px">② 扫描评论和昵称</button>
        <button class="xbk-btn danger" id="xbk-go" disabled>一键拉黑选中 (<span id="xbk-count">0</span>)</button>
        <button class="xbk-btn" id="xbk-stop" style="width:100%;margin-top:5px;display:none">停止</button>
        <div class="xbk-prog"><i id="xbk-bar"></i></div>
        <div id="xbk-progTxt">就绪</div>
        <div id="xbk-log"></div>
        <div class="xbk-note">提示：默认勾选所有命中账号，请先查看评论内容再拉黑；建议每天 ≤200 个，脚本已内置随机间隔防风控。已拉黑记录存于浏览器本地，可「重置记录」。</div>
        <div class="xbk-inline" style="margin-top:4px">
          <button class="xbk-btn" id="xbk-resetRec" style="font-size:11px">重置已拉黑记录</button>
        </div>
      </div>
    `;
    document.body.appendChild(elPanel);

    elBody = $('#xbk-body');
    elList = $('#xbk-list');
    elLog = $('#xbk-log');
    elBar = $('#xbk-bar');
    elProg = $('#xbk-progTxt');
    elScanBtn = $('#xbk-scan');

    // 事件
    elLauncher.addEventListener('click', () => {
      const open = elPanel.classList.toggle('open');
      elLauncher.textContent = open ? '收起' : '批量拉黑';
    });
    $('#xbk-close').addEventListener('click', () => {
      elPanel.classList.remove('open');
      elLauncher.textContent = '批量拉黑';
    });
    elScanBtn.addEventListener('click', scanAll);
    $('#xbk-all').addEventListener('click', () => { candidates.forEach(c => c.checked = true); renderCandidates(); });
    $('#xbk-none').addEventListener('click', () => { candidates.forEach(c => c.checked = false); renderCandidates(); });
    $('#xbk-copy').addEventListener('click', async () => {
      const list = candidates.filter(c => c.checked && !blocked[c.name]).map(c => '@' + c.name).join('\n');
      if (!list) { alert('没有勾选任何账号'); return; }
      try { await navigator.clipboard.writeText(list); log('已复制 ' + candidates.filter(c => c.checked && !blocked[c.name]).length + ' 个用户名'); }
      catch (e) { alert('复制失败，请手动复制'); }
    });
    $('#xbk-go').addEventListener('click', () => {
      const names = candidates.filter(c => c.checked && !blocked[c.name]).map(c => c.name);
      if (!names.length) { alert('没有勾选任何账号'); return; }
      // 不弹确认框，直接开始（像真人点屏蔽一样，直接进入 X 的确认框）
      log('开始拉黑 ' + names.length + ' 个账号…');
      $('#xbk-go').disabled = true;
      $('#xbk-stop').style.display = '';
      startBlocking(names).finally(() => { updateGoDisabled(); $('#xbk-stop').style.display = 'none'; });
    });
    $('#xbk-stop').addEventListener('click', () => { stopping = true; log('正在停止…（当前账号处理完即停）'); });
    $('#xbk-resetRec').addEventListener('click', () => {
      if (confirm('清空本地已拉黑记录？不会解除任何已拉黑操作。')) { blocked = {}; saveBlocked(); renderCandidates(); log('已拉黑记录已清空'); }
    });
    $('#xbk-wordAdd').addEventListener('click', addWords);
    $('#xbk-wordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWords(); });
    $('#xbk-wordReset').addEventListener('click', () => {
      if (confirm('恢复为默认词语列表？当前自定义列表将被覆盖。')) { words = clone(DEFAULT_WORDS); saveWords(); renderWords(); log('已恢复默认词语列表'); }
    });

    renderWords();
    log('就绪。x.com 所有页面右侧都有「批量拉黑」按钮，打开帖子详情页后点击按钮 → 再点「扫描评论和昵称」即可。');
  }

  // ==================== 词语列表渲染 ====================
  function renderWords() {
    const box = $('#xbk-wordList');
    box.innerHTML = '';
    CATS.forEach(cat => {
      const catEl = document.createElement('div');
      catEl.className = 'xbk-cat';
      catEl.textContent = cat;
      box.appendChild(catEl);
      const chips = document.createElement('div');
      chips.className = 'xbk-chips';
      (words[cat] || []).forEach(w => {
        const chip = document.createElement('span');
        chip.className = 'xbk-chip';
        chip.innerHTML = esc(w) + '<span class="del" data-cat="' + esc(cat) + '" data-w="' + esc(w) + '">×</span>';
        chips.appendChild(chip);
      });
      if (!(words[cat] || []).length) {
        const empty = document.createElement('span');
        empty.style.cssText = 'font-size:11px;color:#8b98a5';
        empty.textContent = '（空）';
        chips.appendChild(empty);
      }
      box.appendChild(chips);
    });
    // 删除事件（委托）
    $$('#xbk-wordList .del').forEach(d => d.addEventListener('click', () => {
      const cat = d.dataset.cat;
      const w = d.dataset.w;
      words[cat] = (words[cat] || []).filter(x => x !== w);
      saveWords();
      renderWords();
      log('已删除词语：' + w);
    }));
  }

  function addWords() {
    const input = $('#xbk-wordInput');
    const cat = $('#xbk-wordCat').value;
    const raw = input.value.split(/[,，、\s\n]+/).map(s => s.trim()).filter(Boolean);
    if (!raw.length) return;
    let added = 0;
    words[cat] = words[cat] || [];
    raw.forEach(w => { if (!words[cat].includes(w)) { words[cat].push(w); added++; } });
    saveWords();
    renderWords();
    input.value = '';
    log('已添加 ' + added + ' 个词语到「' + cat + '」' + (raw.length - added ? '（' + (raw.length - added) + ' 个已存在）' : ''));
  }

  // ==================== 结果列表渲染 ====================
  function renderCandidates() {
    elList.innerHTML = '';
    $('#xbk-countInfo').textContent = candidates.length ? '（共 ' + candidates.length + ' 个）' : '';
    if (!candidates.length) {
      elList.innerHTML = '<div id="xbk-empty">' + (isStatusPage() ? '暂无命中账号。请先点击「② 扫描评论和昵称」。' : '请在帖子详情页使用：打开任意一条帖子（网址含 /status/）后再扫描。') + '</div>';
    }
    candidates.forEach(c => {
      const item = document.createElement('div');
      item.className = 'xbk-item';
      const wordsHit = uniqWords(c.matched.flatMap(m => m.hits));
      const tags = [
        c.isAuthor ? '<span class="xbk-tag author">帖子作者</span>' : '',
        '<span class="xbk-tag">评论命中' + c.matched.length + '条/共' + c.total + '条</span>',
        c.nameHits.length ? '<span class="xbk-tag namehit">名称含关键词</span>' : '',
        blocked[c.name] ? '<span class="xbk-tag blocked">已拉黑</span>' : ''
      ].join(' ');
      // 名称命中预览：显示名/句柄 + 命中词高亮
      const nameHitHtml = c.nameHits.length
        ? '<div class="xbk-cmt xbk-namehit">【名称命中】' + highlight('@' + c.name + (c.displayName ? ' · ' + c.displayName : ''), uniqWords(c.nameHits)) + '</div>'
        : '';
      item.innerHTML =
        '<div class="head">' +
        '<input type="checkbox"' + ((c.checked && !blocked[c.name]) ? ' checked' : '') + (blocked[c.name] ? ' disabled' : '') + '>' +
        '<span class="name">@' + esc(c.name) + '</span> ' + tags +
        '</div>' +
        nameHitHtml +
        c.matched.map(m => '<div class="xbk-cmt">' + highlight(m.text, uniqWords(m.hits)) + '</div>').join('');
      const cb = item.querySelector('input');
      if (!blocked[c.name]) cb.addEventListener('change', () => { c.checked = cb.checked; updateCount(); });
      elList.appendChild(item);
    });
    updateCount();
  }

  function highlight(text, wlist) {
    if (!wlist.length) return esc(text);
    const sorted = wlist.slice().sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('(' + sorted.join('|') + ')', 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    out += esc(text.slice(last));
    return out;
  }

  function updateCount() {
    const n = candidates.filter(c => c.checked && !blocked[c.name]).length;
    $('#xbk-count').textContent = n;
    updateGoDisabled();
  }

  // 选中 0 个时禁用「一键拉黑」按钮
  function updateGoDisabled() {
    const go = $('#xbk-go');
    if (go) go.disabled = candidates.filter(c => c.checked && !blocked[c.name]).length === 0;
  }

  function setProg(cur, total, text) {
    elBar.style.width = (total ? Math.round(cur / total * 100) : 0) + '%';
    elProg.textContent = text + (total ? '（' + cur + '/' + total + '）' : '');
  }

  function log(msg) {
    const d = document.createElement('div');
    d.textContent = '[' + new Date().toTimeString().slice(0, 8) + '] ' + msg;
    elLog.appendChild(d);
    elLog.scrollTop = elLog.scrollHeight;
  }

  // 漂亮的完成提示（顶部居中，1.5 秒后自动淡出消失）
  function showToast(msg, type) {
    let t = document.getElementById('xbk-toast');
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'xbk-toast';
    const color = type === 'warn' ? '#d97706' : '#16a34a';
    const icon = type === 'warn' ? '!' : '✓';
    t.style.cssText = 'position:fixed;top:26px;left:50%;transform:translate(-50%,-14px);z-index:2147483600;' +
      'display:flex;align-items:center;gap:10px;padding:12px 22px 12px 14px;border-radius:14px;' +
      'background:' + color + ';color:#fff;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
      'box-shadow:0 10px 28px rgba(0,0,0,.28);opacity:0;transition:opacity .25s ease,transform .25s ease;';
    const iconEl = document.createElement('span');
    iconEl.textContent = icon;
    iconEl.style.cssText = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.28);font-size:14px;font-weight:700;';
    const textEl = document.createElement('span');
    textEl.textContent = msg;
    t.appendChild(iconEl);
    t.appendChild(textEl);
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translate(-50%,0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translate(-50%,-14px)';
      setTimeout(() => { if (t.parentNode) t.remove(); }, 320);
    }, 1500);
  }

  // ==================== 启动（所有常量/函数已定义完毕再调用） ====================
  tryInit();
  setInterval(tryInit, 1500);
})();
