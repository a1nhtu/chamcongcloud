// Cầu nối máy chấm công UNION (Virdi / UNIONCOMMUNITY) — SDK UCSAPI40.dll (UCS SDK v4.8, bản 32-bit).
// Máy Union TỰ KẾT NỐI về phần mềm: trên máy đặt IP máy tính + cổng (mặc định 9870), phần mềm mở cổng chờ (UCSAPI_ServerStart).
// Được server/union.js chạy NỀN 1 tiến trình duy nhất; nói chuyện qua stdin / stdout, mỗi dòng các cột cách nhau TAB:
//   vào (lệnh):  <mã> <lệnh> <TerminalID> [tham số…]      lệnh: users · count · logs [từ đến] · newlogs · fw · info · reboot · deluser <id> · delall · opendoor · quit
//   ra:          READY <cổng> · FAIL <mã lỗi> <lời> · A <mã> <kết quả gọi SDK> (0 = đã gửi lệnh xuống máy)
//                C <máy> <ip> (máy vừa kết nối) · X <máy> (mất kết nối) · T <máy> (máy hỏi giờ → trả giờ máy tính)
//                L <máy> <R|G> <Số ID> <yyyy-MM-dd HH:mm:ss> <AuthMode> <AuthType> <hợp lệ 1|0> <AuthResult> <thẻ> <thứ tự> <tổng>   lượt chấm (R real-time · G tải về)
//                LE <máy> <mã lỗi> (tải lượt chấm xong mà không có dòng nào)
//                U <máy> <Số ID> <tên> <quản trị 1|0> <UniqueID> <thứ tự> <tổng>  ·  UE <máy> <mã lỗi>
//                N <máy> <lỗi> <số QT> <số NV> <sức chứa NV> <vân tay> <sức chứa vân tay> <khuôn mặt> <sức chứa mặt>
//                V <máy> <lỗi> <firmware> · I <máy> <ip> <firmware> <mã model> <loại máy> <MAC> · E <máy> <sự kiện> <lỗi> <tham số>
// Biên dịch: csc /platform:x86 /target:exe /out:UnionBridge.exe UnionBridge.cs (server/union.js tự biên dịch bằng csc của .NET Framework 4).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class UnionBridge
{
    const string DLL = "UCSAPI40.dll";
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate uint EventHandler(uint terminalId, uint eventType, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectory(string path);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_ServerStart(uint maxTerminal, uint port, ref uint initFlag, EventHandler cb);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_ServerStop();
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetUserInfoListFromTerminal(ushort clientId, uint terminalId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetUserCountFromTerminal(ushort clientId, uint terminalId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetAccessLogFromTerminal(ushort clientId, uint terminalId, uint logType);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetAccessLogFromTerminalEx2(ushort clientId, uint terminalId, uint logType, uint logImage, IntPtr period);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetFirmwareVersionFromTerminal(ushort clientId, uint terminalId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_GetTerminalInfo(uint terminalId, IntPtr info);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_RebootToTerminal(ushort clientId, uint terminalId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_DeleteUserFromTerminal(ushort clientId, uint terminalId, uint userId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_DeleteAllUserFromTerminal(ushort clientId, uint terminalId);
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)] static extern uint UCSAPI_OpenDoorToTerminal(ushort clientId, uint terminalId);

    // Mã sự kiện (UCSAPI_Type.h: UCSAPI_CALLBACK_EVENT = 1600)
    const uint EV = 1600, EV_CONNECTED = EV + 1, EV_DISCONNECTED = EV + 2, EV_REALTIME_LOG = EV + 3, EV_GET_LOG = EV + 4, EV_GET_TIME = EV + 6,
        EV_ADD_USER = EV + 10, EV_DELETE_USER = EV + 11, EV_DELETE_ALL = EV + 12, EV_USER_COUNT = EV + 13, EV_USER_LIST = EV + 14,
        EV_FW_VERSION = EV + 82, EV_OPEN_DOOR = EV + 90, EV_REBOOT = EV + 206;
    const uint LOG_NEW = 0, LOG_ALL = 2, LOG_PERIOD = 3, LOG_NO_IMAGE = 1;
    const uint RESULT_DEFAULT = 0, RESULT_PROCESS = 1;

    static EventHandler callback;   // giữ tham chiếu: SDK gọi lại suốt đời tiến trình, không để bị thu gom
    static readonly object outLock = new object();
    static TextWriter stdout;
    static readonly Encoding ansi = Encoding.Default;

    static void Out(params object[] cols)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < cols.Length; i++) { if (i > 0) sb.Append('\t'); sb.Append(Clean(Convert.ToString(cols[i]))); }
        lock (outLock) { stdout.Write(sb.Append('\n').ToString()); stdout.Flush(); }
    }
    static string Clean(string s) { return s == null ? "" : s.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Replace('\0', ' ').Trim(); }

    // UCSAPI_DATA { UINT32 Length; void* Data } → chuỗi (máy lưu tên dạng byte: thử UTF-8, sai thì theo bảng mã Windows)
    static string DataStr(IntPtr p)
    {
        if (p == IntPtr.Zero) return "";
        int len = Marshal.ReadInt32(p); IntPtr d = Marshal.ReadIntPtr(p, 4);
        if (d == IntPtr.Zero || len <= 0 || len > 4096) return "";
        var b = new byte[len]; Marshal.Copy(d, b, 0, len);
        int n = Array.IndexOf(b, (byte)0); if (n < 0) n = len;
        try { return new UTF8Encoding(false, true).GetString(b, 0, n); } catch { return ansi.GetString(b, 0, n); }
    }
    static uint ErrOf(IntPtr w) { return w == IntPtr.Zero ? 0 : (uint)Marshal.ReadInt32(w, 4); }
    static uint ProgCur(IntPtr w) { return w == IntPtr.Zero ? 0 : (uint)Marshal.ReadInt32(w, 8); }
    static uint ProgTotal(IntPtr w) { return w == IntPtr.Zero ? 0 : (uint)Marshal.ReadInt32(w, 12); }
    // UCSAPI_CALLBACK_PARAM_1 { UINT32 DataType; union { … }* } → con trỏ dữ liệu khi đúng loại
    static IntPtr Param1(IntPtr l, int dataType)
    {
        if (l == IntPtr.Zero || Marshal.ReadInt32(l) != dataType) return IntPtr.Zero;
        return Marshal.ReadIntPtr(l, 4);
    }

    static uint OnEvent(uint tid, uint ev, IntPtr w, IntPtr l)
    {
        try
        {
            switch (ev)
            {
                case EV_CONNECTED:
                    {
                        string ip = "";
                        if (l != IntPtr.Zero) ip = Marshal.ReadByte(l, 3) + "." + Marshal.ReadByte(l, 2) + "." + Marshal.ReadByte(l, 1) + "." + Marshal.ReadByte(l, 0);
                        Out("C", tid, ip);
                        break;
                    }
                case EV_DISCONNECTED: Out("X", tid); break;
                case EV_GET_TIME:
                    {   // máy hỏi giờ khi kết nối → trả giờ máy tính đang chạy phần mềm (UCSAPI_DATE_TIME_INFO)
                        if (l == IntPtr.Zero) break;
                        var now = DateTime.Now;
                        Marshal.WriteInt16(l, 0, (short)now.Year);
                        Marshal.WriteByte(l, 2, (byte)now.Month); Marshal.WriteByte(l, 3, (byte)now.Day);
                        Marshal.WriteByte(l, 4, (byte)now.Hour); Marshal.WriteByte(l, 5, (byte)now.Minute); Marshal.WriteByte(l, 6, (byte)now.Second);
                        Out("T", tid);
                        return RESULT_PROCESS;
                    }
                case EV_REALTIME_LOG:
                case EV_GET_LOG:
                    {
                        IntPtr a = Param1(l, 2);   // UCSAPI_CALLBACK_DATA_TYPE_ACCESS_LOG
                        if (a == IntPtr.Zero) { if (ev == EV_GET_LOG) Out("LE", tid, ErrOf(w)); break; }
                        // UCSAPI_ACCESS_LOG_DATA: UserID@0 · DateTime@4 (Year u16, Month, Day, Hour, Min, Sec) · AuthMode@12 · AuthType@13 · IsAuthorized@16 · RFID*@20 · AuthResult@24
                        uint uid = (uint)Marshal.ReadInt32(a, 0);
                        string t = string.Format("{0:D4}-{1:D2}-{2:D2} {3:D2}:{4:D2}:{5:D2}", (ushort)Marshal.ReadInt16(a, 4), Marshal.ReadByte(a, 6), Marshal.ReadByte(a, 7),
                            Marshal.ReadByte(a, 8), Marshal.ReadByte(a, 9), Marshal.ReadByte(a, 10));
                        Out("L", tid, ev == EV_REALTIME_LOG ? "R" : "G", uid, t, Marshal.ReadByte(a, 12), Marshal.ReadByte(a, 13),
                            Marshal.ReadInt32(a, 16) != 0 ? 1 : 0, (uint)Marshal.ReadInt32(a, 24), DataStr(Marshal.ReadIntPtr(a, 20)), ProgCur(w), ProgTotal(w));
                        break;
                    }
                case EV_USER_LIST:
                    {
                        IntPtr u = Param1(l, 0);   // UCSAPI_CALLBACK_DATA_TYPE_USER_INFO
                        if (u == IntPtr.Zero) { Out("UE", tid, ErrOf(w)); break; }
                        // UCSAPI_USER_INFO: UserID@0 · UserName*@4 · UniqueID*@8 · Property@12 (bit 7 = quản trị)
                        Out("U", tid, (uint)Marshal.ReadInt32(u, 0), DataStr(Marshal.ReadIntPtr(u, 4)), (Marshal.ReadByte(u, 12) & 0x80) != 0 ? 1 : 0,
                            DataStr(Marshal.ReadIntPtr(u, 8)), ProgCur(w), ProgTotal(w));
                        break;
                    }
                case EV_USER_COUNT:
                    {
                        if (l == IntPtr.Zero) { Out("N", tid, ErrOf(w)); break; }
                        // UCSAPI_USER_COUNT: AdminNumber · UserNumber · MaxUser · RegFinger · MaxFinger · RegFace · MaxFace
                        Out("N", tid, ErrOf(w), Marshal.ReadInt32(l, 0), Marshal.ReadInt32(l, 4), Marshal.ReadInt32(l, 8), Marshal.ReadInt32(l, 12),
                            Marshal.ReadInt32(l, 16), Marshal.ReadInt32(l, 20), Marshal.ReadInt32(l, 24));
                        break;
                    }
                case EV_FW_VERSION:
                    Out("V", tid, ErrOf(w), l == IntPtr.Zero ? "" : DataStr(l));
                    break;
                case EV_ADD_USER: case EV_DELETE_USER: case EV_DELETE_ALL: case EV_OPEN_DOOR: case EV_REBOOT:
                    Out("E", tid, ev, ErrOf(w), (ev == EV_ADD_USER || ev == EV_DELETE_USER) ? (uint)l.ToInt32() : 0);
                    break;
            }
        }
        catch (Exception e) { Out("E", tid, ev, "EXC", e.Message); }
        return RESULT_DEFAULT;
    }

    // UCSAPI_DATE_PERIOD { StartDate(Year u16, Month u8, Day u8), EndDate(…) }
    static IntPtr Period(string from, string to)
    {
        DateTime f = DateTime.ParseExact(from, "yyyy-MM-dd", null), t = DateTime.ParseExact(to, "yyyy-MM-dd", null);
        IntPtr p = Marshal.AllocHGlobal(8);
        Marshal.WriteInt16(p, 0, (short)f.Year); Marshal.WriteByte(p, 2, (byte)f.Month); Marshal.WriteByte(p, 3, (byte)f.Day);
        Marshal.WriteInt16(p, 4, (short)t.Year); Marshal.WriteByte(p, 6, (byte)t.Month); Marshal.WriteByte(p, 7, (byte)t.Day);
        return p;
    }

    static uint Run(string cmd, uint tid, string[] c)
    {
        switch (cmd)
        {
            case "users": return UCSAPI_GetUserInfoListFromTerminal(0, tid);
            case "count": return UCSAPI_GetUserCountFromTerminal(0, tid);
            case "newlogs": return UCSAPI_GetAccessLogFromTerminal(0, tid, LOG_NEW);
            case "logs":
                if (c.Length > 4 && c[3] != "" && c[4] != "")
                {
                    IntPtr p = Period(c[3], c[4]);
                    try { return UCSAPI_GetAccessLogFromTerminalEx2(0, tid, LOG_PERIOD, LOG_NO_IMAGE, p); } finally { Marshal.FreeHGlobal(p); }
                }
                return UCSAPI_GetAccessLogFromTerminal(0, tid, LOG_ALL);
            case "fw": return UCSAPI_GetFirmwareVersionFromTerminal(0, tid);
            case "info":
                {   // UCSAPI_TERMINAL_INFO: IP[4]@4 · Firmware(Major, Minor)@16 · ModelNo u16@22 · TerminalType@24 · MAC[6]@25 — trả ngay, không qua sự kiện
                    IntPtr p = Marshal.AllocHGlobal(64);
                    try
                    {
                        for (int i = 0; i < 64; i++) Marshal.WriteByte(p, i, 0);
                        uint r = UCSAPI_GetTerminalInfo(tid, p);
                        if (r == 0)
                        {
                            var mac = new StringBuilder();
                            for (int i = 0; i < 6; i++) mac.Append((i > 0 ? ":" : "") + Marshal.ReadByte(p, 25 + i).ToString("X2"));
                            Out("I", tid, Marshal.ReadByte(p, 4) + "." + Marshal.ReadByte(p, 5) + "." + Marshal.ReadByte(p, 6) + "." + Marshal.ReadByte(p, 7),
                                Marshal.ReadByte(p, 16) + "." + Marshal.ReadByte(p, 17), (ushort)Marshal.ReadInt16(p, 22), Marshal.ReadByte(p, 24), mac);
                        }
                        return r;
                    }
                    finally { Marshal.FreeHGlobal(p); }
                }
            case "reboot": return UCSAPI_RebootToTerminal(0, tid);
            case "deluser": return UCSAPI_DeleteUserFromTerminal(0, tid, uint.Parse(c[3]));
            case "delall": return UCSAPI_DeleteAllUserFromTerminal(0, tid);
            case "opendoor": return UCSAPI_OpenDoorToTerminal(0, tid);
            default: return 0xFFFFFFFF;
        }
    }

    static int Main(string[] args)
    {
        stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        uint port = 9870, max = 256;
        string dllDir = AppDomain.CurrentDomain.BaseDirectory;
        for (int i = 0; i + 1 < args.Length; i += 2)
        {
            if (args[i] == "--port") port = uint.Parse(args[i + 1]);
            else if (args[i] == "--dll") dllDir = args[i + 1];
            else if (args[i] == "--max") max = uint.Parse(args[i + 1]);
        }
        SetDllDirectory(dllDir);
        try { Directory.SetCurrentDirectory(dllDir); } catch { }
        callback = OnEvent;
        uint flag = 0, r;
        try { r = UCSAPI_ServerStart(max, port, ref flag, callback); }
        catch (Exception e) { Out("FAIL", "LOAD", "Không nạp được SDK Union (" + dllDir + "): " + e.Message); return 2; }
        if (r != 0) { Out("FAIL", r.ToString("X"), "Không mở được cổng " + port + " (cổng đang bị chương trình khác dùng?)"); return 3; }
        Out("READY", port);

        // Node đóng stdin (tắt phần mềm / tắt công tắc) → dừng máy chủ rồi thoát
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            var c = line.TrimStart('﻿').Split('\t');
            if (c.Length == 0 || c[0] == "") continue;
            if (c.Length > 1 && c[1] == "quit") break;
            if (c.Length < 3) { Out("A", c[0], "BAD"); continue; }
            uint res;
            try { res = Run(c[1], uint.Parse(c[2]), c); }
            catch (Exception e) { Out("A", c[0], "EXC", e.Message); continue; }
            Out("A", c[0], res == 0xFFFFFFFF ? "BAD" : res.ToString("X"));
        }
        // ServerStop đôi khi chờ máy ngắt lâu → tối đa 3 giây rồi thoát hẳn (nhả cổng cho lần chạy sau)
        new Thread(() => { Thread.Sleep(3000); Environment.Exit(0); }) { IsBackground = true }.Start();
        try { UCSAPI_ServerStop(); } catch { }
        Environment.Exit(0);
        return 0;
    }
}
