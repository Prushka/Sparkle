using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class FakeBackend
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
    private static void Main(string[] args)
    {
        string directory = Environment.GetEnvironmentVariable("SPARKLE_TEST_DIR");
        if (args.Length > 0 && args[0] == "--child")
        {
            File.WriteAllText(Path.Combine(directory, "child-console.txt"), GetConsoleWindow().ToInt64().ToString());
            Thread.Sleep(Timeout.Infinite);
            return;
        }
        Console.OutputEncoding = new UTF8Encoding(false);
        File.WriteAllText(Path.Combine(directory, "configuration.txt"), String.Join("\n", new[] {
            Environment.GetEnvironmentVariable("ADDR"), Environment.GetEnvironmentVariable("OUTPUT"),
            Environment.GetEnvironmentVariable("PFP_DIR"), Environment.GetEnvironmentVariable("MEDIA_CACHE_DIR"),
            Environment.GetEnvironmentVariable("PLEX_PATH_MAPPINGS")
        }));
        File.WriteAllText(Path.Combine(directory, "backend-console.txt"), GetConsoleWindow().ToInt64().ToString());
        File.WriteAllText(Path.Combine(directory, "backend-pid.txt"), Process.GetCurrentProcess().Id.ToString());
        var child = Process.Start(new ProcessStartInfo
        {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true
        });
        File.WriteAllText(Path.Combine(directory, "child-pid.txt"), child.Id.ToString());
        Console.WriteLine("stdout: ready - Unicode \u65e5\u672c\u8a9e");
        Console.Error.WriteLine("stderr: ready");
        using (var stop = EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("SPARKLE_SHUTDOWN_EVENT")))
        {
            int tick = 0;
            while (!stop.WaitOne(100)) Console.WriteLine("heartbeat " + ++tick);
        }
        File.WriteAllText(Path.Combine(directory, "graceful-stop.txt"), "yes");
        Console.WriteLine("graceful shutdown complete");
        Console.Error.WriteLine("final stderr cleanup");
        // Deliberately leave the child alive to test job-based cleanup.
    }
}
