# Windows backend launcher

Sparkle Backend uses the same native Windows Forms tray pattern as Sparkle-Transcoder.
It runs the watch-party Go API without an empty PowerShell/console window, starts at
current-user sign-in, and provides a dedicated live log window. It does not start the
Next.js frontend. This is a per-user desktop application, not a Windows service.

## Install and use

Requirements: Windows with Windows PowerShell 5.1 and .NET Framework 4.x, plus Go 1.25+
on `PATH` for the initial build. The build uses Windows' existing Framework C# compiler;
neither Visual Studio nor a .NET SDK is required. The account must have access to the
configured media, profile and cache directories.

Preserve the repository's `.env`. Stop any manually launched copy of this backend
before starting the tray copy, then run from the repository root:

```powershell
.\install-backend-startup.ps1 -Start
```

The installer compiles `bin/windows/SparkleBackend.exe` and `Sparkle.Api.exe` before
creating two current-user shortcuts named **Sparkle Backend**:

- Startup launches directly into the tray at sign-in with no terminal or log window.
- Start Menu opens the log window. A second launch activates the existing instance.

No administrator access is needed. The shortcuts target the GUI executable directly;
they do not leave a console wrapper open. Sparkle-Transcoder's **Sparkle** shortcuts and
instance are separate. Windows may place the new tray icon in the overflow area.

Double-click the tray icon to open logs. Right-click it for backend status, Start,
Stop, Restart, Open Logs, Open Log Folder and Quit. Closing the log window hides it
while the backend continues running. Stop keeps the tray available; Quit shuts down
the backend and exits the tray app. A failed backend stays stopped until Start/Restart
is requested, with details in the log and a tray notification.

**Stopping/restarting loses in-memory rooms, chat and playback state.** Media files and
persisted profile/cache files remain governed by the existing backend configuration.

## Configuration, logs and updates

Each backend start uses `start-backend.ps1 -BackendExecutable ...`, which reads the
root `.env` (or inherited `ENV_FILE`). Relative `OUTPUT`, `PFP_DIR` and `MEDIA_CACHE_DIR`
paths resolve against the repository root, just as with a terminal launch. No
credentials or media mappings are written into shortcuts. Go is not needed at runtime.
Restart the backend after configuration changes. If media is on a mapped network
drive, it must be connected in this user's sign-in session before the backend starts;
otherwise use an accessible UNC mapping or retry Start after connecting the drive.

The window captures stdout/stderr with UTF-8, timestamps, a pause-display toggle,
Copy Logs and Open Log Folder. Logs live at `.sparkle-backend/logs/sparkle.log`.
Starting a fresh tray session replaces the previous file; hiding/reopening logs and
restarting the backend within that tray session preserve it. The file is capped at
8 MiB, then truncated with a continuation marker. The display retains at most 250,000
characters/2,000 entries, with oversized individual lines truncated. These generated
files and binaries are ignored by Git and excluded from the frontend Docker context.

To update after pulling changes, choose **Quit**, then rerun the installer. Builds
refuse to overwrite a running copy. If Go is not on `PATH`, supply `-GoExe <path>`.
The checkout must remain at its installed path; remove its shortcuts before moving it,
then reinstall from the new location. The installer refuses to overwrite shortcuts
owned by a different checkout or application.

Useful commands from the repository root:

```powershell
# Build without installing shortcuts.
.\build-windows-app.ps1

# Start manually, or activate logs in an existing instance.
.\launch-backend-tray.ps1 -ShowLogs

# Request graceful shutdown without opening a window.
.\launch-backend-tray.ps1 -Quit

# Remove current-user Startup and Start Menu shortcuts; does not stop a running app.
.\install-backend-startup.ps1 -Remove
```

`-NoStartup` and `-NoStartMenu` skip creating their respective shortcuts during
installation; they do not remove existing shortcuts. To opt out of login launch after
installation, remove both shortcuts, then reinstall with `-NoStartup`.

## Process ownership and validation

The WinForms application context owns the tray lifetime independently of the log
window. A checkout-specific mutex prevents duplicate instances; named events activate
logs and request exit. The hidden PowerShell launcher waits on a startup gate until
the tray assigns it to a Windows Job Object. The compiled Go API and encoder children
inherit that job. Closing the last job handle kills the whole owned process tree,
including when the tray crashes or Windows ends the session.

Stop/Restart/Quit first signal a private Windows shutdown event. The backend cancels
its existing context and runs ordinary HTTP, room and encoder shutdown. The tray allows
12 seconds before forced cleanup. No HTTP shutdown endpoint is added. Non-Windows
builds and terminal launches without this event retain their existing signal behavior.

Run these tests from the repository root on Windows:

```powershell
.\windows\test-tray.ps1
.\windows\test-launcher.ps1
go -C backend test ./...
go -C backend vet ./...
```

The first suite uses a fake backend/encoder to check absence of console windows,
root-relative configuration, UTF-8 live logs, bounded log storage, close/reopen,
activation, start/stop/restart/quit and process-tree cleanup. The second builds the real
API and GUI in a path containing spaces, serves an empty catalog on a temporary loopback
port, and checks single-instance activation, hidden login launch, graceful shutdown
and cleanup after killing the tray process. Both use disposable fixtures under
`cache/`, without real Plex credentials or media. Go lifecycle tests exercise the
native shutdown event; run race tests with CGO and a supported C compiler as well.

These checks simulate the installed executable's login invocation; they do not sign
out or reboot the user's machine. Installer verification should inspect the actual
shortcut targets and confirm the API process belongs to the tray's compiled backend.
