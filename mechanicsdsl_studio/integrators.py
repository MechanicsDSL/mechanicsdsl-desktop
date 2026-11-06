"""Energy-conserving integration for conservative systems.

A general-purpose adaptive solver does not conserve energy by construction: its error in
the energy accumulates, usually in one direction, so over a long run the energy drifts.
For a conservative system Studio integrates instead with a symplectic method, the
two-stage Gauss-Legendre Runge-Kutta method (order 4). A symplectic method preserves
the geometry of Hamiltonian flow, and as a consequence its energy error stays bounded,
oscillating about zero, however long the run (Hairer, Lubich and Wanner, *Geometric
Numerical Integration*, 2nd ed., 2006, chapters VI and IX). Gauss-Legendre methods are
symplectic for every Hamiltonian, not only the separable ones H = T(p) + V(q) that the
cheaper explicit methods need, which matters for systems such as an orbit written in
polar coordinates, whose kinetic energy depends on the position. They also conserve
every linear and quadratic invariant exactly, such as the angular momentum of an orbit.

The method integrates Hamilton's equations in positions q and momenta p. For a system
given by its Lagrangian, the momenta are p = dL/d(qdot); this module requires the
Lagrangian to be quadratic in the velocities, L = 1/2 qdot.M(q).qdot + b(q).qdot - V(q),
so that the velocities follow from the momenta by solving the linear system
M(q) qdot = p - b(q). The step is fixed, since a step that varies with the state is no
longer symplectic. It is chosen from a short trial run, so that the energy error stays
below a target, and then shortened slightly so that every output point falls on a step.
"""
import math

import numpy as np
import sympy as sp
from scipy.integrate import DOP853

ENERGY_TOLERANCE = 1e-9    # target bound on the relative energy error
MAX_STEPS = 20_000_000     # beyond this a run would take many minutes
PILOT_STEPS = 400          # adaptive steps used to find the system's fastest time scale
PILOT_MARGIN = 40          # adaptive steps either side of the fastest, for the trial
TRIAL_STEPS = 5_000        # most fixed steps in one trial
RETRY_FACTOR = 10          # a run whose energy error is this far past the target is redone
ITERATION_TOL = 1e-15      # convergence of the stage equations (fixed-point iteration)
MAX_ITERATIONS = 60
SYMBOLIC_SOLVE_LIMIT = 3   # coordinates up to which the velocities are solved symbolically

_R3 = math.sqrt(3.0)
A11, A12 = 0.25, 0.25 - _R3 / 6.0
A21, A22 = 0.25 + _R3 / 6.0, 0.25
C1, C2 = 0.5 - _R3 / 6.0, 0.5 + _R3 / 6.0          # the stages' places in the step
E1, E2 = 1.0 / (C2 - C1), (1.0 + C2 - C1) / (C2 - C1)  # extrapolation to the next step
NAME = "Gauss-Legendre, order 4 (symplectic)"


class NotConservative(Exception):
    """The system cannot be integrated symplectically; the message says why."""


class StepTooLong(Exception):
    """The stage equations did not converge at this step size."""


def _solve(M, r):
    """Solve the small dense system M x = r by Gaussian elimination with pivoting."""
    n = len(r)
    if n == 1:
        return [r[0] / M[0][0]]
    a = [list(row) + [r[i]] for i, row in enumerate(M)]
    for c in range(n):
        piv = max(range(c, n), key=lambda i: abs(a[i][c]))
        if a[piv][c] == 0.0:
            raise ZeroDivisionError("singular mass matrix")
        a[c], a[piv] = a[piv], a[c]
        for i in range(c + 1, n):
            f = a[i][c] / a[c][c]
            if f:
                for j in range(c, n + 1):
                    a[i][j] -= f * a[c][j]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (a[i][n] - sum(a[i][j] * x[j] for j in range(i + 1, n))) / a[i][i]
    return x


