// MoPhanMem.exe — mở trang quản lý vào TRÌNH DUYỆT KHÁCH ĐANG MỞ SẴN (Chrome / Cốc Cốc / Edge / Firefox…)
// thay vì trình duyệt mặc định của Windows. Dùng cho lối tắt Desktop + bước "Mở trang quản lý" cuối bộ cài.
//   MoPhanMem.exe <url>            mở
//   MoPhanMem.exe <url> --dry-run  chỉ in lựa chọn, không mở (để thử)
// Không có trình duyệt nào đang mở cửa sổ, hoặc trình duyệt mặc định đang mở → mở bằng trình duyệt mặc định (như cũ).
// Bộ cài tự biên dịch file này bằng csc.exe của .NET Framework 4 (có sẵn trong Windows) — xem DigiplusSetup.iss.
using System;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Win32;

static class MoPhanMem
{
    // thứ tự ưu tiên khi đang mở nhiều trình duyệt (không có trình duyệt mặc định trong số đó)
    static readonly string[] Known = { "chrome", "browser", "msedge", "firefox", "opera", "brave", "vivaldi" };

    static string PathOf(Process p)
    {
        try { return p.MainModule.FileName; } catch { return null; }
    }

    static string DefaultExe()
    {
        try
        {
            var id = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice", "ProgId", null) as string;
            if (string.IsNullOrEmpty(id)) return "";
            using (var k = Registry.ClassesRoot.OpenSubKey(id + @"\shell\open\command"))
            {
                var cmd = k == null ? null : k.GetValue(null) as string;
                if (cmd == null) return "";
                var m = Regex.Match(cmd, "^\\s*\"([^\"]+)\"");
                if (!m.Success) m = Regex.Match(cmd, @"^\s*(\S+\.exe)", RegexOptions.IgnoreCase);
                return m.Success ? m.Groups[1].Value : "";
            }
        }
        catch { return ""; }
    }

    static void OpenDefault(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    [STAThread]
    static int Main(string[] args)
    {
        var dry = args.Contains("--dry-run");
        var url = args.FirstOrDefault(a => !a.StartsWith("--"));
        if (string.IsNullOrEmpty(url)) url = "http://localhost:8686/admin";

        // chỉ tính trình duyệt CÓ CỬA SỔ (Edge hay chạy ngầm không cửa sổ → bỏ qua); browser.exe chỉ nhận Cốc Cốc / Yandex
        var open = Known
            .SelectMany(n => Process.GetProcessesByName(n))
            .Where(p => { try { return p.MainWindowHandle != IntPtr.Zero; } catch { return false; } })
            .Select(p => new { p.ProcessName, Path = PathOf(p) })
            .Where(x => x.Path != null && (!x.ProcessName.Equals("browser", StringComparison.OrdinalIgnoreCase)
                                           || Regex.IsMatch(x.Path, "CocCoc|Yandex", RegexOptions.IgnoreCase)))
            .ToList();
        var def = DefaultExe();
        var useDefault = open.Count == 0 || (def != "" && open.Any(x => string.Equals(x.Path, def, StringComparison.OrdinalIgnoreCase)));

        if (dry)
        {
            Console.WriteLine("mac dinh : " + def);
            Console.WriteLine("dang mo  : " + string.Join(" | ", open.Select(x => x.Path).Distinct()));
            Console.WriteLine("se mo bang: " + (useDefault ? "trinh duyet mac dinh" : open[0].Path));
            return 0;
        }
        try
        {
            if (useDefault) OpenDefault(url);
            else Process.Start(open[0].Path, "\"" + url + "\"");
        }
        catch
        {
            try { OpenDefault(url); } catch { return 1; }
        }
        return 0;
    }
}
