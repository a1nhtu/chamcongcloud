using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace TimMay
{
    interface IScanner : IDisposable
    {
        string ModeName { get; }
        // ip, mac, cách phát hiện
        event Action<uint, byte[], string> Found;
        void Scan(IList<uint> targets, CancellationToken ct, Action<int, int> progress, Action<string> log);
    }

    static class Pcap
    {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string p);
        [DllImport("wpcap.dll", CharSet = CharSet.Ansi)] public static extern IntPtr pcap_open_live(string dev, int snaplen, int promisc, int to_ms, StringBuilder errbuf);
        [DllImport("wpcap.dll")] public static extern int pcap_sendpacket(IntPtr p, byte[] buf, int size);
        [DllImport("wpcap.dll")] public static extern int pcap_next_ex(IntPtr p, out IntPtr hdr, out IntPtr data);
        [DllImport("wpcap.dll")] public static extern void pcap_close(IntPtr p);
        [DllImport("wpcap.dll")] static extern IntPtr pcap_lib_version();
        [DllImport("wpcap.dll")] public static extern IntPtr pcap_geterr(IntPtr p);

        static bool? avail;
        public static string Version = "";

        // Npcap không đóng kèm (giấy phép) — có cài sẵn thì dùng, không thì chạy chế độ Windows
        public static bool Available
        {
            get
            {
                if (avail.HasValue) return avail.Value;
                try
                {
                    string dir = Path.Combine(Environment.SystemDirectory, "Npcap");
                    if (!File.Exists(Path.Combine(dir, "wpcap.dll"))) { avail = false; return false; }
                    SetDllDirectory(dir);
                    Version = Marshal.PtrToStringAnsi(pcap_lib_version());
                    avail = true;
                }
                catch { avail = false; }
                return avail.Value;
            }
        }
    }

    // Quét bằng Npcap: tự gửi gói ARP thô xuống dây, không đụng cấu hình mạng của PC.
    // Gửi 2 kiểu: ARP probe (IP gửi = 0.0.0.0, Linux trả lời bất kể khác dải) và ARP thường (IP gửi = IP PC).
    class PcapScanner : IScanner
    {
        readonly Adapter ad;
        IntPtr cap, snd;
        Thread rx;
        volatile bool running;
        public volatile bool Listening;   // ghi nhận cả gói nghe thấy ngoài lúc quét (máy đang khởi động...)
        public Func<byte[], bool> IsTarget = m => true;   // lọc MAC để bắt gói IP thụ động
        public event Action<uint, byte[], string> Found;
        public string ModeName { get { return "Npcap (gửi ARP thô, nhanh)"; } }

        public PcapScanner(Adapter a)
        {
            ad = a;
            string dev = @"\Device\NPF_" + a.Id;
            var eb = new StringBuilder(512);
            cap = Pcap.pcap_open_live(dev, 96, 0, 5, eb);
            if (cap == IntPtr.Zero) throw new Exception("Npcap không mở được card mạng: " + eb);
            snd = Pcap.pcap_open_live(dev, 96, 0, 5, eb);
            if (snd == IntPtr.Zero) { Pcap.pcap_close(cap); throw new Exception("Npcap không mở được card mạng: " + eb); }
            running = true;
            rx = new Thread(RxLoop) { IsBackground = true, Name = "pcap-rx" };
            rx.Start();
        }

        volatile bool scanning;

        void RxLoop()
        {
            var f = new byte[64];
            while (running)
            {
                IntPtr h, d;
                int r = Pcap.pcap_next_ex(cap, out h, out d);
                if (r == 1)
                {
                    int len = Marshal.ReadInt32(h, 8);   // pcap_pkthdr: timeval(8) + caplen
                    if (len < 34) continue;
                    int n = Math.Min(len, f.Length);
                    Marshal.Copy(d, f, 0, n);
                    try { Handle(f, n); } catch { }
                }
                else if (r < 0) break;
            }
        }

        static bool Eq(byte[] a, int o, byte[] b) { for (int i = 0; i < 6; i++) if (a[o + i] != b[i]) return false; return true; }
        static byte[] Sub(byte[] a, int o, int n) { var r = new byte[n]; Array.Copy(a, o, r, 0, n); return r; }

        void Handle(byte[] f, int n)
        {
            if (Eq(f, 6, ad.Mac)) return;   // gói của chính mình
            if (!scanning && !Listening) return;
            int type = f[12] << 8 | f[13];
            var h = Found;
            if (h == null) return;
            if (type == 0x0806 && n >= 42)
            {
                int op = f[20] << 8 | f[21];
                byte[] sha = Sub(f, 22, 6);
                uint spa = Ip.FromBytes(f, 28), tpa = Ip.FromBytes(f, 38);
                if (spa != 0) h(spa, sha, op == 2 ? "trả lời quét" : "nghe thấy (ARP)");
                else if (op == 1 && tpa != 0) h(tpa, sha, "đang khởi động (ARP probe)");
            }
            else if (type == 0x0800 && Listening && n >= 34)
            {
                // Chỉ bắt gói IP khi ở chế độ NGHE, và chỉ IP cùng dải card (bỏ gói internet đi qua modem)
                byte[] src = Sub(f, 6, 6);
                if (!IsTarget(src)) return;
                uint sip = Ip.FromBytes(f, 26);
                if (sip != 0 && (sip & ad.Mask) == (ad.Ip & ad.Mask)) h(sip, src, "nghe thấy (gói IP)");
            }
        }

        byte[] Frame(uint spa, uint tpa)
        {
            var f = new byte[60];
            for (int i = 0; i < 6; i++) f[i] = 0xFF;
            Array.Copy(ad.Mac, 0, f, 6, 6);
            f[12] = 0x08; f[13] = 0x06;
            f[14] = 0; f[15] = 1; f[16] = 0x08; f[17] = 0; f[18] = 6; f[19] = 4; f[20] = 0; f[21] = 1;
            Array.Copy(ad.Mac, 0, f, 22, 6);
            Array.Copy(Ip.Bytes(spa), 0, f, 28, 4);
            Array.Copy(Ip.Bytes(tpa), 0, f, 38, 4);
            return f;
        }

        public void Scan(IList<uint> targets, CancellationToken ct, Action<int, int> progress, Action<string> log)
        {
            scanning = true;
            try
            {
                var probe = Frame(0, 0);
                var normal = Frame(ad.Ip, 0);
                int sent = 0;
                for (int i = 0; i < targets.Count; i++)
                {
                    if (ct.IsCancellationRequested) break;
                    var tb = Ip.Bytes(targets[i]);
                    Array.Copy(tb, 0, probe, 38, 4);
                    Array.Copy(tb, 0, normal, 38, 4);
                    if (Pcap.pcap_sendpacket(snd, probe, 60) != 0 || Pcap.pcap_sendpacket(snd, normal, 60) != 0)
                        throw new Exception("Npcap gửi gói lỗi: " + Marshal.PtrToStringAnsi(Pcap.pcap_geterr(snd)));
                    sent += 2;
                    if (sent % 64 == 0) Thread.Sleep(12);   // ~5.000 gói/giây, không làm nghẽn mạng khách
                    if (i % 256 == 0 && progress != null) progress(i, targets.Count);
                }
                if (progress != null) progress(targets.Count, targets.Count);
                // chờ các máy trả lời trễ
                for (int k = 0; k < 25 && !ct.IsCancellationRequested; k++) Thread.Sleep(100);
            }
            finally { scanning = false; }
        }

        // Kiểm tra 1 IP có ai đang dùng không (trả lời ARP trong timeoutMs)
        public bool IsUsed(uint ip, int timeoutMs)
        {
            bool hit = false;
            Action<uint, byte[], string> cb = (i, m, how) => { if (i == ip) hit = true; };
            Found += cb;
            scanning = true;
            try
            {
                Pcap.pcap_sendpacket(snd, Frame(0, ip), 60);
                Pcap.pcap_sendpacket(snd, Frame(ad.Ip, ip), 60);
                for (int t = 0; t < timeoutMs && !hit; t += 50) Thread.Sleep(50);
            }
            finally { scanning = false; Found -= cb; }
            return hit;
        }

        public void Dispose()
        {
            running = false;
            if (rx != null) rx.Join(500);
            if (cap != IntPtr.Zero) Pcap.pcap_close(cap);
            if (snd != IntPtr.Zero) Pcap.pcap_close(snd);
            cap = snd = IntPtr.Zero;
        }
    }

    // Không có Npcap: tạm thêm tuyến "on-link" cho các dải cần quét để Windows tự hỏi ARP thẳng xuống dây,
    // rồi dùng SendARP song song. Cần quyền Admin; quét xong gỡ tuyến ngay.
    class WinScanner : IScanner
    {
        [DllImport("iphlpapi.dll")] static extern int SendARP(uint destIp, uint srcIp, byte[] mac, ref int len);

        readonly Adapter ad;
        public event Action<uint, byte[], string> Found;
        public string ModeName { get { return "Windows (không cần Npcap, chậm hơn)"; } }
        public int Threads = 256;

        public WinScanner(Adapter a) { ad = a; }

        public static byte[] Arp(uint ip)
        {
            var mac = new byte[6];
            int len = 6;
            uint dest = BitConverter.ToUInt32(Ip.Bytes(ip), 0);
            return SendARP(dest, 0, mac, ref len) == 0 && len == 6 ? mac : null;
        }

        public void Scan(IList<uint> targets, CancellationToken ct, Action<int, int> progress, Action<string> log)
        {
            var routes = new List<string>();
            try
            {
                // Gom dải cần tuyến: /16 nếu nhiều /24, ngược lại từng /24
                var off = targets.Where(t => !ad.SameNet(t)).ToList();
                foreach (var g in off.GroupBy(t => t & 0xFFFF0000u))
                {
                    var c24 = g.Select(t => t & 0xFFFFFF00u).Distinct().ToList();
                    if (c24.Count > 16) routes.Add(Ip.Str(g.Key) + "/16");
                    else routes.AddRange(c24.Select(c => Ip.Str(c) + "/24"));
                }
                if (routes.Count > 0)
                {
                    if (!NetCfg.IsAdmin()) throw new Exception("Quét khác dải ở chế độ Windows cần chạy tool bằng quyền Admin.");
                    if (log != null) log("Tạm thêm " + routes.Count + " tuyến on-link để quét...");
                    foreach (var r in routes.ToList())
                        if (!NetCfg.AddOnLinkRoute(ad.Index, r, log)) routes.Remove(r);
                }

                var q = new ConcurrentQueue<uint>(targets);
                int done = 0, total = targets.Count;
                var th = new List<Thread>();
                for (int i = 0; i < Math.Min(Threads, total); i++)
                {
                    var t = new Thread(() =>
                    {
                        uint ip;
                        while (!ct.IsCancellationRequested && q.TryDequeue(out ip))
                        {
                            var mac = Arp(ip);
                            if (mac != null && mac.Any(b => b != 0)) { var h = Found; if (h != null) h(ip, mac, "trả lời quét"); }
                            int d = Interlocked.Increment(ref done);
                            if (d % 64 == 0 && progress != null) progress(d, total);
                        }
                    }) { IsBackground = true };
                    th.Add(t);
                    t.Start();
                }
                foreach (var t in th) t.Join();
                if (progress != null) progress(total, total);
            }
            finally
            {
                foreach (var r in routes) NetCfg.DeleteRoute(ad.Index, r);
                if (routes.Count > 0 && log != null) log("Đã gỡ các tuyến tạm.");
            }
        }

        public void Dispose() { }
    }
}
