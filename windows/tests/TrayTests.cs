using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Sparkle.Backend.Windows
{
    internal static class TrayTests
    {
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [STAThread]
        private static void Main(string[] args)
        {
            string result = Path.Combine(args[0], "test-result.txt");
            try
            {
                Environment.SetEnvironmentVariable("SPARKLE_TEST_DIR", args[0]);
                Application.EnableVisualStyles();
                string logDirectory = Path.Combine(args[0], ".sparkle-backend", "logs");
                string logPath = Path.Combine(logDirectory, "sparkle.log");
                const string previousSession = "Previous tray session must not survive a new launch.";
                Directory.CreateDirectory(logDirectory);
                File.WriteAllText(logPath, previousSession);
                using (var activation = new EventWaitHandle(false, EventResetMode.AutoReset))
                using (var app = new TrayApplication(args[0], args[1], activation))
                {
                    Wait(delegate { app.LogWindow.RefreshLogs(); return app.LogWindow.LogText.Contains("stderr: ready"); }, "capturing stdout/stderr");
                    Check(!app.LogWindow.LogText.Contains(previousSession), "new tray launch displayed the previous session's logs");
                    string currentLog = ReadLiveLog(logPath);
                    Check(!currentLog.Contains(previousSession) && currentLog.Contains("stderr: ready"), "new tray launch did not replace the previous log file");
                    Check(app.LogWindow.LogText.Contains("Unicode \u65e5\u672c\u8a9e"), "UTF-8 output must survive redirection");
                    string configuration = File.ReadAllText(Path.Combine(args[0], "configuration.txt"));
                    Check(configuration.Contains("127.0.0.1:18991"), "root .env was not loaded");
                    foreach (string directory in new[] { "fixture output", "fixture profiles", "fixture cache" })
                        Check(configuration.Contains(Path.Combine(args[0], directory)), "relative paths were not resolved against repository root");
                    Check(configuration.Contains("\"local\":\"X:/test media\""), "quoted mapping JSON was damaged");
                    Check(!currentLog.Contains("fixture-secret-not-for-logs") && !currentLog.Contains("X:/test media"), "launcher leaked private configuration");
                    Check(!app.LogWindow.Visible, "startup must be tray-only");
                    Wait(delegate { return File.Exists(Path.Combine(args[0], "child-console.txt")); }, "child startup");
                    Check(File.ReadAllText(Path.Combine(args[0], "backend-console.txt")) == "0", "backend unexpectedly has a console");
                    Check(File.ReadAllText(Path.Combine(args[0], "child-console.txt")) == "0", "child unexpectedly has a console");
                    int launcher = app.BackendProcessId;
                    app.ShowLogs();
                    Check(app.LogWindow.Visible, "logs did not open");
                    Check(IsWindowVisible(app.LogWindow.Handle), "logs were hidden by the process startup window style");
                    app.LogWindow.Close();
                    Check(!app.LogWindow.Visible && !app.LogWindow.IsDisposed, "closing logs must hide the window");
                    Check(app.IsRunning && app.BackendProcessId == launcher, "closing logs stopped or restarted backend");
                    activation.Set();
                    Wait(delegate { return app.LogWindow.Visible; }, "second-launch activation");
                    Check(app.LogWindow.LogText.Contains("stderr: ready") && ReadLiveLog(logPath).Contains("stderr: ready"), "reopening the current tray session cleared its logs");
                    int child = Int32.Parse(File.ReadAllText(Path.Combine(args[0], "child-pid.txt")));
                    app.StopBackend(false, false);
                    Wait(delegate { return app.BackendProcessId == 0; }, "graceful stop");
                    Check(File.Exists(Path.Combine(args[0], "graceful-stop.txt")), "graceful shutdown signal was not received");
                    Wait(delegate { return Gone(child); }, "encoder child cleanup");
                    Check(!app.IsQuitting && app.LogWindow.Visible, "Stop must leave the tray/log window alive");
                    app.StartBackend();
                    Wait(delegate { return app.IsRunning && app.BackendProcessId != launcher; }, "start after stop");
                    launcher = app.BackendProcessId;
                    app.StopBackend(true, false);
                    Wait(delegate { return app.IsRunning && app.BackendProcessId != launcher; }, "restart");
                    app.StopBackend(false, true);
                    Wait(delegate { return app.BackendProcessId == 0; }, "quit");
                    Check(app.IsQuitting, "Quit did not end application lifetime");
                }
                using (var failed = new TrayApplication(args[0], Path.Combine(args[0], "missing.exe"), null))
                {
                    Check(!failed.IsRunning && failed.LogWindow.Visible, "startup errors must open the log window");
                    Check(failed.LogWindow.LogText.Contains("Unable to start"), "startup error details missing from logs");
                    Check(!failed.LogWindow.LogText.Contains("stderr: ready") && !ReadLiveLog(logPath).Contains("stderr: ready"), "a subsequent tray session kept earlier backend logs");
                    failed.LogWindow.Close();
                    Check(!failed.IsQuitting, "closing failed-start logs must preserve the tray");
                    failed.StopBackend(false, true);
                }
                using (var buffer = new LogBuffer(Path.Combine(args[0], "bounded-logs")))
                {
                    for (int i = 0; i < 3000; i++) buffer.Write("test", new String('x', 200));
                    long cursor = 0;
                    bool reset;
                    Check(buffer.Read(ref cursor, out reset).Length <= LogBuffer.MaxCharacters && reset, "log display memory must be bounded");
                    Check(buffer.Read(ref cursor, out reset) == "", "unchanged logs should not be re-rendered");
                    for (int i = 0; i < 100; i++) buffer.Write("test", new String('x', 100000));
                    Check(new FileInfo(Path.Combine(args[0], "bounded-logs", "sparkle.log")).Length <= LogBuffer.MaxFileBytes, "disk log must be bounded");
                }
                using (var quit = new EventWaitHandle(false, EventResetMode.AutoReset))
                using (var app = new TrayApplication(args[0], args[1], null, quit))
                {
                    Wait(delegate { app.LogWindow.RefreshLogs(); return app.LogWindow.LogText.Contains("stderr: ready"); }, "quit-event startup");
                    quit.Set();
                    Wait(delegate { return app.IsQuitting && app.BackendProcessId == 0; }, "external quit event");
                }
                Check(Program.InstanceName(args[0]) == Program.InstanceName(args[0].ToUpperInvariant() + "\\"), "instance identity must ignore case/trailing separators");
                Check(Program.InstanceName(args[0]) != Program.InstanceName(args[0] + "-other"), "different checkouts must have separate instance identities");
                File.WriteAllText(result, "PASS: hidden startup and children; fresh session logs; UTF-8 live logs; close/reopen; activation; stop/start/restart/quit; graceful shutdown; process-tree cleanup; bounded logs.");
            }
            catch (Exception error) { File.WriteAllText(result, "FAIL: " + error); Environment.ExitCode = 1; }
        }
        private static string ReadLiveLog(string path)
        {
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var reader = new StreamReader(input)) return reader.ReadToEnd();
        }
        private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static bool Gone(int pid) { try { using (var process = Process.GetProcessById(pid)) return process.HasExited; } catch (ArgumentException) { return true; } }
        private static void Wait(Func<bool> condition, string label)
        {
            var timeout = Stopwatch.StartNew();
            while (timeout.ElapsedMilliseconds < 20000)
            {
                Application.DoEvents();
                if (condition()) return;
                Thread.Sleep(20);
            }
            throw new Exception("Timed out: " + label);
        }
    }
}
