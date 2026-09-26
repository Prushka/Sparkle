[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') {
    # Use the same built-in .NET Framework drawing runtime as the tray app.
    & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed.' }
    return
}
Add-Type -AssemblyName System.Drawing
# Keep the artwork as vector drawing instructions so every icon size is rendered
# independently. This uses only the Windows runtime, with no image build tools.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class SparkleBackendIconArtwork
{
    private static GraphicsPath Rounded(float x, float y, float w, float h, float r)
    {
        var path = new GraphicsPath();
        path.AddArc(x, y, r * 2, r * 2, 180, 90);
        path.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
        path.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
        path.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static void Fill(Graphics g, Color color, float x, float y, float w, float h, float r)
    {
        using (var path = Rounded(x, y, w, h, r))
        using (var brush = new SolidBrush(color)) g.FillPath(brush, path);
    }

    private static Bitmap Render(int size)
    {
        using (var large = new Bitmap(size * 4, size * 4, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(large))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.ScaleTransform(size * 4 / 256f, size * 4 / 256f);
            // Match the sibling apps' #f5c542 yellow. Two server drawers and
            // a four-point sparkle distinguish the backend at small tray sizes.
            Color yellow = Color.FromArgb(245, 197, 66);
            Color shade = Color.FromArgb(215, 166, 38);
            Color detail = Color.FromArgb(82, 61, 12);
            for (int row = 0; row < 2; row++)
            {
                float top = 66 + row * 88;
                using (var body = Rounded(22, top, 196, 72, 15))
                using (var fill = new LinearGradientBrush(new PointF(0, top), new PointF(0, top + 72), yellow, shade))
                using (var outline = new Pen(detail, 5))
                {
                    g.FillPath(fill, body);
                    g.DrawPath(outline, body);
                }
                using (var brush = new SolidBrush(detail)) g.FillEllipse(brush, 42, top + 25, 22, 22);
                Fill(g, detail, 82, top + 28, 76, 16, 7);
                if (size >= 32) Fill(g, Color.FromArgb(255, 228, 147), 174, top + 28, 20, 16, 5);
            }
            using (var sparkle = new GraphicsPath())
            using (var brush = new SolidBrush(yellow))
            using (var outline = new Pen(detail, 5) { LineJoin = LineJoin.Round })
            {
                sparkle.AddPolygon(new[] {
                    new PointF(196, 16), new PointF(208, 48), new PointF(240, 60),
                    new PointF(208, 72), new PointF(196, 104), new PointF(184, 72),
                    new PointF(152, 60), new PointF(184, 48)
                });
                g.FillPath(brush, sparkle);
                g.DrawPath(outline, sparkle);
            }
            var result = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var output = Graphics.FromImage(result))
            {
                output.CompositingMode = CompositingMode.SourceCopy;
                output.InterpolationMode = InterpolationMode.HighQualityBicubic;
                output.PixelOffsetMode = PixelOffsetMode.HighQuality;
                output.DrawImage(large, new Rectangle(0, 0, size, size), 0, 0, large.Width, large.Height, GraphicsUnit.Pixel);
            }
            return result;
        }
    }

    private static byte[] EncodeFrame(Bitmap bitmap)
    {
        int size = bitmap.Width, maskStride = ((size + 31) / 32) * 4;
        using (var stream = new MemoryStream())
        using (var writer = new BinaryWriter(stream))
        {
            // A 32-bit DIB plus transparency mask is supported by both the C#
            // compiler and WinForms, including the small notification-area sizes.
            writer.Write(40); writer.Write(size); writer.Write(size * 2);
            writer.Write((ushort)1); writer.Write((ushort)32); writer.Write(0);
            writer.Write(size * size * 4 + maskStride * size);
            writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(0);
            for (int y = size - 1; y >= 0; y--)
                for (int x = 0; x < size; x++)
                {
                    Color c = bitmap.GetPixel(x, y);
                    writer.Write(c.B); writer.Write(c.G); writer.Write(c.R); writer.Write(c.A);
                }
            for (int y = size - 1; y >= 0; y--)
            {
                var mask = new byte[maskStride];
                for (int x = 0; x < size; x++)
                    if (bitmap.GetPixel(x, y).A == 0) mask[x / 8] |= (byte)(128 >> (x % 8));
                writer.Write(mask);
            }
            return stream.ToArray();
        }
    }

    public static void Generate(string directory)
    {
        int[] sizes = { 16, 20, 24, 32, 40, 48, 64, 128, 256 };
        var frames = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
            using (var bitmap = Render(sizes[i]))
            {
                frames[i] = EncodeFrame(bitmap);
                if (sizes[i] == 256) bitmap.Save(Path.Combine(directory, "sparkle-backend.png"), ImageFormat.Png);
            }
        using (var writer = new BinaryWriter(File.Create(Path.Combine(directory, "sparkle-backend.ico"))))
        {
            writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)sizes.Length);
            int offset = 6 + sizes.Length * 16;
            for (int i = 0; i < sizes.Length; i++)
            {
                writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                writer.Write((byte)0); writer.Write((byte)0);
                writer.Write((ushort)1); writer.Write((ushort)32);
                writer.Write(frames[i].Length); writer.Write(offset);
                offset += frames[i].Length;
            }
            foreach (byte[] frame in frames) writer.Write(frame);
        }
    }
}
'@
[SparkleBackendIconArtwork]::Generate($PSScriptRoot)
Write-Host 'Generated sparkle-backend.ico (16-256 px) and sparkle-backend.png.'
