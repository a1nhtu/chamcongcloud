using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace TimMay
{
    // Tiện ích IPv4 dạng số nguyên (big-endian: 192.168.1.1 = 0xC0A80101)
    static class Ip
    {
        public static uint Parse(string s)
        {
            var b = IPAddress.Parse(s.Trim()).GetAddressBytes();
            if (b.Length != 4) throw new FormatException("Không phải IPv4: " + s);
            return (uint)(b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]);
        }

        public static bool TryParse(string s, out uint v)
        {
            v = 0;
            IPAddress a;
            if (s == null || !IPAddress.TryParse(s.Trim(), out a) || a.AddressFamily != AddressFamily.InterNetwork) return false;
            if (s.Trim().Split('.').Length != 4) return false;
            v = Parse(s);
            return true;
        }

        public static string Str(uint v) { return (v >> 24) + "." + ((v >> 16) & 255) + "." + ((v >> 8) & 255) + "." + (v & 255); }
        public static byte[] Bytes(uint v) { return new[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v }; }
        public static uint FromBytes(byte[] b, int o) { return (uint)(b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]); }
        public static uint MaskOf(int prefix) { return prefix == 0 ? 0 : 0xFFFFFFFFu << (32 - prefix); }

        public static int PrefixOf(uint mask)
        {
            int n = 0;
            while ((mask & 0x80000000u) != 0) { n++; mask <<= 1; }
            return n;
        }

        public static string Mac(byte[] m)
        {
            return string.Join(":", m.Select(x => x.ToString("X2")));
        }

        // Các dải hay gặp: máy ZK mặc định 192.168.1.201; .201 ở mọi 192.168.x; rồi các /24 phổ biến của modem
        public static List<uint> QuickList()
        {
            var list = new List<uint>();
            var seen = new HashSet<uint>();
            Action<uint> add = v => { if (seen.Add(v)) list.Add(v); };
            add(Parse("192.168.1.201"));
            for (uint x = 0; x < 256; x++) add(0xC0A80000u | (x << 8) | 201);
            string[] nets = {
                "192.168.1", "192.168.0", "192.168.2", "192.168.3", "192.168.4", "192.168.5", "192.168.8", "192.168.10",
                "192.168.11", "192.168.20", "192.168.30", "192.168.31", "192.168.50", "192.168.88", "192.168.100",
                "192.168.101", "192.168.123", "192.168.168", "192.168.178", "192.168.200", "192.168.254",
                "10.0.0", "10.0.1", "10.1.1", "10.10.10", "10.10.1", "10.0.10", "10.10.0", "172.16.0", "172.16.1",
                "172.16.10", "172.20.10"
            };
            foreach (var n in nets)
            {
                uint b = Parse(n + ".0");
                for (uint h = 1; h < 255; h++) add(b | h);
            }
            return list;
        }

        public static List<uint> Full192()
        {
            var list = QuickList();
            var seen = new HashSet<uint>(list);
            for (uint x = 0; x < 256; x++)
                for (uint h = 1; h < 255; h++)
                {
                    uint v = 0xC0A80000u | (x << 8) | h;
                    if (seen.Add(v)) list.Add(v);
                }
            return list;
        }

        // "10.10.0.0/16, 172.16.5.0/24, 192.168.9.1-192.168.9.50, 192.168.7.1-100, 10.0.0.5"
        public static List<uint> ParseRanges(string text)
        {
            var list = new List<uint>();
            var seen = new HashSet<uint>();
            foreach (var raw in text.Split(new[] { ',', ';', ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string t = raw.Trim();
                if (t.Contains("/"))
                {
                    var p = t.Split('/');
                    int prefix = int.Parse(p[1]);
                    if (prefix < 14 || prefix > 32) throw new FormatException("Dải " + t + " quá rộng (tối thiểu /14)");
                    uint mask = MaskOf(prefix), net = Parse(p[0]) & mask, last = net | ~mask;
                    for (uint v = net; ; v++)
                    {
                        if (prefix >= 31 || ((v & 255) != 0 && (v & 255) != 255)) { if (seen.Add(v)) list.Add(v); }
                        if (v == last) break;
                    }
                }
                else if (t.Contains("-"))
                {
                    var p = t.Split('-');
                    uint a = Parse(p[0]);
                    uint b = p[1].Contains(".") ? Parse(p[1]) : (a & 0xFFFFFF00u) | uint.Parse(p[1]);
                    if (b < a || b - a > 262144) throw new FormatException("Khoảng " + t + " không hợp lệ");
                    for (uint v = a; ; v++) { if (seen.Add(v)) list.Add(v); if (v == b) break; }
                }
                else
                {
                    uint v = Parse(t);
                    if (seen.Add(v)) list.Add(v);
                }
            }
            return list;
        }
    }

    class Adapter
    {
        public string Id, Name, Desc;
        public int Index;
        public byte[] Mac;
        public uint Ip, Mask, Gw;
        public bool Dhcp;

        public bool SameNet(uint ip) { return Mask != 0 && (ip & Mask) == (Ip & Mask); }

        public override string ToString()
        {
            return Name + " — " + TimMay.Ip.Str(Ip) + "/" + TimMay.Ip.PrefixOf(Mask) +
                   (Gw != 0 ? "  (modem " + TimMay.Ip.Str(Gw) + ")" : "") + "  " + Desc;
        }

        public static List<Adapter> ListAll()
        {
            var res = new List<Adapter>();
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                var props = ni.GetIPProperties();
                IPv4InterfaceProperties v4;
                try { v4 = props.GetIPv4Properties(); } catch { continue; }
                if (v4 == null) continue;
                var mac = ni.GetPhysicalAddress().GetAddressBytes();
                if (mac.Length != 6) continue;
                var ua = props.UnicastAddresses.FirstOrDefault(u => u.Address.AddressFamily == AddressFamily.InterNetwork &&
                                                                   !u.Address.ToString().StartsWith("169.254."));
                if (ua == null) continue;
                var gw = props.GatewayAddresses.FirstOrDefault(g => g.Address.AddressFamily == AddressFamily.InterNetwork &&
                                                                   g.Address.ToString() != "0.0.0.0");
                res.Add(new Adapter
                {
                    Id = ni.Id, Name = ni.Name, Desc = ni.Description, Index = v4.Index, Mac = mac,
                    Ip = TimMay.Ip.Parse(ua.Address.ToString()),
                    Mask = ua.IPv4Mask != null ? TimMay.Ip.Parse(ua.IPv4Mask.ToString()) : 0xFFFFFF00u,
                    Gw = gw != null ? TimMay.Ip.Parse(gw.Address.ToString()) : 0,
                    Dhcp = v4.IsDhcpEnabled
                });
            }
            return res.OrderBy(a => a.Gw == 0).ThenBy(a => a.Name.StartsWith("vEthernet")).ToList();
        }
    }

    // Lệnh mạng Windows (netsh) + ghi lại những gì đã gắn tạm để gỡ sạch kể cả khi tool bị tắt ngang
    static class NetCfg
    {
        public static bool IsAdmin()
        {
            using (var id = System.Security.Principal.WindowsIdentity.GetCurrent())
                return new System.Security.Principal.WindowsPrincipal(id).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }

        public static int Run(string exe, string args, out string output)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage),
                StandardErrorEncoding = Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage)
            };
            using (var p = Process.Start(psi))
            {
                string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit(30000);
                output = o.Trim();
                return p.ExitCode;
            }
        }

        static bool Netsh(string args, Action<string> log)
        {
            string o;
            int rc = Run("netsh.exe", args, out o);
            if (rc != 0 && log != null) log("  netsh " + args + " → " + (o == "" ? "lỗi " + rc : o));
            return rc == 0;
        }

        static bool Ps(string script, Action<string> log)
        {
            string o;
            int rc = Run("powershell.exe", "-NoProfile -NonInteractive -Command \"" + script.Replace("\"", "\\\"") + "\"", out o);
            if (rc != 0 && log != null) log("  powershell → " + o);
            return rc == 0;
        }

        // Gắn thêm 1 IP phụ TẠM (store=active). QUAN TRỌNG: trên card đang DHCP, phải bật
        // dhcpstaticipcoexistence TRƯỚC khi add — nếu không, netsh add address sẽ ép card sang
        // chế độ IP tĩnh và làm MẤT IP DHCP (mất mạng). Khi gỡ, card DHCP được ép về lại DHCP
        // để không bao giờ trơ lại trạng thái "tĩnh rỗng".
        public static bool AddAlias(Adapter a, uint ip, uint mask, Action<string> log)
        {
            if (a.Dhcp)
            {
                // Ghi mốc khôi phục DHCP TRƯỚC khi đụng gì — nếu tool chết giữa chừng vẫn dọn được
                State.Add("restoredhcp|" + a.Index);
                Netsh("interface ipv4 set interface interface=" + a.Index + " dhcpstaticipcoexistence=enabled", log);
            }
            State.Add("alias|" + a.Index + "|" + Ip.Str(ip));
            string add = "interface ipv4 add address name=" + a.Index + " address=" + Ip.Str(ip) + " mask=" + Ip.Str(mask) + " store=active";
            if (Netsh(add, log)) return true;
            if (Ps("New-NetIPAddress -InterfaceIndex " + a.Index + " -IPAddress " + Ip.Str(ip) + " -PrefixLength " + Ip.PrefixOf(mask) +
                   " -PolicyStore ActiveStore -SkipAsSource $true -ErrorAction Stop | Out-Null", log)) return true;
            State.Remove("alias|" + a.Index + "|" + Ip.Str(ip));
            if (a.Dhcp) RestoreDhcp(a.Index, log);
            return false;
        }

        // Gỡ IP phụ. dhcp=true: card vốn DHCP → tắt chế độ song song TRƯỚC rồi xoá IP phụ
        // (IP DHCP gốc vẫn còn nhờ coexistence nên không cần renew, không gián đoạn mạng).
        // dhcp=false (card vốn tĩnh): chỉ xoá đúng IP phụ, giữ nguyên IP tĩnh gốc.
        public static void RemoveAlias(int index, string ip, bool dhcp, Action<string> log)
        {
            if (dhcp) Netsh("interface ipv4 set interface interface=" + index + " dhcpstaticipcoexistence=disabled", null);
            if (!Netsh("interface ipv4 delete address name=" + index + " address=" + ip + " store=active", null))
                Ps("Remove-NetIPAddress -InterfaceIndex " + index + " -IPAddress " + ip + " -Confirm:$false -ErrorAction SilentlyContinue", null);
            if (dhcp) State.Remove("restoredhcp|" + index);
            State.Remove("alias|" + index + "|" + ip);
            if (log != null) log("Đã gỡ IP phụ " + ip);
        }

        // Sledgehammer: ép card về DHCP sạch — CHỈ dùng cho dọn-sót sau khi tool chết ngang
        // (có thể gây renew ngắn). Thứ tự: tắt coexistence trước rồi mới set source=dhcp mới ăn.
        public static void RestoreDhcp(int index, Action<string> log)
        {
            Netsh("interface ipv4 set interface interface=" + index + " dhcpstaticipcoexistence=disabled", null);
            Netsh("interface ipv4 set address name=" + index + " source=dhcp", null);
            Netsh("interface ipv4 set dnsservers name=" + index + " source=dhcp", null);
            State.Remove("restoredhcp|" + index);
            if (log != null) log("Đã trả card mạng về DHCP.");
        }

        public static bool AddOnLinkRoute(int index, string prefix, Action<string> log)
        {
            State.Add("route|" + index + "|" + prefix);
            if (Netsh("interface ipv4 add route prefix=" + prefix + " interface=" + index + " nexthop=0.0.0.0 metric=1 store=active", log)) return true;
            State.Remove("route|" + index + "|" + prefix);
            return false;
        }

        public static void DeleteRoute(int index, string prefix)
        {
            Netsh("interface ipv4 delete route prefix=" + prefix + " interface=" + index + " nexthop=0.0.0.0 store=active", null);
            State.Remove("route|" + index + "|" + prefix);
        }

        // Trạng thái IP phụ: Preferred = dùng được, Duplicate = trùng IP với máy khác, null = chưa có
        public static DuplicateAddressDetectionState? AddressState(Adapter a, uint ip)
        {
            var ni = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n => n.Id == a.Id);
            if (ni == null) return null;
            string s = Ip.Str(ip);
            var ua = ni.GetIPProperties().UnicastAddresses.FirstOrDefault(u => u.Address.ToString() == s);
            if (ua == null) return null;
            return ua.DuplicateAddressDetectionState;
        }
    }

    static class State
    {
        static readonly object L = new object();
        static string FilePath
        {
            get
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Digiplus", "TimMayChamCong");
                Directory.CreateDirectory(d);
                return Path.Combine(d, "dang-gan-tam.txt");
            }
        }

        static List<string> Read() { try { return File.ReadAllLines(FilePath).Where(x => x.Trim() != "").ToList(); } catch { return new List<string>(); } }
        static void Write(List<string> l) { try { File.WriteAllLines(FilePath, l); } catch { } }

        public static void Add(string line) { lock (L) { var l = Read(); if (!l.Contains(line)) { l.Add(line); Write(l); } } }
        public static void Remove(string line) { lock (L) { var l = Read(); if (l.Remove(line)) Write(l); } }

        // Gỡ những IP phụ / tuyến tạm còn sót lại từ lần chạy trước (tool bị tắt ngang)
        public static void CleanupLeftovers(Action<string> log)
        {
            List<string> l;
            lock (L) l = Read();
            // Các card DHCP cần ép về DHCP trước (xử lý luôn IP phụ tĩnh còn sót trên card đó)
            var dhcpIdx = new HashSet<int>();
            foreach (var line in l.Where(x => x.StartsWith("restoredhcp|")))
            {
                var p = line.Split('|');
                try { int i = int.Parse(p[1]); dhcpIdx.Add(i); NetCfg.RestoreDhcp(i, log); } catch { }
                Remove(line);
            }
            foreach (var line in l)
            {
                var p = line.Split('|');
                try
                {
                    if (p[0] == "alias") { int i = int.Parse(p[1]); if (!dhcpIdx.Contains(i)) NetCfg.RemoveAlias(i, p[2], false, log); }
                    else if (p[0] == "route") NetCfg.DeleteRoute(int.Parse(p[1]), p[2]);
                    else if (p[0] == "coexist") NetCfg.RestoreDhcp(int.Parse(p[1]), null);
                }
                catch { }
                Remove(line);
            }
        }
    }

    // Bảo đảm với tới được 1 IP khác dải: gắn tạm 1 IP phụ cùng dải máy vào card mạng, tự gỡ khi Dispose.
    // Cùng dải sẵn thì không làm gì.
    class Reach : IDisposable
    {
        readonly Adapter ad;
        readonly Action<string> log;
        uint alias;
        bool on;

        public Reach(Adapter a, uint targetIp, Action<string> log)
        {
            ad = a; this.log = log;
            if (a.SameNet(targetIp)) return;
            if (!NetCfg.IsAdmin()) throw new Exception("Cần chạy bằng quyền Administrator để với tới máy khác dải mạng.");
            uint net = targetIp & 0xFFFFFF00u;   // giả định /24 cho dải máy
            foreach (uint host in new uint[] { 250, 251, 249, 248, 199, 99, 88, 77, 252, 123 })
            {
                uint c = net | host;
                if (c == targetIp) continue;
                Log("Gắn IP phụ tạm " + Ip.Str(c) + " để nói chuyện với máy...");
                if (!NetCfg.AddAlias(a, c, 0xFFFFFF00u, log)) continue;
                alias = c; on = true;
                for (int i = 0; i < 20; i++)
                {
                    var st = NetCfg.AddressState(a, c);
                    if (st == DuplicateAddressDetectionState.Preferred) { Log("IP phụ sẵn sàng."); return; }
                    if (st == DuplicateAddressDetectionState.Duplicate) break;
                    Thread.Sleep(150);
                }
                if (NetCfg.AddressState(a, c) == DuplicateAddressDetectionState.Duplicate)
                { Log("IP phụ " + Ip.Str(c) + " trùng máy khác, thử địa chỉ khác..."); NetCfg.RemoveAlias(a.Index, Ip.Str(c), a.Dhcp, null); on = false; continue; }
                return;   // chưa kịp xác nhận vẫn thử tiếp
            }
            if (!on) throw new Exception("Không gắn được IP phụ cùng dải máy.");
        }

        void Log(string s) { if (log != null) log(s); }
        public void Dispose() { if (on) { try { NetCfg.RemoveAlias(ad.Index, Ip.Str(alias), ad.Dhcp, log); } catch { } on = false; } }
    }

    static class TcpProbe
    {
        public static bool Open(uint ip, int port, int timeoutMs)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(new IPAddress(Ip.Bytes(ip)), port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch { return false; }
        }
    }
}
