/*!
 * Genie window animation for Local Video Player
 * ------------------------------------------------
 * Drop-in: add  <script src="genie.js" defer></script>  to index.html.
 * It watches the existing `hidden` class on the player's popups / panels /
 * modals and plays a macOS-style genie (open + close) between the window and
 * the button that opened it. Nothing in main.js / player.css has to change.
 *
 * Settings menu  ->  "Window animation: Genie / Classic"  (genie is the default).
 * "Classic" turns this script off completely, so the player's own original
 * open / close behaviour is used.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Config
   * ------------------------------------------------------------------ */
  const STORE_KEY = 'lvp.windowAnimation';   // 'genie' | 'classic'
  const ROWS      = 90;      // mesh rows: more = smoother funnel edges
  const LAG       = 0.7;     // how far the far edge trails the near edge
  const TIP       = 24;      // width (px) of the genie tip at the button
  const PAD       = 80;      // snapshot margin so box-shadows are included
  const MAX_NODES = 2500;    // safety limit for the snapshot
  const OPEN_MS   = 640;
  const CLOSE_MS  = 520;

  /* element that is shown/hidden with the `hidden` class, the card inside it
     that actually gets animated (null = the element itself), and the button(s)
     the genie flies to */
  const TARGETS = [
    { id: 'settingsMenu',         trigger: ['#settingsBtn'] },
    { id: 'playlistPanel',        trigger: ['#playlistToggleBtn'] },
    { id: 'studyTimerMenu',       trigger: ['#studyTimerBtn'] },
    { id: 'shortcutsOverlay',     card: '.shortcuts-card', trigger: ['#settingsBtn'] },
    { id: 'urlModalOverlay',      card: '.shortcuts-card', trigger: ['#addUrlBtn2', '#playlistToggleBtn'] },
    { id: 'featuresOverlay',      card: '.shortcuts-card', trigger: ['#featuresBtn'] },
    { id: 'defaultPlayerOverlay', card: '.shortcuts-card', trigger: ['#defaultPlayerBtn', '#defaultPlayerFeatureBtn'] },
    { id: 'newPlaylistOverlay',   card: '.shortcuts-card', trigger: ['#addPlaylistTab'] },
    /* pages inside the settings menu: shown with the `active` class instead of `hidden` */
    { id: 'settingsMainPanel',    active: true, trigger: [] },
    { id: 'settingsSpeedPanel',   active: true, trigger: [] },
    { id: 'settingsSkipPanel',    active: true, trigger: [] },
    { id: 'settingsBtnSizePanel', active: true, trigger: [] }
  ];

  const clamp  = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = t => t * t * (3 - 2 * t);
  const ease   = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* ------------------------------------------------------------------ *
   *  Mode (genie / classic)
   * ------------------------------------------------------------------ */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let mode = 'genie';
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === 'genie' || v === 'classic') mode = v;
  } catch (e) { /* storage blocked */ }

  let broken = false;                         // WebGL / snapshot not usable
  const enabled = () => mode === 'genie' && !reduced.matches && !broken && !!gl;

  /* ------------------------------------------------------------------ *
   *  Styles
   * ------------------------------------------------------------------ */
  const css = document.createElement('style');
  css.textContent = `
    .genie-hold { opacity: 0 !important; transition: none !important; animation: none !important; pointer-events: none !important; }
    .genie-live { transition: none !important; animation: none !important; }
    .genie-scrim { position: fixed; pointer-events: none; z-index: 2147483645; }
    #genieCanvas { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646; display: none; }
  `;
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ *
   *  WebGL: one shared canvas draws every genie ghost
   * ------------------------------------------------------------------ */
  const canvas = document.createElement('canvas');
  canvas.id = 'genieCanvas';
  canvas.setAttribute('aria-hidden', 'true');

  let gl = null, isGL2 = false, posBuf = null, uViewport = null, uAlpha = null;
  const posArray = new Float32Array((ROWS + 1) * 4);

  (function initGL() {
    try {
      const opts = { alpha: true, premultipliedAlpha: true, antialias: true };
      gl = canvas.getContext('webgl2', opts);
      isGL2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', opts);
      if (!gl) return;

      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, `
        attribute vec2 aPos; attribute vec2 aUv;
        uniform vec2 uViewport; varying vec2 vUv;
        void main() {
          vec2 c = aPos / uViewport;
          gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
          vUv = aUv;
        }`));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D uTex; uniform float uAlpha; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(uTex, vUv) * uAlpha; }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return; }
      gl.useProgram(prog);

      uViewport = gl.getUniformLocation(prog, 'uViewport');
      uAlpha    = gl.getUniformLocation(prog, 'uAlpha');

      const uv = new Float32Array((ROWS + 1) * 4);
      for (let k = 0; k <= ROWS; k++) uv.set([0, k / ROWS, 1, k / ROWS], k * 4);
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      const aUv = gl.getAttribLocation(prog, 'aUv');
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posArray.byteLength, gl.DYNAMIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } catch (e) { gl = null; }
  })();

  function makeTexture(img) {
    try {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (isGL2) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      return tex;
    } catch (e) {
      broken = true;      // e.g. tainted by the browser: fall back to classic
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   *  DOM -> image snapshot
   *  The element is cloned with its *computed* styles written inline (only
   *  what differs from browser defaults), so it renders identically inside an
   *  SVG <foreignObject> without needing the page's stylesheet.
   * ------------------------------------------------------------------ */
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'noscript', 'video', 'audio', 'iframe', 'object', 'embed', 'template']);
  const SKIP_PROP = /^(transition|animation|will-change|cursor|pointer-events|user-select|-webkit-user-select|scroll|overscroll|touch-action|resize|view-transition|anchor|position-|interactivity|caret|-webkit-locale|-webkit-tap|container|content-visibility|inline-size|block-size|min-inline|min-block|max-inline|max-block|margin-inline|margin-block|padding-inline|padding-block|border-inline|border-block|inset-inline|inset-block|border-start|border-end|app-region|-webkit-app-region)/;
  const FORCE_PROP = new Set(['width', 'height', 'display', 'position', 'box-sizing']);

  let baseFrame = null;
  const baseCache = new Map();

  function baselineFor(node) {
    const key = (node.namespaceURI || '') + '|' + node.localName;
    let b = baseCache.get(key);
    if (b) return b;
    if (!baseFrame) {
      baseFrame = document.createElement('iframe');
      baseFrame.setAttribute('aria-hidden', 'true');
      baseFrame.tabIndex = -1;
      baseFrame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1234px;height:600px;border:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(baseFrame);
      const d = baseFrame.contentDocument;
      d.open(); d.write('<!doctype html><html><body></body></html>'); d.close();
    }
    const d = baseFrame.contentDocument;
    const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? d.createElementNS(node.namespaceURI, node.localName)
      : d.createElement(node.localName);
    (node.namespaceURI === 'http://www.w3.org/2000/svg'
      ? (() => { const s = d.createElementNS('http://www.w3.org/2000/svg', 'svg'); d.body.appendChild(s); return s; })()
      : d.body).appendChild(el);
    b = readStyle(baseFrame.contentWindow.getComputedStyle(el));
    el.remove();
    baseCache.set(key, b);
    return b;
  }

  function readStyle(cs) {
    const o = {};
    for (let i = 0; i < cs.length; i++) {
      const n = cs[i];
      if (SKIP_PROP.test(n)) continue;
      o[n] = cs.getPropertyValue(n);
    }
    return o;
  }

  function styleString(vals, base, parent) {
    let s = '';
    for (const n in vals) {
      const v = vals[n];
      if (FORCE_PROP.has(n) || v !== base[n] || v !== parent[n]) s += n + ':' + v + ';';
    }
    return s;
  }

  function imgToData(img) {
    try {
      if (!img.complete || !img.naturalWidth) return null;
      const r = img.getBoundingClientRect();
      const w = Math.max(1, Math.min(Math.round(r.width * 2) || img.naturalWidth, 640));
      const h = Math.max(1, Math.min(Math.round(r.height * 2) || img.naturalHeight, 640));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL(w * h > 4096 ? 'image/jpeg' : 'image/png', 0.88);
    } catch (e) { return null; }
  }

  function pseudoNode(host, which, hostVals) {
    const pcs = getComputedStyle(host, which);
    const c = pcs.content;
    if (!c || c === 'none' || c === 'normal' || pcs.display === 'none') return null;
    const sp = document.createElement('span');
    const vals = readStyle(pcs);
    delete vals.content;
    sp.setAttribute('style', styleString(vals, baselineFor(sp), hostVals));
    const m = /^"([\s\S]*)"$/.exec(c);
    if (m) sp.textContent = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return sp;
  }

  function cloneEl(node, ctx, parentVals, isRoot, scrollOff) {
    if (++ctx.count > MAX_NODES) throw new Error('snapshot too large');
    const tag = node.localName;
    if (SKIP_TAGS.has(tag)) return null;
    const cs = getComputedStyle(node);
    if (cs.display === 'none') return null;

    let out;
    if (tag === 'canvas') {
      out = document.createElement('img');
      try { out.setAttribute('src', node.toDataURL()); } catch (e) { /* ignore */ }
    } else {
      out = node.cloneNode(false);
      if (tag === 'img') {
        const d = imgToData(node);
        if (d) out.setAttribute('src', d);
        out.removeAttribute('srcset');
        out.removeAttribute('loading');
      }
    }
    for (const a of Array.from(out.attributes)) {
      if (/^on/i.test(a.name)) out.removeAttribute(a.name);
    }

    const vals = readStyle(cs);
    let s = styleString(vals, baselineFor(node), parentVals);

    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
      s += 'overflow:hidden;';
    }
    if (isRoot) {
      const r = ctx.rect;
      s += `position:absolute;left:${PAD}px;top:${PAD}px;right:auto;bottom:auto;margin:0;` +
           `transform:none;translate:none;rotate:none;scale:none;opacity:1;visibility:visible;` +
           `width:${r.width}px;height:${r.height}px;min-width:0;min-height:0;max-width:none;max-height:none;box-sizing:border-box;`;
      if (cs.display === 'inline') s += 'display:block;';
    }
    if (scrollOff) s += `translate:${-scrollOff[0]}px ${-scrollOff[1]}px;`;
    out.setAttribute('style', s);

    if (tag === 'input') {
      const t = (node.type || '').toLowerCase();
      if (t === 'checkbox' || t === 'radio') {
        if (node.checked) out.setAttribute('checked', ''); else out.removeAttribute('checked');
      } else out.setAttribute('value', node.value);
    }
    if (tag === 'option') {
      if (node.selected) out.setAttribute('selected', ''); else out.removeAttribute('selected');
    }
    if (tag === 'textarea') { out.textContent = node.value; return out; }
    if (tag === 'canvas' || tag === 'img') return out;

    /* prune children that are scrolled / clipped out of view (keep the box) */
    let prune = false;
    if (!isRoot && ctx.clips && cs.display !== 'contents') {
      const r = node.getBoundingClientRect(), cr = ctx.rect;
      prune = r.bottom < cr.top - 30 || r.top > cr.bottom + 30 || r.right < cr.left - 30 || r.left > cr.right + 30;
    }
    if (prune) return out;

    const before = pseudoNode(node, '::before', vals);
    if (before) out.appendChild(before);

    const off = (node.scrollTop || node.scrollLeft) ? [node.scrollLeft, node.scrollTop] : null;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out.appendChild(c.cloneNode());
      else if (c.nodeType === 1) {
        const k = cloneEl(c, ctx, vals, false, off);
        if (k) out.appendChild(k);
      }
    }

    const after = pseudoNode(node, '::after', vals);
    if (after) out.appendChild(after);
    return out;
  }

  function serialize(card, r) {
    const ccs = getComputedStyle(card);
    const ctx = {
      count: 0,
      rect: r,
      clips: ccs.overflowX !== 'visible' || ccs.overflowY !== 'visible'
    };
    const div = document.createElement('div');
    const root = cloneEl(card, ctx, baselineFor(div), true, null);
    const xml = new XMLSerializer().serializeToString(root);

    const W = r.width + PAD * 2, H = r.height + PAD * 2;
    const sc = Math.min(window.devicePixelRatio || 1, 2.5, 4096 / Math.max(W, H));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W * sc}" height="${H * sc}" viewBox="0 0 ${W} ${H}">` +
      `<foreignObject x="0" y="0" width="${W}" height="${H}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${xml}</div>` +
      `</foreignObject></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ------------------------------------------------------------------ *
   *  Per-window state
   * ------------------------------------------------------------------ */
  const plain = r => ({ left: r.left, top: r.top, width: r.width, height: r.height });
  const targets = [];
  let lastAct = null;

  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('button,[role="button"],.icon-btn,.playlist-tab,.drop-footer-link,a,.settings-row,.settings-panel-header,[data-back],[data-target]');
    if (b) {
      const r = b.getBoundingClientRect();
      lastAct = { el: b, time: performance.now(), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    }
  }, true);

  function isVisible(e) {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function findOrigin(t) {
    let el = null;
    for (const s of t.cfg.trigger || []) {
      const e = document.querySelector(s);
      if (isVisible(e) && !t.el.contains(e)) { el = e; break; }
    }
    const recent = lastAct && performance.now() - lastAct.time < 1500;
    if (!el && recent && isVisible(lastAct.el) && (t.cfg.active || !t.el.contains(lastAct.el))) el = lastAct.el;
    if (!el && recent && t.cfg.active) return { x: lastAct.x, y: lastAct.y, w: lastAct.w };
    if (el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    }
    return { x: innerWidth / 2, y: innerHeight - 36, w: 44 };   // bottom centre
  }

  const hiddenOf = t => (t.cfg.active ? !t.el.classList.contains('active') : t.el.classList.contains('hidden'));

  /* a settings page only animates while the settings menu itself is open and still */
  function pageBlocked(t) {
    if (!t.cfg.active) return false;
    const m = targets.find(x => x.el.id === 'settingsMenu');
    return !m || m.hidden || !!m.anim;
  }

  function makeTarget(cfg) {
    const el = document.getElementById(cfg.id);
    if (!el) return null;
    const t = {
      cfg, el,
      overlay: !!cfg.card,
      hidden: cfg.active ? !el.classList.contains('active') : el.classList.contains('hidden'),
      snap: null, rect: null, oRect: null,
      hard: true, soft: false,
      building: null, token: 0, anim: null, timer: 0, trash: []
    };
    t.card = () => (cfg.card ? el.querySelector(cfg.card) : el);
    new MutationObserver(recs => onMutations(t, recs))
      .observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    return t;
  }

  function onMutations(t, recs) {
    const card = t.card();
    let classTouched = false, hard = false, soft = false;
    for (const r of recs) {
      if (r.type === 'attributes') {
        if (r.target === t.el && r.attributeName === 'class') classTouched = true;
        if (r.attributeName === 'class' && r.target === card) continue;      // our own classes
        if (r.attributeName === 'style' && r.target !== card) continue;       // progress bars, our opacity
        if (r.target === t.el && t.overlay) continue;
        if (r.target === card) hard = true; else soft = true;
      } else hard = true;
    }
    if (classTouched) {
      const h = hiddenOf(t);
      if (h !== t.hidden) {
        t.hidden = h;
        if (h) onClose(t); else onOpen(t);
        return;
      }
    }
    if (hard) t.hard = true;
    if (soft) t.soft = true;
    if ((hard || soft) && !t.hidden) scheduleRefresh(t);
  }

  function scheduleRefresh(t, delay = 900) {
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      if (t.hidden || t.anim || !enabled() || document.hidden) return;
      if (t.hard || t.soft || !t.snap) ensureSnap(t);
    }, delay);
  }

  function ensureSnap(t) {
    if (t.building) return t.building;
    t.building = build(t).then(ok => { t.building = null; return ok; }, () => { t.building = null; return false; });
    return t.building;
  }

  async function build(t) {
    const card = t.card();
    if (!card) return false;
    const r = card.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    t.hard = false; t.soft = false;

    let url;
    try { url = serialize(card, r); }
    catch (e) { t.hard = true; return false; }

    const img = new Image();
    const loaded = await new Promise(res => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url; });
    if (!loaded) { t.hard = true; return false; }

    const tex = makeTexture(img);
    if (!tex) return false;

    const old = t.snap && t.snap.tex;
    t.snap = { tex, W: r.width, H: r.height };
    t.rect = plain(r);
    if (t.overlay) t.oRect = plain(t.el.getBoundingClientRect());
    if (old) {
      if (t.anim && t.anim.tex === old) t.trash.push(old); else gl.deleteTexture(old);
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   *  Open / close
   * ------------------------------------------------------------------ */
  function hold(t) {
    const c = t.card();
    if (c) { c.classList.remove('genie-live'); c.classList.add('genie-hold'); }
  }
  function release(t) {
    const c = t.card();
    if (c) c.classList.remove('genie-hold', 'genie-live');
    if (t.overlay) t.el.style.opacity = '';
  }

  async function onOpen(t) {
    if (!enabled() || pageBlocked(t)) { release(t); return; }
    const card = t.card();
    if (!card) return;
    const token = ++t.token;
    hold(t);

    if (t.anim) { startAnim(t, 0); return; }            // reverse a running close

    if (t.overlay) t.el.style.opacity = '0';
    const origin = findOrigin(t);

    const r = card.getBoundingClientRect();
    const resized = t.snap && (Math.abs(r.width - t.snap.W) > 1 || Math.abs(r.height - t.snap.H) > 1);
    let ok = true;
    if (!t.snap || t.hard || resized) ok = await ensureSnap(t);
    if (token !== t.token) return;                       // closed / re-opened meanwhile

    if (!ok || !t.snap) { release(t); return; }
    if (t.rect && !resized) t.rect = plain(card.getBoundingClientRect());
    startAnim(t, 0, origin);
  }

  function onClose(t) {
    ++t.token;
    if (!enabled() || pageBlocked(t)) { if (t.anim) startAnim(t, 1); else release(t); return; }
    if (t.anim) { startAnim(t, 1); return; }             // reverse a running open
    if (!t.snap || !t.rect) { release(t); return; }
    hold(t);
    startAnim(t, 1, findOrigin(t));
  }

  /* ------------------------------------------------------------------ *
   *  Animation loop
   * ------------------------------------------------------------------ */
  const anims = new Set();
  let raf = 0;

  function host() { return document.fullscreenElement || document.body; }

  function mount() {
    const h = host();
    if (canvas.parentNode !== h) h.appendChild(canvas);
    canvas.style.display = 'block';
  }

  function makeGeo(t, o) {
    const r = t.rect;
    const left = r.left - PAD, top = t.rect.top - PAD;
    const TW = r.width + PAD * 2, TH = r.height + PAD * 2;
    return {
      left, top, TW, TH,
      tx: o.x, ty: o.y,
      tip: Math.min(TIP, Math.max(10, o.w * 0.55)),
      nearTop: o.y < top + TH / 2
    };
  }

  function startAnim(t, target, origin) {
    const prev = t.anim;
    const now = performance.now();
    if (prev) {                                          // reverse smoothly from where it is
      prev.from = prev.p;
      prev.target = target;
      prev.t0 = now;
      prev.dur = (target === 0 ? OPEN_MS : CLOSE_MS) * Math.max(0.35, Math.abs(target - prev.p));
      return;
    }
    const a = {
      t, tex: t.snap.tex, geo: makeGeo(t, origin),
      p: target === 0 ? 1 : 0, from: target === 0 ? 1 : 0, target,
      t0: now, dur: target === 0 ? OPEN_MS : CLOSE_MS, scrim: null
    };
    t.anim = a;
    anims.add(a);
    mount();
    setBackdrop(a, clamp(1 - a.p));
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function ensureScrim(a) {
    if (a.scrim) return a.scrim;
    const t = a.t, cs = getComputedStyle(t.el), r = t.oRect || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const s = document.createElement('div');
    s.className = 'genie-scrim';
    s.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      `background-color:${cs.backgroundColor};` +
      (cs.backdropFilter && cs.backdropFilter !== 'none' ? `backdrop-filter:${cs.backdropFilter};-webkit-backdrop-filter:${cs.backdropFilter};` : '');
    host().appendChild(s);
    a.scrim = s;
    return s;
  }

  function setBackdrop(a, v) {
    const t = a.t;
    if (!t.overlay) return;
    if (!t.el.classList.contains('hidden')) {            // overlay is displayed: fade it
      t.el.style.opacity = v >= 0.999 ? '' : String(v);
      if (a.scrim) a.scrim.style.opacity = '0';
    } else {                                             // overlay already hidden: fade a copy
      ensureScrim(a).style.opacity = String(v);
    }
  }

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
    }
    gl.viewport(0, 0, w, h);
  }

  function drawGhost(a) {
    const g = a.geo, p = a.p, cxw = g.left + g.TW / 2;
    let prevY = -Infinity;
    for (let k = 0; k <= ROWS; k++) {
      const f = k / ROWS;
      const d = g.nearTop ? f : 1 - f;
      const s = clamp(p * (1 + LAG) - d * LAG);          // rows nearest the button lead
      const ey = 1 - (1 - s) * (1 - s);
      const ex = smooth(s);
      const y0 = g.top + f * g.TH;
      let y = y0 + (g.ty - y0) * ey;
      if (y < prevY) y = prevY;
      prevY = y;
      const cx = cxw + (g.tx - cxw) * ex;
      const w = g.TW + (g.tip - g.TW) * ey;
      const i = k * 4;
      posArray[i] = cx - w / 2; posArray[i + 1] = y;
      posArray[i + 2] = cx + w / 2; posArray[i + 3] = y;
    }
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posArray);
    gl.uniform2f(uViewport, innerWidth, innerHeight);
    gl.uniform1f(uAlpha, 1 - smooth(clamp((p - 0.86) / 0.14)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, (ROWS + 1) * 2);
  }

  function finish(a) {
    const t = a.t, card = t.card();
    anims.delete(a);
    t.anim = null;
    if (a.scrim) a.scrim.remove();
    if (t.overlay) t.el.style.opacity = '';
    for (const x of t.trash) gl.deleteTexture(x);
    t.trash.length = 0;

    if (a.target === 0) {                                // window is now the real element again
      if (card) { card.classList.add('genie-live'); card.classList.remove('genie-hold'); }
      scheduleRefresh(t, 1200);
    } else if (card) {
      card.classList.remove('genie-hold', 'genie-live');
    }
  }

  function tick(now) {
    raf = 0;
    fit();
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const a of Array.from(anims)) {
      const k = clamp((now - a.t0) / a.dur);
      a.p = k >= 1 ? a.target : a.from + (a.target - a.from) * ease(k);
      if (k >= 1) { finish(a); continue; }
      drawGhost(a);
      setBackdrop(a, clamp(1 - a.p));
    }
    if (anims.size) raf = requestAnimationFrame(tick);
    else canvas.style.display = 'none';
  }

  function cancelAll() {
    for (const a of Array.from(anims)) { a.p = a.target; finish(a); }
    cancelAnimationFrame(raf); raf = 0;
    canvas.style.display = 'none';
    for (const t of targets) { const c = t.card(); if (c) c.classList.remove('genie-live', 'genie-hold'); if (t.overlay && !t.hidden) t.el.style.opacity = ''; }
  }

  document.addEventListener('fullscreenchange', () => { if (anims.size) mount(); });

  /* ------------------------------------------------------------------ *
   *  Keep rects fresh while windows are open (so close starts in the right place)
   * ------------------------------------------------------------------ */
  setInterval(() => {
    if (document.hidden || !enabled()) return;
    for (const t of targets) {
      if (t.hidden || t.anim) continue;
      const c = t.card();
      if (!c) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      t.rect = plain(r);
      if (t.overlay) t.oRect = plain(t.el.getBoundingClientRect());
      if (t.snap && (Math.abs(r.width - t.snap.W) > 1 || Math.abs(r.height - t.snap.H) > 1)) {
        t.hard = true;
        scheduleRefresh(t, 300);
      }
    }
  }, 250);

  /* ------------------------------------------------------------------ *
   *  Settings-menu switch: Genie <-> Classic
   * ------------------------------------------------------------------ */
  function label() { return mode === 'genie' ? 'Genie' : 'Classic'; }

  function setMode(m) {
    if (m !== 'genie' && m !== 'classic') return;
    mode = m;
    try { localStorage.setItem(STORE_KEY, m); } catch (e) { /* ignore */ }
    if (m === 'classic') cancelAll();
    const v = document.getElementById('genieModeValue');
    if (v) v.textContent = label();
    if (m === 'genie') for (const t of targets) if (!t.hidden) { t.hard = true; scheduleRefresh(t, 200); }
  }

  function injectRow() {
    const panel = document.getElementById('settingsMainPanel');
    if (!panel || panel.querySelector('#genieModeRow')) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.id = 'genieModeRow';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.innerHTML = '<span>Window animation</span><span class="settings-row-value" id="genieModeValue"></span><span class="settings-row-chevron" style="visibility:hidden">›</span>';
    row.querySelector('#genieModeValue').textContent = label();
    const toggle = e => { e.stopPropagation(); e.preventDefault(); setMode(mode === 'genie' ? 'classic' : 'genie'); };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
    panel.appendChild(row);
  }

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */
  function boot() {
    for (const cfg of TARGETS) { const t = makeTarget(cfg); if (t) targets.push(t); }
    injectRow();
    const panel = document.getElementById('settingsMainPanel');
    if (panel) new MutationObserver(injectRow).observe(panel, { childList: true });
    reduced.addEventListener && reduced.addEventListener('change', () => { if (reduced.matches) cancelAll(); });
    for (const t of targets) if (!t.hidden) scheduleRefresh(t, 600);
  }

  window.GenieFX = { setMode, getMode: () => mode, isActive: enabled };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
