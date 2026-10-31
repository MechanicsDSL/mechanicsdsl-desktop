"""Engine, geometry and file tests. Run with: python -m pytest -q tests"""
import json
import math
import threading
import time

import numpy as np
import pytest

from mechanicsdsl_studio.app import Api
from mechanicsdsl_studio.engine import TARGETS, Engine, pretty_unit, tex_name
from mechanicsdsl_studio.examples import BLANK, EXAMPLES
from mechanicsdsl_studio.geometry import infer_animation
from mechanicsdsl_studio.worker import EngineProcess

EXPECTED_SHAPE = {
    "simple-pendulum": "pendulum", "double-pendulum": "pendulum", "damped-oscillator": "springs",
    "coupled-oscillators": "springs", "elastic-pendulum": "elastic", "pendulum-on-cart": "cart",
    "projectile": "particles", "kepler-orbit": "orbit", "figure-eight": "particles",
}


@pytest.fixture(scope="module")
def engine():
    e = Engine()
    e.warm_up()
    return e


@pytest.mark.parametrize("example", EXAMPLES, ids=[e["id"] for e in EXAMPLES])
def test_every_example_runs(engine, example):
    r = engine.run(example["source"], example["settings"])
    assert r["ok"], r.get("error")
    assert r["equations"]["blocks"], "no equations typeset"
    sim = r["simulation"]
    assert len(sim["t"]) == sim["points"] and sim["t"][-1] == pytest.approx(example["settings"]["t_end"])
    for name, values in sim["series"].items():
        assert len(values) == len(sim["t"]) and all(v is not None for v in values), name
    assert r["animation"]["kind"] == EXPECTED_SHAPE[example["id"]]
    json.dumps(r)                                    # everything must cross the bridge as JSON


@pytest.mark.parametrize("example", [e for e in EXAMPLES if e["id"] != "damped-oscillator"],
                         ids=[e["id"] for e in EXAMPLES if e["id"] != "damped-oscillator"])
def test_conservative_examples_conserve_energy(engine, example):
    r = engine.run(example["source"], example["settings"])
    assert r["energy"]["conserved"]
    assert r["energy"]["max_relative_drift"] < 1e-3


def test_damped_oscillator_loses_energy(engine):
    ex = next(e for e in EXAMPLES if e["id"] == "damped-oscillator")
    r = engine.run(ex["source"], ex["settings"])
    assert not r["energy"]["conserved"]
    assert r["energy"]["values"][-1] < 0.1 * r["energy"]["values"][0]


def test_small_angle_pendulum_period(engine):
    """With theta(0) = 0.01 the period should be 2*pi*sqrt(l/g) to within 0.01%."""
    src = next(e for e in EXAMPLES if e["id"] == "simple-pendulum")["source"]
    r = engine.run(src, {"t_end": 10, "points": 4000, "initial": {"theta": 0.01}, "parameters": {"l": 2.0}})
    t, th = np.array(r["simulation"]["t"]), np.array(r["simulation"]["series"]["theta"])
    up = [i for i in range(1, len(th)) if th[i - 1] < 0 <= th[i]]
    crossings = [t[i - 1] + (t[i] - t[i - 1]) * (-th[i - 1]) / (th[i] - th[i - 1]) for i in up]
    period = (crossings[-1] - crossings[0]) / (len(crossings) - 1)
    assert period == pytest.approx(2 * math.pi * math.sqrt(2.0 / 9.81), rel=1e-4)


def test_overrides_do_not_leak_into_the_cache(engine):
    src = next(e for e in EXAMPLES if e["id"] == "simple-pendulum")["source"]
    a = engine.run(src, {"parameters": {"g": 1.0}})
    b = engine.run(src, {})
    assert b["cached"] and b["system"]["parameters"][2]["value"] == 9.81
    assert a["simulation"]["series"]["theta"][200] != b["simulation"]["series"]["theta"][200]


def test_equations_read_like_a_textbook(engine):
    r = engine.run(EXAMPLES[0]["source"], EXAMPLES[0]["settings"])
    eom = r["equations"]["blocks"][1]["lines"][0]
    assert eom == r"\ddot{\theta} = - \frac{g \sin{\left(\theta \right)}}{l}"
    assert "1.0" not in r["equations"]["blocks"][0]["lines"][0]


