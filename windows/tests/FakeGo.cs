using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class FakeGo
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
    private static int Main(string[] args)
    {
        string root = Environment.GetEnvironmentVariable("SPARKLE_TEST_DIR");
        if (args.Length == 1 && args[0] == "--child")
        {
            File.WriteAllText(Path.Combine(root, "compiler-child-console.txt"), GetConsoleWindow().ToInt64().ToString());
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length != 5 || args[0] != "build" || args[1] != "-trimpath" || args[2] != "-o" || args[4] != "./cmd/api")
            throw new Exception("Unexpected Go build arguments.");
        if (Environment.CurrentDirectory != Path.Combine(root, "backend")) throw new Exception("Wrong build directory.");
        using (var child = Process.Start(new ProcessStartInfo
        {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = "--child", UseShellExecute = false, CreateNoWindow = true
        }))
        {
            File.WriteAllText(Path.Combine(root, "compiler-child-pid.txt"), child.Id.ToString());
            File.WriteAllText(Path.Combine(root, "compiler-console.txt"), GetConsoleWindow().ToInt64().ToString());
            File.WriteAllText(Path.Combine(root, "compiler-pid.txt"), Process.GetCurrentProcess().Id.ToString());
            Console.WriteLine("compiler ready - Unicode \u65e5\u672c\u8a9e");
            using (var gate = EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("SPARKLE_TEST_BUILD_EVENT")))
                if (!gate.WaitOne(20000)) throw new Exception("Test did not release compiler.");
            if (File.ReadAllText(Path.Combine(root, "build-mode.txt")) == "fail")
            {
                Console.Error.WriteLine("fixture compilation error");
                return 1;
            }
            File.Copy(Path.Combine(root, "NextBackend.exe"), args[3], true);
            Console.WriteLine("fixture compilation complete");
            // Leave a compiler child to verify build-job cleanup as well.
            return 0;
        }
    }
}
