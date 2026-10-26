using System.Collections.Generic;

namespace TimMay
{
    // Nhận diện hãng theo 3 byte đầu MAC (OUI). Chỉ cần đủ để đánh dấu máy chấm công.
    static class Oui
    {
        // ZKTeco dùng nhiều dải; "00:17:61" là dải phổ biến nhất trên Ronald Jack / ZKTeco ở VN
        static readonly Dictionary<string, string> Zk = new Dictionary<string, string>
        {
            { "001761", "ZKTeco" }, { "0017A1", "ZKTeco" }, { "00661B", "ZKTeco" },
            { "68175A", "ZKTeco" }, { "F44932", "ZKTeco" }, { "88A9A7", "ZKTeco" },
            { "341513", "ZKTeco" }, { "607EA4", "ZKTeco" }
        };

        static readonly Dictionary<string, string> Other = new Dictionary<string, string>
        {
            { "000C43", "Ralink (máy chấm công Hồng Ngoại/Hikvision OEM)" },
            { "44190B", "Suprema" }, { "0017FB", "Suprema" },
            { "4CBD8F", "Anviz" }, { "001D94", "Anviz" },
            { "BCAD28", "Hikvision" }, { "C056E3", "Hikvision" }, { "44A642", "Hikvision" }, { "283933", "Hikvision" },
            { "001018", "Broadcom" }
        };

        public static string Vendor(byte[] mac, out bool isZk)
        {
            isZk = false;
            if (mac == null || mac.Length < 3) return "";
            string p = mac[0].ToString("X2") + mac[1].ToString("X2") + mac[2].ToString("X2");
            if (Zk.ContainsKey(p)) { isZk = true; return "ZKTeco / Ronald Jack"; }
            string v;
            if (Other.TryGetValue(p, out v)) return v;
            if ((mac[0] & 0x02) != 0) return "(MAC ngẫu nhiên/ảo)";
            return "";
        }

        public static bool LikelyZk(byte[] mac, bool port4370Open, bool port8818Open)
        {
            bool isZk;
            Vendor(mac, out isZk);
            return isZk || port4370Open || port8818Open;
        }
    }
}