def test_hamiltonian_systems(engine):
    src = r"""\system{h}
\defvar{x}{Position}{m}
\parameter{m}{1.0}{kg}
\parameter{k}{4.0}{N/m}
\hamiltonian{\frac{p_x^2}{2*m} + \frac{1}{2}*k*x^2}
\initial{x=1.0, p_x=0}
"""
    r = engine.run(src, {"t_end": 5, "points": 2000})
    assert r["ok"] and r["system"]["formulation"] == "Hamiltonian"
    assert [i["name"] for i in r["system"]["initial"]] == ["x", "p_x"]
    t, x = np.array(r["simulation"]["t"]), np.array(r["simulation"]["series"]["x"])
    assert x[np.argmin(abs(t - math.pi))] == pytest.approx(1.0, abs=1e-4)   # omega = 2


def test_syntax_error_is_reported_plainly(engine):
    r = engine.run(r"\system{x}\defvar{q}{a}{m}\lagrangian{\dot{q}^2 - q^")
    assert not r["ok"] and r["stage"] == "compile"
    assert "Traceback" not in r["error"] and len(r["error"]) < 300


@pytest.mark.parametrize("target", list(TARGETS))
def test_code_generation(engine, target):
    r = engine.export(EXAMPLES[3]["source"], target)
    assert r["ok"], r.get("error")
    assert r["files"] and all(f["text"].strip() for f in r["files"])
    assert r["files"][0]["path"].startswith("double_pendulum")


def test_write_files_stays_inside_the_folder(tmp_path):
    written = Engine.write_files(str(tmp_path), [{"path": "a/b.c", "text": "x"}, {"path": "../escape.c", "text": "y"}])
    assert (tmp_path / "a" / "b.c").read_text() == "x"
    assert len(written) == 1 and not (tmp_path.parent / "escape.c").exists()


def test_blank_system_runs(engine):
    assert engine.run(BLANK, {})["ok"]


def test_units_and_names():
    assert pretty_unit("m / (s ^ 2.0)") == "m/s²"
    assert pretty_unit("N*s/m") == "N·s/m"
    assert pretty_unit("((N * m ^ 2) / (kg ^ 2))") == "N·m²/kg²"
    assert pretty_unit("(N * m ^ 2) / (kg ^ 2)") == "N·m²/kg²"
    assert tex_name("theta1") == r"\theta_{1}"
    assert tex_name("theta1", "dot") == r"\dot{\theta}_{1}"
    assert tex_name("GM") == r"\mathrm{GM}"


def test_geometry_unknown_shape_is_not_animated():
    t = np.linspace(0, 1, 10)
    y = np.zeros((4, 10))
    assert infer_animation("x", ["theta", "q"], {}, t, y) is not None       # cart: one linear, one angle
    assert infer_animation("x", ["u", "v", "w"], {}, t, np.zeros((6, 10)))["kind"] == "springs"
    assert infer_animation("x", ["r", "s"], {}, t, y)["kind"] == "springs"
    assert infer_animation("x", ["x", "y", "theta"], {}, t, np.zeros((6, 10))) is None


def test_worksheet_round_trip(tmp_path):
    api = Api(engine=None, window_ref=lambda: None)
    doc = {"format": "mechanicsdsl-worksheet", "version": 1, "title": "Test",
           "cells": [{"type": "code", "source": BLANK, "settings": {"t_end": 3}}, {"type": "text", "source": "# Notes"}]}
    path = str(tmp_path / "t.mdsw")
    assert api.save_worksheet(doc, path)["path"] == path
    back = api.read_worksheet(path)
    assert back["data"] == doc
    (tmp_path / "bad.mdsw").write_text("{}")
    assert "error" in api.read_worksheet(str(tmp_path / "bad.mdsw"))


def test_engine_process_runs_and_can_be_stopped():
    proc = EngineProcess()
    try:
        r = proc.call("run", EXAMPLES[0]["source"], {"t_end": 2})
        assert r["ok"]
        result = {}
        th = threading.Thread(target=lambda: result.update(proc.call("run", EXAMPLES[3]["source"], {"t_end": 2000, "points": 4000})))
        th.start()
        time.sleep(1.0)
        proc.cancel()
        th.join(20)
        assert result.get("cancelled")
        assert proc.call("run", EXAMPLES[0]["source"], {"t_end": 1})["ok"]   # restarted and usable
    finally:
        proc.close()
