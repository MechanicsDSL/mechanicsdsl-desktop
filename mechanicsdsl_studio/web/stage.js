/* The motion stage: draws a mechanism as a mechanical drawing on graph paper. */
(function () {
  "use strict";

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function fmt(v) {
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(0).replace("e+", "e");
    return String(+v.toPrecision(3));
  }

  class Stage {
    constructor(canvas, anim, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.anim = anim;
      this.opts = Object.assign({ trails: true, unit: "", grid: true, compact: false }, opts || {});
      this.frame = 0;
      this.colours();
      this.layout();
    }

    colours() {
      this.c = {
        sheet: css("--sheet"), ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"),
        minor: css("--grid-minor"), major: css("--grid-major"), hatch: css("--hatch"), accent: css("--accent"),
        series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css("--s" + i)),
      };
    }

    layout() {
      const dpr = window.devicePixelRatio || 1;
      const r = this.canvas.getBoundingClientRect();
      this.w = Math.max(r.width, 10); this.h = Math.max(r.height, 10);
      this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const a = this.anim;
      let [x0, x1, y0, y1] = a.bounds;
      for (const an of a.anchors || []) { x0 = Math.min(x0, an.x); x1 = Math.max(x1, an.x); y0 = Math.min(y0, an.y); y1 = Math.max(y1, an.y); }
      if (a.kind === "pendulum" || a.kind === "elastic") {           // keep the pivot in view and the swing centred
        const reach = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1));
        x0 = -reach; x1 = reach; y0 = Math.min(y0, -reach * 0.25); y1 = Math.max(y1, reach * 0.18);
      }
      if (a.kind === "cart") { y0 = Math.min(y0, -0.2); y1 = Math.max(y1, 0.35); }
      const spanX = Math.max(x1 - x0, 1e-9), spanY = Math.max(y1 - y0, 1e-9);
      const pad = this.opts.compact ? 0.16 : 0.12;
      const sx = this.w / (spanX * (1 + 2 * pad)), sy = this.h / (spanY * (1 + 2 * pad));
      this.scale = Math.min(sx, sy);
      this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    }

    X(x) { return this.w / 2 + (x - this.cx) * this.scale; }
    Y(y) { return this.h / 2 - (y - this.cy) * this.scale; }

    point(id, f) {
      if (id[0] === "a") { const a = this.anim.anchors[+id.slice(1)]; return [a.x, a.y]; }
      const b = this.anim.bodies[+id.slice(1)];
      return [b.x[f], b.y[f]];
    }

    draw(f) {
      if (f != null) this.frame = f;
      f = this.frame;
      const g = this.ctx, a = this.anim, c = this.c;
      g.clearRect(0, 0, this.w, this.h);
      g.fillStyle = c.sheet; g.fillRect(0, 0, this.w, this.h);
      if (this.opts.grid) this.paper();
      if (a.rail) this.rail();
      if (a.kind === "springs") this.floor();
      for (const an of a.anchors || []) this.anchor(an);
      if (this.opts.trails && a.trail) a.bodies.forEach((b, i) => this.trail(b, i, f));
      for (const l of a.links || []) {
        const p = this.point(l.from, f), q = this.point(l.to, f);
        if (p[0] == null || q[0] == null) continue;
        if (l.style === "spring") this.spring(p, q); else this.rod(p, q);
      }
      a.bodies.forEach((b, i) => this.body(b, i, f));
      if (!this.opts.compact) this.scaleBar();
    }

    paper() {
      const g = this.ctx, step = niceStep(14 / this.scale), major = step * 5;
      const x0 = this.cx - this.w / 2 / this.scale, x1 = this.cx + this.w / 2 / this.scale;
      const y0 = this.cy - this.h / 2 / this.scale, y1 = this.cy + this.h / 2 / this.scale;
      g.lineWidth = 1;
      for (const [s, col] of [[step, this.c.minor], [major, this.c.major]]) {
        g.strokeStyle = col; g.beginPath();
        for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) { const X = Math.round(this.X(x)) + 0.5; g.moveTo(X, 0); g.lineTo(X, this.h); }
        for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) { const Y = Math.round(this.Y(y)) + 0.5; g.moveTo(0, Y); g.lineTo(this.w, Y); }
        g.stroke();
      }
      this.gridStep = major;
    }

    hatch(x0, y0, x1, y1, dir) {
      const g = this.ctx;
      g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
      g.strokeStyle = this.c.hatch; g.lineWidth = 1; g.beginPath();
      const h = y1 - y0, wdt = x1 - x0;
      for (let t = -h; t < wdt + h; t += 6) {
        if (dir > 0) { g.moveTo(x0 + t, y1); g.lineTo(x0 + t + h, y0); } else { g.moveTo(x0 + t, y0); g.lineTo(x0 + t + h, y1); }
      }
      g.stroke(); g.restore();
    }

    anchor(an) {
      const g = this.ctx, X = this.X(an.x), Y = this.Y(an.y), ink = this.c.ink;
      if (an.style === "pivot") {
        this.hatch(X - 34, Y - 11, X + 34, Y, 1);
        g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 34, Y); g.lineTo(X + 34, Y); g.stroke();
        g.fillStyle = this.c.sheet; g.beginPath(); g.arc(X, Y, 4.5, 0, 7); g.fill(); g.lineWidth = 1.8; g.stroke();
      } else if (an.style === "wall") {
        const left = an.x <= this.cx, hgt = 46;
        this.hatch(left ? X - 11 : X, Y - hgt / 2, left ? X : X + 11, Y + hgt / 2, 1);
        g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(X, Y - hgt / 2); g.lineTo(X, Y + hgt / 2); g.stroke();
      } else if (an.style === "star") {
        const s4 = this.c.series[3];
        const grd = g.createRadialGradient(X, Y, 2, X, Y, 26);
        grd.addColorStop(0, s4); grd.addColorStop(1, "transparent");
        g.fillStyle = grd; g.beginPath(); g.arc(X, Y, 26, 0, 7); g.fill();
        g.fillStyle = s4; g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y, 9, 0, 7); g.fill(); g.stroke();
      }
    }

    rail() {
      const g = this.ctx, Y = this.Y(0) + 17;
      this.hatch(0, Y, this.w, Y + 9, 1);
      g.strokeStyle = this.c.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(0, Y); g.lineTo(this.w, Y); g.stroke();
    }

    floor() {
      const g = this.ctx, Y = this.Y(0) + 17;
      const xa = this.X(Math.min(...this.anim.anchors.map((a) => a.x))), xb = this.anim.anchors.length > 1 ? this.X(Math.max(...this.anim.anchors.map((a) => a.x))) : this.w - 20;
      this.hatch(xa, Y, xb, Y + 9, 1);
      g.strokeStyle = this.c.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(xa, Y); g.lineTo(xb, Y); g.stroke();
    }

    rod(p, q) {
      const g = this.ctx;
      g.strokeStyle = this.c.ink; g.lineWidth = 2.4; g.lineCap = "round";
      g.beginPath(); g.moveTo(this.X(p[0]), this.Y(p[1])); g.lineTo(this.X(q[0]), this.Y(q[1])); g.stroke();
    }

    spring(p, q) {
      const g = this.ctx, X0 = this.X(p[0]), Y0 = this.Y(p[1]), X1 = this.X(q[0]), Y1 = this.Y(q[1]);
      const dx = X1 - X0, dy = Y1 - Y0, L = Math.hypot(dx, dy);
      if (L < 1) return;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, lead = Math.min(12, L * 0.15), coils = 9, amp = 7;
      g.strokeStyle = this.c.ink; g.lineWidth = 1.6; g.lineJoin = "round"; g.beginPath();
      g.moveTo(X0, Y0); g.lineTo(X0 + ux * lead, Y0 + uy * lead);
      const body = L - 2 * lead;
      for (let i = 1; i < coils * 2; i++) {
        const s = lead + body * i / (coils * 2), side = i % 2 ? 1 : -1;
        g.lineTo(X0 + ux * s + nx * amp * side, Y0 + uy * s + ny * amp * side);
      }
      g.lineTo(X1 - ux * lead, Y1 - uy * lead); g.lineTo(X1, Y1); g.stroke();
    }

    trail(b, i, f) {
      const g = this.ctx, n = Math.min(f, Math.max(60, Math.round(b.x.length * 0.45)));
      if (n < 2) return;
      const col = this.c.series[i % 8];
      g.lineWidth = 1.7; g.lineCap = "round";
      const seg = 12;
      for (let s = f - n; s < f; s += seg) {
        g.globalAlpha = 0.08 + 0.72 * ((s - (f - n)) / n);
        g.strokeStyle = col; g.beginPath();
        const e = Math.min(f, s + seg);
        let started = false;
        for (let k = Math.max(0, s); k <= e; k++) {
          if (b.x[k] == null) continue;
          const X = this.X(b.x[k]), Y = this.Y(b.y[k]);
          if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    body(b, i, f) {
      const g = this.ctx, x = b.x[f], y = b.y[f];
      if (x == null || y == null) return;
      const X = this.X(x), Y = this.Y(y), col = this.c.series[i % 8];
      g.strokeStyle = this.c.ink; g.lineWidth = 1.6;
      if (b.shape === "cart") {
        const w = 66, h = 28;
        g.fillStyle = this.c.sheet; g.fillRect(X - w / 2, Y - h / 2, w, h); g.strokeRect(X - w / 2, Y - h / 2, w, h);
        g.fillStyle = col; g.globalAlpha = 0.18; g.fillRect(X - w / 2, Y - h / 2, w, h); g.globalAlpha = 1;
        for (const ox of [-19, 19]) { g.fillStyle = this.c.sheet; g.beginPath(); g.arc(X + ox, Y + h / 2 + 3, 5.5, 0, 7); g.fill(); g.stroke(); }
      } else if (b.shape === "block") {
        const s = 30 + 8 * Math.cbrt(b.size || 1);
        g.fillStyle = col; g.fillRect(X - s / 2, Y - s / 2 + 1, s, s - 2); g.strokeRect(X - s / 2, Y - s / 2 + 1, s, s - 2);
      } else {
        const r = this.opts.compact ? 6 : Math.max(6, Math.min(16, 7 + 4 * Math.cbrt(b.size || 1)));
        g.fillStyle = col; g.beginPath(); g.arc(X, Y, r, 0, 7); g.fill(); g.stroke();
      }
    }

    scaleBar() {
      const g = this.ctx, step = this.gridStep || niceStep(80 / this.scale), px = step * this.scale;
      if (!isFinite(px) || px < 10) return;
      const x = 16, y = this.h - 16;
      g.strokeStyle = this.c.ink2; g.fillStyle = this.c.ink2; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 5); g.stroke();
      g.font = "12px 'Plex Sans', 'Segoe UI', sans-serif"; g.textBaseline = "bottom";
      g.fillText(fmt(step) + (this.opts.unit ? " " + this.opts.unit : ""), x + px + 8, y + 1);
    }
  }

  window.Stage = Stage;
})();
