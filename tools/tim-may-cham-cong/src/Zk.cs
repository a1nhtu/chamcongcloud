using System;

namespace TimMay
{
    // Kết nối máy chấm công qua SDK zkemkeeper.dll (COM) — cùng SDK phần mềm Digiplus đang dùng
    class ZkDevice : IDisposable
    {
        const int M = 1;
        dynamic z;
        bool connected;

        public static bool SdkInstalled()
        {
            return Type.GetTypeFromProgID("zkemkeeper.ZKEM") != null;
        }

        // Nếu máy CHƯA có SDK nào mà bên cạnh exe có sẵn thư mục zksdk\zkemkeeper.dll → tự đăng ký
        // (regsvr32 32-bit). Máy đã có SDK (Wise Eye / Ronald Jack / Digiplus) thì GIỮ NGUYÊN, không đụng.
        public static string EnsureRegistered()
        {
            if (SdkInstalled()) return null;
            string dll = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "zksdk", "zkemkeeper.dll");
            if (!System.IO.File.Exists(dll)) return null;
            try
            {
                string regsvr = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.SystemX86), "regsvr32.exe");
                if (!System.IO.File.Exists(regsvr)) regsvr = "regsvr32.exe";
                var psi = new System.Diagnostics.ProcessStartInfo(regsvr, "/s \"" + dll + "\"") { UseShellExecute = false, CreateNoWindow = true };
                var p = System.Diagnostics.Process.Start(psi);
                p.WaitForExit(15000);
                return SdkInstalled() ? "Đã tự đăng ký SDK máy chấm công." : null;
            }
            catch { return null; }
        }

        public void Connect(uint ip, int port, int commKey)
        {
            var t = Type.GetTypeFromProgID("zkemkeeper.ZKEM");
            if (t == null) throw new Exception("Máy tính này chưa có SDK máy chấm công (zkemkeeper.dll). Cài DigiplusChamCong-Setup.exe bằng quyền Admin, hoặc regsvr32 zkemkeeper.dll.");
            z = Activator.CreateInstance(t);
            if (commKey > 0) z.SetCommPassword(commKey);
            if (!(bool)z.Connect_Net(Ip.Str(ip), port))
            {
                int e = 0;
                z.GetLastError(ref e);
                throw new Exception("Không kết nối được " + Ip.Str(ip) + ":" + port + " (mã lỗi " + e + "). Kiểm tra mật mã kết nối (Comm Key), dây mạng.");
            }
            connected = true;
        }

        public string Option(string key)
        {
            string v = "";
            try { if ((bool)z.GetSysOption(M, key, out v)) return (v ?? "").Trim('\0', ' '); } catch { }
            return "";
        }

        public string Serial() { string s = ""; try { z.GetSerialNumber(M, out s); } catch { } return s ?? ""; }
        public string Firmware() { string s = ""; try { z.GetFirmwareVersion(M, ref s); } catch { } return s ?? ""; }
        public string Model() { string s = ""; try { z.GetProductCode(M, out s); } catch { } return s ?? ""; }
        public string DeviceIp() { string s = ""; try { z.GetDeviceIP(M, ref s); } catch { } return s ?? ""; }

        // Ghi mạng mới rồi khởi động lại máy. Ghi mask/gateway trước, IP sau cùng (phòng firmware áp IP ngay)
        public void WriteNetwork(bool dhcp, uint ip, uint mask, uint gw, Action<string> log)
        {
            z.EnableDevice(M, false);
            if (dhcp)
            {
                log("  DHCP=1 → " + ((bool)z.SetSysOption(M, "DHCP", "1") ? "OK" : "máy không nhận"));
            }
            else
            {
                log("  NetMask=" + Ip.Str(mask) + " → " + ((bool)z.SetSysOption(M, "NetMask", Ip.Str(mask)) ? "OK" : "máy không nhận"));
                log("  GATEIPAddress=" + Ip.Str(gw) + " → " + ((bool)z.SetSysOption(M, "GATEIPAddress", Ip.Str(gw)) ? "OK" : "máy không nhận"));
                if (Option("DHCP") == "1") log("  DHCP=0 → " + ((bool)z.SetSysOption(M, "DHCP", "0") ? "OK" : "máy không nhận"));
                bool ok = (bool)z.SetDeviceIP(M, Ip.Str(ip));
                if (!ok) ok = (bool)z.SetSysOption(M, "IPAddress", Ip.Str(ip));
                log("  IPAddress=" + Ip.Str(ip) + " → " + (ok ? "OK" : "máy không nhận"));
                if (!ok) throw new Exception("Máy không nhận IP mới.");
            }
            try { z.RefreshData(M); } catch { }
            try { z.EnableDevice(M, true); } catch { }
            log("  Gửi lệnh khởi động lại máy...");
            try { z.RestartDevice(M); } catch { }
            connected = false;
        }

        // Xóa toàn bộ quyền quản trị (admin) trên máy — để vào được Menu khi quên/mất admin.
        // Nhiều firmware trả false dù thành công nên không chặn theo kết quả.
        public void ClearAdmin(Action<string> log)
        {
            z.EnableDevice(M, false);
            bool ok = false;
            try { ok = (bool)z.ClearAdministrators(M); } catch (Exception ex) { log("  ClearAdministrators lỗi: " + ex.Message); }
            try { z.RefreshData(M); } catch { }
            try { z.EnableDevice(M, true); } catch { }
            log("  Đã gửi lệnh xóa quản trị" + (ok ? " (máy báo OK)" : " (máy không báo kết quả — thường vẫn xong)") + ".");
        }

        public void Dispose()
        {
            if (z != null && connected) { try { z.Disconnect(); } catch { } }
            connected = false;
            if (z != null) { try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(z); } catch { } }
            z = null;
        }
    }
}
