using System;
using System.Drawing;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TimMay
{
    // Đưa 1 máy chấm công (đang khác dải) về cùng dải modem:
    // 1) gắn tạm 1 IP phụ cùng dải máy vào card mạng  2) kết nối SDK đọc serial/model
    // 3) đổi IP máy sang dải modem + khởi động lại  4) gỡ IP phụ.
    class PointForm : Form
    {
        readonly Adapter ad;
        readonly Device dev;
        TextBox txtNewIp, txtKey;
        Label lblInfo;
        TextBox log;
        Button btnRead, btnApply, btnClose;
        RadioButton rdoDhcp, rdoStatic;

        CancellationTokenSource cts = new CancellationTokenSource();

        public PointForm(Adapter a, Device d)
        {
            ad = a; dev = d;
            Text = "Đưa máy " + d.IpStr + " về dải modem";
            Width = 640; Height = 560; StartPosition = FormStartPosition.CenterParent;
            Font = new Font("Segoe UI", 9f); MaximizeBox = false; MinimizeBox = false;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            Build();
            FormClosing += (s, e) => cts.Cancel();
        }

        void Build()
        {
            int y = 12;
            Func<string, int, Label> lab = (t, yy) => { var l = new Label { Text = t, Left = 14, Top = yy + 3, Width = 150 }; Controls.Add(l); return l; };

            Controls.Add(new Label { Left = 14, Top = y, Width = 600, Height = 60, ForeColor = Color.DimGray, Text =
                "Máy hiện ở " + dev.IpStr + " (MAC " + dev.MacStr + "). Modem của bạn ở dải " +
                Ip.Str(ad.Gw & ad.Mask) + "/" + Ip.PrefixOf(ad.Mask) + " (cổng " + Ip.Str(ad.Gw) + ").\n" +
                "Chọn IP mới cùng dải modem rồi bấm Áp dụng. Tool sẽ tự gắn IP phụ tạm để nói chuyện với máy, xong sẽ gỡ." });
            y += 64;

            lab("Comm Key (nếu có):", y);
            txtKey = new TextBox { Left = 170, Top = y, Width = 100, Text = "0" };
            Controls.Add(txtKey);
            btnRead = new Button { Left = 290, Top = y - 1, Width = 150, Text = "① Kết nối & đọc máy" };
            btnRead.Click += async (s, e) => await Read();
            Controls.Add(btnRead);
            y += 34;

            lblInfo = new Label { Left = 14, Top = y, Width = 600, Height = 44, ForeColor = Color.Navy, Text = "Chưa đọc máy." };
            Controls.Add(lblInfo);
            y += 48;

            rdoStatic = new RadioButton { Left = 14, Top = y, Width = 150, Text = "Đặt IP tĩnh:", Checked = true };
            Controls.Add(rdoStatic);
            txtNewIp = new TextBox { Left = 170, Top = y, Width = 140, Text = Ip.Str(SuggestIp()) };
            Controls.Add(txtNewIp);
            Controls.Add(new Label { Left = 318, Top = y + 3, Width = 300, ForeColor = Color.DimGray, Text = "mask " + Ip.Str(ad.Mask) + ", gw " + Ip.Str(ad.Gw) });
            y += 28;
            rdoDhcp = new RadioButton { Left = 14, Top = y, Width = 420, Text = "Bật DHCP (máy tự xin IP từ modem)" };
            Controls.Add(rdoDhcp);
            y += 34;

            btnApply = new Button { Left = 14, Top = y, Width = 200, Height = 32, Enabled = false, Text = "② ÁP DỤNG & khởi động lại máy", BackColor = Color.FromArgb(0, 120, 215), ForeColor = Color.White, Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
            btnApply.Click += async (s, e) => await Apply();
            Controls.Add(btnApply);
            btnClose = new Button { Left = 224, Top = y, Width = 100, Height = 32, Text = "Đóng" };
            btnClose.Click += (s, e) => Close();
            Controls.Add(btnClose);
            y += 40;

            log = new TextBox { Left = 14, Top = y, Width = 600, Height = Height - y - 50, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom, BackColor = Color.FromArgb(30, 30, 30), ForeColor = Color.Gainsboro, Font = new Font("Consolas", 9f) };
            Controls.Add(log);
        }

        uint SuggestIp()
        {
            // Giữ nguyên octet cuối của máy nếu còn trống trong dải modem, ngược lại .201
            uint host = dev.Ip & ~ad.Mask;
            uint cand = (ad.Gw & ad.Mask) | host;
            if (host == 0 || cand == ad.Ip || cand == ad.Gw) cand = (ad.Gw & ad.Mask) | 201;
            return cand;
        }

        void Log(string s)
        {
            if (log.InvokeRequired) { log.BeginInvoke((Action)(() => Log(s))); return; }
            log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + s + "\r\n");
        }

        async Task Read()
        {
            btnRead.Enabled = false;
            try
            {
                if (!ZkDevice.SdkInstalled())
                {
                    Log("CHƯA có SDK zkemkeeper trên máy tính này.");
                    MessageBox.Show("Máy tính này chưa có SDK máy chấm công (zkemkeeper.dll).\nCài DigiplusChamCong-Setup.exe (quyền Admin) rồi thử lại.\n\nVẫn tìm & liệt kê máy được, chỉ chưa đổi IP qua SDK.", "Thiếu SDK", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                int key = ParseKey();
                await Task.Run(() =>
                {
                    using (var r = new Reach(ad, dev.Ip, Log))
                    using (var z = new ZkDevice())
                    {
                        Log("Kết nối SDK " + dev.IpStr + ":4370 ...");
                        z.Connect(dev.Ip, 4370, key);
                        string sn = z.Serial(), model = z.Model(), fw = z.Firmware(), dhcp = z.Option("DHCP");
                        Invoke((Action)(() =>
                        {
                            lblInfo.Text = "Model: " + (model == "" ? "?" : model) + "   Serial: " + (sn == "" ? "?" : sn) +
                                           "\nFirmware: " + fw + "   DHCP máy: " + (dhcp == "1" ? "đang bật" : "tắt");
                            btnApply.Enabled = true;
                        }));
                        Log("Đọc máy OK. Serial " + sn + ", model " + model + ".");
                    }
                });
            }
            catch (Exception ex) { Log("LỖI đọc máy: " + ex.Message); MessageBox.Show(ex.Message, "Không đọc được máy", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { btnRead.Enabled = true; }
        }

        int ParseKey() { int k; return int.TryParse(txtKey.Text.Trim(), out k) ? k : 0; }

        async Task Apply()
        {
            bool dhcp = rdoDhcp.Checked;
            uint newIp = 0;
            if (!dhcp)
            {
                if (!Ip.TryParse(txtNewIp.Text, out newIp)) { MessageBox.Show("IP mới không hợp lệ."); return; }
                if ((newIp & ad.Mask) != (ad.Gw & ad.Mask)) { MessageBox.Show("IP mới phải cùng dải modem (" + Ip.Str(ad.Gw & ad.Mask) + "/" + Ip.PrefixOf(ad.Mask) + ")."); return; }
                if (newIp == ad.Gw) { MessageBox.Show("IP mới trùng modem."); return; }
                if (newIp == ad.Ip) { MessageBox.Show("IP mới trùng máy tính này."); return; }
            }
            string msg = dhcp ? "Bật DHCP cho máy " + dev.IpStr + " và khởi động lại máy?"
                              : "Đổi IP máy " + dev.IpStr + " → " + Ip.Str(newIp) + " (mask " + Ip.Str(ad.Mask) + ", gw " + Ip.Str(ad.Gw) + ") và khởi động lại máy?";
            if (MessageBox.Show(msg + "\n\nMáy sẽ khởi động lại và mất kết nối ở IP cũ.", "Xác nhận", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;

            btnApply.Enabled = btnRead.Enabled = false;
            try
            {
                int key = ParseKey();
                await Task.Run(() =>
                {
                    using (var r = new Reach(ad, dev.Ip, Log))
                    using (var z = new ZkDevice())
                    {
                        Log("Kết nối lại để ghi cấu hình...");
                        z.Connect(dev.Ip, 4370, key);
                        z.WriteNetwork(dhcp, newIp, ad.Mask, ad.Gw, Log);
                    }
                });
                Log("ĐÃ GỬI. Máy đang khởi động lại...");
                if (!dhcp)
                {
                    await WaitNewIp(newIp);
                    Log("Giờ có thể nhập IP " + Ip.Str(newIp) + " vào phần mềm chấm công.");
                }
                else Log("Máy sẽ xin IP mới từ modem; xem IP mới trong danh sách thiết bị của modem hoặc quét lại.");
                MessageBox.Show("Hoàn tất. Máy đang khởi động lại với cấu hình mới.", "Xong", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex) { Log("LỖI áp dụng: " + ex.Message); MessageBox.Show(ex.Message, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { btnApply.Enabled = btnRead.Enabled = true; }
        }

        async Task WaitNewIp(uint ip)
        {
            Log("Chờ máy lên lại ở " + Ip.Str(ip) + " (tối đa 60 giây)...");
            for (int i = 0; i < 30 && !cts.IsCancellationRequested; i++)
            {
                await Task.Delay(2000);
                if (await Task.Run(() => TcpProbe.Open(ip, 4370, 500))) { Log("✓ Máy đã lên ở " + Ip.Str(ip) + " (cổng 4370 mở)."); return; }
            }
            Log("Chưa thấy máy ở IP mới (máy có thể khởi động lâu hơn). Thử quét lại sau.");
        }
    }
}
