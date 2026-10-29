export class ScratchCard {
  constructor(canvas, onReveal, onProgress) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.onReveal = onReveal; this.onProgress = onProgress; this.active = false; this.frame = null;
    canvas.addEventListener('pointerdown', e => {
      if (!this.active || (e.button !== 0 && e.pointerType !== 'touch') || this.pointer !== undefined) return;
      e.preventDefault(); this.pointer = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* Synthetic touch events have no active native pointer. */ }
      this.last = this.point(e); this.stroke(this.last, this.last); this.schedule();
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.active || this.pointer !== e.pointerId) return;
      e.preventDefault();
      for (const sample of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
        const next = this.point(sample); this.stroke(this.last, next); this.last = next;
      }
      this.schedule();
    });
    const stop = e => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = undefined; this.schedule();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, stop);
    canvas.addEventListener('keydown', e => { if (this.active && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.onReveal(); } });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
  }
  point(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.canvas.width === w && this.canvas.height === h) return;
    const old = document.createElement('canvas'); old.width = this.canvas.width; old.height = this.canvas.height;
    old.getContext('2d').drawImage(this.canvas, 0, 0);
    this.canvas.width = w; this.canvas.height = h; this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.painted) this.ctx.drawImage(old, 0, 0, r.width, r.height); else this.paint();
  }
  reset(enabled) {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null; this.pointer = undefined; this.active = enabled; this.painted = false;
    this.canvas.classList.remove('revealed'); this.canvas.tabIndex = enabled ? 0 : -1;
    this.resize(); this.paint(); this.onProgress(0);
  }
  paint() {
    const { width: w, height: h } = this.canvas.getBoundingClientRect();
    if (!w || !h) return;
    const c = this.ctx; c.globalCompositeOperation = 'source-over';
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#eedba7'); g.addColorStop(.35, '#faf0cc'); g.addColorStop(.65, '#cdb77b'); g.addColorStop(1, '#f2dfaa');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffffff30'; c.lineWidth = 1;
    for (let x = -h; x < w; x += 7) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + h, h); c.stroke(); }
    c.textAlign = 'center'; c.fillStyle = '#73613c'; c.font = 'bold 27px sans-serif'; c.fillText('✦ 刮开这里 ✦', w / 2, h / 2 - 3);
    c.font = '13px sans-serif'; c.fillText('让好运，从指尖发生', w / 2, h / 2 + 29); this.painted = true;
  }
  stroke(a, b) {
    const c = this.ctx; c.globalCompositeOperation = 'destination-out'; c.lineWidth = 42; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x + .01, b.y + .01); c.stroke();
  }
  schedule() {
    if (this.frame || !this.active) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null; if (!this.active) return;
      // Downsample to a small grid instead of reading the full high-DPI surface.
      const sample = this.sample || (this.sample = document.createElement('canvas'));
      sample.width = 64; sample.height = 32;
      const c = sample.getContext('2d', { willReadFrequently: true }); c.drawImage(this.canvas, 0, 0, 64, 32);
      const pixels = c.getImageData(0, 0, 64, 32).data;
      let cleared = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 128) cleared++;
      const ratio = cleared / 2048; this.onProgress(ratio);
      if (ratio >= .45) this.onReveal();
    });
  }
  reveal() { this.active = false; this.pointer = undefined; this.canvas.tabIndex = -1; this.canvas.classList.add('revealed'); this.onProgress(1); }
}
