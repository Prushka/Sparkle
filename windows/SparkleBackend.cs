using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Sparkle Backend")]
[assembly: System.Reflection.AssemblyProduct("Sparkle Backend")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace Sparkle.Backend.Windows
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
                bool showLogs = false, quitOnly = false;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--repo-root" && i + 1 < args.Length) root = Path.GetFullPath(args[++i]);
                    else if (args[i] == "--logs") showLogs = true;
                    else if (args[i] == "--quit") quitOnly = true;
                    else throw new ArgumentException("Unknown argument: " + args[i]);
                }

                string instance = InstanceName(root);
                if (quitOnly)
                {
                    try { using (var quitEvent = EventWaitHandle.OpenExisting(instance + ".Quit")) quitEvent.Set(); }
                    catch (WaitHandleCannotBeOpenedException) { }
                    return;
                }
                bool newEvent, newMutex;
                using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, instance + ".Logs", out newEvent))
                using (var quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, instance + ".Quit"))
                using (var mutex = new Mutex(true, instance, out newMutex))
                {
                    if (!newMutex)
                    {
                        if (newEvent) MessageBox.Show("Sparkle Backend is already starting. Open it again in a moment.", "Sparkle Backend");
                        else showEvent.Set();
                        return;
                    }
                    try
                    {
                        string backend = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Sparkle.Api.exe");
                        using (var app = new TrayApplication(root, backend, showEvent, quitEvent))
                        {
                            if (showLogs) app.ShowLogs();
                            Application.Run(app);
                        }
                    }
                    finally { mutex.ReleaseMutex(); }
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Sparkle Backend could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        internal static string InstanceName(string root)
        {
            using (var hash = SHA256.Create())
                return "Local\\SparkleWatchPartyBackend." + BitConverter.ToString(hash.ComputeHash(
                    Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd('\\', '/').ToUpperInvariant()))).Replace("-", "");
        }
    }

    // ApplicationContext owns the lifetime; the logs Form is deliberately NOT
    // its MainForm. Closing that window must never end the tray message loop.
    internal sealed class TrayApplication : ApplicationContext
    {
        private readonly string root, backendPath;
        private readonly EventWaitHandle showEvent, quitEvent;
        private readonly LogBuffer logs;
        private readonly Icon icon;
        private readonly NotifyIcon tray;
        private readonly ContextMenuStrip menu;
        private readonly ToolStripMenuItem statusItem, startItem, stopItem, restartItem;
        private readonly System.Windows.Forms.Timer timer;
        private readonly Stopwatch stopWatch = new Stopwatch();
        private Process backend;
        private ProcessJob job;
        private EventWaitHandle startGate, shutdownEvent;
        private bool stopping, restartAfterStop, quitting, disposed;
        internal readonly LogsWindow LogWindow;

        internal TrayApplication(string repositoryRoot, string executable, EventWaitHandle activationEvent, EventWaitHandle quitActivation = null)
        {
            root = repositoryRoot;
            backendPath = executable;
            showEvent = activationEvent;
            quitEvent = quitActivation;
            if (!File.Exists(Path.Combine(root, "start-backend.ps1"))) throw new FileNotFoundException("Cannot find start-backend.ps1 in " + root);
            logs = new LogBuffer(Path.Combine(root, ".sparkle-backend", "logs"));
            icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? (Icon)SystemIcons.Application.Clone();
            LogWindow = new LogsWindow(logs, icon);
            menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("Starting") { Enabled = false };
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            startItem = new ToolStripMenuItem("Start Backend", null, delegate { StartBackend(); });
            stopItem = new ToolStripMenuItem("Stop Backend", null, delegate { StopBackend(false, false); });
            restartItem = new ToolStripMenuItem("Restart Backend", null, delegate { StopBackend(true, false); });
            menu.Items.AddRange(new ToolStripItem[] { startItem, stopItem, restartItem });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open Logs", null, delegate { ShowLogs(); });
            menu.Items.Add("Open Log Folder", null, delegate { LogWindow.OpenFolder(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit", null, delegate { StopBackend(false, true); });
            tray = new NotifyIcon { Icon = icon, Text = "Sparkle Backend", ContextMenuStrip = menu, Visible = true };
            tray.MouseDoubleClick += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowLogs(); };
            timer = new System.Windows.Forms.Timer { Interval = 250 };
            timer.Tick += delegate { Tick(); };
            timer.Start();
            SystemEvents.SessionEnding += OnSessionEnding;
            StartBackend();
        }

        internal bool IsRunning { get { return backend != null && !backend.HasExited; } }
        internal bool IsQuitting { get { return quitting; } }
        internal int BackendProcessId { get { return backend == null ? 0 : backend.Id; } }

        internal void ShowLogs()
        {
            LogWindow.RefreshLogs();
            if (!LogWindow.Visible) LogWindow.Show();
            if (LogWindow.WindowState == FormWindowState.Minimized) LogWindow.WindowState = FormWindowState.Normal;
            LogWindow.EnsureVisible();
            LogWindow.Activate();
            LogWindow.BringToFront();
        }

        internal void StartBackend()
        {
            if (backend != null || quitting) return;
            try
            {
                if (!File.Exists(backendPath)) throw new FileNotFoundException("Run build-windows-app.ps1 to build " + backendPath);
                string token = Guid.NewGuid().ToString("N");
                string gateName = "Local\\SparkleWatchParty.Start." + token;
                string stopName = "Local\\SparkleWatchParty.Stop." + token;
                startGate = new EventWaitHandle(false, EventResetMode.ManualReset, gateName);
                shutdownEvent = new EventWaitHandle(false, EventResetMode.ManualReset, stopName);
                job = new ProcessJob();
                var info = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                    Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(Path.Combine(root, "start-backend.ps1")) + " -BackendExecutable " + Quote(backendPath),
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };
                info.EnvironmentVariables["SPARKLE_START_EVENT"] = gateName;
                info.EnvironmentVariables["SPARKLE_SHUTDOWN_EVENT"] = stopName;
                backend = new Process { StartInfo = info };
                backend.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) logs.Write("out", e.Data); };
                backend.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) logs.Write("err", e.Data); };
                if (!backend.Start()) throw new InvalidOperationException("Windows did not start the backend launcher.");
                // start-backend.ps1 waits on the gate before starting the server.
                job.Assign(backend);
                backend.BeginOutputReadLine();
                backend.BeginErrorReadLine();
                startGate.Set();
                logs.Write("app", "Started backend launcher (PID " + backend.Id + ").");
            }
            catch (Exception error)
            {
                if (backend != null)
                {
                    try { if (!backend.HasExited) backend.Kill(); } catch (InvalidOperationException) { }
                }
                ReleaseBackend();
                logs.Write("app", "Unable to start: " + error.Message);
                ShowLogs();
            }
            UpdateStatus();
        }

        internal void StopBackend(bool restart, bool quit)
        {
            quitting |= quit;
            restartAfterStop = restart && !quitting;
            if (backend == null)
            {
                if (quitting) ExitThread();
                else if (restartAfterStop) StartBackend();
                return;
            }
            if (!stopping)
            {
                stopping = true;
                stopWatch.Restart();
                logs.Write("app", "Requesting backend shutdown...");
                shutdownEvent.Set();
            }
            UpdateStatus();
        }

        private void Tick()
        {
            if (quitEvent != null && quitEvent.WaitOne(0)) StopBackend(false, true);
            if (showEvent != null && showEvent.WaitOne(0)) ShowLogs();
            if (backend != null)
            {
                if (stopping && job != null && !backend.HasExited && stopWatch.ElapsedMilliseconds >= 12000)
                {
                    logs.Write("app", "Shutdown timed out; stopping the remaining backend processes.");
                    job.Dispose();
                    job = null;
                }
                if (backend.HasExited)
                {
                    int exitCode = backend.ExitCode;
                    bool expected = stopping;
                    ReleaseBackend();
                    logs.Write("app", "Backend " + (expected ? "stopped" : "exited") + " (exit code " + exitCode + ").");
                    stopping = false;
                    if (quitting) { ExitThread(); return; }
                    if (restartAfterStop) { restartAfterStop = false; StartBackend(); }
                    else if (!expected)
                    {
                        tray.ShowBalloonTip(4000, "Sparkle Backend stopped", "Open Logs for details. Use Start Backend to retry.", ToolTipIcon.Warning);
                    }
                }
            }
            UpdateStatus();
            if (LogWindow.Visible) LogWindow.RefreshLogs();
        }

        private void UpdateStatus()
        {
            string state = stopping ? "Stopping..." : IsRunning ? "Running" : "Stopped";
            statusItem.Text = "Status: " + state;
            tray.Text = "Sparkle Backend: " + state;
            startItem.Enabled = backend == null && !quitting;
            stopItem.Enabled = restartItem.Enabled = backend != null && !stopping;
            LogWindow.SetStatus(state);
        }

        private void ReleaseBackend()
        {
            // Close the job even if its root exited on its own: encoders may
            // otherwise outlive their server and keep redirected pipes open.
            if (job != null) { job.Dispose(); job = null; }
            if (backend != null)
            {
                try { if (backend.HasExited) backend.WaitForExit(); } catch (InvalidOperationException) { }
                backend.Dispose();
                backend = null;
            }
            if (startGate != null) { startGate.Dispose(); startGate = null; }
            if (shutdownEvent != null) { shutdownEvent.Dispose(); shutdownEvent = null; }
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            // The OS can end the session before the timer runs again. Job
            // ownership still guarantees that no backend survives the host.
            try { if (shutdownEvent != null) shutdownEvent.Set(); }
            catch (ObjectDisposedException) { }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                disposed = true;
                SystemEvents.SessionEnding -= OnSessionEnding;
                timer.Stop();
                timer.Dispose();
                ReleaseBackend();
                tray.Visible = false;
                tray.Dispose();
                menu.Dispose();
                LogWindow.Dispose();
                icon.Dispose();
                logs.Dispose();
            }
            base.Dispose(disposing);
        }

        private static string Quote(string value) { return "\"" + value + "\""; }
    }

    internal sealed class LogsWindow : Form
    {
        private readonly LogBuffer logs;
        private readonly RichTextBox text;
        private readonly Label status;
        private readonly CheckBox paused;
        private long sequence;

        internal LogsWindow(LogBuffer buffer, Icon icon)
        {
            logs = buffer;
            Text = "Sparkle Backend - Logs";
            Icon = icon;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1000, 640);
            MinimumSize = new Size(600, 360);
            Font = new Font("Segoe UI", 10);
            AutoScaleMode = AutoScaleMode.Dpi;
            var header = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(10), WrapContents = true };
            status = new Label { AutoSize = true, Margin = new Padding(3, 7, 24, 3) };
            paused = new CheckBox { Text = "Pause display", AutoSize = true, Margin = new Padding(3, 7, 16, 3) };
            var folder = new Button { Text = "Open log folder", AutoSize = true };
            folder.Click += delegate { OpenFolder(); };
            var copy = new Button { Text = "Copy logs", AutoSize = true };
            copy.Click += delegate
            {
                try { if (text.TextLength > 0) Clipboard.SetText(text.Text); }
                catch (ExternalException) { MessageBox.Show(this, "Clipboard is busy. Please try again.", "Sparkle Backend"); }
            };
            header.Controls.AddRange(new Control[] { status, paused, folder, copy });
            text = new RichTextBox
            {
                Dock = DockStyle.Fill, ReadOnly = true, WordWrap = false, DetectUrls = false,
                BackColor = Color.FromArgb(22, 24, 28), ForeColor = Color.Gainsboro,
                Font = new Font("Consolas", 10), BorderStyle = BorderStyle.None,
                AccessibleName = "Application logs"
            };
            var footer = new Label { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(10), Text = "Close hides this window. Use the tray menu to stop or quit. Restarting clears rooms and chat." };
            Controls.Add(text);
            Controls.Add(header);
            Controls.Add(footer);
        }

        internal string LogText { get { return text.Text; } }
        internal void EnsureVisible()
        {
            // A compatibility/background launcher can supply SW_HIDE in its
            // startup info. Windows applies that to the first ShowWindow call,
            // even when WinForms considers the Form visible already.
            ShowWindow(Handle, 5); // SW_SHOW
        }
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        internal void SetStatus(string value) { status.Text = "Backend: " + value; }
        internal void RefreshLogs()
        {
            if (paused.Checked) return;
            bool reset;
            string update = logs.Read(ref sequence, out reset);
            if (update.Length == 0) return;
            if (reset) text.Text = update;
            else text.AppendText(update);
            if (text.TextLength > LogBuffer.MaxCharacters) text.Text = text.Text.Substring(text.TextLength - LogBuffer.MaxCharacters);
            text.SelectionStart = text.TextLength;
            text.SelectionLength = 0;
            text.ScrollToCaret();
        }

        internal void OpenFolder()
        {
            try { Process.Start(new ProcessStartInfo { FileName = logs.DirectoryPath, UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(this, error.Message, "Cannot open logs"); }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }
    }

    internal sealed class LogBuffer : IDisposable
    {
        internal const int MaxCharacters = 250000;
        internal const int MaxFileBytes = 8 * 1024 * 1024;
        private readonly object sync = new object();
        private readonly Queue<KeyValuePair<long, string>> entries = new Queue<KeyValuePair<long, string>>();
        private readonly StreamWriter file;
        private int characters;
        private long sequence;
        private bool disposed;
        internal readonly string DirectoryPath;
        private static readonly Regex Ansi = new Regex("\x1b\\[[0-9;]*[a-zA-Z]", RegexOptions.Compiled);

        internal LogBuffer(string directory)
        {
            DirectoryPath = directory;
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, "sparkle.log");
            // A new tray session replaces the previous log on disk and in memory.
            file = new StreamWriter(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
            Write("app", "Sparkle Backend tray started.");
        }

        internal void Write(string source, string message)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [" + source + "] " + Ansi.Replace(message, "") + Environment.NewLine;
            lock (sync)
            {
                if (disposed) return;
                try
                {
                    // Bound long-running login sessions as well as the UI buffer.
                    if (file.BaseStream.Length + Encoding.UTF8.GetByteCount(line) > MaxFileBytes)
                    {
                        file.BaseStream.SetLength(0);
                        file.BaseStream.Position = 0;
                        file.WriteLine("[app] Log size limit reached; continuing current session.");
                    }
                    if (line.Length > MaxCharacters / 2) line = line.Substring(0, MaxCharacters / 2) + " [truncated]\r\n";
                    file.Write(line);
                }
                catch (IOException) { line = "[app] Could not write to the log file. " + line; }
                catch (UnauthorizedAccessException) { line = "[app] Log file access denied. " + line; }
                // Bound memory even when writing to disk fails.
                if (line.Length > MaxCharacters / 2) line = line.Substring(0, MaxCharacters / 2) + " [display truncated]\r\n";
                Add(line);
            }
        }

        private void Add(string line)
        {
            entries.Enqueue(new KeyValuePair<long, string>(++sequence, line));
            characters += line.Length;
            while (entries.Count > 2000 || characters > MaxCharacters) characters -= entries.Dequeue().Value.Length;
        }

        internal string Read(ref long lastSequence, out bool reset)
        {
            lock (sync)
            {
                reset = entries.Count > 0 && lastSequence < entries.Peek().Key - 1;
                if (lastSequence == sequence) return "";
                var result = new StringBuilder();
                foreach (var entry in entries) if (entry.Key > lastSequence) result.Append(entry.Value);
                lastSequence = sequence;
                return result.ToString();
            }
        }

        public void Dispose() { lock (sync) { disposed = true; file.Dispose(); } }
    }

    // Job membership is inherited by children. The last handle closing also
    // handles a tray crash or forced Windows session shutdown.
    internal sealed class ProcessJob : IDisposable
    {
        private IntPtr handle;
        internal ProcessJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var info = new ExtendedLimits();
            info.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(info);
            IntPtr pointer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, pointer, false);
                if (!SetInformationJobObject(handle, 9, pointer, (uint)size)) throw new Win32Exception();
            }
            catch { Dispose(); throw; }
            finally { Marshal.FreeHGlobal(pointer); }
        }
        internal void Assign(Process process) { if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception(); }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }

        [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
        {
            public BasicLimits BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    }
}
