using System;
using System.Windows.Forms;

namespace TimMay
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { ZkDevice.EnsureRegistered(); } catch { }   // tự đăng ký SDK kèm theo nếu máy chưa có
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                try { MessageBox.Show("Lỗi: " + (e.ExceptionObject as Exception)?.Message, "Tìm máy chấm công"); } catch { }
            };
            Application.ThreadException += (s, e) =>
            {
                MessageBox.Show("Lỗi: " + e.Exception.Message, "Tìm máy chấm công");
            };
            Application.Run(new MainForm());
        }
    }
}
