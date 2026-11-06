/* MechanicsDSL Studio: worksheet interface. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ helpers */
  const $ = (s, el = document) => el.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const icon = (id) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); return s; };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const tex = (s, display) => { try { return katex.renderToString(s, { displayMode: !!display, throwOnError: false, strict: "ignore" }); } catch (e) { return s; } };
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Omega: "Ω", Phi: "Φ", Theta: "Θ" };
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function uname(name) {      // theta1_dot -> θ̇₁
    let dot = "";
    if (name.endsWith("_dot")) { dot = "̇"; name = name.slice(0, -4); }
    let mom = "";
    if (name.startsWith("p_")) { mom = "p"; name = name.slice(2); }
    const m = name.match(/^([A-Za-z]+?)_?(\d*)$/);
    const base = m ? (GREEK[m[1]] || m[1]) : name, sub = m ? m[2].replace(/\d/g, (d) => SUB[d]) : "";
    return mom ? "p" + (GREEK[m && m[1]] || base) + sub : base + dot + sub;
  }
  function fmtNum(v) {
    if (v == null || !isFinite(v)) return "";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(4).replace(/\.?0+e/, "e");
    return String(+v.toPrecision(6));
  }
  function fmtTime(s) { return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(s < 10 ? 2 : 1) + " s"; }

  /* ------------------------------------------------------------------ bridge */
  const inWindow = !window.MDSL_DEV;            // the development server sets MDSL_DEV
  const bridgeReady = new Promise((resolve) => {
    if (!inWindow) return resolve();
    if (window.pywebview && window.pywebview.api) return resolve();
    window.addEventListener("pywebviewready", () => resolve(), { once: true });
  });
  async function call(name, ...args) {
    await bridgeReady;
    if (inWindow) return window.pywebview.api[name](...args);
    const r = await fetch("/api/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("Not available in the browser preview");
    return r.json();
  }

  /* ------------------------------------------------------------------ state */
  const state = { title: "Untitled worksheet", path: null, cells: [], dirty: false, info: null, examples: [], focused: null, busy: 0 };
  const sheet = $("#sheet");

  function setDirty(d) {
    state.dirty = d;
    $("#dirty-flag").hidden = !d;
    call("set_dirty", d).catch(() => {});
    saveDraft();
  }
  const saveDraft = debounce(() => store.set("mdsl-studio-draft", serialise()), 400);

  function serialise() {
    return {
      format: "mechanicsdsl-worksheet", version: 1, app: "MechanicsDSL Studio " + ((state.info && state.info.app_version) || ""),
      title: state.title, path: state.path, dirty: state.dirty,
      cells: state.cells.map((c) => ({ type: c.type, source: c.source, settings: c.type === "code" ? c.settings : undefined, view: c.view })),
    };
  }

  function status(msg) { $("#status-msg").textContent = msg || ""; }
  function engine(stateName, text) {
    const el = $("#engine-state");
    el.className = "engine-state " + stateName;
    el.lastChild.textContent = text;
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
  }

  /* ------------------------------------------------------------------ DSL editor mode */
  CodeMirror.defineSimpleMode("mdsl", {
    start: [
      { regex: /%.*/, token: "comment" },
      { regex: /\\(?:system|defvar|parameter|lagrangian|hamiltonian|force|initial|constraint|nonholonomic|damping|rayleigh|define|solve|animate|plot|export|import|transform|fluid|boundary|region)\b/, token: "keyword" },
      { regex: /\\(?:dot|ddot|frac|sqrt|sin|cos|tan|exp|log|ln|sinh|cosh|tanh|arcsin|arccos|arctan|cdot|vec|hat|partial|sum|int|pi|infty)\b/, token: "builtin" },
      { regex: /\\[A-Za-z]+/, token: "variable-2" },
      { regex: /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/, token: "number" },
      { regex: /[{}\[\]()]/, token: "bracket" },
      { regex: /[-+*/^=,_]/, token: "operator" },
    ],
    meta: { lineComment: "%" },
  });

  /* ------------------------------------------------------------------ rail */
  const REFERENCE = [
    ["\\system{name}", "Names the system. The name is used for generated files."],
    ["\\defvar{q}{description}{unit}", "Declares a generalised coordinate."],
    ["\\parameter{m}{1.0}{kg}", "Declares a constant with its value and unit. Each one gets a slider."],
    ["\\lagrangian{T - V}", "The Lagrangian. Use \\dot{q} for a velocity, \\frac{a}{b}, \\cos{x}, \\sqrt{x} and ^ for powers."],
    ["\\hamiltonian{H}", "Use Hamilton's equations instead, with momenta p_q."],
    ["\\force{-b*\\dot{x}}", "A generalised force that is not derived from a potential, such as damping."],
    ["\\constraint{expression}", "A holonomic constraint, expression = 0."],
    ["\\initial{q=0.5, q_dot=0}", "Starting values. Anything left out starts at zero."],
  ];
  function renderRail() {
    const ex = $("#rail-examples");
    ex.replaceChildren();
    const groups = {};
    for (const e of state.examples) (groups[e.category] = groups[e.category] || []).push(e);
    for (const [g, list] of Object.entries(groups)) {
      ex.append(h("div", { class: "rail-group" }, g));
      for (const e of list) ex.append(h("button", { class: "example", onclick: () => addExample(e), title: "Add to the worksheet and run" }, h("strong", {}, e.title), h("span", {}, e.summary)));
    }
    const ref = $("#rail-reference");
    ref.replaceChildren(h("p", { class: "ref-intro" }, "Select a line to insert it at the cursor in the focused system."));
    for (const [code, desc] of REFERENCE) ref.append(h("div", { class: "ref-item", tabindex: 0, onclick: () => insertSnippet(code), onkeydown: (e) => e.key === "Enter" && insertSnippet(code) }, h("code", {}, code), h("p", {}, desc)));
  }
  function insertSnippet(code) {
    const c = state.focused && state.focused.type === "code" ? state.focused : state.cells.find((x) => x.type === "code");
    if (!c) return toast("Add a system first.");
    c.editor.replaceSelection(code + "\n");
    c.editor.focus();
  }
  document.querySelectorAll(".rail-tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".rail-tab").forEach((x) => { x.classList.toggle("active", x === t); x.setAttribute("aria-selected", x === t); });
    $("#rail-examples").hidden = t.dataset.rail !== "examples";
    $("#rail-reference").hidden = t.dataset.rail !== "reference";
  }));
  $("#toggle-rail").addEventListener("click", () => {
    $("#app").classList.toggle("rail-hidden");
    store.set("mdsl-studio-rail", !$("#app").classList.contains("rail-hidden"));
    setTimeout(() => state.cells.forEach(relayout), 50);
  });

  /* ------------------------------------------------------------------ start screen */
  function renderStart() {
    sheet.replaceChildren();
    const grid = h("div", { class: "start-grid" });
    const wrap = h("section", { class: "start" },
      h("h1", {}, "Write a Lagrangian. See the motion."),
      h("p", {}, "Each system gives you its equations of motion, plots, an animation and generated code. Start from an example or write your own."),
      grid,
      h("div", { class: "start-actions" },
        h("button", { class: "btn primary", onclick: () => { addCell("code", null, null, null, true); } }, "New system"),
        h("button", { class: "btn", onclick: openWorksheet }, "Open worksheet…")));
    sheet.append(wrap);
    for (const e of state.examples.slice(0, 8)) {
      const cv = h("canvas", { "aria-hidden": "true" });
      grid.append(h("button", { class: "start-card", onclick: () => addExample(e) }, cv, h("div", {}, h("strong", {}, e.title), h("span", {}, e.summary))));
      requestAnimationFrame(() => thumbnail(cv, e.id));
    }
  }
  function thumbnail(cv, id) {      // a still drawing of each example, made without running it
    const T = [0, 1], one = (x, y) => ({ x: [x, x], y: [y, y] });
    const pend = (angs) => { let x = 0, y = 0; return angs.map((a) => { x += Math.sin(a); y -= Math.cos(a); return Object.assign(one(x, y), { size: 1 }); }); };
    let a;
    if (id === "simple-pendulum") a = { kind: "pendulum", bodies: pend([0.55]), anchors: [{ x: 0, y: 0, style: "pivot" }], links: [{ from: "a0", to: "b0", style: "rod" }] };
    else if (id === "double-pendulum") a = { kind: "pendulum", bodies: pend([0.9, 2.1]), anchors: [{ x: 0, y: 0, style: "pivot" }], links: [{ from: "a0", to: "b0", style: "rod" }, { from: "b0", to: "b1", style: "rod" }] };
    else if (id === "elastic-pendulum") a = { kind: "elastic", bodies: [Object.assign(one(Math.sin(0.5) * 1.3, -Math.cos(0.5) * 1.3), { size: 1 })], anchors: [{ x: 0, y: 0, style: "pivot" }], links: [{ from: "a0", to: "b0", style: "spring" }] };
    else if (id === "pendulum-on-cart") a = { kind: "cart", rail: true, bodies: [Object.assign(one(0, 0), { shape: "cart", size: 2 }), Object.assign(one(Math.sin(0.7), -Math.cos(0.7)), { size: 1 })], anchors: [], links: [{ from: "b0", to: "b1", style: "rod" }] };
    else if (id === "damped-oscillator") a = { kind: "springs", bodies: [Object.assign(one(1.25, 0), { shape: "block" })], anchors: [{ x: 0, y: 0, style: "wall" }], links: [{ from: "a0", to: "b0", style: "spring" }] };
    else if (id === "coupled-oscillators") a = { kind: "springs", bodies: [Object.assign(one(1.15, 0), { shape: "block" }), Object.assign(one(1.95, 0), { shape: "block" })], anchors: [{ x: 0, y: 0, style: "wall" }, { x: 3, y: 0, style: "wall" }], links: [{ from: "a0", to: "b0", style: "spring" }, { from: "b0", to: "b1", style: "spring" }, { from: "b1", to: "a1", style: "spring" }] };
    else if (id === "projectile" || id === "kepler-orbit" || id === "figure-eight") {
      const n = 160, bodies = [];
      const path = (fx, fy) => { const x = [], y = []; for (let i = 0; i < n; i++) { const s = i / (n - 1); x.push(fx(s)); y.push(fy(s)); } return { x, y, size: 1 }; };
      let anchors = [];
      if (id === "projectile") bodies.push(path((s) => 20 * s, (s) => 20 * s * (1 - s) * 0.5));
      if (id === "kepler-orbit") { anchors = [{ x: 0, y: 0, style: "star" }]; bodies.push(path((s) => { const E = 2 * Math.PI * s * 0.86; return Math.cos(E) - 0.35; }, (s) => 0.94 * Math.sin(2 * Math.PI * s * 0.86))); }
      if (id === "figure-eight") for (let k = 0; k < 3; k++) bodies.push(path((s) => Math.sin(2 * Math.PI * (s * 0.3 + k / 3)), (s) => 0.5 * Math.sin(4 * Math.PI * (s * 0.3 + k / 3))));
      a = { kind: "particles", bodies, anchors, links: [], trail: true };
    }
    if (!a) return;
    const all = a.bodies.flatMap((b) => b.x), allY = a.bodies.flatMap((b) => b.y);
    a.bounds = [Math.min(...all), Math.max(...all), Math.min(...allY), Math.max(...allY)];
    a.t = T;
    const st = new Stage(cv, a, { compact: true, trails: !!a.trail });
    st.draw(a.bodies[0].x.length - 1);
  }

  /* ------------------------------------------------------------------ cells */
  function addExample(e) {
    const empty = !state.cells.length;
    if (empty) {
      state.title = e.title; $("#doc-title").value = e.title; call("set_title", e.title).catch(() => {});
      addCell("text", "# " + e.title + "\n\n" + e.summary, null, null, false);
    }
    const c = addCell("code", e.source, Object.assign({ parameters: {}, initial: {} }, e.settings), null, false);
    c.el.scrollIntoView({ block: "start" });
    runCell(c);
  }

  function addCell(type, source, settings, index, focus) {
    if (!state.cells.length) sheet.replaceChildren();
    const c = {
      id: uid(), type, source: source != null ? source : (type === "code" ? null : ""),
      settings: Object.assign({ t_end: 10, points: 1000, parameters: {}, initial: {} }, settings || {}),
      view: { tab: "motion" }, result: null, state: "new",
    };
    if (type === "code" && c.source == null) c.source = "";
    const at = index == null ? state.cells.length : index;
    state.cells.splice(at, 0, c);
    buildCell(c);
    placeCells();
    if (type === "code" && !c.source) call("blank").then((b) => { c.editor.setValue(b); c.source = b; }).catch(() => {});
    if (focus) setTimeout(() => (c.editor ? c.editor.focus() : editText(c)), 30);
    setDirty(true);
    return c;
  }

  function placeCells() {
    sheet.replaceChildren();
    if (!state.cells.length) return renderStart();
    sheet.append(insertBar(0));
    state.cells.forEach((c, i) => { sheet.append(c.el); sheet.append(insertBar(i + 1)); });
    state.cells.forEach((c) => c.editor && c.editor.refresh());
  }
  function insertBar(i) {
    return h("div", { class: "insert-bar" },
      h("button", { onclick: () => addCell("code", null, null, i, true) }, "Add system"),
      h("button", { onclick: () => addCell("text", "", null, i, true) }, "Add text"));
  }

  function moveCell(c, d) {
    const i = state.cells.indexOf(c), j = i + d;
    if (j < 0 || j >= state.cells.length) return;
    state.cells.splice(i, 1); state.cells.splice(j, 0, c);
    placeCells(); setDirty(true);
  }
  function deleteCell(c) {
    const i = state.cells.indexOf(c);
    if (c.stage) c.stage.stop();
    state.cells.splice(i, 1);
    placeCells(); setDirty(true);
    toast("Removed.");
  }

  function buildCell(c) {
    const tools = h("div", { class: "cell-tools" },
      h("button", { class: "icon-btn", title: "Move up", "aria-label": "Move up", onclick: () => moveCell(c, -1) }, "↑"),
      h("button", { class: "icon-btn", title: "Move down", "aria-label": "Move down", onclick: () => moveCell(c, 1) }, "↓"),
      h("button", { class: "icon-btn", title: "Delete", "aria-label": "Delete", onclick: () => deleteCell(c) }, "✕"));
    const body = h("div", { class: "cell-body" });
    c.el = h("div", { class: "cell " + (c.type === "text" ? "text-cell" : "code-cell"), dataset: { state: "new" } },
      h("div", { class: "gutter" }, h("span", { class: "mark", title: "Not run yet" })), body);
    c.el.addEventListener("focusin", () => focusCell(c));
    c.el.addEventListener("mousedown", () => focusCell(c));
    if (c.type === "text") {
      body.append(h("div", { class: "cell-head" }, tools));
      c.prose = h("div", { class: "prose", tabindex: 0, ondblclick: () => editText(c), onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); editText(c); } } });
      body.append(c.prose);
      renderText(c);
      return;
    }
    c.runBtn = h("button", { class: "btn primary small run-btn", title: "Run (Shift+Enter)", onclick: () => (c.state === "running" ? call("cancel") : runCell(c)) }, icon("i-play"), "Run");
    body.append(h("div", { class: "cell-head" }, h("span", { class: "cell-kind" }, "System"), tools, c.runBtn));
    const ed = h("div", { class: "editor" });
    body.append(ed, h("div", { class: "progress" }));
    c.msg = h("div"); c.out = h("div");
    body.append(c.msg, c.out);
    c.editor = CodeMirror(ed, {
      value: c.source || "", mode: "mdsl", theme: "mdsl", lineNumbers: true, lineWrapping: true, matchBrackets: true,
      autoCloseBrackets: "{}()[]", styleActiveLine: true, viewportMargin: Infinity, tabSize: 4, indentUnit: 4,
      extraKeys: {
        "Shift-Enter": () => { runCell(c); const n = state.cells[state.cells.indexOf(c) + 1]; if (n && n.editor) n.editor.focus(); },
        "Ctrl-Enter": () => runCell(c), "Cmd-Enter": () => runCell(c),
        Tab: (cm) => cm.replaceSelection("    "),
      },
    });
    c.editor.on("change", () => {
      c.source = c.editor.getValue();
      if (c.errorLine) { c.editor.removeLineClass(c.errorLine, "background", "cm-error-line"); c.errorLine = null; }
      if (c.state === "done" || c.state === "error") setCellState(c, "stale");
      setDirty(true);
    });
  }

  function focusCell(c) {
    if (state.focused === c) return;
    if (state.focused) state.focused.el.classList.remove("focused");
    state.focused = c; c.el.classList.add("focused");
  }

  function setCellState(c, s) {
    c.state = s; c.el.dataset.state = s;
    const titles = { new: "Not run yet", running: "Running", done: "Up to date", stale: "Edited since the last run", error: "Stopped with an error" };
    c.el.querySelector(".mark").title = titles[s] || "";
    if (c.runBtn) c.runBtn.replaceChildren(icon(s === "running" ? "i-stop" : "i-play"), s === "running" ? "Stop" : "Run");
  }

  /* ------------------------------------------------------------------ text cells */
  function renderText(c) {
    const src = c.source.trim();
    if (!src) { c.prose.innerHTML = '<p class="placeholder">Double-click to write notes. Use # for headings and $…$ for mathematics.</p>'; return; }
    c.prose.innerHTML = markdown(src);
  }
  function editText(c) {
    if (c.textarea) return;
    const ta = h("textarea", { class: "text-editor", spellcheck: "true", "aria-label": "Notes" });
    ta.value = c.source;
    const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    ta.addEventListener("input", () => { c.source = ta.value; fit(); setDirty(true); });
    const done = () => { c.textarea = null; ta.replaceWith(c.prose); renderText(c); };
    ta.addEventListener("blur", done);
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape" || (e.key === "Enter" && e.shiftKey)) { e.preventDefault(); ta.blur(); } });
    c.prose.replaceWith(ta); c.textarea = ta; fit(); ta.focus();
  }
  function markdown(src, texFn) {
    const maths = [], render = texFn || tex;
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { maths.push(render(m, true)); return "\u0000" + (maths.length - 1) + "\u0000"; });
    src = src.replace(/\$([^$\n]+?)\$/g, (_, m) => { maths.push(render(m, false)); return "\u0000" + (maths.length - 1) + "\u0000"; });
    const inline = (s) => escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
    const out = [];
    let list = null;
    for (const block of src.split(/\n{2,}/)) {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) { out.push("<ul>" + lines.map((l) => "<li>" + inline(l.replace(/^\s*[-*] /, "")) + "</li>").join("") + "</ul>"); continue; }
      const m = block.match(/^(#{1,3}) (.*)$/);
      if (m && lines.length === 1) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      out.push("<p>" + lines.map(inline).join("<br>") + "</p>");
    }
    return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => maths[+i]);
  }

  /* ------------------------------------------------------------------ running */
  async function runCell(c, opts) {
    opts = opts || {};
    if (c.type !== "code") return;
    if (c.running) { c.queued = true; return; }
    c.running = true; c.queued = false;
    setCellState(c, "running");
    state.busy++; engine("busy", "Computing");
    if (!opts.quiet) c.msg.replaceChildren();
    let r;
    try { r = await call("run", c.source, c.settings); }
    catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    state.busy--; if (!state.busy) engine("ready", "Engine ready");
    c.running = false;
    if (r.cancelled) { setCellState(c, c.result ? "stale" : "new"); status("Stopped."); return; }
    if (!r.ok && r.stage !== "simulate") {
      setCellState(c, "error");
      c.msg.replaceChildren(h("div", { class: "error-note" }, h("strong", {}, r.error || "The system could not be compiled."),
        h("p", {}, "Check the line in question and run again. The Reference tab lists every command.")));
      if (!opts.quiet) c.out.replaceChildren();
      c.result = null;
      const m = /line (\d+)/.exec(r.error || "");
      if (m && +m[1] <= c.editor.lineCount()) { c.errorLine = c.editor.addLineClass(+m[1] - 1, "background", "cm-error-line"); }
    } else {
      c.result = r;
      setCellState(c, r.ok ? "done" : "error");
      const notes = [];
      if (!r.ok) notes.push(h("div", { class: "error-note" }, h("strong", {}, "The simulation failed. "), r.error || "", h("p", {}, "The equations above are still valid. Try a shorter time span or different starting values.")));
      c.msg.replaceChildren(...notes);
      renderOutput(c, opts.quiet);
      status(r.timing ? `Ran ${r.system.name} in ${fmtTime(r.timing.total)}` + (r.cached ? " (equations reused)" : "") : "");
    }
    if (c.queued) runCell(c, { quiet: true });
  }

  async function runAll() {
    for (const c of state.cells) if (c.type === "code") await runCell(c);
  }

  /* ------------------------------------------------------------------ output */
  function renderOutput(c, keepView) {
    const r = c.result, sys = r.system;
    if (keepView && c.outParts) { updateOutput(c); return; }
    if (c.stage) c.stage.stop();
    const head = h("div", { class: "out-head" }, h("h3", {}, sys.name.replace(/_/g, " ")),
      h("span", { class: "fact" }, "Formulation ", h("b", {}, sys.formulation)),
      h("span", { class: "fact" }, "Degrees of freedom ", h("b", {}, sys.coordinates.length)),
      r.timing ? h("span", { class: "fact" }, "Compiled and solved in ", h("b", {}, fmtTime(r.timing.total))) : null);
    const eqs = h("div", { class: "equations" });
    renderEquations(eqs, r.equations);

    const tabs = [["motion", "Motion"], ["coords", "Coordinates"], ["phase", "Phase portrait"], ["energy", "Energy"], ["code", "Code"]];
    const tabBar = h("div", { class: "tabs", role: "tablist" });
    const pane = h("div", { class: "pane" });
    const panes = {};
    for (const [id, label] of tabs) tabBar.append(h("button", { class: "tab" + (c.view.tab === id ? " active" : ""), role: "tab", "aria-selected": c.view.tab === id, onclick: () => showTab(c, id) }, label));
    const controls = renderControls(c);
    const bench = h("div", { class: "bench" }, h("div", { class: "bench-main" }, tabBar, pane), controls);
    c.out.replaceChildren(h("div", { class: "output" }, head, eqs, r.ok ? bench : null));
    c.outParts = { head, eqs, tabBar, pane, panes, controls };
    if (r.ok) showTab(c, c.view.tab || "motion");
  }

  function updateOutput(c) {      // after a slider change: refresh the data, keep the layout
    const p = c.outParts, r = c.result;
    if (!r.ok) return renderOutput(c, false);
    const facts = p.head.querySelectorAll(".fact b");
    if (facts[2] && r.timing) facts[2].textContent = fmtTime(r.timing.total);
    for (const k of Object.keys(p.panes)) { if (k !== "code") { purge(p.panes[k]); delete p.panes[k]; } }
    const motionPlaying = c.stage && c.stage.playing;
    if (c.stage) c.stage.stop();
    showTab(c, c.view.tab, motionPlaying);
  }
  function purge(el) { el.querySelectorAll(".js-plotly-plot").forEach((p) => Plotly.purge(p)); }

  function renderEquations(el, eq) {
    if (!eq || eq.error) { el.append(h("p", { class: "eq-note" }, (eq && eq.error) || "")); return; }
    for (const b of eq.blocks) {
      const copy = h("button", { class: "icon-btn", title: "Copy as LaTeX", "aria-label": "Copy as LaTeX", onclick: () => copyText(b.lines.join(" \\\\\n"), "LaTeX copied.") }, icon("i-copy"));
      const block = h("div", { class: "eq-block" }, h("div", { class: "eq-title" }, b.title, copy));
      for (const line of b.lines) block.append(h("div", { class: "eq-line", html: tex(line, true) }));
      if (b.note) block.append(h("div", { class: "eq-note" }, b.note));
      el.append(block);
    }
  }

  function showTab(c, id, autoplay) {
    c.view.tab = id;
    const p = c.outParts;
    p.tabBar.querySelectorAll(".tab").forEach((t, i) => { const on = ["motion", "coords", "phase", "energy", "code"][i] === id; t.classList.toggle("active", on); t.setAttribute("aria-selected", on); });
    if (c.stage && id !== "motion") c.stage.pause();
    if (!p.panes[id]) {
      p.panes[id] = h("div");
      p.pane.replaceChildren(p.panes[id]);
      ({ motion: paneMotion, coords: paneCoords, phase: panePhase, energy: paneEnergy, code: paneCode })[id](c, p.panes[id], autoplay);
    } else {
      p.pane.replaceChildren(p.panes[id]);
      p.panes[id].querySelectorAll(".js-plotly-plot").forEach((g) => Plotly.Plots.resize(g));
      if (id === "motion" && c.stage) c.stage.relayout();
    }
  }

  function relayout(c) {
    if (!c.outParts) return;
    if (c.stage && c.view.tab === "motion") c.stage.relayout();
    c.outParts.pane.querySelectorAll(".js-plotly-plot").forEach((g) => Plotly.Plots.resize(g));
  }

  /* motion */
  function paneMotion(c, el, autoplay) {
    const a = c.result.animation, sys = c.result.system;
    if (!a) {
      el.append(h("div", { class: "no-anim" }, "This system's coordinates don't match a shape the stage can draw: a pendulum chain, a spring and mass, a cart, an orbit or particles in a plane. Its motion is in the Coordinates and Phase portrait tabs."));
      return;
    }
    const unitOf = () => { const p = sys.parameters.find((x) => /^[lL]\d*$|^l0$/.test(x.name)); const q = sys.coordinates.find((x) => x.unit && x.unit !== "rad"); return (p && p.unit) || (q && q.unit) || ""; };
    const cv = h("canvas", { role: "img", "aria-label": "Animation of " + sys.name });
    const caption = h("div", { class: "stage-caption" }, captionFor(a));
    const stageEl = h("div", { class: "stage" }, cv, caption);
    const playBtn = h("button", { class: "icon-btn", "aria-label": "Play" }, icon("i-play"));
    const scrub = h("input", { type: "range", min: 0, max: a.t.length - 1, value: 0, step: 1, "aria-label": "Time" });
    const clock = h("span", { class: "clock" });
    const tEnd = a.t[a.t.length - 1] || 1;
    const base = tEnd < 6 ? tEnd / 6 : tEnd > 20 ? tEnd / 20 : 1;     // aim for 6 to 20 seconds of playback
    const speed = h("select", { "aria-label": "Playback speed" }, ...[0.25, 0.5, 1, 2, 4].map((s) => h("option", { value: s, selected: s === 1 }, s + "×")));
    const trails = h("input", { type: "checkbox", checked: !!a.trail });
    const save = h("button", { class: "btn small", onclick: () => saveCanvas(cv, sys.name) }, "Save frame");
    el.append(stageEl, h("div", { class: "transport" }, playBtn, scrub, clock, speed,
      a.trail ? h("label", { class: "check" }, trails, "Trails") : null, save));

    const st = new Stage(cv, a, { trails: !!a.trail, unit: unitOf() });
    let raf = null, last = 0, simT = 0;
    const show = (f) => { st.draw(f); scrub.value = f; clock.textContent = `t = ${fmtNum(+a.t[f].toPrecision(4))} of ${fmtNum(tEnd)}`; };
    const frameAt = (t) => { let lo = 0, hi = a.t.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a.t[m] <= t) lo = m; else hi = m - 1; } return lo; };
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      simT += dt * base * +speed.value;
      if (simT > tEnd) simT = 0;
      show(frameAt(simT));
      raf = requestAnimationFrame(tick);
    };
    const ctl = {
      playing: false,
      play() { if (raf) return; ctl.playing = true; last = performance.now(); simT = a.t[+scrub.value]; playBtn.replaceChildren(icon("i-pause")); playBtn.setAttribute("aria-label", "Pause"); raf = requestAnimationFrame(tick); },
      pause() { ctl.playing = false; if (raf) cancelAnimationFrame(raf); raf = null; playBtn.replaceChildren(icon("i-play")); playBtn.setAttribute("aria-label", "Play"); },
      stop() { ctl.pause(); },
      relayout() { st.colours(); st.layout(); show(+scrub.value); },
    };
    playBtn.onclick = () => (ctl.playing ? ctl.pause() : ctl.play());
    scrub.oninput = () => { ctl.pause(); show(+scrub.value); };
    trails.onchange = () => { st.opts.trails = trails.checked; show(+scrub.value); };
    c.stage = ctl;
    requestAnimationFrame(() => { st.layout(); show(0); if (autoplay !== false && !matchMedia("(prefers-reduced-motion: reduce)").matches) ctl.play(); });
  }
  function captionFor(a) {
    return ({ pendulum: "Pendulum, angles measured from the downward vertical", elastic: "Mass on a spring, free to swing", orbit: "Orbit about the origin", cart: "Cart on a horizontal track", particles: "Bodies moving in the plane", springs: a.display_scale < 1 ? "Masses on springs (displacements enlarged for clarity)" : "Masses on springs" })[a.kind] || "";
  }

  /* plots */
  function plotTheme(extra) {
    const ink2 = css("--ink-2"), rule = css("--rule-2"), axis = { gridcolor: rule, zeroline: false, linecolor: css("--rule"), tickfont: { size: 11.5, color: ink2 }, title: { font: { size: 12.5, color: ink2 } }, automargin: true };
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { family: "Plex Sans, Segoe UI, sans-serif", size: 12, color: ink2 },
      margin: { l: 64, r: 16, t: 24, b: 40 }, showlegend: false, hovermode: "x unified",
      hoverlabel: { bgcolor: css("--sheet"), bordercolor: css("--rule"), font: { color: css("--ink"), size: 12 } },
      _axis: axis,
    }, extra || {});
  }
  const plotConfig = { responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: "reset" };
  const series = (i) => css("--s" + ((i % 8) + 1));

  function chartBox(el, note, name) {
    const box = h("div", { class: "chart" });
    const bar = h("div", { class: "pane-note", style: "display:flex;align-items:center;gap:12px" }, h("span", { style: "flex:1" }, note || ""),
      h("button", { class: "btn small", onclick: () => saveChart(box, name) }, "Save image"));
    el.append(bar, box);
    return box;
  }

  function paneCoords(c, el) {
    const r = c.result, s = r.simulation, n = s.coordinates.length;
    const box = chartBox(el, "Drag to zoom, double-click to reset.", r.system.name + " coordinates");
    const t = plotTheme({ grid: { rows: n, columns: 1, pattern: "independent", roworder: "top to bottom", ygap: 0.28 }, height: Math.max(260, 64 + n * 150) });
    const traces = [], layout = Object.assign({}, t);
    s.coordinates.forEach((q, i) => {
      const k = i ? String(i + 1) : "";
      const unit = (r.system.coordinates[i] || {}).unit;
      traces.push({ x: s.t, y: s.series[q], xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "lines", line: { color: series(i), width: 2 }, name: uname(q), hovertemplate: "%{y:.5g}<extra>" + uname(q) + "</extra>" });
      layout["xaxis" + k] = Object.assign({}, t._axis, i ? { matches: "x" } : {}, i === n - 1 ? { title: { text: "Time", font: t._axis.title.font } } : { showticklabels: false });
      layout["yaxis" + k] = Object.assign({}, t._axis, { title: { text: uname(q) + (unit ? ` (${unit})` : ""), font: t._axis.title.font } });
    });
    delete layout._axis;
    Plotly.newPlot(box, traces, layout, plotConfig);
  }

  function panePhase(c, el) {
    const r = c.result, s = r.simulation, n = s.coordinates.length, cols = Math.min(n, n === 4 ? 2 : 3), rows = Math.ceil(n / cols);
    const box = chartBox(el, "Each coordinate against its velocity. A closed loop is periodic motion; a spiral is losing energy.", r.system.name + " phase portrait");
    const t = plotTheme({ grid: { rows, columns: cols, pattern: "independent", xgap: 0.22, ygap: 0.3 }, height: rows * (cols === 1 ? 380 : 300) + 30, hovermode: "closest" });
    const traces = [], layout = Object.assign({}, t);
    s.coordinates.forEach((q, i) => {
      const k = i ? String(i + 1) : "", v = s.velocity_suffix === "p_" ? "p_" + q : q + "_dot";
      traces.push({ x: s.series[q], y: s.series[v], customdata: s.t, xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "lines", line: { color: series(i), width: 1.6 },
        hovertemplate: `${uname(q)} %{x:.4g}<br>${uname(v)} %{y:.4g}<br>t %{customdata:.4g}<extra></extra>` });
      traces.push({ x: [s.series[q][0]], y: [s.series[v][0]], xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "markers", marker: { size: 9, color: css("--sheet"), line: { color: series(i), width: 2 } }, hovertemplate: "Start<extra></extra>" });
      layout["xaxis" + k] = Object.assign({}, t._axis, { title: { text: uname(q), font: t._axis.title.font } });
      layout["yaxis" + k] = Object.assign({}, t._axis, { title: { text: uname(v), font: t._axis.title.font } });
    });
    delete layout._axis;
    Plotly.newPlot(box, traces, layout, plotConfig);
  }

  function paneEnergy(c, el) {
    const r = c.result, e = r.energy, s = r.simulation;
    if (!e) { el.append(h("div", { class: "no-anim" }, "The energy function is not available for this system.")); return; }
    const drift = e.max_relative_drift;
    const note = e.conserved
      ? h("span", {}, "Energy should be conserved for this system, so its drift measures the solver's accuracy. Largest relative drift: ", h("b", {}, drift.toExponential(1)), "." +
          ((r.simulation && r.simulation.integrator === "symplectic") ? " The symplectic integrator keeps this error bounded, so it does not grow with the length of the run." : ""))
      : h("span", {}, "Forces in this system do work, so the energy changes over time.");
    const box = chartBox(el, "", r.system.name + " energy");
    box.previousSibling.firstChild.replaceChildren(note);
    const t = plotTheme({ grid: { rows: 2, columns: 1, pattern: "independent", ygap: 0.3 }, height: 430 });
    const layout = Object.assign({}, t, {
      xaxis: Object.assign({}, t._axis, { showticklabels: false }), xaxis2: Object.assign({}, t._axis, { matches: "x", title: { text: "Time", font: t._axis.title.font } }),
      yaxis: Object.assign({}, t._axis, { title: { text: "Energy h(q, q̇)", font: t._axis.title.font } }),
      yaxis2: Object.assign({}, t._axis, { title: { text: "Relative drift", font: t._axis.title.font }, exponentformat: "e" }),
    });
    delete layout._axis;
    Plotly.newPlot(box, [
      { x: s.t, y: e.values, type: "scatter", mode: "lines", line: { color: series(0), width: 2 }, hovertemplate: "%{y:.8g}<extra>Energy</extra>" },
      { x: s.t, y: e.relative_drift, xaxis: "x2", yaxis: "y2", type: "scatter", mode: "lines", line: { color: series(1), width: 1.6 }, hovertemplate: "%{y:.3e}<extra>Drift</extra>" },
    ], layout, plotConfig);
  }

  /* code */
  const CM_MODE = { cpp: "text/x-c++src", openmp: "text/x-c++src", cuda: "text/x-c++src", arm: "text/x-csrc", arduino: "text/x-c++src", wasm: "text/x-csrc", python: "python", rust: "rust", julia: "julia", matlab: "octave", fortran: "fortran", javascript: "javascript" };
  function modeFor(path, target) {
    const ext = path.split(".").pop().toLowerCase();
    return ({ py: "python", rs: "rust", jl: "julia", m: "octave", f90: "fortran", js: "javascript", html: "htmlmixed", cu: "text/x-c++src", c: "text/x-csrc", h: "text/x-csrc", cpp: "text/x-c++src", ino: "text/x-c++src" })[ext] || CM_MODE[target] || null;
  }
  function paneCode(c, el) {
    const targets = (state.info && state.info.targets) || [];
    const sel = h("select", { "aria-label": "Language" }, ...targets.map((t) => h("option", { value: t.id, selected: t.id === (c.view.target || "cpp") }, t.label)));
    const gen = h("button", { class: "btn primary small" }, "Generate");
    const copyBtn = h("button", { class: "btn small", disabled: true }, icon("i-copy"), "Copy");
    const saveBtn = h("button", { class: "btn small", disabled: true }, "Save files…");
    const files = h("div", { class: "file-tabs" });
    const view = h("div", { class: "code-view" });
    const note = h("p", { class: "pane-note" }, "Generate a standalone simulation of this system in another language, from the same equations.");
    el.append(h("div", { class: "code-bar" }, sel, gen, copyBtn, saveBtn), note, files, view);
    let cm = null, current = null, result = null;
    const showFile = (f) => {
      current = f;
      files.querySelectorAll(".file-tab").forEach((b) => b.classList.toggle("active", b.dataset.path === f.path));
      if (!cm) cm = CodeMirror(view, { value: "", readOnly: true, lineNumbers: true, viewportMargin: 50 });
      cm.setOption("mode", modeFor(f.path, result.target));
      cm.setValue(f.text); cm.refresh();
    };
    gen.onclick = async () => {
      c.view.target = sel.value;
      gen.disabled = true; gen.textContent = "Generating…";
      const r = await call("export", c.source, sel.value).catch((e) => ({ ok: false, error: String(e) }));
      gen.disabled = false; gen.textContent = "Generate";
      if (!r.ok) { note.textContent = r.error || "Code generation failed."; return; }
      result = r;
      note.textContent = `${r.label}, ${r.files.length} file${r.files.length > 1 ? "s" : ""}.`;
      files.replaceChildren(...r.files.map((f) => h("button", { class: "file-tab", dataset: { path: f.path }, onclick: () => showFile(f) }, f.path)));
      copyBtn.disabled = saveBtn.disabled = false;
      showFile(r.files[0]);
    };
    copyBtn.onclick = () => current && copyText(current.text, "Code copied.");
    saveBtn.onclick = async () => {
      if (!result) return;
      const r = await call("save_code", result.files, result.system).catch(() => ({ error: "Saving files needs the desktop app." }));
      if (!r) return;
      toast(r.error || `Saved ${r.count} file${r.count > 1 ? "s" : ""} to ${r.folder}`);
    };
  }

  /* controls */
  function sliderRange(v, name) {
    if (/^(theta|phi|psi|alpha|beta|gamma)\d*$/.test(name)) return [-Math.PI, Math.PI];
    if (v === 0) return [-1, 1];
    return v > 0 ? [0, v * 3] : [v * 3, -v * 3];
  }
  function renderControls(c) {
    const r = c.result, sys = r.system;
    const rerun = debounce(() => runCell(c, { quiet: true }), 220);
    const panel = h("div", { class: "controls" });
    const ctl = (item, bucket) => {
      const key = item.name, def = item.default;
      const cur = c.settings[bucket][key] != null ? c.settings[bucket][key] : item.value;
      const [lo, hi] = sliderRange(def, key);
      const num = h("input", { type: "number", value: fmtNum(cur), step: "any", "aria-label": key, class: cur !== def ? "changed" : "" });
      const rng = h("input", { type: "range", min: Math.min(lo, cur), max: Math.max(hi, cur), step: (hi - lo) / 400 || 0.01, value: cur, "aria-label": key + " slider" });
      const set = (v, from) => {
        if (!isFinite(v)) return;
        if (from !== num) num.value = fmtNum(v);
        if (from !== rng) rng.value = v;
        num.classList.toggle("changed", v !== def);
        if (v === def) delete c.settings[bucket][key]; else c.settings[bucket][key] = v;
        setDirty(true); rerun();
      };
      num.addEventListener("change", () => set(parseFloat(num.value), num));
      rng.addEventListener("input", () => set(parseFloat(rng.value), rng));
      return h("div", { class: "control" }, h("label", { html: tex(item.tex) + (item.unit ? `<span class="unit">${escapeHtml(item.unit)}</span>` : "") }), rng, num);
    };
    const reset = (bucket) => h("button", { class: "link-btn", onclick: () => { c.settings[bucket] = {}; setDirty(true); c.outParts.controls.replaceWith(c.outParts.controls = renderControls(c)); runCell(c, { quiet: true }); } }, "Reset");
    if (sys.parameters.length) { panel.append(h("h4", {}, "Parameters", reset("parameters"))); sys.parameters.forEach((p) => panel.append(ctl(p, "parameters"))); }
    panel.append(h("h4", {}, "Starting values", reset("initial")));
    sys.initial.forEach((p) => panel.append(ctl(p, "initial")));
    panel.append(h("h4", {}, "Time span"));
    const tEnd = h("input", { type: "number", value: fmtNum(c.settings.t_end), min: 0, step: "any", "aria-label": "End time" });
    tEnd.addEventListener("change", () => { const v = parseFloat(tEnd.value); if (v > 0) { c.settings.t_end = v; setDirty(true); rerun(); } });
    const choices = [...new Set([500, 1000, 2000, 4000, +c.settings.points])].sort((a, b) => a - b);
    const pts = h("select", { "aria-label": "Output points" }, ...choices.map((n) => h("option", { value: n, selected: n === +c.settings.points }, n.toLocaleString("en-GB"))));
    pts.addEventListener("change", () => { c.settings.points = +pts.value; setDirty(true); rerun(); });
    const methods = [["auto", "Automatic"], ["symplectic", "Symplectic"], ["adaptive", "Adaptive"]];
    const current = c.settings.integrator || "auto";
    const integ = h("select", { "aria-label": "Integrator", title: "Automatic uses the symplectic integrator, which keeps a conservative system's energy error bounded however long the run, and the adaptive solver otherwise." },
      ...methods.map(([v, label]) => h("option", { value: v, selected: v === current }, label)));
    integ.addEventListener("change", () => { c.settings.integrator = integ.value; setDirty(true); rerun(); });
    panel.append(h("div", { class: "control-row" }, h("label", {}, "End time"), tEnd), h("div", { class: "control-row" }, h("label", {}, "Output points"), pts),
      h("div", { class: "control-row" }, h("label", {}, "Integrator"), integ));
    const sim = r.simulation;
    if (sim) panel.append(h("p", { class: "pane-note", style: "margin:10px 16px 0" }, `Solver ${sim.method || ""}` +
      (sim.step ? `, fixed step ${sim.step.toPrecision(3)}, ${sim.steps.toLocaleString("en-GB")} steps` : "") +
      `, ${sim.evaluations.toLocaleString("en-GB")} evaluations` + (sim.stiff ? ", stiff" : "") + "."));
    return panel;
  }

  /* ------------------------------------------------------------------ saving images and text */
  async function saveCanvas(cv, name) {
    const r = await call("save_image", name + " frame", cv.toDataURL("image/png")).catch(() => null);
    if (r) toast(r.error || "Saved " + r.path); else if (!inWindow) toast("Saving images needs the desktop app.");
  }
  async function saveChart(box, name) {
    const url = await Plotly.toImage(box, { format: "png", scale: 2, width: box.clientWidth, height: box.clientHeight });
    const r = await call("save_image", name, url).catch(() => null);
    if (r) toast(r.error || "Saved " + r.path); else if (!inWindow) toast("Saving images needs the desktop app.");
  }
  function copyText(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(done), () => {
      const ta = h("textarea"); ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast(done);
    });
  }

  /* ------------------------------------------------------------------ handout */
  // A self-contained HTML page for a lesson: the notes, and for each system its
  // model, equations, a strip of the motion and the plots. Mathematics is MathML
  // and the figures are embedded images, so the file works offline, in any
  // browser, and prints (or saves as PDF) on white paper whatever the app theme.
  const PRINT = {
    sheet: "#ffffff", ink: "#18202e", ink2: "#4f5a6c", ink3: "#7b8597", minor: "#e9eef5", major: "#d3dce8",
    hatch: "#8a95a8", accent: "#1b4db1",
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  };
  const HANDOUT_PARTS = [
    ["notes", "Notes", true], ["source", "MechanicsDSL source", true], ["values", "Parameters and starting values", true],
    ["equations", "Equations of motion", true], ["motion", "Motion (four stills)", true], ["coords", "Coordinates against time", true],
    ["phase", "Phase portrait", true], ["energy", "Energy", false],
  ];
  const mathml = (s, display) => { try { return katex.renderToString(s, { displayMode: !!display, throwOnError: false, strict: "ignore", output: "mathml" }); } catch (e) { return escapeHtml(s); } };

  function handoutDialog() {
    const saved = store.get("mdsl-studio-handout", {});
    const boxes = HANDOUT_PARTS.map(([id, label, on]) => {
      const cb = h("input", { type: "checkbox", checked: saved[id] != null ? saved[id] : on });
      return [id, cb, h("label", { class: "check" }, cb, label)];
    });
    const title = h("input", { class: "modal-input", value: state.title, "aria-label": "Handout title" });
    const openAfter = h("input", { type: "checkbox", checked: saved.open !== false });
    const go = h("button", { class: "btn primary" }, "Save handout…");
    const cancel = h("button", { class: "btn" }, "Cancel");
    const note = h("p", { class: "pane-note" }, "Saves one HTML file with everything embedded. Open it in a browser and print it, or choose Save as PDF in the print dialogue.");
    const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Handout" },
      h("h2", {}, "Handout"), h("label", { class: "modal-label" }, "Title"), title,
      h("div", { class: "modal-label" }, "Include"), h("div", { class: "modal-grid" }, ...boxes.map((b) => b[2])),
      h("label", { class: "check", style: "margin-top:14px" }, openAfter, "Open it in the browser afterwards"), note,
      h("div", { class: "modal-actions" }, cancel, go));
    const backdrop = h("div", { class: "modal-backdrop" }, modal);
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
    cancel.onclick = close;
    go.onclick = async () => {
      const parts = {};
      for (const [id, cb] of boxes) parts[id] = cb.checked;
      store.set("mdsl-studio-handout", Object.assign({}, parts, { open: openAfter.checked }));
      go.disabled = cancel.disabled = true; go.textContent = "Preparing…";
      try {
        const html = await buildHandout(title.value.trim() || state.title, parts);
        const r = await call("save_handout", html, title.value.trim() || state.title, openAfter.checked).catch(() => null);
        close();
        if (r) toast(r.error || "Saved " + r.path);
        else if (!inWindow) downloadHtml(html, (title.value.trim() || "handout") + ".html");
      } catch (e) {
        go.disabled = cancel.disabled = false; go.textContent = "Save handout…";
        note.textContent = "The handout could not be made: " + (e && e.message || e);
      }
    };
    document.body.append(backdrop);
    title.focus(); title.select();
  }
  function downloadHtml(html, name) {      // browser preview only: the desktop app saves through a dialogue
    const a = h("a", { href: URL.createObjectURL(new Blob([html], { type: "text/html" })), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  async function buildHandout(title, parts) {
    for (const c of state.cells) {           // every system needs an up-to-date result
      if (c.type === "code" && (!c.result || c.state === "stale" || c.state === "new")) await runCell(c, { quiet: !!c.result });
    }
    const scratch = h("div", { style: "position:fixed;left:-20000px;top:0;width:900px", "aria-hidden": "true" });
    document.body.append(scratch);
    const body = [];
    let fig = 0, headed = false;      // headed: the notes just before a system already name it
    const figure = (img, caption) => `<figure>${img}<figcaption><span class="fig-no">Figure ${++fig}.</span> ${caption}</figcaption></figure>`;
    try {
      for (const c of state.cells) {
        if (c.type === "text") {
          let src = c.source.trim();
          if (!body.length && src.split("\n")[0].replace(/^#\s*/, "").trim().toLowerCase() === title.toLowerCase()) src = src.split("\n").slice(1).join("\n").trim();
          headed = parts.notes && /^#/m.test(c.source);
          if (parts.notes && src) body.push(`<section class="notes">${markdown(src, mathml)}</section>`);
          continue;
        }
        const r = c.result;
        if (!r || !r.system) {
          body.push(`<section class="system"><p class="note">A system in this worksheet could not be compiled${r && r.error ? ": " + escapeHtml(r.error) : ""}.</p></section>`);
          continue;
        }
        const sys = r.system, name = sys.name.replace(/_/g, " ");
        const out = [`<section class="system">` + (headed ? "" : `<h2 class="sys-title">${escapeHtml(name[0].toUpperCase() + name.slice(1))}</h2>`)];
        headed = false;
        if (parts.source) out.push(`<h3>Model</h3><pre class="source">${escapeHtml(c.source.trim())}</pre>`);
        if (parts.values) out.push(valuesTable(c, r));
        if (parts.equations && r.equations && r.equations.blocks) {
          out.push("<h3>Equations of motion</h3>");
          for (const b of r.equations.blocks) {
            out.push(`<div class="eq-block"><div class="eq-title">${escapeHtml(b.title)}</div>` + b.lines.map((l) => `<div class="eq">${mathml(l, true)}</div>`).join("") +
              (b.note ? `<p class="note">${escapeHtml(b.note)}</p>` : "") + "</div>");
          }
        }
        if (r.ok) {
          if (parts.motion && r.animation) out.push(figure(motionStrip(r, scratch), `${escapeHtml(captionFor(r.animation) || "The motion")}, at four moments.`));
          if (parts.coords) out.push(figure(await chartImage(scratch, coordsFigure(r)), "Each coordinate against time."));
          if (parts.phase) out.push(figure(await chartImage(scratch, phaseFigure(r)), "Phase portraits: each coordinate against its velocity. The ring marks the start."));
          if (parts.energy && r.energy) out.push(figure(await chartImage(scratch, energyFigure(r)), r.energy.conserved
            ? `Energy over time. It should be constant; the largest relative drift, ${r.energy.max_relative_drift.toExponential(1)}, is the solver's error.`
            : "Energy over time. Forces in this system do work, so it changes."));
        } else {
          out.push(`<p class="note">The simulation did not complete: ${escapeHtml(r.error || "")}</p>`);
        }
        out.push("</section>");
        body.push(out.join("\n"));
      }
    } finally {
      scratch.remove();
    }
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return handoutPage(title, date, body.join("\n"));
  }

  function valuesTable(c, r) {
    const sys = r.system;
    const row = (p) => `<tr><td>${mathml(p.tex, false)}</td><td class="num">${escapeHtml(fmtNum(p.value))}</td><td>${escapeHtml(p.unit || "")}</td></tr>`;
    const tables = [];
    if (sys.parameters.length) tables.push(`<table><caption>Parameters</caption><tbody>${sys.parameters.map(row).join("")}</tbody></table>`);
    if (sys.initial.length) tables.push(`<table><caption>Starting values</caption><tbody>${sys.initial.map(row).join("")}</tbody></table>`);
    tables.push(`<table><caption>Simulation</caption><tbody><tr><td>Time span</td><td class="num">${escapeHtml(fmtNum(c.settings.t_end))}</td><td>s</td></tr>` +
      (r.simulation ? `<tr><td>Solver</td><td class="num" colspan="2">${escapeHtml(r.simulation.method || "")}</td></tr>` +
        (r.simulation.step ? `<tr><td>Step</td><td class="num">${escapeHtml(fmtNum(r.simulation.step))}</td><td>s</td></tr>` : "") : "") + "</tbody></table>");
    return `<h3>Parameters and starting values</h3><div class="tables">${tables.join("")}</div>`;
  }

  function motionStrip(r, scratch) {
    const a = r.animation, n = a.t.length, frames = [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
    const cells = frames.map((f) => {
      const cv = h("canvas", { style: "width:330px;height:240px;display:block" });
      scratch.append(cv);
      const st = new Stage(cv, a, { trails: !!a.trail, unit: "", palette: PRINT, dpr: 2.5, compact: true });
      st.layout(); st.draw(f);
      const url = cv.toDataURL("image/png");
      cv.remove();
      return `<div class="still"><img src="${url}" alt="The system at t = ${fmtNum(+a.t[f].toPrecision(4))}"><div class="t">t = ${escapeHtml(fmtNum(+a.t[f].toPrecision(4)))}</div></div>`;
    });
    return `<div class="strip">${cells.join("")}</div>`;
  }

  function printLayout(extra) {
    const axis = { gridcolor: "#e7ebf1", zeroline: false, linecolor: "#c9d1dc", tickfont: { size: 11, color: "#4f5a6c" }, title: { font: { size: 12, color: "#4f5a6c" } }, automargin: true };
    return [Object.assign({ paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", font: { family: "Segoe UI, Helvetica, Arial, sans-serif", size: 11, color: "#4f5a6c" },
      margin: { l: 64, r: 16, t: 12, b: 40 }, showlegend: false, width: 680 }, extra || {}), axis];
  }
  function coordsFigure(r) {
    const s = r.simulation, n = s.coordinates.length;
    const [layout, axis] = printLayout({ grid: { rows: n, columns: 1, pattern: "independent", roworder: "top to bottom", ygap: 0.35 }, height: Math.min(900, 60 + n * 130) });
    const traces = [];
    s.coordinates.forEach((q, i) => {
      const k = i ? String(i + 1) : "", unit = (r.system.coordinates[i] || {}).unit;
      traces.push({ x: s.t, y: s.series[q], xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "lines", line: { color: PRINT.series[i % 8], width: 1.6 } });
      layout["xaxis" + k] = Object.assign({}, axis, i ? { matches: "x" } : {}, i === n - 1 ? { title: { text: "Time (s)", font: axis.title.font } } : { showticklabels: false });
      layout["yaxis" + k] = Object.assign({}, axis, { title: { text: uname(q) + (unit ? ` (${unit})` : ""), font: axis.title.font } });
    });
    return { traces, layout };
  }
  function phaseFigure(r) {
    const s = r.simulation, n = s.coordinates.length, cols = Math.min(n, n === 4 ? 2 : 3), rows = Math.ceil(n / cols);
    const [layout, axis] = printLayout({ grid: { rows, columns: cols, pattern: "independent", xgap: 0.25, ygap: 0.35 }, height: rows * (cols === 1 ? 300 : 230) + 20, width: cols === 1 ? 440 : 680 });
    const traces = [];
    s.coordinates.forEach((q, i) => {
      const k = i ? String(i + 1) : "", v = s.velocity_suffix === "p_" ? "p_" + q : q + "_dot";
      traces.push({ x: s.series[q], y: s.series[v], xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "lines", line: { color: PRINT.series[i % 8], width: 1.3 } });
      traces.push({ x: [s.series[q][0]], y: [s.series[v][0]], xaxis: "x" + k, yaxis: "y" + k, type: "scatter", mode: "markers", marker: { size: 8, color: "#ffffff", line: { color: PRINT.series[i % 8], width: 2 } } });
      layout["xaxis" + k] = Object.assign({}, axis, { title: { text: uname(q), font: axis.title.font } });
      layout["yaxis" + k] = Object.assign({}, axis, { title: { text: uname(v), font: axis.title.font } });
    });
    return { traces, layout };
  }
  function energyFigure(r) {
    const s = r.simulation, e = r.energy;
    const [layout, axis] = printLayout({ height: 260 });
    layout.xaxis = Object.assign({}, axis, { title: { text: "Time (s)", font: axis.title.font } });
    layout.yaxis = Object.assign({}, axis, { title: { text: "Energy", font: axis.title.font } });
    return { traces: [{ x: s.t, y: e.values, type: "scatter", mode: "lines", line: { color: PRINT.series[0], width: 1.6 } }], layout };
  }
  async function chartImage(scratch, figSpec) {
    const box = h("div", { style: `width:${figSpec.layout.width}px;height:${figSpec.layout.height}px` });
    scratch.append(box);
    try {
      await Plotly.newPlot(box, figSpec.traces, figSpec.layout, { staticPlot: true });
      const url = await Plotly.toImage(box, { format: "svg", width: figSpec.layout.width, height: figSpec.layout.height });
      const pct = Math.round(100 * figSpec.layout.width / 680);
      return `<img class="chart" src="${url}" alt=""${pct < 100 ? ` style="width:${pct}%"` : ""}>`;
    } finally {
      Plotly.purge(box); box.remove();
    }
  }

  function handoutPage(title, date, body) {
    const app = (state.info && state.info.app_version) ? `MechanicsDSL Studio ${state.info.app_version}` : "MechanicsDSL Studio";
    return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(app)}">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --ink: #18202e; --ink-2: #4f5a6c; --rule: #d8dee7; --accent: #1b4db1; }
  html { background: #eef1f5; }
  body { margin: 0; color: var(--ink); font: 15px/1.55 "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .page { max-width: 760px; margin: 28px auto; padding: 44px 56px 56px; background: #fff; box-shadow: 0 1px 0 rgba(24,32,46,.05), 0 10px 30px -14px rgba(24,32,46,.25); }
  header.doc { border-bottom: 2px solid var(--ink); padding-bottom: 10px; margin-bottom: 26px; display: flex; align-items: baseline; gap: 16px; }
  header.doc h1 { font-size: 26px; line-height: 1.2; margin: 0; flex: 1; letter-spacing: -.01em; }
  header.doc .date { color: var(--ink-2); font-size: 13px; white-space: nowrap; }
  h1, h2, h3 { line-height: 1.25; }
  .notes h1 { font-size: 21px; margin: 26px 0 8px; }
  .notes h2, h2.sys-title { font-size: 18px; margin: 26px 0 8px; }
  h3, .notes h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); margin: 22px 0 8px; }
  p { margin: 0 0 10px; }
  code, pre { font-family: Consolas, "SF Mono", Menlo, monospace; font-size: 12.5px; }
  pre.source { background: #f5f7fa; border: 1px solid var(--rule); border-radius: 4px; padding: 10px 12px; white-space: pre-wrap; margin: 0; }
  section.system { margin-top: 30px; }
  .tables { display: flex; flex-wrap: wrap; gap: 14px 28px; align-items: flex-start; }
  table { border-collapse: collapse; font-size: 13.5px; }
  caption { text-align: left; font-weight: 600; font-size: 12px; color: var(--ink-2); padding-bottom: 3px; white-space: nowrap; }
  td { border-top: 1px solid var(--rule); padding: 4px 14px 4px 0; vertical-align: baseline; }
  tr:last-child td { border-bottom: 1px solid var(--rule); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .eq-block { margin: 6px 0 12px; }
  .eq-title { font-size: 12.5px; color: var(--ink-2); margin-bottom: 2px; }
  .eq { overflow: hidden; max-width: 170mm; }   /* the printable width of A4, so the fit below also holds on paper */
  math { font-family: "Cambria Math", "STIX Two Math", "Latin Modern Math", math; font-size: 1.08em; }
  math[display="block"] { margin: 6px 0; }
  .note { color: var(--ink-2); font-size: 13px; }
  figure { margin: 18px 0; break-inside: avoid; page-break-inside: avoid; }
  figure img.chart { display: block; width: 100%; height: auto; }
  figcaption { font-size: 13px; color: var(--ink-2); margin-top: 6px; }
  .fig-no { font-weight: 600; color: var(--ink); }
  .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .still { border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; }
  .still img { display: block; width: 100%; height: auto; }
  .still .t { font-size: 12px; text-align: center; padding: 3px 0 4px; border-top: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
  footer.doc { margin-top: 36px; padding-top: 8px; border-top: 1px solid var(--rule); color: var(--ink-2); font-size: 12px; display: flex; justify-content: space-between; }
  .print { position: fixed; right: 20px; top: 16px; font: 600 13px/1 inherit; padding: 9px 14px; border-radius: 5px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  @media screen and (max-width: 800px) { .page { margin: 0; padding: 24px 16px 32px; box-shadow: none; } .strip { grid-template-columns: repeat(2, 1fr); } .print { display: none; } }
  @page { size: A4; margin: 16mm 16mm 18mm; }
  @media print {
    html { background: #fff; }
    body { font-size: 11pt; }
    .page { margin: 0; padding: 0; max-width: none; box-shadow: none; }
    .print { display: none; }
    h2, h3 { break-after: avoid; page-break-after: avoid; }
    section.system { break-before: auto; }
    pre.source, table, .eq-block { break-inside: avoid; page-break-inside: avoid; }
  }
</style>
</head>
<body>
<button class="print" onclick="window.print()">Print or save as PDF</button>
<main class="page">
<header class="doc"><h1>${escapeHtml(title)}</h1><span class="date">${escapeHtml(date)}</span></header>
${body}
<footer class="doc"><span>${escapeHtml(title)}</span><span>Made with ${escapeHtml(app)}</span></footer>
</main>
<script>
  // Long equations: reduce the type size until each one fits the page width.
  function fitEquations() {
    document.querySelectorAll(".eq").forEach(function (el) {
      var m = el.querySelector("math"); if (!m) return;
      m.style.fontSize = "";
      var size = 1.08;
      while (el.scrollWidth > el.clientWidth + 1 && size > 0.62) { size -= 0.04; m.style.fontSize = size.toFixed(2) + "em"; }
    });
  }
  window.addEventListener("load", fitEquations);
  window.addEventListener("resize", fitEquations);
  window.addEventListener("beforeprint", fitEquations);
</script>
</body>
</html>
`;
  }

  /* ------------------------------------------------------------------ files */
  function loadDoc(data, path) {
    state.cells.forEach((c) => c.stage && c.stage.stop());
    state.cells = [];
    state.title = data.title || "Untitled worksheet"; state.path = path || null;
    $("#doc-title").value = state.title;
    $("#status-path").textContent = path || "";
    call("set_title", state.title).catch(() => {});
    for (const cd of data.cells || []) {
      const c = { id: uid(), type: cd.type === "text" ? "text" : "code", source: cd.source || "", settings: Object.assign({ t_end: 10, points: 1000, parameters: {}, initial: {} }, cd.settings || {}), view: Object.assign({ tab: "motion" }, cd.view || {}), state: "new" };
      state.cells.push(c); buildCell(c);
    }
    placeCells();
  }
  async function newWorksheet() {
    if (state.dirty && state.cells.length && !confirm("Discard the changes to this worksheet?")) return;
    state.cells.forEach((c) => c.stage && c.stage.stop());
    state.cells = []; state.path = null; state.title = "Untitled worksheet";
    $("#doc-title").value = state.title; $("#status-path").textContent = "";
    call("set_title", "").catch(() => {});
    renderStart(); setDirty(false);
  }
  async function openWorksheet() {
    if (state.dirty && state.cells.length && !confirm("Discard the changes to this worksheet?")) return;
    const r = await call("open_worksheet").catch(() => null);
    if (!r) { if (!inWindow) toast("Opening files needs the desktop app."); return; }
    if (r.error) return toast(r.error);
    loadDoc(r.data, r.path); setDirty(false);
    toast("Opened. Select Run all to compute every system.");
  }
  async function saveWorksheet(saveAs) {
    const data = serialise(); delete data.path; delete data.dirty;
    const r = await call("save_worksheet", data, state.path, !!saveAs).catch(() => null);
    if (!r) { if (!inWindow) toast("Saving files needs the desktop app."); return; }
    if (r.error) return toast(r.error);
    state.path = r.path; $("#status-path").textContent = r.path;
    setDirty(false); toast("Saved.");
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
    $("#btn-theme").replaceChildren(icon(dark ? "i-sun" : "i-moon"));
    for (const c of state.cells) {
      if (!c.outParts) continue;
      for (const k of Object.keys(c.outParts.panes)) if (k !== "motion" && k !== "code") { purge(c.outParts.panes[k]); delete c.outParts.panes[k]; }
      if (c.view.tab !== "motion" && c.view.tab !== "code") showTab(c, c.view.tab);
      else if (c.stage) c.stage.relayout();
    }
    if (!state.cells.length) renderStart();
  }
  $("#btn-theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const t = dark ? "light" : "dark"; store.set("mdsl-studio-theme", t); applyTheme(t);
  });

  /* ------------------------------------------------------------------ wiring */
  $("#btn-new").onclick = newWorksheet;
  $("#btn-open").onclick = openWorksheet;
  $("#btn-save").onclick = () => saveWorksheet(false);
  $("#btn-run-all").onclick = runAll;
  $("#btn-handout").onclick = handoutDialog;
  $("#doc-title").addEventListener("input", (e) => { state.title = e.target.value; setDirty(true); });
  $("#doc-title").addEventListener("change", () => call("set_title", state.title).catch(() => {}));
  $("#doc-title").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveWorksheet(e.shiftKey); }
    else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); openWorksheet(); }
    else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newWorksheet(); }
    else if (mod && e.shiftKey && e.key === "Enter") { e.preventDefault(); runAll(); }
    else if (e.key === "Escape" && state.busy) call("cancel");
  });
  window.addEventListener("resize", debounce(() => state.cells.forEach(relayout), 120));
  window.addEventListener("beforeunload", () => store.set("mdsl-studio-draft", serialise()));

  async function start() {
    applyTheme(store.get("mdsl-studio-theme", null));
    if (store.get("mdsl-studio-rail", true) === false) $("#app").classList.add("rail-hidden");
    const [info, examples] = await Promise.all([call("info"), call("examples")]);
    state.info = info; state.examples = examples;
    $("#status-version").textContent = `Studio ${info.app_version}, MechanicsDSL ${info.core_version}`;
    renderRail();
    const open = await call("startup_file").catch(() => null);
    const draft = store.get("mdsl-studio-draft", null);
    if (open) {
      const r = await call("read_worksheet", open);
      if (r && !r.error) { loadDoc(r.data, r.path); setDirty(false); } else { renderStart(); if (r) toast(r.error); }
    } else if (draft && draft.cells && draft.cells.length) {
      loadDoc(draft, draft.path); setDirty(!!draft.dirty);
      if (draft.dirty) toast("Your last session was restored.");
    } else renderStart();
    engine("", "Loading MechanicsDSL");
    call("warm").then(() => { if (!state.busy) engine("ready", "Engine ready"); }).catch(() => engine("", "Engine not available"));
  }
  start().catch((e) => { engine("", "Engine not available"); status(String(e)); });
})();
