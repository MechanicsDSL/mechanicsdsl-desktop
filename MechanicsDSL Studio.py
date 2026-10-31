"""Launcher for the Windows build (see build_exe.bat)."""
import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()     # the engine runs in a child process
    from mechanicsdsl_studio.app import main
    main()
