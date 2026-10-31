"""The computation side of MechanicsDSL Studio.

Everything the interface asks for goes through `Engine`, which returns plain JSON-ready
dicts. The window (pywebview) and the development server both call it the same way.
"""
import hashlib
import logging
import math
import os
import re
import shutil
import tempfile
import threading
import time

import numpy as np
import sympy as sp

os.environ.setdefault("MPLBACKEND", "Agg")   # MechanicsDSL imports matplotlib; never open windows

from . import __version__
from .examples import BLANK, EXAMPLES
from .geometry import infer_animation

MAX_POINTS = 4000          # simulation output points sent to the interface
TARGETS = {                # code generator -> (label, file extension or None for a folder)
    "cpp": ("C++", ".cpp"),
    "python": ("Python", ".py"),
    "rust": ("Rust", ".rs"),
    "julia": ("Julia", ".jl"),
    "matlab": ("MATLAB", ".m"),
    "fortran": ("Fortran", ".f90"),
    "javascript": ("JavaScript", ".js"),
    "openmp": ("C++ with OpenMP", ".cpp"),
    "cuda": ("CUDA", None),
    "wasm": ("WebAssembly", None),
    "arduino": ("Arduino", ".ino"),
    "arm": ("ARM Cortex-M (bare-metal C)", ".c"),
}
GREEK = {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
         "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi",
         "omega", "varphi", "vartheta", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
         "Phi", "Psi", "Omega"}


class _LogCapture(logging.Handler):
    """Collects MechanicsDSL's own error messages, which say more than its return value."""

    def __init__(self):
        super().__init__(logging.WARNING)
        self.records = []

    def emit(self, record):
        msg = record.getMessage().split("\n")[0]
        if msg not in self.records:
            self.records.append((record.levelname, msg))


def _mdsl():
    import mechanics_dsl
    mechanics_dsl.setup_logging(level=logging.WARNING) if hasattr(mechanics_dsl, "setup_logging") else None
    return mechanics_dsl


# ---------------------------------------------------------------- LaTeX

def tex_name(name, accent=None):
    """theta1 -> \\theta_{1}; with accent="dot", \\dot{\\theta}_{1}."""
    m = re.match(r"^([A-Za-z]+?)_?(\d+)$", name)
    base, sub = (m.group(1), m.group(2)) if m else (name, "")
    if base in GREEK:
        base = "\\" + base
    elif len(base) > 1:
        base = f"\\mathrm{{{base}}}"
    if accent:
        base = f"\\{accent}{{{base}}}"
    return base + (f"_{{{sub}}}" if sub else "")


def symbol_names(coords, params):
    """Symbol name -> LaTeX. Keyed by name because the parser's symbols carry assumptions."""
    names = {}
    for q in coords:
        t = tex_name(q)
        names[q] = t
        names[f"{q}_dot"] = tex_name(q, "dot")
        names[f"{q}_ddot"] = tex_name(q, "ddot")
        names[f"p_{q}"] = f"p_{{{t}}}"
    for p in params:
        names[p] = tex_name(p)
    return names


def tidy(expr, simplify=True):
    """Turn 1.0 into 1, 0.5 into 1/2 and x**2.0 into x**2 so the output reads like a textbook."""
    if isinstance(expr, sp.MatrixBase):
        return expr.applyfunc(lambda e: tidy(e, simplify))
    if not isinstance(expr, sp.Basic):
        return expr
    reps = {}
    for f in expr.atoms(sp.Float):
        if f == int(f) and abs(f) < 1e12:
            reps[f] = sp.Integer(int(f))
        else:
            r = sp.nsimplify(f, rational=True)
            if isinstance(r, sp.Rational) and r.q <= 12 and abs(float(r) - float(f)) < 1e-12:
                reps[f] = r
    out = expr.xreplace(reps) if reps else expr
    if not simplify:
        return out
    try:
        if sp.count_ops(out) < 60:
            out = sp.simplify(out)
        else:
            out = sp.factor_terms(out)
    except Exception:
        pass
    return out


def latex(expr, names, simplify=True):
    e = tidy(expr, simplify)
    mapping = {s: names[s.name] for s in getattr(e, "free_symbols", ()) if s.name in names}
    return sp.latex(e, symbol_names=mapping)


# ---------------------------------------------------------------- engine

