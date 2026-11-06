# Changelog

## 1.2.0 (November 2026)

- **Energy is now conserved over long runs.** Conservative systems are integrated with a
  symplectic method, the two-stage Gauss-Legendre method (order 4), whose energy error
  stays bounded however long the run instead of accumulating. Over 5,000 years the
  planetary orbit's relative energy drift falls from 1.3%, and rising, to 4e-10, the
  same as over 500 years; its angular momentum is conserved to rounding error. Every
  conservative example in the gallery now holds its energy to 1e-9 or better, and most
  re-solve as quickly as before or faster. The method works for any system whose
  Lagrangian is quadratic in the velocities, including orbits in polar coordinates and
  pendulums whose mass matrix changes with the configuration, and for Hamiltonian
  worksheets. Its fixed step is chosen from a short trial over the fastest part of the
  motion, and the whole run is then checked against the energy target.
- **Tighter tolerance for the adaptive solver,** used for systems with damping or other
  non-conservative forces: a relative tolerance of 1e-10, against 1e-6 before. The
  damped oscillator's error against its exact solution falls from 2e-8 to 2e-10.
- **Integrator setting.** Each system's Time span panel has an Integrator choice:
  Automatic (the default: symplectic for conservative systems, adaptive otherwise),
  Symplectic or Adaptive. The solver note gives the step used, and the energy pane says
  when the error is bounded. If the symplectic integrator cannot be used for a system,
  the worksheet says why and uses the adaptive solver.
- **Fixed: small energy drifts were plotted as steps.** The energy and its drift were
  rounded to ten decimal places before plotting, which turned drifts near 1e-10 into
  staircases; they are now rounded to significant figures instead.

## 1.1.1 (November 2026)

- **Fixed: the Windows build from the release did not open** when its zip had been
  extracted with File Explorer. Windows marks every extracted file as downloaded from the
  internet, the .NET Framework will not load a marked library, and the window library
  stopped with "Failed to resolve Python.Runtime.Loader.Initialize". The app now clears
  the mark from the libraries it loads through .NET before opening the window.

## 1.1.0 (November 2026)

- **Handouts.** The Handout button saves the worksheet as one self-contained web page:
  notes, each model's source, parameters and starting values, the equations of motion,
  four stills of the motion, and plots of the coordinates, phase portraits and (if
  chosen) energy. Mathematics is MathML and figures are embedded, so the file works
  offline in any browser and prints, or saves as PDF, on white paper in either theme.
  Long equations are scaled to fit the printed page.
- **macOS.** Builds for Apple silicon and Intel Macs, as disk images.
- **Release builds on GitHub Actions** for Windows and both kinds of Mac, each checked by
  the bundled program's self-test before it is attached to the release. `build.py` holds
  the build steps for every platform; the version number now comes only from
  `mechanicsdsl_studio/__init__.py`.

## 1.0.0 (November 2026)

First release.

- Worksheets of systems and notes, saved as `.mdsw` files.
- For each system: the Lagrangian or Hamiltonian and the equations of motion, typeset;
  an animation; coordinates against time; phase portraits; the energy function and its
  drift; and generated code in twelve languages.
- Parameters and starting values on sliders. The equations are derived once and reused,
  so changes re-solve in a fraction of a second.
- Animations without setup for pendulum chains, elastic pendulums, carts, orbits,
  particles in a plane and masses on springs.
- Syntax errors reported in plain language, with the line highlighted.
- Computations run in a separate process and can be stopped.
- Nine worked examples, a command reference, light and dark themes.
- Works offline.