class HamiltonianFlow:
    """Hamilton's equations for one compiled system, as fast scalar functions.

    The state is z = (q_1, ..., q_n, p_1, ..., p_n). Parameters are arguments rather than
    constants, so one flow serves every setting of the sliders.
    """

    def __init__(self, comp, coords, param_names, has_force):
        if has_force:
            raise NotConservative("it has a non-conservative force")
        if getattr(comp, "constraints", None):
            raise NotConservative("it has constraints")
        self.n = n = len(coords)
        self.coords = coords
        self.param_names = list(param_names)

        if comp.lagrangian is not None:
            expr = comp.symbolic.ast_to_sympy(comp.lagrangian)
        elif getattr(comp, "hamiltonian", None) is not None:
            expr = comp.symbolic.ast_to_sympy(comp.hamiltonian)
        else:
            raise NotConservative("it has neither a Lagrangian nor a Hamiltonian")
        by_name = {s.name: s for s in expr.free_symbols}     # keep the parser's own symbols
        sym = lambda name: by_name.get(name, sp.Symbol(name))
        qs = [sym(q) for q in coords]
        pars = [sym(k) for k in self.param_names]
        known = set(qs) | set(pars)
        self.lagrangian = comp.lagrangian is not None
        # MechanicsDSL can integrate a Lagrangian system in momenta; follow its layout.
        self.momentum_layout = bool(comp.use_hamiltonian_formulation)

        if self.lagrangian:
            qd = [sym(f"{q}_dot") for q in coords]
            known |= set(qd)
            if expr.free_symbols - known:
                extra = ", ".join(sorted(s.name for s in expr.free_symbols - known))
                raise NotConservative(f"its Lagrangian depends on {extra}")
            L = expr
            dL = [sp.diff(L, v) for v in qd]
            M = [[sp.diff(d, v) for v in qd] for d in dL]
            if any(sp.expand(sp.diff(m, v)) != 0 for row in M for m in row for v in qd):
                raise NotConservative("its Lagrangian is not quadratic in the velocities")
            zero = {v: 0 for v in qd}
            b = [d.subs(zero) for d in dL]
            args_q = qs + pars
            args_qv = qs + qd + pars
            self._M = sp.lambdify(args_q, M, modules="math", cse=True)
            self._b = sp.lambdify(args_q, b, modules="math", cse=True)
            self._dLdq = sp.lambdify(args_qv, [sp.diff(L, q) for q in qs], modules="math", cse=True)
            self._L = sp.lambdify(args_qv, L, modules="math", cse=True)
            self._p = sp.lambdify(args_qv, dL, modules="math", cse=True)
            self._fast_field = None
            if n <= SYMBOLIC_SOLVE_LIMIT:
                # For a few coordinates, solve M qdot = p - b symbolically once, so each
                # evaluation of the field is a single generated function.
                ps = [sp.Dummy(f"p{i}") for i in range(n)]
                vel = list(sp.Matrix(M).LUsolve(sp.Matrix(ps) - sp.Matrix(b)))
                pdot = [sp.diff(L, q).subs(dict(zip(qd, vel)), simultaneous=True) for q in qs]
                self._fast_field = sp.lambdify(qs + ps + pars, vel + pdot, modules="math", cse=True)
        else:
            ps = [sym(f"p_{q}") for q in coords]
            known |= set(ps)
            if expr.free_symbols - known:
                extra = ", ".join(sorted(s.name for s in expr.free_symbols - known))
                raise NotConservative(f"its Hamiltonian depends on {extra}")
            H = expr
            field = [sp.diff(H, p) for p in ps] + [-sp.diff(H, q) for q in qs]
            args = qs + ps + pars
            self._field = sp.lambdify(args, field, modules="math", cse=True)
            self._H = sp.lambdify(args, H, modules="math", cse=True)

    # -- the vector field and the energy
    def velocities(self, z, prm):
        """The velocities qdot for the state z = (q, p)."""
        q, p = z[:self.n], z[self.n:]
        b = self._b(*q, *prm)
        return _solve(self._M(*q, *prm), [p[i] - b[i] for i in range(self.n)])

    def field(self, z, prm):
        """dz/dt = (dH/dp, -dH/dq)."""
        if not self.lagrangian:
            return self._field(*z, *prm)
        if self._fast_field is not None:
            return self._fast_field(*z, *prm)
        q = z[:self.n]
        v = self.velocities(z, prm)
        return v + list(self._dLdq(*q, *v, *prm))

    def energy(self, z, prm):
        """The Hamiltonian, which for these systems is the energy function."""
        if not self.lagrangian:
            return self._H(*z, *prm)
        q, p = z[:self.n], z[self.n:]
        v = self.velocities(z, prm)
        return sum(p[i] * v[i] for i in range(self.n)) - self._L(*q, *v, *prm)

    def state_from(self, y0, prm):
        """Convert the solver's starting state (q, qdot) or (q, p), interleaved, to z."""
        q = [float(y0[2 * i]) for i in range(self.n)]
        rate = [float(y0[2 * i + 1]) for i in range(self.n)]
        if self.momentum_layout or not self.lagrangian:
            return q + rate
        return q + list(self._p(*q, *rate, *prm))

    def interleaved(self, zs, prm):
        """Convert states z back to the solver's layout: rows q_1, rate_1, q_2, rate_2, ..."""
        y = np.empty((2 * self.n, len(zs)))
        for k, z in enumerate(zs):
            rate = z[self.n:] if self.momentum_layout else self.velocities(z, prm)
            for i in range(self.n):
                y[2 * i, k] = z[i]
                y[2 * i + 1, k] = rate[i]
        return y