class Engine:
    def __init__(self):
        self._cache = {}            # source hash -> compiled PhysicsCompiler
        self._eq_cache = {}         # source hash -> typeset equations
        self._lock = threading.RLock()
        self._mdsl = None

    # -- information
    def info(self):
        try:
            import mechanics_dsl
            core = mechanics_dsl.__version__
        except Exception:
            core = "not installed"
        return {"app_version": __version__, "core_version": core,
                "targets": [{"id": k, "label": v[0]} for k, v in TARGETS.items()]}

    def examples(self):
        return EXAMPLES

    def blank(self):
        return BLANK

    def warm_up(self):
        """Import the heavy libraries in the background so the first run is quick."""
        self._mdsl = _mdsl()
        return True

    # -- compiling
    def _compile(self, source):
        key = hashlib.sha256(source.encode()).hexdigest()
        with self._lock:
            hit = self._cache.get(key)
        if hit:
            return hit, [], 0.0, True
        mdsl = self._mdsl or _mdsl()
        cap = _LogCapture()
        log = logging.getLogger("MechanicsDSL")
        log.addHandler(cap)
        t0 = time.perf_counter()
        try:
            comp = mdsl.PhysicsCompiler()
            result = comp.compile_dsl(source)
        finally:
            log.removeHandler(cap)
        dt = time.perf_counter() - t0
        if not result.get("success"):
            msgs = [m for lvl, m in cap.records if lvl == "ERROR"]
            # the parser's own message is the useful one; the final summary repeats it badly
            detail = next((m for m in msgs if "Parser error" in m or "Token" in m), None)
            raise CompileError(_clean_error(detail or result.get("error") or "Compilation failed"),
                               [m for _, m in cap.records])
        with self._lock:
            self._cache[key] = comp
            if len(self._cache) > 24:
                self._cache.pop(next(iter(self._cache)))
        return comp, [m for lvl, m in cap.records if lvl == "WARNING"], dt, False

    def run(self, source, settings=None):
        """Compile (or reuse) a system, simulate it and return everything the cell shows."""
        settings = settings or {}
        t_start = time.perf_counter()
        try:
            comp, warnings, compile_s, cached = self._compile(source)
        except CompileError as e:
            return {"ok": False, "stage": "compile", "error": str(e), "log": e.log}
        except Exception as e:
            return {"ok": False, "stage": "compile", "error": _clean_error(f"{type(e).__name__}: {e}"), "log": []}

        coords = comp.get_coordinates()
        param_def = {k: v for k, v in comp.parameters_def.items()}
        base_params = {k: float(v["value"]) for k, v in param_def.items()}
        base_initial = {k: float(v) for k, v in comp.initial_conditions.items()}

        # apply the interface's parameter and initial-condition overrides
        params = dict(base_params)
        params.update({k: float(v) for k, v in (settings.get("parameters") or {}).items() if k in params})
        initial = dict(base_initial)
        initial.update({k: float(v) for k, v in (settings.get("initial") or {}).items()})

        out = {"ok": True, "cached": cached, "warnings": warnings,
               "system": self._describe(comp, coords, param_def, params, base_params, base_initial, initial)}
        key = hashlib.sha256(source.encode()).hexdigest()
        if key not in self._eq_cache:
            try:
                self._eq_cache[key] = self._equations(comp, coords, list(params))
            except Exception as e:   # typesetting must never stop a run
                self._eq_cache[key] = {"error": f"Could not typeset the equations: {e}"}
        out["equations"] = self._eq_cache[key]

        t_end = float(settings.get("t_end", 10.0))
        points = int(min(max(int(settings.get("points", 1000)), 50), MAX_POINTS))
        t0 = time.perf_counter()
        try:
            with self._lock:
                try:
                    for k, v in params.items():
                        comp.parameters_def[k]["value"] = v
                    comp.initial_conditions.clear()
                    comp.initial_conditions.update(initial)
                    comp.setup_simulation(comp.equations)
                    sol = comp.simulate((0.0, t_end), points)
                finally:                                # keep the cached system pristine
                    for k, v in base_params.items():
                        comp.parameters_def[k]["value"] = v
                    comp.initial_conditions.clear()
                    comp.initial_conditions.update(base_initial)
        except Exception as e:
            out.update(ok=False, stage="simulate", error=_clean_error(f"{type(e).__name__}: {e}"))
            return out
        sim_s = time.perf_counter() - t0
        if not sol.get("success"):
            out.update(ok=False, stage="simulate", error=str(sol.get("message") or "The simulation failed."))
            return out

        t = np.asarray(sol["t"], dtype=float)
        y = np.asarray(sol["y"], dtype=float)
        hamiltonian = bool(sol.get("use_hamiltonian"))
        series = {}
        for i, q in enumerate(coords):
            series[q] = _list(y[2 * i])
            series[(f"p_{q}" if hamiltonian else f"{q}_dot")] = _list(y[2 * i + 1])
        out["simulation"] = {
            "t": _list(t), "series": series, "coordinates": coords,
            "velocity_suffix": "p_" if hamiltonian else "_dot",
            "method": sol.get("method_used"), "stiff": bool(sol.get("is_stiff")),
            "evaluations": int(sol.get("nfev") or 0), "t_end": t_end, "points": len(t),
        }
        try:
            out["energy"] = self._energy(comp, coords, params, y) if not hamiltonian else None
        except Exception:
            out["energy"] = None
        try:
            out["animation"] = infer_animation(comp.system_name, coords, params, t, y)
        except Exception:
            out["animation"] = None
        out["timing"] = {"compile": round(compile_s, 3), "simulate": round(sim_s, 3),
                         "total": round(time.perf_counter() - t_start, 3)}
        return out

    def _describe(self, comp, coords, param_def, params, base_params, base_initial, initial):
        var = comp.variables or {}
        def unit_of(name):
            d = param_def.get(name) or var.get(name) or {}
            return pretty_unit(d.get("unit", "")) if isinstance(d, dict) else ""
        def desc_of(name):
            d = var.get(name) or {}
            return d.get("description", "") if isinstance(d, dict) else ""
        ic = []
        ham = bool(comp.use_hamiltonian_formulation)
        for q in coords:
            rate = f"p_{q}" if ham else f"{q}_dot"
            for k, t in ((q, tex_name(q)), (rate, f"p_{{{tex_name(q)}}}" if ham else tex_name(q, "dot"))):
                ic.append({"name": k, "tex": t, "value": initial.get(k, 0.0), "default": base_initial.get(k, 0.0)})
        return {
            "name": comp.system_name,
            "formulation": "Hamiltonian" if comp.use_hamiltonian_formulation else "Lagrangian",
            "coordinates": [{"name": q, "tex": tex_name(q), "description": desc_of(q), "unit": unit_of(q)}
                            for q in coords],
            "parameters": [{"name": k, "tex": tex_name(k), "value": params[k], "default": base_params[k],
                            "unit": unit_of(k)} for k in params],
            "initial": ic,
            "mass_matrix": isinstance(comp.equations, dict) and "__mass_matrix__" in comp.equations,
            "constraints": len(getattr(comp, "constraints", []) or []),
        }

    def _equations(self, comp, coords, params):
        names = symbol_names(coords, params)
        eq = {"blocks": []}
        if comp.lagrangian is not None:
            L = comp.symbolic.ast_to_sympy(comp.lagrangian)
            eq["blocks"].append({"title": "Lagrangian", "lines": [f"L = {latex(L, names, simplify=False)}"]})
        if comp.hamiltonian is not None:
            H = comp.symbolic.ast_to_sympy(comp.hamiltonian)
            eq["blocks"].append({"title": "Hamiltonian", "lines": [f"H = {latex(H, names, simplify=False)}"]})
        E = comp.equations
        if isinstance(E, dict) and "__mass_matrix__" in E:
            M, F = E["__mass_matrix__"]
            M, F = sp.Matrix(M), sp.Matrix(F)
            qdd = sp.Matrix([sp.Symbol(f"{q}_ddot") for q in coords])
            if M.shape[0] <= 6:
                lines = [f"{latex(M, names)} {latex(qdd, names)} = {latex(F, names)}"]
            else:
                lines = [r"\mathbf{M}(q)\,\ddot{\mathbf{q}} = \mathbf{F}(q,\dot{q})"]
            eq["blocks"].append({"title": "Equations of motion (mass-matrix form)", "lines": lines,
                                 "note": "Solved numerically for the accelerations at each step."})
        elif comp.use_hamiltonian_formulation:
            q_dots, p_dots = E
            lines = []
            for i, q in enumerate(coords):
                t = tex_name(q)
                lines.append(f"{tex_name(q, 'dot')} = {latex(q_dots[i], names)}")
                lines.append(f"\\dot{{p}}_{{{t}}} = {latex(p_dots[i], names)}")
            eq["blocks"].append({"title": "Hamilton's equations", "lines": lines})
        else:
            lines = []
            for q in coords:
                key = f"{q}_ddot"
                if key in E:
                    lines.append(f"{tex_name(q, 'ddot')} = {latex(E[key], names)}")
            eq["blocks"].append({"title": "Equations of motion", "lines": lines})
        return eq

    def _energy(self, comp, coords, params, y):
        """Energy function h = sum(qdot * dL/dqdot) - L, evaluated along the solution."""
        if comp.lagrangian is None:
            return None
        L = comp.symbolic.ast_to_sympy(comp.lagrangian)
        by_name = {s.name: s for s in L.free_symbols}     # keep the parser's own symbols
        sym = lambda n: by_name.get(n, sp.Symbol(n))
        qs = [sym(q) for q in coords]
        qd = [sym(f"{q}_dot") for q in coords]
        h = sum(v * sp.diff(L, v) for v in qd) - L
        h = h.subs({sym(k): v for k, v in params.items()})
        f = sp.lambdify(qs + qd, h, "numpy")
        args = [y[2 * i] for i in range(len(coords))] + [y[2 * i + 1] for i in range(len(coords))]
        vals = np.asarray(f(*args), dtype=float) * np.ones(y.shape[1])
        if not np.all(np.isfinite(vals)):
            return None
        e0 = vals[0]
        scale = abs(e0) if abs(e0) > 1e-12 else max(1e-12, float(np.max(np.abs(vals))))
        return {"values": _list(vals), "relative_drift": _list((vals - e0) / scale),
                "max_relative_drift": float(np.max(np.abs(vals - e0)) / scale),
                "conserved": not _has_force(comp)}

    # -- code generation
    def export(self, source, target):
        if target not in TARGETS:
            return {"ok": False, "error": f"Unknown target {target}"}
        try:
            comp, _, _, _ = self._compile(source)
        except Exception as e:
            return {"ok": False, "error": _clean_error(str(e))}
        label, ext = TARGETS[target]
        work = tempfile.mkdtemp(prefix="mdsl-export-")
        name = comp.system_name or "system"
        try:
            with self._lock:
                comp.setup_simulation(comp.equations)
                comp.export(target, os.path.join(work, name + (ext or "")))
            files = []
            for root, _, fnames in os.walk(work):
                for fn in sorted(fnames):
                    full = os.path.join(root, fn)
                    rel = os.path.relpath(full, work).replace("\\", "/")
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        files.append({"path": rel, "text": fh.read()})
            files.sort(key=lambda f: (-len(f["text"]), f["path"]))   # main source first
            return {"ok": True, "target": target, "label": label, "system": name, "files": files}
        except Exception as e:
            return {"ok": False, "error": _clean_error(f"{type(e).__name__}: {e}")}
        finally:
            shutil.rmtree(work, ignore_errors=True)

    @staticmethod
    def write_files(folder, files):
        """Write exported files into a folder chosen by the user."""
        written = []
        for f in files:
            dest = os.path.normpath(os.path.join(folder, f["path"]))
            if not dest.startswith(os.path.normpath(folder)):
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8", newline="") as fh:
                fh.write(f["text"])
            written.append(dest)
        return written


