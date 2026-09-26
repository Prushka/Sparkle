using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Sparkle.Backend.Windows
{
    internal static class TrayTests
    {
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] private static extern bool IsProcessDPIAware();
        [STAThread]
        private static void Main(string[] args)
        {
            string result = Path.Combine(args[0], "test-result.txt");
            try
            {
                Environment.SetEnvironmentVariable("SPARKLE_TEST_DIR", args[0]);
                Program.SetProcessDPIAware();
                Application.EnableVisualStyles();
                Check(IsProcessDPIAware(), "tray process is not DPI aware");
                // Framework's Icon loader clamps 256 px requests to 128 px.
                // Check the Explorer frame in the ICO directory separately.
                using (var stream = typeof(TrayApplication).Assembly.GetManifestResourceStream("SparkleBackend.Icon"))
                using (var reader = new BinaryReader(stream))
                {
                    Check(reader.ReadUInt16() == 0 && reader.ReadUInt16() == 1 && reader.ReadUInt16() == 9, "invalid embedded icon directory");
                    foreach (int size in new[] { 16, 20, 24, 32, 40, 48, 64, 128, 256 })
                    {
                        Check(reader.ReadByte() == (size % 256) && reader.ReadByte() == (size % 256), "missing embedded icon frame at " + size + " px");
                        reader.ReadBytes(14);
                    }
                }
                foreach (int size in new[] { 16, 20, 24, 32, 40, 48, 64, 128 })
                    using (var icon = TrayApplication.LoadIcon(new Size(size, size)))
                        Check(icon.Width == size && icon.Height == size, "missing icon frame at " + size + " px");
                string logDirectory = Path.Combine(args[0], ".sparkle-backend", "logs");
                string logPath = Path.Combine(logDirectory, "sparkle.log");
                const string previousSession = "Previous tray session belongs in an archive.";
                Directory.CreateDirectory(logDirectory);
                File.WriteAllText(logPath, previousSession);
                var recoveredAt = new DateTime(2001, 2, 3, 4, 5, 6, DateTimeKind.Utc);
                File.SetLastWriteTimeUtc(logPath, recoveredAt);
                DateTime sessionStartedAt = DateTime.UtcNow;
                using (var activation = new EventWaitHandle(false, EventResetMode.AutoReset))
                using (var app = new TrayApplication(args[0], args[1], activation))
                {
                    Wait(delegate { app.LogWindow.RefreshLogs(); return app.LogWindow.LogText.Contains("stderr: ready"); }, "capturing stdout/stderr");
                    Check(!app.LogWindow.LogText.Contains(previousSession), "new tray launch displayed the previous session's logs");
                    string currentLog = ReadLiveLog(logPath);
                    Check(!currentLog.Contains(previousSession) && currentLog.Contains("stderr: ready"), "new tray launch did not replace the previous log file");
                    Check(ReadLiveLog(ArchivePath(logDirectory, recoveredAt, "-recovered")).Contains(previousSession), "unclean session was not recovered before opening the current log");
                    Check(app.LogWindow.LogText.Contains("Unicode \u65e5\u672c\u8a9e"), "UTF-8 output must survive redirection");
                    string configuration = File.ReadAllText(Path.Combine(args[0], "configuration.txt"));
                    Check(configuration.Contains("127.0.0.1:18991"), "root .env was not loaded");
                    foreach (string directory in new[] { "fixture output", "fixture profiles", "fixture cache", "fixture sessions" })
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
                    using (var graphics = app.LogWindow.CreateGraphics())
                        Check(app.LogWindow.Width >= 980 * graphics.DpiX / 96, "log window did not scale from its 96 DPI layout");
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
                    Check(Directory.GetFiles(logDirectory, "sparkle-*.log").Length == 1, "backend restart or opening logs archived the active tray session");
                    app.StopBackend(false, true);
                    Wait(delegate { return app.BackendProcessId == 0; }, "quit");
                    Check(app.IsQuitting, "Quit did not end application lifetime");
                }
                string[] sessionArchives = Directory.GetFiles(logDirectory, "sparkle-*.log");
                Check(sessionArchives.Length == 2, "tray exit did not archive its session exactly once");
                foreach (string archive in sessionArchives)
                {
                    if (archive.EndsWith("-recovered.log", StringComparison.Ordinal)) continue;
                    string name = Path.GetFileNameWithoutExtension(archive).Substring("sparkle-".Length);
                    DateTime exitedAt = DateTime.ParseExact(name, LogBuffer.ArchiveTimeFormat, CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
                    Check(exitedAt >= sessionStartedAt && exitedAt <= DateTime.UtcNow, "archive filename does not record the tray exit time");
                    string content = ReadLiveLog(archive);
                    Check(content.Contains("tray exited at " + exitedAt.ToString("O", CultureInfo.InvariantCulture)), "archive omitted its exit timestamp");
                    Check(Count(content, "graceful shutdown complete") == 3 && Count(content, "final stderr cleanup") == 3,
                        "archive lost final backend stdout/stderr across stop, restart, or quit");
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
                    Check(new FileInfo(Path.Combine(args[0], "bounded-logs", "sparkle.log")).Length > 10000000, "disk log was truncated at the old size limit");
                }
                CheckLogRetention(args[0]);
                using (var quit = new EventWaitHandle(false, EventResetMode.AutoReset))
                using (var app = new TrayApplication(args[0], args[1], null, quit))
                {
                    Wait(delegate { app.LogWindow.RefreshLogs(); return app.LogWindow.LogText.Contains("stderr: ready"); }, "quit-event startup");
                    quit.Set();
                    Wait(delegate { return app.IsQuitting && app.BackendProcessId == 0; }, "external quit event");
                }
                Check(Program.InstanceName(args[0]) == Program.InstanceName(args[0].ToUpperInvariant() + "\\"), "instance identity must ignore case/trailing separators");
                Check(Program.InstanceName(args[0]) != Program.InstanceName(args[0] + "-other"), "different checkouts must have separate instance identities");
                File.WriteAllText(result, "PASS: DPI awareness and scaled layout; icon frames; five exit-timestamped archives; recovery, retention, collisions and locked-file safety; full disk logs and final stdout/stderr; hidden startup and children; UTF-8; close/reopen; activation; stop/start/restart/quit; graceful shutdown; process-tree cleanup; bounded display logs.");
            }
            catch (Exception error) { File.WriteAllText(result, "FAIL: " + error); Environment.ExitCode = 1; }
        }
        private static string ArchivePath(string directory, DateTime timestamp, string suffix)
        {
            return Path.Combine(directory, "sparkle-" + timestamp.ToString(LogBuffer.ArchiveTimeFormat, CultureInfo.InvariantCulture) + suffix + ".log");
        }
        private static void CheckLogRetention(string root)
        {
            string directory = Path.Combine(root, "retention");
            var exitedAt = new DateTime(2001, 2, 3, 4, 5, 6, DateTimeKind.Utc);
            using (var buffer = new LogBuffer(directory))
            {
                string unrelated = Path.Combine(directory, "sparkle-unrelated.log");
                string invalidDate = Path.Combine(directory, "sparkle-1999-99-99_00-00-00.0000000Z.log");
                File.WriteAllText(unrelated, "keep");
                File.WriteAllText(invalidDate, "keep");
                string nested = Path.Combine(directory, "nested");
                Directory.CreateDirectory(nested);
                File.WriteAllText(ArchivePath(nested, exitedAt.AddDays(-1), ""), "keep");
                for (int i = 0; i < 8; i++)
                {
                    buffer.Write("test", "session " + i);
                    buffer.EndSession(exitedAt.AddSeconds(i));
                    // Retention must use the filename's exit time, not file dates.
                    File.SetLastWriteTimeUtc(ArchivePath(directory, exitedAt.AddSeconds(i), ""), exitedAt.AddDays(-i));
                }
                Check(Directory.GetFiles(directory, "sparkle-2001-*.log").Length == 5, "retention did not keep exactly five archives");
                for (int i = 0; i < 8; i++)
                {
                    string path = ArchivePath(directory, exitedAt.AddSeconds(i), "");
                    if (i < 3) Check(!File.Exists(path), "oldest archive was retained");
                    else Check(ReadLiveLog(path).Contains("session " + i), "newest archive was lost");
                }
                Check(File.Exists(unrelated) && File.Exists(invalidDate) && Directory.GetFiles(nested).Length == 1,
                    "retention deleted unrelated or nested files");
                Check(ReadLiveLog(Path.Combine(directory, "sparkle.log")) == "", "archived content remained in the current log");
            }
            Check(Directory.GetFiles(directory, "sparkle-2001-*.log").Length == 5, "disposing an archived session added a duplicate archive");

            directory = Path.Combine(root, "collisions");
            using (var buffer = new LogBuffer(directory))
            {
                for (int i = 0; i < 8; i++)
                {
                    buffer.Write("test", "collision " + i);
                    buffer.EndSession(exitedAt);
                }
                Check(Directory.GetFiles(directory, "sparkle-*.log").Length == 5, "timestamp collision bypassed retention");
                for (int i = 0; i < 8; i++)
                {
                    string path = ArchivePath(directory, exitedAt, i == 0 ? "" : "-" + i.ToString("D4", CultureInfo.InvariantCulture));
                    if (i < 3) Check(!File.Exists(path), "timestamp collision kept an older log");
                    else Check(ReadLiveLog(path).Contains("collision " + i), "timestamp collision overwrote or discarded a newer log");
                }
            }

            directory = Path.Combine(root, "locked-log");
            var locked = new LogBuffer(directory);
            string current = Path.Combine(directory, "sparkle.log");
            locked.Write("test", "preserve despite blocked rename");
            using (var viewer = new FileStream(current, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                locked.Dispose();
                Check(ReadLiveLog(current).Contains("preserve despite blocked rename"), "failed exit rotation discarded the current log");
                using (var next = new LogBuffer(directory))
                {
                    Check(ReadLiveLog(current).Contains("preserve despite blocked rename"), "failed startup rotation truncated the previous log");
                    Check(ReadLiveLog(current).Contains("Could not archive or prune logs"), "blocked rotation was not reported");
                }
            }
            using (var next = new LogBuffer(directory))
            {
                string[] recovered = Directory.GetFiles(directory, "sparkle-*-recovered.log");
                Check(recovered.Length == 1 && ReadLiveLog(recovered[0]).Contains("preserve despite blocked rename"),
                    "previous log was not recovered after the viewer closed");
                Check(!ReadLiveLog(current).Contains("preserve despite blocked rename"), "recovery did not start a fresh current log");
                // The memory limit must never truncate the full disk log.
                next.Write("test", new String('x', LogBuffer.MaxCharacters * 2) + "disk log tail");
                Check(ReadLiveLog(current).Contains("disk log tail"), "display bounding truncated the disk log");
            }
        }
        private static int Count(string text, string term) { return (text.Length - text.Replace(term, "").Length) / term.Length; }
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