def _step(field, z, h, k1, k2, prm, n):
    """One Gauss-Legendre step; k1 and k2 are starting guesses for the stage slopes.

    The stage equations are solved by fixed-point iteration, which converges for the
    non-stiff systems this method is used on. Each coordinate is judged on its own
    scale, so a coordinate that grows large, such as the angle of an orbit after many
    revolutions, does not loosen the test for the others. Iteration stops when the
    update falls to rounding level, or stops shrinking once it is already small.
    Returns the increment to the state, the stage slopes, and the evaluations used.
    """
    previous = math.inf
    for it in range(1, MAX_ITERATIONS + 1):
        z1 = [z[i] + h * (A11 * k1[i] + A12 * k2[i]) for i in range(n)]
        z2 = [z[i] + h * (A21 * k1[i] + A22 * k2[i]) for i in range(n)]
        n1 = field(z1, prm)
        n2 = field(z2, prm)
        change = abs(h) * max(max(abs(n1[i] - k1[i]), abs(n2[i] - k2[i])) / (1.0 + abs(z[i]))
                              for i in range(n))
        k1, k2 = n1, n2
        if not math.isfinite(change):
            raise StepTooLong()
        if change <= ITERATION_TOL or (change >= previous and change <= 1e-13):
            return [0.5 * h * (k1[i] + k2[i]) for i in range(n)], k1, k2, 2 * it
        previous = change
    raise StepTooLong()


def _run(flow, z0, prm, h, steps, every=1):
    """Take `steps` steps of size h from z0, keeping every `every`-th state.

    The state is updated with compensated (Kahan) summation, so that rounding error in
    adding millions of small increments does not itself drift (Hairer, Lubich and
    Wanner, section VIII.5). Returns the kept states and the number of evaluations.
    """
    field, n = flow.field, 2 * flow.n
    z = [float(x) for x in z0]
    carry = [0.0] * n
    k = list(field(z, prm))
    k1, k2 = k, list(k)
    out = [list(z)]
    evaluations = 1
    for s in range(1, steps + 1):
        dz, k1, k2, used = _step(field, z, h, k1, k2, prm, n)
        evaluations += used
        # Start the next step from the stage slopes extrapolated along this step's
        # collocation polynomial, whose derivative is linear through (c1, k1), (c2, k2).
        d = [k2[i] - k1[i] for i in range(n)]
        k1 = [k1[i] + E1 * d[i] for i in range(n)]
        k2 = [k1[i] + (E2 - E1) * d[i] for i in range(n)]
        for i in range(n):
            y = dz[i] + carry[i]
            t = z[i] + y
            carry[i] = (z[i] - t) + y
            z[i] = t
        if s % every == 0:
            out.append(list(z))
    return out, evaluations


def _energy_error(flow, zs, prm):
    e = [flow.energy(z, prm) for z in zs]
    e0 = e[0]
    scale = abs(e0) if abs(e0) > 1e-12 else max(1e-12, max(abs(x) for x in e))
    return max(abs(x - e0) for x in e) / scale