SUPERSCRIPT = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")


def pretty_unit(u):
    """'m / (s ^ 2.0)' -> 'm/s²', 'N*s/m' -> 'N·s/m'."""
    u = str(u or "").strip()
    u = re.sub(r"\s*([/*^])\s*", r"\1", u)
    u = re.sub(r"\^(-?\d+)(?:\.0+)?", lambda m: m.group(1).translate(SUPERSCRIPT), u)
    u = re.sub(r"\(([^()/*·]+)\)", r"\1", u)
    while u.startswith("(") and u.endswith(")") and _balanced(u[1:-1]):
        u = u[1:-1]                                   # brackets around the whole unit
    u = re.sub(r"^\(([^()/]+)\)/", r"\1/", u)         # brackets around a product numerator
    return u.replace("*", "·")


def _balanced(s):
    depth = 0
    for ch in s:
        depth += (ch == "(") - (ch == ")")
        if depth < 0:
            return False
    return depth == 0


class CompileError(Exception):
    def __init__(self, message, log):
        super().__init__(message)
        self.log = log


def _has_force(comp):
    for attr in ("forces", "damping_forces", "rayleigh_dissipation"):
        v = getattr(comp, attr, None)
        if v:
            return True
    return False


def _clean_error(msg):
    msg = re.sub(r"^(Compilation failed: )+", "", str(msg))
    msg = msg.replace("Equation derivation failed: Equation derivation returned None",
                      "The equations of motion could not be derived. Check the \\lagrangian line.")
    msg = re.sub(r"^Parser error: ", "Syntax error: ", msg)
    return msg[:600]


def _list(a):
    a = np.asarray(a, dtype=float)
    return [None if not math.isfinite(v) else round(float(v), 10) if abs(v) < 1e15 else float(v)
            for v in a.tolist()]
