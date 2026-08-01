/* AI Canvas 官网交互 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 年份 ---- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---- 导航滚动态 ---- */
  var nav = document.getElementById('nav');
  var onScroll = function () {
    nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- 移动端菜单 ---- */
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('mobileMenu');
  var closeMenu = function () {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '打开菜单');
    menu.hidden = true;
  };
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? '打开菜单' : '关闭菜单');
      menu.hidden = open;
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
    // 拉宽到桌面断点后，菜单状态不应残留
    window.matchMedia('(min-width: 861px)').addEventListener('change', function (e) {
      if (e.matches) closeMenu();
    });
  }

  /* ---- 滚动进场 ---- */
  var items = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        // 同一容器内的兄弟元素做轻微错峰
        var siblings = Array.prototype.filter.call(
          el.parentNode.children,
          function (n) { return n.classList && n.classList.contains('reveal'); }
        );
        var i = siblings.indexOf(el);
        el.style.transitionDelay = Math.min(i, 6) * 60 + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---- 数字滚动 ---- */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && !reduceMotion && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-count'), 10);
        var start = performance.now();
        var dur = 900;
        var tick = function (now) {
          var p = Math.min((now - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = String(Math.round(target * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ---- 截图随滚动展开 ---- */
  var shot = document.querySelector('.shot');
  var shotWrap = document.getElementById('shotWrap');
  if (shot && shotWrap && !reduceMotion && window.innerWidth > 860) {
    var raf = null;
    var update = function () {
      raf = null;
      var rect = shotWrap.getBoundingClientRect();
      var progress = 1 - Math.min(Math.max(rect.top / window.innerHeight, 0), 1);
      shot.style.setProperty('--rx', (7 - progress * 7).toFixed(2) + 'deg');
    };
    update();
    window.addEventListener('scroll', function () {
      if (raf === null) raf = requestAnimationFrame(update);
    }, { passive: true });
  }

  /* ---- 卡片跟随指针的高光 ---- */
  if (window.matchMedia('(hover: hover)').matches && !reduceMotion) {
    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ---- 平台识别 ---- */
  var ua = navigator.userAgent;
  var platform = navigator.platform || '';
  var os = 'unknown';

  if (/Windows|Win64|Win32/i.test(ua) || /Win/i.test(platform)) {
    os = 'win';
  } else if (/Mac/i.test(ua) || /Mac/i.test(platform)) {
    // Apple Silicon 上的 Chromium 会在 WebGL renderer 里暴露 "Apple M…"
    os = 'mac';
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        var renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        if (/Intel/i.test(renderer)) os = 'mac-intel';
      }
    } catch (err) {
      /* 识别失败时保持 Apple Silicon 默认值 */
    }
  } else if (/Linux|X11|Ubuntu/i.test(ua)) {
    os = 'linux';
  }

  var labels = {
    win: '下载 Windows 版',
    mac: '下载 macOS 版',
    'mac-intel': '下载 macOS 版',
    linux: '下载 Linux 版'
  };

  var label = document.getElementById('heroDownloadLabel');
  if (label && labels[os]) label.textContent = labels[os];

  var current = document.querySelector('.dl-card[data-os="' + os + '"]');
  if (current) current.classList.add('is-current');
})();