def _pilot(flow, z0, prm, t_end):
    """Find the fastest part of the motion, such as an orbit's closest approach.

    Takes a few hundred steps of an adaptive solver and returns its smallest step, with
    the state some way before that step and the length of a stretch around it, so that
    a trial of the fixed-step method can be run over the hardest part of the motion
    without running the whole span.
    """
    solver = DOP853(lambda t, z: flow.field(list(z), prm), 0.0, np.array(z0), t_end,
                    rtol=1e-8, atol=1e-10)
    times, states = [0.0], [list(z0)]
    for _ in range(PILOT_STEPS):
        if solver.status != "running":
            break
        solver.step()
        if solver.status == "failed":
            break
        times.append(float(solver.t))
        states.append([float(x) for x in solver.y])
    sizes = [times[i + 1] - times[i] for i in range(len(times) - 1)]
    if not sizes or min(sizes) <= 0:
        return t_end / 1000, list(z0), t_end
    i = min(range(len(sizes)), key=sizes.__getitem__)
    first, last = max(0, i - PILOT_MARGIN), min(len(times) - 1, i + 1 + PILOT_MARGIN)
    return sizes[i], states[first], times[last] - times[first]


def _choose_step(flow, z0, prm, t_end, gap, tolerance):
    """Choose the fixed step, and return it with the energy error measured in trial.

    Starts from the adaptive solver's smallest step and tries it over the hardest part
    of the motion. The energy error of a fourth-order method scales as the fourth power
    of the step, so the step is rescaled by that law, shorter or longer, and the longest
    step whose error is inside the target is kept.
    """
    h_min, start, window = _pilot(flow, z0, prm, t_end)
    h = min(h_min, gap)
    best, best_error = None, None
    for _ in range(8):
        steps = max(PILOT_MARGIN, int(math.ceil(window / h)))
        try:
            trial, _ = _run(flow, start, prm, h, min(steps, TRIAL_STEPS))
            error = _energy_error(flow, trial, prm)
        except (StepTooLong, ZeroDivisionError, OverflowError, ValueError):
            h /= 4
            continue
        if error <= tolerance:
            if best is None or h > best:
                best, best_error = h, error
            if error >= tolerance / 5 or h >= gap:
                break
            factor = min(4.0, 0.8 * (tolerance / max(error, 1e-300)) ** 0.25)
        else:
            factor = max(0.1, 0.8 * (tolerance / error) ** 0.25)
        h = min(h * factor, gap)
        if best is not None and h <= best:
            break
    if best is None:
        raise NotConservative("no step size met the energy tolerance")
    return best, best_error


def integrate(flow, y0, prm, t_end, points, tolerance=ENERGY_TOLERANCE):
    """Integrate from y0 (the solver's interleaved starting state) to t_end.

    Returns a dict in the shape of MechanicsDSL's own solution, plus the step used and
    the largest relative energy error at the output points.
    """
    z0 = flow.state_from(y0, prm)
    gap = t_end / (points - 1)
    h, _ = _choose_step(flow, z0, prm, t_end, gap, tolerance)

    for attempt in range(2):
        per_gap = max(1, int(math.ceil(gap / h)))     # whole steps between output points
        h = gap / per_gap
        total = per_gap * (points - 1)
        if total > MAX_STEPS:
            raise NotConservative(f"it would need {total:,} steps")
        try:
            zs, evaluations = _run(flow, z0, prm, h, total, every=per_gap)
            error = _energy_error(flow, zs, prm)
        except (StepTooLong, ZeroDivisionError, OverflowError, ValueError):
            error = math.inf
        # The trial is a sample of the motion; the whole run is the test. If the trial
        # missed something and the run's energy error is well outside the target,
        # shorten the step by the fourth-root law and run once more.
        if error <= RETRY_FACTOR * tolerance:
            break
        if attempt == 1 or not math.isfinite(error):
            raise NotConservative("its energy error could not be brought inside the target")
        h *= max(0.1, 0.8 * (tolerance / error) ** 0.25)

    return {
        "success": True, "t": np.linspace(0.0, t_end, points), "y": flow.interleaved(zs, prm),
        "method_used": NAME, "nfev": evaluations, "steps": total, "step": h,
        "energy_error": error, "is_stiff": False, "use_hamiltonian": flow.momentum_layout,
    }
