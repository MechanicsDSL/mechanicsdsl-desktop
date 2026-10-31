"""Work out how to draw a system from its coordinates, so most systems animate without setup.

Recognised shapes, in order:
  pendulum chain    every coordinate is an angle (theta1, theta2, ...), measured from the
                    downward vertical, with lengths l1, l2, ... (or l)
  elastic pendulum  r and theta: a mass on a spring hanging from a pivot
  orbit             r and phi: polar coordinates about a central body
  cart and pendulum one linear coordinate and one angle
  particles         coordinates that pair up as x/y (x1, y1, x2, y2, ...)
  masses on springs every coordinate is a linear displacement (x, x1, x2, ...)
Anything else is not animated; the plots still show the motion.
"""
import re

import numpy as np

ANGLE = re.compile(r"^(theta|phi|psi|alpha|beta|gamma|varphi|vartheta)_?\d*$")
MAX_FRAMES = 1500


def _param(params, names, default):
    for n in names:
        if n in params:
            return float(params[n])
    return default


def _frames(t, n=MAX_FRAMES):
    if len(t) <= n:
        return np.arange(len(t))
    return np.unique(np.linspace(0, len(t) - 1, n).round().astype(int))


def _pack(kind, t, idx, bodies, anchors=(), links=(), trail=False, extra=None):
    xs = [b["x"] for b in bodies] + [np.array([a["x"]]) for a in anchors]
    ys = [b["y"] for b in bodies] + [np.array([a["y"]]) for a in anchors]
    allx, ally = np.concatenate(xs), np.concatenate(ys)
    allx, ally = allx[np.isfinite(allx)], ally[np.isfinite(ally)]
    if not len(allx):
        return None
    out = {
        "kind": kind,
        "t": [round(float(v), 9) for v in t[idx]],
        "bodies": [{"x": _r(b["x"][idx]), "y": _r(b["y"][idx]), "size": b.get("size", 1.0),
                    "shape": b.get("shape", "disc"), "label": b.get("label", "")} for b in bodies],
        "anchors": list(anchors),
        "links": list(links),
        "trail": trail,
        "bounds": [float(allx.min()), float(allx.max()), float(ally.min()), float(ally.max())],
    }
    if extra:
        out.update(extra)
    return out


def _r(a):
    return [None if not np.isfinite(v) else round(float(v), 7) for v in a]


def _mass_size(params, i, n):
    m = _param(params, [f"m{i}", f"m_{i}", "m"], 1.0)
    return m


def infer_animation(name, coords, params, t, y):
    t = np.asarray(t, float)
    y = np.asarray(y, float)
    q = {c: y[2 * i] for i, c in enumerate(coords)}
    idx = _frames(t)
    angles = [c for c in coords if ANGLE.match(c)]
    linear = [c for c in coords if c not in angles]
    n = len(coords)

    # pendulum chain
    if n and len(angles) == n:
        bodies, links, px, py = [], [], np.zeros_like(t), np.zeros_like(t)
        prev = "a0"
        for i, c in enumerate(coords, 1):
            l = _param(params, [f"l{i}", f"L{i}", f"l_{i}"] + (["l", "L"] if True else []), 1.0)
            px = px + l * np.sin(q[c])
            py = py - l * np.cos(q[c])
            bodies.append({"x": px.copy(), "y": py.copy(), "size": _mass_size(params, i, n), "label": c})
            links.append({"from": prev, "to": f"b{i - 1}", "style": "rod"})
            prev = f"b{i - 1}"
        return _pack("pendulum", t, idx, bodies, [{"x": 0.0, "y": 0.0, "style": "pivot"}], links,
                     trail=n > 1)

    # r with an angle
    if set(linear) == {"r"} and len(angles) == 1:
        a, r = q[angles[0]], q["r"]
        if angles[0].startswith("phi") or angles[0].startswith("varphi"):
            body = {"x": r * np.cos(a), "y": r * np.sin(a), "size": 1.0, "label": "body"}
            return _pack("orbit", t, idx, [body], [{"x": 0.0, "y": 0.0, "style": "star"}], [],
                         trail=True)
        body = {"x": r * np.sin(a), "y": -r * np.cos(a), "size": _mass_size(params, 1, 1), "label": "mass"}
        return _pack("elastic", t, idx, [body], [{"x": 0.0, "y": 0.0, "style": "pivot"}],
                     [{"from": "a0", "to": "b0", "style": "spring"}], trail=True)

    # cart and pendulum
    if len(linear) == 1 and len(angles) == 1:
        x, a = q[linear[0]], q[angles[0]]
        l = _param(params, ["l", "L", "l1"], 1.0)
        cart = {"x": x, "y": np.zeros_like(x), "size": _param(params, ["M", "m_c", "mc"], 2.0),
                "shape": "cart", "label": linear[0]}
        bob = {"x": x + l * np.sin(a), "y": -l * np.cos(a), "size": _param(params, ["m", "m_p", "mp"], 1.0),
               "label": angles[0]}
        return _pack("cart", t, idx, [cart, bob], [], [{"from": "b0", "to": "b1", "style": "rod"}],
                     trail=False, extra={"rail": True})

    # x/y pairs
    pairs = {}
    for c in linear:
        m = re.match(r"^([xy])_?(\w*)$", c)
        if m:
            pairs.setdefault(m.group(2), {})[m.group(1)] = c
    if linear and not angles and all(len(p) == 2 for p in pairs.values()) and \
            sum(len(p) for p in pairs.values()) == len(linear):
        bodies = []
        for i, (suffix, p) in enumerate(sorted(pairs.items())):
            bodies.append({"x": q[p["x"]], "y": q[p["y"]], "size": _mass_size(params, i + 1, len(pairs)),
                           "label": f"body {suffix}" if suffix else "body"})
        return _pack("particles", t, idx, bodies, [], [], trail=True)

    # masses on springs along a line
    if linear and not angles:
        k = len(linear)
        walls_right = f"k{k + 1}" in params
        spacing = 1.0
        amp = max(float(np.nanmax(np.abs(q[c]))) for c in linear) or 1.0
        scale = min(1.0, 0.35 * spacing / amp)       # keep masses from overlapping on screen
        bodies, links = [], []
        for i, c in enumerate(linear):
            bodies.append({"x": (i + 1) * spacing + scale * q[c], "y": np.zeros_like(t),
                           "size": _mass_size(params, i + 1, k), "shape": "block", "label": c})
        anchors = [{"x": 0.0, "y": 0.0, "style": "wall"}]
        links.append({"from": "a0", "to": "b0", "style": "spring"})
        for i in range(1, k):
            links.append({"from": f"b{i - 1}", "to": f"b{i}", "style": "spring"})
        if walls_right:
            anchors.append({"x": (k + 1) * spacing, "y": 0.0, "style": "wall"})
            links.append({"from": f"b{k - 1}", "to": "a1", "style": "spring"})
        out = _pack("springs", t, idx, bodies, anchors, links, trail=False,
                    extra={"display_scale": scale})
        if out:
            out["bounds"][2], out["bounds"][3] = -0.6, 0.6
        return out
    return None
