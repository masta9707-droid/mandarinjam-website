/* MJ-WEB-W8 R2-FLOAT-TRANSPARENT-CONTINUOUS — logo seal đã tách nền, hiển thị liên tục.
 * Zero dependency. Home('/') & /shop only. Continuous — KHÔNG tự ẩn khi scroll/ảnh/card/footer.
 * Chỉ hide/pause khi: user Ẩn, tab hidden, menu/search/filter/dialog thật mở, đang nhập input,
 *   reduced-motion, rời home/shop. Resume 300-500ms khi đủ điều kiện (trừ user Ẩn / reduce).
 * Harness global: window.__mjFloat (đo thật, không hardcode). 
 * Asset: /assets/logo/mandarin-jam-seal.png (RGBA 2048x2048, alpha bbox measured read-only).
 */
(function () {
  'use strict';
  if (!('requestAnimationFrame' in window)) return;
  var reduceMq = matchMedia('(prefers-reduced-motion: reduce)');

  var NS = 'mj:logoFloat:hidden';
  var userHidden = false;
  try { userHidden = sessionStorage.getItem(NS) === '1'; } catch (e) { userHidden = false; }

  // ---------- asset & alpha bbox (SHOP-R2 R2-05: v3 — nền+lỗ chữ+white matte đã xoá, mặt giữ) ----------
  var NAT = 1563;                       // canvas natural (owner-logo-white 1563x1563)
  var BBOX = { l: 224, t: 363, w: 1115, h: 779 };  // alpha bbox CỦA v4 (mask không gian giữ mặt, đo PIL, exclusive right/bottom)
  var IMG = '/assets/logo/owner-logo-transparent-v4.png';
  var ASP = BBOX.h / BBOX.w;            // 779/1114

  // ---------- DOM: wrapper artW x artH = bề rộng/giữa artwork, không lề alpha ----------
  var artW, artH;
  function sizeBox() { artW = window.innerWidth < 1024 ? 40 : 56; artH = artW * ASP; }
  sizeBox();

  var layer = document.createElement('div');
  layer.className = 'mj-float-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.display = 'none';
  var art = document.createElement('img');
  art.className = 'mj-float-logo';
  art.src = IMG;
  art.alt = '';
  art.setAttribute('aria-hidden', 'true');
  art.setAttribute('draggable', 'false');
  art.style.position = 'absolute';
  // layer = artW x artH (bề rộng/giữa artwork); img = toàn canvas scale theo artwork, crop alpha padding
  function applyArtSize() {
    var s = artW / BBOX.w;              // scale: artwork width -> artW (56/40)
    var px = Math.round(NAT * s);       // toàn canvas 2048 * s
    layer.style.width = artW + 'px';
    layer.style.height = artH + 'px';
    art.style.width = px + 'px';
    art.style.height = 'auto';
    art.style.left = -Math.round(BBOX.l * s) + 'px';  // đưa bbox top-left về (0,0) của layer
    art.style.top = -Math.round(BBOX.t * s) + 'px';
  }
  applyArtSize();
  layer.appendChild(art);

  var ctrl = document.createElement('button');
  ctrl.type = 'button';
  ctrl.className = 'mj-float-ctrl';
  ctrl.style.display = 'none';
  // SHOP-R1 4.6: control nhỏ trung tính — hit-area 44px, icon pause/play 16px + accessible label
  ctrl.setAttribute('aria-live', 'polite');
  var ctrlIcon = document.createElement('span');
  ctrlIcon.setAttribute('aria-hidden', 'true');
  ctrlIcon.className = 'mj-float-ctrl-icon';
  ctrl.appendChild(ctrlIcon);
  document.body.appendChild(layer);
  document.body.appendChild(ctrl);

  // ---------- i18n ----------
  function lang() {
    var m = /[?&]lang=(vi|en|zh|ko)/.exec(location.search);
    return (m && m[1]) || (document.documentElement.lang || 'vi');
  }
  var L = {
    vi: { show: 'Bật logo bay', hide: 'Dừng logo bay' },
    en: { show: 'Show floating logo', hide: 'Pause floating logo' },
    zh: { show: '显示浮动标志', hide: '暂停浮动标志' },
    ko: { show: '움직이는 로고 보기', hide: '움직이는 로고 일시정지' }
  };
  function lc(l) { return L[l] || L.vi; }
  // pause icon (hai vạch) / play icon (tam giác), 16px
  var ICON_PAUSE = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3.4" y="3" width="3.4" height="10" rx="0.6"/><rect x="9.2" y="3" width="3.4" height="10" rx="0.6"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5 3.2v9.6c0 .7.8 1.1 1.4.7l7-4.8a.9.9 0 0 0 0-1.4l-7-4.8A.85.85 0 0 0 5 3.2Z"/></svg>';
  function setCtrl() {
    var t = userHidden ? lc(lang()).show : lc(lang()).hide;
    ctrl.setAttribute('aria-label', t);
    ctrl.setAttribute('title', t);
    ctrlIcon.innerHTML = userHidden ? ICON_PLAY : ICON_PAUSE;
  }

  // ---------- viewport / bounds ----------
  var VIEW = { L: 12, R: 12, B: 16, H: 8 };
  var speed = (window.innerWidth < 1024) ? 22 : 32;
  function bounds() {
    var vv = window.visualViewport;
    var w = vv && vv.width ? vv.width : window.innerWidth;
    var hh = vv && vv.height ? vv.height : window.innerHeight;
    var top = VIEW.H;
    var bottom = hh - VIEW.B;
    return { left: VIEW.L, top: top, right: w - VIEW.R, bottom: bottom, w: w, h: hh };
  }

  // ---------- state ----------
  var x = 0, y = 0, vx = 0, vy = 0;
  var running = false;
  var raf = null;
  var lastT = null;
  var startedFly = false;      // đã bay ít nhất 1 lần (giữ quỹ đạo khi resume, không random lại)
  var pauseReason = null;      // null | 'route' | 'tab' | 'overlay' | 'focus' | 'reduce'
  var idleTimer = null;
  var created = Date.now();

  // ---------- telemetry thời gian THẬT ----------
  var tel = {
    startMs: Date.now(),
    eligibleMs: 0, visibleMs: 0,
    maxAutoHiddenMs: 0, curAutoHiddenMs: 0,
    autoHiddenMs: 0,
    reasons: {},
    samples: 0
  };
  var errors = 0;              // đếm thật qua window.onerror
  var errorLog = [];
  window.addEventListener('error', function (e) { errors++; if (errorLog.length < 20) errorLog.push(String(e.message).slice(0, 80)); });
  window.addEventListener('unhandledrejection', function (e) { errors++; if (errorLog.length < 20) errorLog.push('unhandledrejection'); });

  // ---------- visibility / pause state ----------
  var overlaySelQuery = 'dialog[open], #searchPanel:not([hidden]), #mobileDrawer:not([hidden]), .search-panel:not([hidden]), .filter-panel:not([hidden]), #langMenu.open, .lang-menu.open';

  function activeEl() { var a = document.activeElement; if (!a) return false; var tn = a.tagName; return tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || a.isContentEditable; }

  // reason hiện tại (không count visible-> 'null' khi nên hiển thị liên tục)
  function currentReason() {
    var p = location.pathname;
    if (p !== '/' && p !== '/shop') return 'route';
    if (document.hidden) return 'tab';
    var ov = document.querySelector(overlaySelQuery);
    if (ov) return 'overlay';
    if (activeEl()) return 'focus';
    if (reduceMq.matches) return 'reduce';
    return null;
  }

  // thống kê thời gian hợp lệ/ẩn (gọi mỗi RAF ~60fps, cộng dt)
  function sampleHidden(dtS, hiddenNow, reason) {
    tel.eligibleMs += dtS * 1000;
    if (hiddenNow) {
      tel.autoHiddenMs += dtS * 1000;
      tel.curAutoHiddenMs += dtS * 1000;
      if (reason) tel.reasons[reason] = (tel.reasons[reason] || 0) + dtS * 1000;
    } else {
      tel.visibleMs += dtS * 1000;
      if (tel.curAutoHiddenMs > tel.maxAutoHiddenMs) tel.maxAutoHiddenMs = tel.curAutoHiddenMs;
      tel.curAutoHiddenMs = 0;
    }
  }

  // ---------- movement ----------
  var bounceCount = 0;
  function step(dt) {
    var b = bounds();
    var rightMin = b.right - artW, bottomMin = b.bottom - artH;
    if (b.left > rightMin || b.top > bottomMin) return false;
    x += vx * dt; y += vy * dt;
    var hit = false;
    if (x < b.left) { x = b.left; vx = Math.abs(vx); hit = true; }
    else if (x > rightMin) { x = rightMin; vx = -Math.abs(vx); hit = true; }
    if (y < b.top) { y = b.top; vy = Math.abs(vy); hit = true; }
    else if (y > bottomMin) { y = bottomMin; vy = -Math.abs(vy); hit = true; }
    if (hit) {
      bounceCount++;
      var a = Math.atan2(vy, vx) + (Math.random() * 0.28 - 0.14);
      var sp = Math.sqrt(vx * vx + vy * vy);
      vx = Math.cos(a) * sp; vy = Math.sin(a) * sp;
    }
    return true;
  }

  var firstStart = true;
  var rafCount = 0;   // tổng RAF tick thực thi (bằng chứng vòng lặp thật)
  function startFly() {
    var b = bounds();
    if (firstStart) {
      var bw = Math.max(b.right - b.left - artW, 0);
      var bh = Math.max(b.bottom - b.top - artH, 0);
      if (bw <= 0 || bh <= 0) return false;
      x = b.left + Math.random() * bw; y = b.top + Math.random() * bh;
      var a;
      for (;;) { a = Math.random() * Math.PI * 2; var dx = Math.cos(a), dy = Math.sin(a); if (Math.abs(dx) > 0.25 && Math.abs(dy) > 0.25 && Math.abs(dx) < 0.985 && Math.abs(dy) < 0.985) break; }
      vx = Math.cos(a) * speed; vy = Math.sin(a) * speed;
      firstStart = false;
      startedFly = true;
    } else {
      // resume: giữ quỹ đạo, chỉ clamp vào bounds mới
      if (x < b.left) x = b.left; if (x > b.right - artW) x = b.right - artW;
      if (y < b.top) y = b.top; if (y > b.bottom - artH) y = b.bottom - artH;
    }
    running = true; lastT = null;
    showLayer();
    if (!raf) raf = requestAnimationFrame(tick);
    return true;
  }
  function showLayer() { layer.style.display = 'block'; layer.style.opacity = '1'; }

  function tick(now) {
    raf = null;
    rafCount++;
    if (!running) { layer.style.display = 'none'; return; }
    if (lastT == null) lastT = now;
    var dt = Math.min((now - lastT) / 1000, 0.032);
    lastT = now;
    var eff = effectiveReason();         // userHidden / pauseReason
    var hiddenNow = (eff !== null);
    sampleHidden(dt, hiddenNow, eff);
    if (!hiddenNow) {
      var ok = step(dt);
      if (ok) layer.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    } else {
      layer.style.opacity = '0';
    }
    raf = requestAnimationFrame(tick);
  }

  // reason hiệu dụng = pauseReason (tự động) hay userHidden
  function effectiveReason() { if (userHidden) return 'user'; return pauseReason; }

  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = null; } running = false; lastT = null; }

  // ---------- reconcile: 1 đường start/stop, resume 350ms when clear ----------
  var resumeTimer = null;
  function reconcile() {
    var pr = currentReason();
    // nút control: vẫn hiện trên route phù hợp, nhãn Show khi userHidden
    var onRoute = (location.pathname === '/' || location.pathname === '/shop');
    ctrl.style.display = (onRoute && !reduceMq.matches) ? 'block' : 'none';
    if (pr === 'route') { ctrl.style.display = 'none'; }

    if (userHidden) {
      stopLoop(); layer.style.opacity = '0'; layer.style.display = 'none'; pauseReason = 'user';
      return;
    }
    if (pr) {
      // đang pause vì điều kiện -> dừng loop, nhớ reason
      pauseReason = pr;
      stopLoop(); layer.style.opacity = '0'; layer.style.display = 'none';
      return;
    }
    // đủ điều kiện -> resume trong 300-500ms (nếu chưa bay), không random lại
    pauseReason = null;
    if (!running) {
      clearTimeout(resumeTimer); resumeTimer = null;
      resumeTimer = setTimeout(function () { resumeTimer = null; if (!userHidden && !currentReason()) startFly(); }, 380);
    }
  }

  // ---------- sự kiện lifecycle (thay interval 300ms) ----------
  document.addEventListener('visibilitychange', function () { if (document.hidden) reconcile(); else { if (startedFly) reconcile(); else scheduleStart(); } });
  window.addEventListener('focus', reconcile);
  window.addEventListener('blur', reconcile);
  document.addEventListener('focusin', reconcile);
  document.addEventListener('focusout', reconcile);
  reduceMq.addEventListener('change', function () { if (reduceMq.matches) reconcile(); else { if (userHidden) { /* giữ */ } else scheduleStart(); } });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (running) { lastT = null; reconcile(); } });
  window.addEventListener('resize', function () { speed = (window.innerWidth < 1024) ? 22 : 32; sizeBox(); applyArtSize(); reconcile(); });

  // theo dõi panel/menu/dialog mở/đóng qua MutationObserver (đổi hidden/class/open) — thay interval
  var mo = new MutationObserver(function () { reconcile(); });
  mo.observe(document.body, { attributes: true, attributeFilter: ['hidden', 'class', 'open'], subtree: true, childList: false });

  // route SPA: app.js gọi showPage() đổi .hidden trên #page-* -> observer bắt; thêm popstate an toàn
  window.addEventListener('popstate', reconcile);

  // ---------- start sau asset decode, tối đa 1s ----------
  var startedOnce = false;
  function scheduleStart() { if (startedOnce) return; startedOnce = true; waitDecodeAndStart(); }
  function waitDecodeAndStart() {
    var done = false;
    function begin() { if (done || userHidden || reduceMq.matches) return; done = true; reconcile(); }
    // giới hạn 1s: dù asset decode chưa xong cũng bắt đầu (render khi sẵn)
    setTimeout(begin, 1000);
    if (art.complete && art.naturalWidth > 0) { begin(); }
    else { art.addEventListener('load', begin); art.addEventListener('error', begin); }
  }
  scheduleStart();

  // ---------- control (Ẩn/Bật) ----------
  ctrl.addEventListener('click', function () {
    if (userHidden) {
      // Show
      userHidden = false;
      try { sessionStorage.setItem(NS, '0'); } catch (e) {}
      setCtrl();
      // giữ nguyên: nếu đang pause vì lý do khác, reconcile lo; nếu ok thì resume
      var pr = currentReason();
      if (!pr && !running) { clearTimeout(resumeTimer); resumeTimer = setTimeout(function () { resumeTimer = null; if (!userHidden && !currentReason()) startFly(); }, 380); }
      if (pr) { pauseReason = pr; stopLoop(); }
    } else {
      // Hide
      userHidden = true;
      try { sessionStorage.setItem(NS, '1'); } catch (e) {}
      setCtrl();
      pauseReason = 'user'; stopLoop(); layer.style.opacity = '0'; layer.style.display = 'none';
    }
  });

  // ---------- expose harness global (đo thật, không hardcode) ----------
  window.__mjFloat = {
    get controllerCount() { return 1; },
    get rafCount() { return rafCount; },
    get artW() { return artW; }, get artH() { return artH; },
    get bbox() { return { l: BBOX.l, t: BBOX.t, w: BBOX.w, h: BBOX.h, nat: NAT }; },
    get running() { return running; },
    get hidden() { return userHidden; },
    get pauseReason() { return pauseReason; },
    get x() { return x; }, get y() { return y; },
    get speed() { return speed; },
    get bounceCount() { return bounceCount; },
    get telemetry() { return tel; },
    get errorCount() { return errors; },
    get errorLog() { return errorLog.slice(); },
    get assetSource() { return art.src; },
    reconcile: reconcile,
    currentReason: currentReason,
    showManual: function () { if (userHidden) { userHidden = false; try { sessionStorage.setItem(NS, '0'); } catch (e) {} setCtrl(); reconcile(); } },
    hideManual: function () { if (!userHidden) { userHidden = true; try { sessionStorage.setItem(NS, '1'); } catch (e) {} setCtrl(); pauseReason = 'user'; stopLoop(); layer.style.opacity = '0'; layer.style.display = 'none'; } }
  };

  setCtrl();
  reconcile();
})();
