"""Integrator tests: the symplectic path for conservative systems, the adaptive path for
the rest, and the choice between them. Run with: python -m pytest -q tests"""
import math

import numpy as np
import pytest
from scipy.integrate import solve_ivp

from mechanicsdsl_studio.examples import EXAMPLES
from mechanicsdsl_studio.engine import Engine

BY_ID = {e["id"]: e for e in EXAMPLES}


@pytest.fixture(scope="module")
def engine():
    e = Engine()
    e.warm_up()
    return e


def series(r, name):
    return np.array(r["simulation"]["series"][name])


@pytest.mark.parametrize("cid", [c for c in BY_ID if c != "damped-oscillator"])
def test_conservative_examples_use_the_symplectic_integrator(engine, cid):
    ex = BY_ID[cid]
    r = engine.run(ex["source"], ex["settings"])
    assert r["simulation"]["integrator"] == "symplectic", r["warnings"]
    assert r["simulation"]["step"] > 0
    assert r["energy"]["max_relative_drift"] < 1e-8


def test_kepler_orbit_over_five_thousand_years(engine):
    """Dr Bai's test. MechanicsDSL Studio 1.1.1 let this orbit's energy drift by 1.3%
    over 5,000 years, steadily. The energy error must now stay bounded, the same at
    5,000 years as at 500, and the angular momentum must be conserved, since the
    Gauss-Legendre method conserves every linear invariant exactly."""
    src = BY_ID["kepler-orbit"]["source"]
    long = engine.run(src, {"t_end": 5000, "points": 4000})
    short = engine.run(src, {"t_end": 500, "points": 4000})
    assert long["simulation"]["integrator"] == "symplectic"
    assert long["energy"]["max_relative_drift"] < 1e-8
    assert long["energy"]["max_relative_drift"] < 3 * short["energy"]["max_relative_drift"]
    r, phi_dot = series(long, "r"), series(long, "phi_dot")
    h = r ** 2 * phi_dot              # angular momentum; the series are rounded for display
    assert np.max(np.abs(h - h[0])) / abs(h[0]) < 1e-9


def test_kepler_angular_momentum_is_conserved_to_rounding(engine):
    """The integrator's own, unrounded output: the angular momentum p_phi is a linear
    invariant, which Gauss-Legendre conserves to rounding error."""
    from mechanicsdsl_studio import integrators
    comp = engine._compile(BY_ID["kepler-orbit"]["source"])[0]
    coords = comp.get_coordinates()
    params = {k: float(v["value"]) for k, v in comp.parameters_def.items()}
    flow = integrators.HamiltonianFlow(comp, coords, list(params), False)
    sol = integrators.integrate(flow, [1.0, 0.0, 0.0, 5.0], [params[k] for k in flow.param_names], 500, 2000)
    y = sol["y"]
    h = params["m"] * y[0] ** 2 * y[3]
    assert np.max(np.abs(h - h[0])) / abs(h[0]) < 1e-12


def test_drift_series_keeps_its_shape(engine):
    """A drift near 1e-10 must reach the plot as values, not rounded to zero."""
    ex = BY_ID["kepler-orbit"]
    r = engine.run(ex["source"], {"t_end": 50, "points": 2000})
    drift = np.abs(np.array(r["energy"]["relative_drift"]))
    assert np.count_nonzero(drift) > 0.9 * len(drift)
    assert drift.max() == pytest.approx(r["energy"]["max_relative_drift"], rel=1e-4)


def test_symplectic_trajectory_matches_a_tight_reference(engine):
    """Bounded energy is not enough: the motion itself must be right. Compare the
    pendulum with scipy's DOP853 at a relative tolerance of 1e-13."""
    ex = BY_ID["simple-pendulum"]
    r = engine.run(ex["source"], {"t_end": 10, "points": 1001})
    t = np.array(r["simulation"]["t"])
    ref = solve_ivp(lambda _, y: [y[1], -9.81 * math.sin(y[0])], (0, 10), [0.5, 0.0],
                    method="DOP853", rtol=1e-13, atol=1e-14, t_eval=t)
    assert np.max(np.abs(series(r, "theta") - ref.y[0])) < 1e-6


