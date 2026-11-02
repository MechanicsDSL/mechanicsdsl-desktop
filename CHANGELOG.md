# Changelog

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
