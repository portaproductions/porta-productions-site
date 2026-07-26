/* ==========================================================================
   Porta Productions — motion.js (v3)
   Cinematic motion layer. A…F is the base pass, G is the all-out layer.
   Vanilla, no deps, single IIFE, no globals. Enhancement only: if this file
   never runs, html never gets .mjs and the page renders fully visible.
   ========================================================================== */
(function () {
  'use strict';

  var W = window, D = document, de = D.documentElement;
  var mq = function (q) { return !!(W.matchMedia && W.matchMedia(q).matches); };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var hasIO = typeof IntersectionObserver === 'function';

  /* A1 — no-JS / no-CLS guard. Hidden states exist only when we can animate. */
  function addC(c) { de.className = (de.className ? de.className + ' ' : '') + c; }
  if (!hasIO || reduce) { addC('mjs-ready'); return; }
  addC('mjs');

  var fine = mq('(pointer:fine)') && W.innerWidth >= 1080;
  var AMP  = W.innerWidth < 760 ? 10 : 22;           /* parallax amplitude, px */
  var $ = function (s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var now = function () { return (W.performance && performance.now) ? performance.now() : +new Date(); };
  function el(tag, cls) { var e = D.createElement(tag); if (cls) e.className = cls; return e; }
  function ready(fn) {
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', fn); else fn();
  }
  function store(k, v) { try { if (v === undefined) return W.sessionStorage.getItem(k); W.sessionStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------------------------------------------------------------- A4
     One shared rAF loop. `S` is the per-frame scroll state every module reads,
     so scroll position and velocity are measured exactly once. Tasks return
     true while they still need frames; after ~40 idle frames the loop cancels
     itself and any input event kicks it back to life.                        */
  var S = { y: 0, dy: 0, vel: 0, dt: 16.7, t: now() };
  var tasks = [], raf = null, idle = 0;
  /* set whenever something other than scrolling invalidates a scroll-derived
     value — a node entering the viewport without the page moving, a resize.
     Without it, scroll-linked tasks that short-circuit on "y hasn't changed"
     would never give a newly-visible element its first value. */
  var dirty = true;
  function soil() { dirty = true; kick(); }
  function frame() {
    raf = null;
    var t = now(), y = W.pageYOffset || 0;
    S.dt = clamp(t - S.t, 1, 50); S.t = t;
    S.dy = y - S.y; S.y = y;
    S.vel += (S.dy - S.vel) * 0.22;                 /* smoothed scroll velocity */
    if (Math.abs(S.vel) < 0.05) S.vel = 0;
    var busy = S.vel !== 0;
    for (var i = 0; i < tasks.length; i++) { if (tasks[i]()) busy = true; }
    idle = busy ? 0 : idle + 1;
    if (idle < 40 && !D.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { idle = 0; if (!raf && !D.hidden) raf = requestAnimationFrame(frame); }
  D.addEventListener('visibilitychange', function () {
    if (D.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; } else kick();
  });
  W.addEventListener('scroll', kick, { passive: true });
  W.addEventListener('resize', function () { soil(); }, { passive: true });

  /* ---------------------------------------------------------------- B1
     Headline line-mask reveal. Words are wrapped individually (so wrapping is
     never broken) but the stagger is computed per visual line, which reads as
     a line reveal. <em> and other inline elements are preserved.            */
  function split(node, bag) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) {
        var parts = n.nodeValue.split(/(\s+)/), frag = D.createDocumentFragment();
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          if (!p) continue;
          if (/^\s+$/.test(p)) { frag.appendChild(D.createTextNode(' ')); continue; }
          var mask = el('span', 'ml'), inner = el('span', 'mli');
          inner.textContent = p; mask.appendChild(inner);
          frag.appendChild(mask); bag.push(mask);
        }
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) { split(n, bag); }
    }
  }
  function prep(h) {
    if (h.getAttribute('data-msplit')) return;
    h.setAttribute('data-msplit', '1');
    var bag = []; split(h, bag); h.mWords = bag;
  }
  function play(h, base) {
    var ws = h.mWords || [], tops = [], i;
    for (i = 0; i < ws.length; i++) tops.push(ws[i].offsetTop);   /* read pass */
    var top = null, line = -1, k = 0;
    for (i = 0; i < ws.length; i++) {                             /* write pass */
      if (top === null || tops[i] - top > 4) { top = tops[i]; line++; k = 0; }
      ws[i].firstChild.style.transitionDelay =
        ((base || 0) + line * 0.05 + (k++) * 0.014).toFixed(3) + 's';
    }
    h.classList.add('m-in');
  }

  /* ---------------------------------------------------------------- misc
     Generic "reveal me once" observer used by B2/B3/B5/G4 and by any element
     we hand a .reveal class to at runtime (the page's own observer already ran). */
  /* A node can legitimately be registered by more than one watcher — the first
     eight gallery tiles are both a stagger target and a curtain host. Each
     registration therefore carries its OWN fired-flag and its own callback in
     a list. Sharing a single flag across watchers makes whichever observer
     fires first silently cancel the others, which showed up as tiles that
     never faded in and one curtain that never opened. */
  var pending = [], wid = 0;

  /* Reveal watchdog. Whatever the normal path is busy with — a stagger queue,
     a curtain still waiting on its own observer, an image that hasn't decoded
     — nothing an eye can see stays hidden more than WATCHDOG ms after it first
     touches the viewport. Every registered callback is idempotent, so firing
     early simply wins the race and the normal path becomes a no-op. */
  var WATCHDOG = 600;
  function force(n) {
    if (n.mWatch) { clearTimeout(n.mWatch); n.mWatch = 0; }
    var f = n.mFires, i;
    if (f) for (i = 0; i < f.length; i++) f[i](n);
    /* counter moves once per node however many watchers it carried, so a second
       force() — a sweep landing on something revealTo() already handled — can
       never drive it negative */
    if (n.mPend) {
      n.mPend = 0;
      if (!--outstanding && guard) { guard.disconnect(); guard = null; }
    }
  }
  var guard = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var n = e.target;
      if (guard) guard.unobserve(n);
      if (n.mWatch || !n.mPend) return;
      n.mWatch = setTimeout(function () { force(n); }, WATCHDOG);
    });
  }, { rootMargin: '0px' });

  var outstanding = 0;
  function enrol(n, fire) {
    (n.mFires || (n.mFires = [])).push(fire);
    if (!n.mPend) { n.mPend = 1; outstanding++; pending.push(n); if (guard) guard.observe(n); }
  }

  /* Arrival by jump — a hash on load, a hashchange, a bfcache restore. The
     visitor never scrolled through the content above them, so animating it is
     pointless and, while it runs, the thing they actually asked for is a ghost.
     Everything from the top of the document down to just past the fold is shown
     at once with transitions suppressed for a frame. Rects are read in one pass
     before any class is written, so this costs a single layout. */
  function revealTo(limit) {
    if (!pending.length) return;
    var list = pending.slice(), hit = [], i, r;
    var top = W.pageYOffset || 0;
    for (i = 0; i < list.length; i++) {                 /* ---- read pass ---- */
      r = list[i].getBoundingClientRect();
      if (r.top + top <= limit) hit.push(list[i]);
    }
    if (!hit.length) return;
    de.classList.add('mnx');                            /* ---- write pass --- */
    for (i = 0; i < hit.length; i++) force(hit[i]);
    pending = pending.filter(function (n) { return n.mPend; });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { de.classList.remove('mnx'); });
    });
  }
  function jumped() { revealTo((W.pageYOffset || 0) + W.innerHeight * 1.25); }
  function watch(list, cb, th) {
    if (!list.length) return;
    var key = 'mF' + (++wid);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) fire(e.target); });
    }, { threshold: th || 0, rootMargin: '0px 0px 10% 0px' });
    function fire(n) { if (n[key]) return; n[key] = 1; io.unobserve(n); cb(n); }
    list.forEach(function (n) { enrol(n, fire); io.observe(n); });
  }

  /* Catch-up sweep. An element can travel through the viewport between two
     IntersectionObserver ticks — an anchor jump, the End key, a momentum flick
     — and because its intersection ratio never observably left 0, no callback
     ever runs. It then sits hidden, or worse, stays behind a closed curtain.
     So: on scroll-end, anything we can prove we scrolled past is shown at once.
     One rect pass over a shrinking list, only when scrolling has stopped. */
  function sweep() {
    var out = [], hit = [], i, j, n, r, vh = W.innerHeight;
    for (i = 0; i < pending.length; i++) {                /* ---- read pass --- */
      n = pending[i];
      r = n.getBoundingClientRect();
      /* On screen or already behind us. Anything IO handled normally has left
         this list already, so the only nodes here are ones it missed. */
      if (r.top < vh && (r.width || r.height)) hit.push(n); else out.push(n);
    }
    pending = out;
    for (i = 0; i < hit.length; i++) force(hit[i]);       /* ---- write pass -- */
  }
  var sweepT = null;
  W.addEventListener('scroll', function () {
    clearTimeout(sweepT); sweepT = setTimeout(sweep, 160);
  }, { passive: true });
  /* keeps a live set of on-screen nodes so off-screen work costs nothing */
  function liveSet(list, margin) {
    var live = [];
    if (!list.length) return live;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var i = live.indexOf(e.target);
        if (e.isIntersecting) { if (i < 0) live.push(e.target); }
        else if (i >= 0) { live.splice(i, 1); if (e.target.mOff) e.target.mOff(); }
      });
      soil();
    }, { rootMargin: margin || '10% 0px' });
    list.forEach(function (n) { io.observe(n); });
    return live;
  }

  ready(function () {

    /* ------------------------------------------------------------ A2 */
    var prog = el('div', 'mprog');
    D.body.appendChild(prog);
    var lastY = -1;
    tasks.push(function () {
      if (S.y === lastY && !dirty) return false;
      lastY = S.y;
      var h = de.scrollHeight - W.innerHeight;
      prog.style.setProperty('--mp', h > 0 ? clamp(S.y / h, 0, 1).toFixed(4) : 0);
      return true;
    });

    /* ------------------------------------------------------------ A3 */
    if (fine) D.body.appendChild(el('div', 'mgrain'));

    /* ------------------------------------------------------------ B1 */
    var hero = D.getElementById('hero');
    var h1 = hero ? hero.querySelector('h1') : null;
    /* Only the homepage hero is a cinematic video wall. The city pages are
       ad and search landing pages behind a still image — their first paint has
       to be readable, so they get an enhancement, never an entrance. */
    var cine = !!(hero && hero.querySelector('video'));
    var heads = $('.sec-head h2, [data-mline]');
    if (h1 && cine) heads.push(h1);
    heads.forEach(prep);
    watch(heads.filter(function (h) { return h !== h1; }), function (h) { play(h, 0); }, 0.25);

    /* ------------------------------------------------------------ B2 */
    var narrow = W.innerWidth < 720;
    var kicks = $('.kicker');
    kicks.forEach(function (k) {
      k.style.opacity = '0';
      if (!narrow) k.style.letterSpacing = '.55em';
    });
    watch(kicks, function (k) { k.style.opacity = ''; k.style.letterSpacing = ''; }, 0.3);

    /* ------------------------------------------------------------ B3
       Observed via the parent: a scaleX(0) box has no area to intersect. */
    var rHosts = [];
    $('.rule').forEach(function (r) {
      r.classList.add('mrule');
      var h = r.parentElement || r;
      if (rHosts.indexOf(h) < 0) rHosts.push(h);
    });
    watch(rHosts, function (h) {
      $('.mrule', h).forEach(function (r) { r.classList.add('m-in'); });
    }, 0.05);

    /* ------------------------------------------------------------ B4
       Runtime stagger for grids. Inline delay beats the coarse d1–d6 classes;
       direct children that never got .reveal are enrolled here.             */
    var late = [];
    $('.svc-feat-grid,.pkg-grid,.gal,.addon-grid,.steps,.why-grid,.rev-grid,' +
      '.films,.reels,.stats,.ig,.svc-grid,.card-grid').forEach(function (g) {
      var kids = Array.prototype.slice.call(g.children), n = 0;
      kids.forEach(function (c) {
        if (!c.classList.contains('reveal')) { c.classList.add('reveal'); late.push(c); }
        c.style.transitionDelay = Math.min(n++ * 45, 450) + 'ms';
      });
    });
    watch(late, function (n) { n.classList.add('in'); }, 0.12);

    /* Every .reveal the page's own observer owns joins the catch-up list too,
       without an observer of its own — the page keeps its original timing on
       the normal path, and the sweep only ever acts on what got skipped. */
    $('.reveal').forEach(function (n) {
      if (n.classList.contains('in')) return;
      enrol(n, function () { n.classList.add('in'); });
    });

    /* ------------------------------------------------------------ G4
       Curtain wipe. A solid panel slides off the frame — more filmic than a
       clip, and it hides the image's own load-in. Only where the host clips
       its overflow; everything else falls back to the B5 clip reveal.       */
    function wipeDelay(n) {
      for (var p = n; p && p !== D.body; p = p.parentElement) {
        if (p.style && p.style.transitionDelay) return p.style.transitionDelay;
      }
      return '0ms';
    }
    var wipeHosts = $('.svc-feat,.addon-img,.igt')
      .concat($('.gal .tile').slice(0, 8));
    wipeHosts.forEach(function (host) {
      if (host.querySelector(':scope > .mwipe')) return;
      var w = el('div', 'mwipe');
      w.style.transitionDelay = wipeDelay(host);
      host.appendChild(w);
      host.mWipe = w;
    });
    watch(wipeHosts, function (h) {
      if (h.mWipe) h.mWipe.classList.add('mwipe-go');
    }, 0.08);

    /* ------------------------------------------------------------ B5
       Anything that didn't get a curtain still gets the clip reveal.
       Observed via the parent: a clip-path'd image reports an empty
       intersection rect and would never trigger its own reveal.            */
    var cHosts = [];
    $('.about-wrap img').forEach(function (c) {
      c.classList.add('mclip');
      var h = c.parentElement || c;
      if (cHosts.indexOf(h) < 0) cHosts.push(h);
    });
    watch(cHosts, function (h) {
      $('.mclip', h).forEach(function (c) { c.classList.add('mclip-in'); });
    }, 0.1);

    /* ------------------------------------------------------------ C1
       Hero timeline: badge .2s → h1 line masks .35s → sub .95s → cta 1.15s
       → trust 1.4s. Above the fold, so it runs off mjs-ready, not an observer. */
    var wrap = h1 ? h1.parentElement : null;
    if (wrap && !cine) {
      /* Static-image hero: everything is legible at first paint and merely
         settles upward. Nothing here ever sits at opacity 0. */
      wrap.classList.add('mhero');
      Array.prototype.slice.call(wrap.children).forEach(function (c, i) {
        c.classList.add('mhs');
        c.style.transitionDelay = (i * 0.05).toFixed(2) + 's';
      });
    } else if (wrap) {
      wrap.classList.add('mhero');
      var seq = { badge: 0.2, sub: 0.8, cta: 0.95, trust: 1.1 };
      Array.prototype.slice.call(wrap.children).forEach(function (c) {
        if (c === h1) return;
        var d = 0.6, key;
        for (key in seq) { if (c.classList.contains(key)) d = seq[key]; }
        c.classList.add('mhi');
        c.style.transitionDelay = d + 's';
        if (c.classList.contains('cta')) {
          c.classList.remove('mhi');
          c.style.transitionDelay = '';
          Array.prototype.slice.call(c.children).forEach(function (b, i) {
            b.classList.add('mhi');
            b.style.transitionDelay = (d + i * 0.11).toFixed(2) + 's';
          });
        }
      });
    }

    /* ------------------------------------------------------------ C4 */
    var cue = null;
    if (hero) {
      cue = el('div', 'mcue');
      cue.appendChild(el('i'));
      var lab = el('b'); lab.textContent = 'Scroll'; cue.appendChild(lab);
      hero.appendChild(cue);
    }

    /* ------------------------------------------------------------ C3 + D1
       Everything scroll-driven runs in the one loop; targets are IO-gated so
       off-screen media costs nothing.                                       */
    var px = [];
    function addPx(node, amp) {
      if (!node) return;
      node.mAmp = amp;
      node.mOff = function () { node.style.setProperty('--py', '0px'); };
      px.push(node);
    }
    if (hero) $('#hero video,#hero .herobg').forEach(function (v) { addPx(v, 0); });
    $('.svc-feat img,.why .wph').forEach(function (n) { addPx(n, AMP); });
    var live = liveSet(px);

    /* ------------------------------------------------------------ G7
       Statement illumination — a light sweep crosses the lead paragraph as it
       travels the viewport. background-clip:text, so it degrades to plain
       colour anywhere the property is missing.                              */
    var lit = [];
    if (W.CSS && CSS.supports && (CSS.supports('background-clip', 'text') ||
        CSS.supports('-webkit-background-clip', 'text'))) {
      lit = $('.sec-head p');
      lit.forEach(function (n) {
        n.classList.add('mlit');
        n.mOff = function () { };
      });
    }
    var litLive = liveSet(lit, '20% 0px');

    /* All rects are read in one pass before any style is written: interleaving
       them forces a synchronous layout per element. Values are also quantised
       and diffed, so a property is only touched when it actually changed —
       --lit in particular repaints clipped-text gradients, which is not cheap. */
    var pLast = -1, rects = [];
    tasks.push(function () {
      var y = S.y, vh = W.innerHeight, i, n;
      if (y === pLast && !dirty) return false;
      dirty = false; pLast = y;

      rects.length = 0;                                  /* ---- read pass ---- */
      for (i = 0; i < live.length; i++) {
        rects.push(live[i].mAmp ? live[i].getBoundingClientRect() : null);
      }
      var litRects = [];
      for (i = 0; i < litLive.length; i++) litRects.push(litLive[i].getBoundingClientRect());

      if (hero && wrap) {                                /* ---- write pass --- */
        if (y < hero.offsetHeight + 200) {
          wrap.style.setProperty('--py', (y * 0.08).toFixed(1) + 'px');
          wrap.style.setProperty('--po', clamp(1 - y / (vh * 0.7), 0, 1).toFixed(3));
        }
        if (cue) cue.classList.toggle('mcue-off', y > 80);
      }
      for (i = 0; i < live.length; i++) {
        n = live[i];
        var v;
        if (!n.mAmp) {                                   /* hero media: C3 */
          v = clamp(y * 0.18, 0, 220).toFixed(1);
        } else {                                         /* section media: D1 */
          var r = rects[i];
          v = (clamp(((r.top + r.height / 2) - vh / 2) / vh, -1, 1) * n.mAmp).toFixed(1);
        }
        if (v !== n.mPy) { n.mPy = v; n.style.setProperty('--py', v + 'px'); }
      }
      for (i = 0; i < litLive.length; i++) {             /* G7 */
        var L = litLive[i], lr = litRects[i];
        var pr = (vh * 0.82 - lr.top) / Math.max(lr.height + vh * 0.34, 1);
        var q = (Math.round(clamp(pr, 0, 1) * 50) * 2);  /* 2% steps */
        if (q !== L.mLit) { L.mLit = q; L.style.setProperty('--lit', q + '%'); }
      }
      return true;
    });

    /* ------------------------------------------------------------ G5
       Scroll-velocity skew. One custom property on <html>; a short list of
       blocks reads it, so the whole page appears to lag behind the scroll. */
    var skTargets = $('.svc-feat-grid,.addon-grid,.steps,.rev-grid,.films')
      .filter(function (n) { return !n.classList.contains('reveal'); });
    if (skTargets.length && fine) {
      skTargets.forEach(function (n) { n.classList.add('msk'); });
      /* quantised to 0.05deg: every distinct value repaints the blocks that
         read it, and nobody can see a twentieth of a degree */
      var skLast = null;
      tasks.push(function () {
        var s = Math.round(clamp(S.vel * 0.035, -0.9, 0.9) * 20) / 20;
        if (s === skLast) return false;
        skLast = s;
        de.style.setProperty('--msk', s + 'deg');
        return s !== 0;
      });
    }

    /* ------------------------------------------------------------ G6
       Marquees driven by the loop instead of CSS keyframes, so scrolling
       pushes them along and hovering brings them to a stop.                */
    $('.bk-track,.track').forEach(function (tr) {
      var half = 0, pos = 0, paused = false, host = tr.parentElement;
      function measure() { half = tr.scrollWidth / 2; }
      measure();
      if (!half) return;
      tr.classList.add('mmq');
      W.addEventListener('resize', measure, { passive: true });
      if (host) {
        host.addEventListener('pointerenter', function () { paused = true; });
        host.addEventListener('pointerleave', function () { paused = false; kick(); });
      }
      var vis = liveSet([tr], '15% 0px');
      tasks.push(function () {
        if (!vis.length) return false;
        var speed = paused ? 0 : 0.032;                  /* px per ms, base drift */
        /* velocity is clamped so an anchor jump nudges the marquee instead of
           slamming it half a screen sideways */
        pos -= speed * S.dt + clamp(S.vel, -40, 40) * 0.28;
        if (half) { while (pos <= -half) pos += half; while (pos > 0) pos -= half; }
        tr.style.setProperty('--mx', pos.toFixed(1) + 'px');
        return !paused;
      });
    });

    /* ------------------------------------------------------------ G10
       Smart header — retracts once you're well down the page and moving
       away, returns the moment you scroll back up.                         */
    var hdr = D.getElementById('header') || D.querySelector('header');
    if (hdr && !mq('(max-width:1080px)') && getComputedStyle(hdr).position === 'fixed') {
      /* anchored threshold rather than per-frame delta: a momentum flick or a
         smooth-scrolled anchor jump can end on a stray negative frame, which
         would flap the header. 50px of committed travel decides it. */
      var anchor = W.pageYOffset || 0, hid = false;
      function hdrSet(v) { if (v !== hid) { hid = v; hdr.classList.toggle('mhide', v); } }
      tasks.push(function () {
        if (D.body.classList.contains('menu-open')) { hdrSet(false); anchor = S.y; return false; }
        if (S.y < 140) { hdrSet(false); anchor = S.y; return false; }
        if (S.y > anchor + 50) { hdrSet(true); anchor = S.y; }
        else if (S.y < anchor - 50) { hdrSet(false); anchor = S.y; }
        return false;
      });
    }

    /* ------------------------------------------------------------ G16
       Section rail — mirrors the nav, tracks the section under the fold and
       flips to dark dots over the paper-toned sections.                    */
    var rail = null, railLinks = [], sections = [];
    if (fine && W.innerWidth >= 1240) {
      var navA = $('nav.links a[href^="#"]').filter(function (a) { return !a.classList.contains('btn'); });
      if (navA.length > 2) {
        rail = el('div', 'mrail');
        navA.forEach(function (a) {
          var id = a.getAttribute('href').slice(1), sec = id && D.getElementById(id);
          if (!sec) return;
          var dot = D.createElement('a');
          dot.href = '#' + id;
          dot.setAttribute('aria-label', a.textContent.trim());
          var t = el('b'); t.textContent = a.textContent.trim();
          dot.appendChild(t);
          rail.appendChild(dot);
          railLinks.push(dot); sections.push(sec);
        });
        if (railLinks.length) {
          D.body.appendChild(rail);
          var rLast = -2, pLastTone = null, allSecs = $('section');
          var lbox = D.getElementById('lightbox');
          tasks.push(function () {
            var mid = S.y + W.innerHeight * 0.42, act = -1, i;
            for (i = 0; i < sections.length; i++) {
              if (sections[i].offsetTop <= mid) act = i;
            }
            rail.classList.toggle('mrail-hide', !!(lbox && lbox.classList.contains('open')));

            /* dot colour follows the tone of the section behind the rail —
               tracked independently of the active dot, since the rail can sit
               over a paper section long before the next nav anchor starts */
            var paper = false;
            for (i = 0; i < allSecs.length; i++) {
              var s = allSecs[i];
              if (s.offsetTop <= mid && s.offsetTop + s.offsetHeight > mid) {
                paper = s.classList.contains('paper');
              }
            }
            if (paper !== pLastTone) { pLastTone = paper; rail.classList.toggle('on-paper', paper); }

            if (act === rLast) return false;
            rLast = act;
            for (i = 0; i < railLinks.length; i++) railLinks[i].classList.toggle('on', i === act);
            return false;
          });
        } else { rail = null; }
      }
    }

    /* ------------------------------------------------------------ E1/E2/E3/G2
       Pointer candy: desktop, fine pointer, ≥1080px only.                   */
    if (fine) {
      /* E1 — magnetic buttons */
      $('.btn,.pkg .pbtn').forEach(function (b) {
        b.classList.add('mmag');
        b.addEventListener('pointermove', function (e) {
          var r = b.getBoundingClientRect();
          b.classList.remove('mrest');
          b.style.setProperty('--mmx', clamp((e.clientX - (r.left + r.width / 2)) * 0.22, -5, 5).toFixed(1) + 'px');
          b.style.setProperty('--mmy', clamp((e.clientY - (r.top + r.height / 2)) * 0.3, -5, 5).toFixed(1) + 'px');
        });
        b.addEventListener('pointerleave', function () {
          b.classList.add('mrest');
          b.style.setProperty('--mmx', '0px'); b.style.setProperty('--mmy', '0px');
        });
      });

      /* E2 — card tilt + moving glare (never on the before/after slider) */
      $('.svc-feat,.tile,.addon,.ytlite').forEach(function (c) {
        if (c.querySelector('.ba') || c.closest('.ba')) return;
        c.classList.add('mtilt');
        var glare = el('div', 'mglare');
        c.appendChild(glare);
        c.addEventListener('pointermove', function (e) {
          var r = c.getBoundingClientRect();
          var gx = (e.clientX - r.left) / r.width, gy = (e.clientY - r.top) / r.height;
          c.classList.add('mtilt-a');
          c.style.setProperty('--ry', ((gx - 0.5) * 7).toFixed(2) + 'deg');
          c.style.setProperty('--rx', ((0.5 - gy) * 7).toFixed(2) + 'deg');
          glare.style.setProperty('--gx', (gx * 100).toFixed(1) + '%');
          glare.style.setProperty('--gy', (gy * 100).toFixed(1) + '%');
        });
        c.addEventListener('pointerleave', function () {
          c.classList.remove('mtilt-a');
          c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
        });
      });

      /* E3 — cursor glow + G2 contextual label, both lerped in the loop */
      var cur = el('div', 'mcur');
      var curl = el('div', 'mcurl');
      D.body.appendChild(cur); D.body.appendChild(curl);
      var tx = -999, ty = -999, cx = -999, cy = -999, lx = -999, ly = -999;
      var LABELS = [
        ['.ytlite', 'Play'], ['.ba', 'Drag'], ['.tile', 'View'],
        ['.igt', 'Open'], ['.svc-feat', 'Explore']
      ];
      var moved = false;
      W.addEventListener('pointermove', function (e) {
        tx = e.clientX; ty = e.clientY; moved = true; kick();
      }, { passive: true });
      W.addEventListener('blur', function () { setLabel(''); });

      function setLabel(hit) {
        if (hit === curl.mLabel) return;
        curl.mLabel = hit;
        if (hit) { curl.textContent = hit; curl.classList.add('on'); }
        else curl.classList.remove('on');
      }
      /* Hit-test in the loop from the real pointer position rather than from
         event.target: tilting a card re-fires pointermove with a target that
         can be the document, which would blink the label off mid-hover. */
      function labelAt(x, y) {
        if (x < 0 || y < 0 || x > W.innerWidth || y > W.innerHeight) return '';
        var t = D.elementFromPoint(x, y);
        if (!t || !t.closest) return '';
        for (var i = 0; i < LABELS.length; i++) {
          if (t.closest(LABELS[i][0])) return LABELS[i][1];
        }
        return '';
      }
      tasks.push(function () {
        var dx = tx - cx, dy = ty - cy;
        var ldx = tx - lx, ldy = ty - ly;
        var moving = Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4 || Math.abs(ldx) > 0.4 || Math.abs(ldy) > 0.4;
        if (moved) { moved = false; setLabel(labelAt(tx, ty)); }
        if (!moving) return false;
        cx += dx * 0.12; cy += dy * 0.12;
        lx += ldx * 0.22; ly += ldy * 0.22;
        cur.style.setProperty('--cx', cx.toFixed(1) + 'px');
        cur.style.setProperty('--cy', cy.toFixed(1) + 'px');
        curl.style.setProperty('--lx', lx.toFixed(1) + 'px');
        curl.style.setProperty('--ly', ly.toFixed(1) + 'px');
        return true;
      });
      /* the label must also drop when the page scrolls out from under the pointer */
      W.addEventListener('scroll', function () { moved = true; }, { passive: true });
    }

    /* ------------------------------------------------------------ G14
       Page-exit fade for internal navigation. Always self-cancels, so a
       blocked or slow navigation can never leave the page blank.           */
    D.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return;
      var u;
      try { u = new URL(a.href); } catch (err) { return; }
      if (u.origin !== location.origin) return;
      if (u.pathname === location.pathname && u.search === location.search) return;
      e.preventDefault();
      D.body.classList.add('mout');
      var done = false;
      var go = function () { if (!done) { done = true; location.href = a.href; } };
      setTimeout(go, 300);
      setTimeout(function () { D.body.classList.remove('mout'); }, 2500);
    });
    W.addEventListener('pageshow', function (e) {
      if (e.persisted) D.body.classList.remove('mout');
    });

    /* ------------------------------------------------------------ G1 / A1
       Curtain up. When the letterbox plays it *is* the curtain, so the plain
       body fade steps aside; the hero timeline starts while the bars are
       still retracting so the two moves overlap.                           */
    var wantsBox = cine && !location.hash && !store('pp_lbx');
    function heroIn() { if (h1 && cine) play(h1, 0); kick(); }

    if (wantsBox) {
      store('pp_lbx', '1');
      addC('mlbx');
      var box = el('div', 'mlbx-wrap');
      box.appendChild(el('i')); box.appendChild(el('b')); box.appendChild(el('i'));
      D.body.appendChild(box);
      de.classList.add('mjs-ready');
      requestAnimationFrame(function () {
        box.classList.add('mlbx-draw');
        setTimeout(function () {
          box.classList.add('mlbx-open');
          setTimeout(heroIn, 260);
          setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1200);
        }, 480);
      });
    } else {
      requestAnimationFrame(function () {
        de.classList.add('mjs-ready');
        if (h1 && cine) play(h1, 0.2);
        kick();
      });
    }

    /* ------------------------------------------------------------ A5
       Arrival by jump. A hash on load, an in-page hash change, or a back/
       forward restore all drop the visitor somewhere they never scrolled to;
       show that screenful outright instead of animating it at them. */
    if (location.hash) {
      /* A deep link should land, not tour the page. html{scroll-behavior:smooth}
         also governs the browser's own hash scroll on load, which animates the
         entire document past the visitor — on this page that is a 12,000px trip
         — and leaves the thing they actually asked for ghosted while it runs.
         Land instantly, reveal, then hand smooth scrolling back for nav clicks. */
      var tgt = null;
      try { tgt = D.getElementById(location.hash.slice(1)); } catch (e) { }
      de.style.scrollBehavior = 'auto';
      if (tgt) tgt.scrollIntoView();
      jumped();
      requestAnimationFrame(jumped);
      setTimeout(function () {            /* late anchor settle: fonts, images */
        if (tgt) tgt.scrollIntoView();
        jumped();
        de.style.scrollBehavior = '';
      }, 340);
    }
    if ('onscrollend' in W) W.addEventListener('scrollend', sweep);
    W.addEventListener('hashchange', function () { setTimeout(jumped, 90); });
    W.addEventListener('popstate', function () { setTimeout(jumped, 90); });
    W.addEventListener('pageshow', function (e) { if (e.persisted) jumped(); });
  });
})();