def test_coupled_mass_matrix_double_pendulum(engine):
    """A mass matrix that depends on the configuration and is not diagonal."""
    ex = BY_ID["double-pendulum"]
    r = engine.run(ex["source"], {"t_end": 3, "points": 601})
    t = np.array(r["simulation"]["t"])
    g, l, m = 9.81, 1.0, 1.0

    def rhs(_, y):
        a, b, ad, bd = y
        d = a - b
        M = np.array([[2 * m * l * l, m * l * l * math.cos(d)], [m * l * l * math.cos(d), m * l * l]])
        f = np.array([-m * l * l * bd * bd * math.sin(d) - 2 * m * g * l * math.sin(a),
                      m * l * l * ad * ad * math.sin(d) - m * g * l * math.sin(b)])
        return [ad, bd, *np.linalg.solve(M, f)]

    ref = solve_ivp(rhs, (0, 3), [2.5, 2.0, 0, 0], method="DOP853", rtol=1e-13, atol=1e-14, t_eval=t)
    assert np.max(np.abs(series(r, "theta1") - ref.y[0])) < 1e-5


def test_many_coordinates_use_the_numerical_solve(engine):
    """The figure-eight has six coordinates, beyond the symbolic velocity solve, and
    should return close to its starting point after one period, 6.3259 time units."""
    ex = BY_ID["figure-eight"]
    r = engine.run(ex["source"], {"t_end": 6.3259, "points": 1500})
    assert r["simulation"]["integrator"] == "symplectic"
    assert r["energy"]["max_relative_drift"] < 1e-8
    assert abs(series(r, "x1")[-1] - 0.97000436) < 1e-3
    assert abs(series(r, "y1")[-1] + 0.24308753) < 1e-3


def test_hamiltonian_worksheet_uses_the_symplectic_integrator(engine):
    src = r"""\system{h}
\defvar{x}{Position}{m}
\parameter{m}{1.0}{kg}
\parameter{k}{4.0}{N/m}
\hamiltonian{\frac{p_x^2}{2*m} + \frac{1}{2}*k*x^2}
\initial{x=1.0, p_x=0}
"""
    r = engine.run(src, {"t_end": 50, "points": 2001})
    assert r["simulation"]["integrator"] == "symplectic"
    t = np.array(r["simulation"]["t"])
    assert np.max(np.abs(series(r, "x") - np.cos(2 * t))) < 1e-5      # omega = 2


def test_damped_oscillator_uses_the_adaptive_solver(engine):
    ex = BY_ID["damped-oscillator"]
    r = engine.run(ex["source"], ex["settings"])
    assert r["simulation"]["integrator"] == "adaptive"
    assert not r["warnings"]
    t = np.array(r["simulation"]["t"])
    gamma = 0.25
    wd = math.sqrt(10.0 - gamma ** 2)
    exact = np.exp(-gamma * t) * (np.cos(wd * t) + gamma / wd * np.sin(wd * t))
    assert np.max(np.abs(series(r, "x") - exact)) < 1e-8


def test_choosing_symplectic_for_a_damped_system_says_why_not(engine):
    ex = BY_ID["damped-oscillator"]
    r = engine.run(ex["source"], dict(ex["settings"], integrator="symplectic"))
    assert r["ok"] and r["simulation"]["integrator"] == "adaptive"
    assert any("non-conservative force" in w for w in r["warnings"])


def test_choosing_adaptive_is_respected(engine):
    ex = BY_ID["simple-pendulum"]
    r = engine.run(ex["source"], dict(ex["settings"], integrator="adaptive"))
    assert r["simulation"]["integrator"] == "adaptive"
    assert r["energy"]["max_relative_drift"] < 1e-7
