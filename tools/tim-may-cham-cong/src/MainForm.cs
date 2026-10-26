using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TimMay
{
    class MainForm : Form
    {
        ComboBox cboAdapter;
        ComboBox cboRange;
        TextBox txtCustom;
        Button btnScan, btnStop, btnPoint, btnClearAdmin;
        CheckBox chkOnlyDevice;
        ProgressBar bar;
        ListView list;
        TextBox log;
        Label lblMode;

        List<Adapter> adapters = new List<Adapter>();
        readonly Dictionary<uint, Device> found = new Dictionary<uint, Device>();
        readonly object foundLock = new object();
        CancellationTokenSource cts;
        System.Windows.Forms.Timer refreshTimer;
        volatile bool scanning;
        Label lblCount;
        SplitContainer split;

        // Bảng màu
        static readonly Color Accent = Color.FromArgb(0, 120, 215);
        static readonly Color AccentDark = Color.FromArgb(0, 99, 177);
        static readonly Color Bg = Color.FromArgb(245, 247, 250);
        static readonly Color CardBg = Color.White;
        static readonly Color Line = Color.FromArgb(225, 228, 232);

        public MainForm()
        {
            Text = "Tìm máy chấm công — Digiplus";
            Width = 1040; Height = 720; StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.5f);
            BackColor = Bg;
            MinimumSize = new Size(880, 560);
            BuildUi();
            Load += (s, e) => { State.CleanupLeftovers(null); ReloadAdapters(); ShowMode(); };
            FormClosing += (s, e) => { if (cts != null) cts.Cancel(); State.CleanupLeftovers(null); };
        }

        Button MakeButton(string text, bool primary)
        {
            var b = new Button
            {
                Text = text, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(14, 7, 14, 7), Margin = new Padding(0, 0, 8, 0),
                FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9.5f, primary ? FontStyle.Bold : FontStyle.Regular),
                BackColor = primary ? Accent : Color.White,
                ForeColor = primary ? Color.White : Color.FromArgb(50, 54, 60)
            };
            b.FlatAppearance.BorderColor = primary ? Accent : Line;
            b.FlatAppearance.BorderSize = 1;
            b.FlatAppearance.MouseOverBackColor = primary ? AccentDark : Color.FromArgb(238, 242, 247);
            b.EnabledChanged += (s, e) =>
            {
                if (primary) { b.BackColor = b.Enabled ? Accent : Color.FromArgb(200, 210, 220); b.ForeColor = Color.White; }
                else b.ForeColor = b.Enabled ? Color.FromArgb(50, 54, 60) : Color.Gray;
            };
            return b;
        }

        Label FieldLabel(string t)
        {
            return new Label { Text = t, AutoSize = false, Width = 86, Height = 30, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(70, 76, 84), Margin = new Padding(0, 0, 6, 0) };
        }

        void BuildUi()
        {
            // ===== Header =====
            var header = new Panel { Dock = DockStyle.Top, Height = 56, BackColor = Accent };
            var title = new Label { Text = "🔍  Tìm máy chấm công", AutoSize = false, Dock = DockStyle.Fill, ForeColor = Color.White, Font = new Font("Segoe UI", 14f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(18, 0, 0, 0) };
            var brand = new Label { Text = "Digiplus", AutoSize = false, Dock = DockStyle.Right, Width = 150, ForeColor = Color.FromArgb(210, 230, 250), Font = new Font("Segoe UI", 11f, FontStyle.Italic), TextAlign = ContentAlignment.MiddleRight, Padding = new Padding(0, 0, 18, 0) };
            header.Controls.Add(title); header.Controls.Add(brand);
            title.BringToFront();

            // ===== Bảng điều khiển (card) =====
            var card = new Panel { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, BackColor = CardBg, Padding = new Padding(16, 14, 16, 14) };

            var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, Padding = new Padding(0) };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            // Hàng 1: Card mạng
            grid.Controls.Add(FieldLabel("Card mạng:"), 0, 0);
            cboAdapter = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 3, 8, 3), Height = 28 };
            cboAdapter.SelectedIndexChanged += (s, e) => ShowMode();
            grid.Controls.Add(cboAdapter, 1, 0);
            var btnReload = MakeButton("↻  Nạp lại", false);
            btnReload.Click += (s, e) => { ReloadAdapters(); ShowMode(); };
            grid.Controls.Add(btnReload, 2, 0);

            // Hàng 2: Phạm vi
            grid.Controls.Add(FieldLabel("Phạm vi:"), 0, 1);
            cboRange = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 3, 8, 3) };
            cboRange.Items.AddRange(new object[] {
                "Nhanh — các dải hay gặp (vài giây)",
                "Dải của card mạng này (/24)",
                "Toàn bộ 192.168.x.x (vài phút)",
                "Tự nhập dải bên dưới"
            });
            cboRange.SelectedIndex = 0;
            cboRange.SelectedIndexChanged += (s, e) => txtCustom.Enabled = cboRange.SelectedIndex == 3;
            grid.Controls.Add(cboRange, 1, 1);
            chkOnlyDevice = new CheckBox { Text = "Chỉ máy chấm công", Checked = true, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 0, 0), ForeColor = Color.FromArgb(70, 76, 84) };
            chkOnlyDevice.CheckedChanged += (s, e) => RefreshList();
            grid.Controls.Add(chkOnlyDevice, 2, 1);

            // Hàng 3: Dải tự nhập
            grid.Controls.Add(FieldLabel("Dải tự nhập:"), 0, 2);
            txtCustom = new TextBox { Dock = DockStyle.Fill, Enabled = false, Text = "192.168.1.0/24, 10.10.10.1-254, 192.168.1.201", Margin = new Padding(0, 3, 8, 3), BorderStyle = BorderStyle.FixedSingle };
            grid.Controls.Add(txtCustom, 1, 2);
            card.Controls.Add(grid);

            // ===== Thanh nút hành động =====
            var bar1 = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = false, Padding = new Padding(0, 12, 0, 0), Margin = new Padding(0) };
            btnScan = MakeButton("🔍  QUÉT TÌM MÁY", true);
            btnScan.Click += async (s, e) => await DoScan();
            btnStop = MakeButton("■  Dừng", false); btnStop.Enabled = false;
            btnStop.Click += (s, e) => { if (cts != null) cts.Cancel(); };
            var sep = new Label { Text = "", AutoSize = false, Width = 24, Height = 2 };
            btnPoint = MakeButton("⚙  Đổi IP về dải modem", false); btnPoint.Enabled = false;
            btnPoint.Click += (s, e) => PointDevice();
            btnClearAdmin = MakeButton("🗝  Xóa quản trị", false); btnClearAdmin.Enabled = false;
            btnClearAdmin.Click += (s, e) => ClearAdminDevice();
            bar1.Controls.AddRange(new Control[] { btnScan, btnStop, sep, btnPoint, btnClearAdmin });
            card.Controls.Add(bar1);
            bar1.BringToFront();

            // ===== Vùng danh sách + nhật ký =====
            var body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16, 10, 16, 6), BackColor = Bg };
            split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterWidth = 8, BackColor = Bg };

            var listPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0), BackColor = CardBg, BorderStyle = BorderStyle.FixedSingle };
            var listHead = new Label { Text = "Thiết bị tìm thấy", Dock = DockStyle.Top, Height = 30, Font = new Font("Segoe UI", 10f, FontStyle.Bold), ForeColor = Color.FromArgb(50, 54, 60), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0), BackColor = Color.FromArgb(248, 249, 251) };
            lblCount = new Label { Dock = DockStyle.Right, Width = 260, Text = "", Font = new Font("Segoe UI", 9f), ForeColor = Color.Gray, TextAlign = ContentAlignment.MiddleRight, Padding = new Padding(0, 0, 10, 0), BackColor = Color.FromArgb(248, 249, 251) };
            listHead.Controls.Add(lblCount);
            list = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, GridLines = false, MultiSelect = false, HideSelection = false, BorderStyle = BorderStyle.None, Font = new Font("Segoe UI", 9.5f) };
            list.Columns.Add("IP", 140);
            list.Columns.Add("Địa chỉ MAC", 160);
            list.Columns.Add("Hãng", 200);
            list.Columns.Add("Cổng mở", 90);
            list.Columns.Add("Nhận xét", 250);
            list.Columns.Add("Phát hiện", 150);
            list.SelectedIndexChanged += (s, e) => btnPoint.Enabled = btnClearAdmin.Enabled = list.SelectedItems.Count > 0 && !scanning;
            list.DoubleClick += (s, e) => PointDevice();
            listPanel.Controls.Add(list); listPanel.Controls.Add(listHead);
            split.Panel1.Controls.Add(listPanel);

            var logPanel = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(30, 30, 30), BorderStyle = BorderStyle.FixedSingle };
            var logHead = new Label { Text = "Nhật ký", Dock = DockStyle.Top, Height = 26, Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.Gainsboro, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0), BackColor = Color.FromArgb(45, 45, 45) };
            log = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.FromArgb(30, 30, 30), ForeColor = Color.Gainsboro, Font = new Font("Consolas", 9f), BorderStyle = BorderStyle.None };
            logPanel.Controls.Add(log); logPanel.Controls.Add(logHead);
            split.Panel2.Controls.Add(logPanel);
            body.Controls.Add(split);

            // ===== Thanh trạng thái =====
            var statusBar = new Panel { Dock = DockStyle.Bottom, Height = 28, BackColor = Color.FromArgb(238, 241, 245) };
            bar = new ProgressBar { Dock = DockStyle.Top, Height = 4, Style = ProgressBarStyle.Continuous };
            lblMode = new Label { Dock = DockStyle.Fill, ForeColor = Color.DimGray, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(12, 0, 0, 0), AutoEllipsis = true };
            statusBar.Controls.Add(lblMode);

            // Thứ tự Dock: Fill trước, rồi các cạnh
            Controls.Add(body);
            Controls.Add(statusBar);
            Controls.Add(bar);
            Controls.Add(card);
            Controls.Add(header);

            Shown += (s, e) => { try { split.SplitterDistance = (int)(split.Height * 0.62); } catch { } };
            refreshTimer = new System.Windows.Forms.Timer { Interval = 600 };
            refreshTimer.Tick += (s, e) => RefreshList();
        }

        void ReloadAdapters()
        {
            adapters = Adapter.ListAll();
            cboAdapter.Items.Clear();
            foreach (var a in adapters) cboAdapter.Items.Add(a.ToString());
            if (cboAdapter.Items.Count > 0) cboAdapter.SelectedIndex = 0;
        }

        Adapter Current { get { return cboAdapter.SelectedIndex >= 0 ? adapters[cboAdapter.SelectedIndex] : null; } }

        void ShowMode()
        {
            string m = Pcap.Available ? "Chế độ nhanh: Npcap " + Pcap.Version.Split(' ').LastOrDefault() : "Chế độ Windows (chưa cài Npcap)";
            if (!NetCfg.IsAdmin()) m += " — CHƯA chạy Admin";
            lblMode.Text = m;
            lblMode.ForeColor = NetCfg.IsAdmin() ? Color.Green : Color.Firebrick;
        }

        void Log(string s)
        {
            if (s == null) return;
            if (log.InvokeRequired) { log.BeginInvoke((Action)(() => Log(s))); return; }
            log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + s + "\r\n");
        }

        List<uint> BuildTargets(Adapter a)
        {
            switch (cboRange.SelectedIndex)
            {
                case 1:
                    var l = new List<uint>();
                    uint net = a.Ip & a.Mask, last = net | ~a.Mask;
                    for (uint v = net + 1; v < last; v++) l.Add(v);
                    return l;
                case 2: return Ip.Full192();
                case 3: return Ip.ParseRanges(txtCustom.Text);
                default: return Ip.QuickList();
            }
        }

        async Task DoScan()
        {
            var a = Current;
            if (a == null) { MessageBox.Show("Chưa chọn card mạng."); return; }
            List<uint> targets;
            try { targets = BuildTargets(a); }
            catch (Exception ex) { MessageBox.Show("Dải không hợp lệ: " + ex.Message); return; }
            if (targets.Count == 0) { MessageBox.Show("Không có địa chỉ nào để quét."); return; }

            bool offSubnet = targets.Any(t => !a.SameNet(t));
            if (!Pcap.Available && offSubnet && !NetCfg.IsAdmin())
            {
                MessageBox.Show("Quét máy KHÁC DẢI mạng (mà máy này chưa cài Npcap) cần chạy tool bằng quyền Administrator.\n\nHãy đóng tool, chuột phải → Run as administrator.", "Cần quyền Admin", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            lock (foundLock) found.Clear();
            list.Items.Clear();
            cts = new CancellationTokenSource();
            scanning = true;
            btnScan.Enabled = false; btnStop.Enabled = true; btnPoint.Enabled = btnClearAdmin.Enabled = false;
            cboAdapter.Enabled = cboRange.Enabled = false;
            bar.Value = 0; bar.Maximum = targets.Count;
            refreshTimer.Start();
            Log("Bắt đầu quét " + targets.Count + " địa chỉ trên " + a.Name + "...");

            IScanner sc = null;
            try
            {
                await Task.Run(() =>
                {
                    sc = Pcap.Available ? (IScanner)new PcapScanner(a) : new WinScanner(a);
                    Invoke((Action)(() => Log("Dùng " + sc.ModeName)));
                    sc.Found += OnFound;
                    sc.Scan(targets, cts.Token, (d, tot) => BeginInvoke((Action)(() => { if (d <= bar.Maximum) bar.Value = d; })), Log);
                });
                await ProbePorts(cts.Token);
            }
            catch (Exception ex) { Log("LỖI: " + ex.Message); MessageBox.Show(ex.Message, "Lỗi quét", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally
            {
                if (sc != null) { sc.Found -= OnFound; sc.Dispose(); }
                scanning = false;
                refreshTimer.Stop(); RefreshList();
                btnScan.Enabled = true; btnStop.Enabled = false;
                cboAdapter.Enabled = cboRange.Enabled = true;
                int dev = found.Values.Count(d => d.LikelyDevice);
                Log("Xong. Thấy " + found.Count + " thiết bị, trong đó " + dev + " nghi là máy chấm công.");
                bar.Value = 0;
            }
        }

        void OnFound(uint ip, byte[] mac, string how)
        {
            if (mac == null || mac.Length < 6 || mac.All(b => b == 0)) return;
            lock (foundLock)
            {
                Device d;
                if (!found.TryGetValue(ip, out d)) { d = new Device { Ip = ip }; found[ip] = d; }
                d.Mac = mac;
                bool zk; d.Vendor = Oui.Vendor(mac, out zk); d.IsZk = zk;
                d.How = how; d.Seen = DateTime.Now;
            }
        }

        async Task ProbePorts(CancellationToken ct)
        {
            Device[] snap;
            lock (foundLock) snap = found.Values.ToArray();
            Log("Dò cổng 4370 / 8818 trên " + snap.Length + " thiết bị...");
            await Task.Run(() =>
            {
                Parallel.ForEach(snap, new ParallelOptions { MaxDegreeOfParallelism = 64, CancellationToken = ct }, d =>
                {
                    d.Port4370 = TcpProbe.Open(d.Ip, 4370, 350);
                    d.Port8818 = TcpProbe.Open(d.Ip, 8818, 350);
                    d.Port80 = TcpProbe.Open(d.Ip, 80, 250);
                });
            });
        }

        void RefreshList()
        {
            Device[] snap;
            lock (foundLock) snap = found.Values.OrderByDescending(d => d.LikelyDevice).ThenBy(d => d.Ip).ToArray();
            list.BeginUpdate();
            list.Items.Clear();
            foreach (var d in snap)
            {
                if (chkOnlyDevice.Checked && !d.LikelyDevice) continue;
                var it = new ListViewItem(new[] { d.IpStr, d.MacStr, d.Vendor, d.Ports, d.Note, d.How }) { Tag = d };
                if (d.IsZk) { it.BackColor = Color.FromArgb(220, 244, 222); it.ForeColor = Color.FromArgb(22, 101, 52); it.Font = new Font(list.Font, FontStyle.Bold); }
                else if (d.Port4370 || d.Port8818) it.BackColor = Color.FromArgb(255, 248, 219);
                list.Items.Add(it);
            }
            list.EndUpdate();
            int dev = snap.Count(x => x.LikelyDevice);
            lblCount.Text = snap.Length + " thiết bị · " + dev + " máy chấm công";
        }

        void PointDevice()
        {
            if (list.SelectedItems.Count == 0 || scanning) return;
            var d = (Device)list.SelectedItems[0].Tag;
            var a = Current;
            if (a == null || a.Gw == 0) { MessageBox.Show("Card mạng đang chọn không có modem (gateway) để đưa máy về."); return; }
            using (var dlg = new PointForm(a, d)) dlg.ShowDialog(this);
        }

        async void ClearAdminDevice()
        {
            if (list.SelectedItems.Count == 0 || scanning) return;
            var d = (Device)list.SelectedItems[0].Tag;
            var a = Current;
            if (!ZkDevice.SdkInstalled()) { MessageBox.Show("Máy tính này chưa có SDK zkemkeeper. Cài DigiplusChamCong-Setup.exe (quyền Admin) rồi thử lại."); return; }
            string key = Prompt.Show(this, "Comm Key của máy (0 nếu không đặt):", "Xóa quản trị " + d.IpStr, "0");
            if (key == null) return;
            int k; int.TryParse(key.Trim(), out k);
            if (MessageBox.Show("Xóa TOÀN BỘ quyền quản trị trên máy " + d.IpStr + "?\n\nSau đó ai cũng vào được Menu máy. Dữ liệu nhân viên và chấm công KHÔNG bị xóa.", "Xác nhận xóa quản trị", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;

            btnClearAdmin.Enabled = btnPoint.Enabled = false;
            Log("Xóa quản trị máy " + d.IpStr + " ...");
            try
            {
                await Task.Run(() =>
                {
                    using (var r = new Reach(a, d.Ip, Log))
                    using (var z = new ZkDevice())
                    {
                        z.Connect(d.Ip, 4370, k);
                        z.ClearAdmin(Log);
                    }
                });
                Log("Xong xóa quản trị " + d.IpStr + ".");
                MessageBox.Show("Đã xóa quản trị máy " + d.IpStr + ".", "Xong", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex) { Log("LỖI xóa quản trị: " + ex.Message); MessageBox.Show(ex.Message, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { btnClearAdmin.Enabled = btnPoint.Enabled = list.SelectedItems.Count > 0; }
        }
    }

    // Hộp nhập 1 dòng
    static class Prompt
    {
        public static string Show(IWin32Window owner, string label, string title, string def)
        {
            using (var f = new Form { Text = title, Width = 420, Height = 160, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, Font = new Font("Segoe UI", 9f) })
            {
                f.Controls.Add(new Label { Left = 12, Top = 14, Width = 380, Text = label });
                var tb = new TextBox { Left = 12, Top = 42, Width = 380, Text = def };
                f.Controls.Add(tb);
                var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Left = 220, Top = 78, Width = 80 };
                var cancel = new Button { Text = "Hủy", DialogResult = DialogResult.Cancel, Left = 312, Top = 78, Width = 80 };
                f.Controls.Add(ok); f.Controls.Add(cancel);
                f.AcceptButton = ok; f.CancelButton = cancel;
                return f.ShowDialog(owner) == DialogResult.OK ? tb.Text : null;
            }
        }
    }
}
