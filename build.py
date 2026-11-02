"""Build MechanicsDSL Studio for the computer this runs on.

    python build.py [--skip-tests]

Runs the tests, bundles the application with PyInstaller, runs the bundle's self-test
(every example and every code generator, in the frozen program) and packs it for release:

    Windows   dist/MechanicsDSL Studio/MechanicsDSL Studio.exe  ->  MechanicsDSL-Studio-<v>-windows.zip
    macOS     dist/MechanicsDSL Studio.app                       ->  MechanicsDSL-Studio-<v>-macos-<arch>.dmg

Install the requirements and PyInstaller first (build_exe.bat does this in a separate
environment on Windows; the GitHub workflow does it on each runner).
"""
import os
import platform
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = "MechanicsDSL Studio"
DIST = os.path.join(ROOT, "dist")
EXCLUDE = [
    "numba", "jax", "torch", "tensorflow", "IPython", "notebook", "jupyter_client",
    "PyQt5", "PyQt6", "PySide6", "tkinter",
    "mechanics_dsl.server", "mechanics_dsl.lsp", "mechanics_dsl.jupyter",
]


def version():
    with open(os.path.join(ROOT, "mechanicsdsl_studio", "__init__.py"), encoding="utf-8") as fh:
        return re.search(r'__version__\s*=\s*"([^"]+)"', fh.read()).group(1)


def run(cmd, **kw):
    print("+", " ".join(f'"{c}"' if " " in c else c for c in cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)


def windows_version_file(v):
    nums = tuple(int(x) for x in (v.split(".") + ["0", "0", "0"])[:4])
    path = os.path.join(ROOT, "build", "version_info.txt")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={nums}, prodvers={nums}, mask=0x3f, flags=0x0,
                    OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'MechanicsDSL'),
      StringStruct('FileDescription', '{NAME}'),
      StringStruct('FileVersion', '{v}'),
      StringStruct('InternalName', '{NAME}'),
      StringStruct('LegalCopyright', 'MIT License'),
      StringStruct('OriginalFilename', '{NAME}.exe'),
      StringStruct('ProductName', '{NAME}'),
      StringStruct('ProductVersion', '{v}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
""")
    return path


def pyinstaller(v):
    sep = ";" if os.name == "nt" else ":"
    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--name", NAME,
        "--icon", os.path.join("assets", "app.ico"),
        "--add-data", f"mechanicsdsl_studio{os.sep}web{sep}mechanicsdsl_studio{os.sep}web",
        "--collect-submodules", "mechanics_dsl.codegen",
        "--collect-submodules", "mechanics_dsl.solver",
        "--copy-metadata", "mechanicsdsl-core",
    ]
    for mod in EXCLUDE:
        cmd += ["--exclude-module", mod]
    if sys.platform == "win32":
        cmd += ["--version-file", windows_version_file(v)]
    if sys.platform == "darwin":
        # argv emulation turns the Finder's "open this worksheet" event into a path in
        # sys.argv, which is how app.py receives a double-clicked .mdsw file
        cmd += ["--osx-bundle-identifier", "org.mechanicsdsl.studio", "--argv-emulation"]
    run(cmd + [f"{NAME}.py"])


def mac_bundle_metadata(app, v):
    """Version, document type and minimum system in Info.plist, then re-sign (ad hoc)."""
    import plistlib
    plist_path = os.path.join(app, "Contents", "Info.plist")
    with open(plist_path, "rb") as fh:
        info = plistlib.load(fh)
    info.update({
        "CFBundleShortVersionString": v,
        "CFBundleVersion": v,
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "11.0",
        "NSHumanReadableCopyright": "MIT License",
        "CFBundleDocumentTypes": [{
            "CFBundleTypeName": "MechanicsDSL worksheet",
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Owner",
            "CFBundleTypeExtensions": ["mdsw"],
        }],
    })
    with open(plist_path, "wb") as fh:
        plistlib.dump(info, fh)
    run(["codesign", "--force", "--deep", "--sign", "-", app])


def selftest(program):
    report = os.path.join(ROOT, "selftest.txt")
    if os.path.exists(report):
        os.remove(report)
    code = subprocess.run([program, "--selftest", report], cwd=ROOT, timeout=1800).returncode
    if os.path.exists(report):
        with open(report, encoding="utf-8") as fh:
            print(fh.read())
    if code != 0 or not os.path.exists(report):
        sys.exit(f"The self-test of the built program failed (exit code {code}).")


def main():
    v = version()
    if "--skip-tests" not in sys.argv:
        run([sys.executable, "-m", "pytest", "-q", "tests"])
    pyinstaller(v)

    if sys.platform == "win32":
        folder = os.path.join(DIST, NAME)
        selftest(os.path.join(folder, NAME + ".exe"))
        archive = os.path.join(DIST, f"MechanicsDSL-Studio-{v}-windows")
        shutil.make_archive(archive, "zip", DIST, NAME)
        print("Built", archive + ".zip")
    elif sys.platform == "darwin":
        app = os.path.join(DIST, NAME + ".app")
        mac_bundle_metadata(app, v)
        selftest(os.path.join(app, "Contents", "MacOS", NAME))
        arch = "apple-silicon" if platform.machine() == "arm64" else "intel"
        dmg = os.path.join(DIST, f"MechanicsDSL-Studio-{v}-macos-{arch}.dmg")
        stage = os.path.join(ROOT, "build", "dmg")
        shutil.rmtree(stage, ignore_errors=True)
        os.makedirs(stage)
        run(["ditto", app, os.path.join(stage, NAME + ".app")])
        os.symlink("/Applications", os.path.join(stage, "Applications"))
        if os.path.exists(dmg):
            os.remove(dmg)
        run(["hdiutil", "create", "-volname", NAME, "-srcfolder", stage, "-ov", "-format", "UDZO", dmg])
        print("Built", dmg)
    else:
        folder = os.path.join(DIST, NAME)
        selftest(os.path.join(folder, NAME))
        archive = os.path.join(DIST, f"MechanicsDSL-Studio-{v}-linux-{platform.machine()}")
        shutil.make_archive(archive, "gztar", DIST, NAME)
        print("Built", archive + ".tar.gz")


if __name__ == "__main__":
    main()
