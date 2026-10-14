/* playlist-sort.js: pointer-based drag reordering with animated row shifting */

const EDGE = 56;
const MAX_SCROLL = 16;

export function initPlaylistSort({ list, onCommit }) {
  let drag = null;

  function rows() {
    return Array.from(list.children).filter(el => el.classList.contains('playlist-item'));
  }

  function compute(d) {
    const ptr = d.pointerY - d.startPointerY + (list.scrollTop - d.startScroll);
    const minDy = -d.tops[d.from];
    const maxDy = d.contentH - d.heights[d.from] - d.tops[d.from];
    const dy = Math.max(minDy, Math.min(maxDy, ptr));
    const center = d.tops[d.from] + dy + d.heights[d.from] / 2;
    let target = d.from;
    for (let j = 0; j < d.from; j++) {
      if (center < d.tops[j] + d.heights[j] / 2) { target = j; break; }
    }
    if (target === d.from) {
      for (let j = d.rows.length - 1; j > d.from; j--) {
        if (center > d.tops[j] + d.heights[j] / 2) { target = j; break; }
      }
    }
    return { dy, target };
  }

  function layout(d, dy, target) {
    const step = d.heights[d.from] + d.gap;
    d.rows.forEach((el, j) => {
      if (j === d.from) return;
      let shift = 0;
      if (target < d.from && j >= target && j < d.from) shift = step;
      else if (target > d.from && j <= target && j > d.from) shift = -step;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    d.el.style.transform = `translateY(${dy}px) scale(1.02)`;
    d.target = target;
  }

  function finalDy(d) {
    let dy = 0;
    if (d.target > d.from) for (let j = d.from + 1; j <= d.target; j++) dy += d.heights[j] + d.gap;
    else if (d.target < d.from) for (let j = d.target; j < d.from; j++) dy -= d.heights[j] + d.gap;
    return dy;
  }

  function frame() {
    if (!drag || drag.ending) return;
    const d = drag;
    const lr = list.getBoundingClientRect();
    let v = 0;
    if (d.pointerY < lr.top + EDGE) v = -MAX_SCROLL * Math.min(1, (lr.top + EDGE - d.pointerY) / EDGE);
    else if (d.pointerY > lr.bottom - EDGE) v = MAX_SCROLL * Math.min(1, (d.pointerY - (lr.bottom - EDGE)) / EDGE);
    if (v) list.scrollTop += v;
    const { dy, target } = compute(d);
    layout(d, dy, target);
    d.raf = requestAnimationFrame(frame);
  }

  function cleanup(d) {
    d.rows.forEach(el => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    });
    d.el.classList.remove('dragging', 'drop-settle');
    list.classList.remove('is-sorting');
    document.removeEventListener('keydown', d.onKey, true);
    drag = null;
  }

  function end(commit) {
    const d = drag;
    if (!d || d.ending) return;
    d.ending = true;
    cancelAnimationFrame(d.raf);
    if (!commit) d.target = d.from;
    const settle = d.target === d.from ? 0 : finalDy(d);
    d.el.classList.add('drop-settle');
    d.el.style.transform = `translateY(${settle}px) scale(1)`;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      const from = d.from, to = d.target;
      d.rows.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
      if (from !== to) {
        const ref = to > from ? d.rows[to].nextSibling : d.rows[to];
        list.insertBefore(d.el, ref);
      }
      void list.offsetHeight;
      cleanup(d);
      if (from !== to) onCommit(from, to);
    };
    d.el.addEventListener('transitionend', e => { if (e.target === d.el && e.propertyName === 'transform') done(); });
    setTimeout(done, 320);
  }

  function begin(e, el) {
    if (drag) return;
    const rs = rows();
    const from = rs.indexOf(el);
    if (from === -1 || rs.length < 2) return;
    const cs = getComputedStyle(el);
    const gap = parseFloat(cs.marginBottom) || 0;
    const d = {
      el, rows: rs, from, target: from, gap,
      tops: rs.map(r => r.offsetTop),
      heights: rs.map(r => r.offsetHeight),
      contentH: list.scrollHeight - (parseFloat(getComputedStyle(list).paddingBottom) || 0),
      startPointerY: e.clientY, pointerY: e.clientY, startScroll: list.scrollTop,
      raf: 0, ending: false, pointerId: e.pointerId, handle: e.currentTarget
    };
    d.onKey = (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); end(false); }
    };
    document.addEventListener('keydown', d.onKey, true);
    list.classList.add('is-sorting');
    el.classList.add('dragging');
    el.style.zIndex = '10';
    drag = d;
    d.raf = requestAnimationFrame(frame);
  }

  function attachHandle(handle, rowEl) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      begin(e, rowEl);
      if (!drag) return;
      const move = (ev) => { if (drag && ev.pointerId === drag.pointerId) drag.pointerY = ev.clientY; };
      const up = (ev) => {
        if (!drag || ev.pointerId !== drag.pointerId) return;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel);
        end(true);
      };
      const cancel = (ev) => {
        if (!drag || ev.pointerId !== drag.pointerId) return;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel);
        end(false);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', cancel);
    });
    handle.addEventListener('click', (e) => e.stopPropagation());
  }

  function animateChange(mutate) {
    const rs = rows();
    const first = new Map(rs.map(r => [r, r.getBoundingClientRect().top]));
    mutate();
    const after = rows();
    const moved = [];
    after.forEach(r => {
      if (!first.has(r)) return;
      const dy = first.get(r) - r.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      r.style.transition = 'none';
      r.style.transform = `translateY(${dy}px)`;
      moved.push(r);
    });
    if (!moved.length) return;
    void list.offsetHeight;
    moved.forEach(r => {
      r.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
      r.style.transform = '';
      const clear = () => { r.style.transition = ''; r.removeEventListener('transitionend', clear); };
      r.addEventListener('transitionend', clear);
    });
  }

  function isDragging() { return !!drag; }

  return { attachHandle, animateChange, isDragging };
}
