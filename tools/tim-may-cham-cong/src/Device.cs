using System;
using System.Net.NetworkInformation;

namespace TimMay
{
    class Device
    {
        public uint Ip;
        public byte[] Mac;
        public string Vendor = "";
        public bool IsZk;
        public bool Port4370, Port8818, Port80;
        public string How = "";
        public DateTime Seen = DateTime.Now;

        public string MacStr { get { return TimMay.Ip.Mac(Mac); } }
        public string IpStr { get { return TimMay.Ip.Str(Ip); } }

        public bool LikelyDevice { get { return IsZk || Port4370 || Port8818; } }

        public string Ports
        {
            get
            {
                var s = new System.Text.StringBuilder();
                if (Port4370) s.Append("4370 ");
                if (Port8818) s.Append("8818 ");
                if (Port80) s.Append("80 ");
                return s.ToString().Trim();
            }
        }

        public string Note
        {
            get
            {
                if (IsZk && Port4370) return "★ Máy chấm công ZKTeco (SDK mở)";
                if (IsZk) return "★ Máy ZKTeco";
                if (Port4370) return "★ Có cổng SDK 4370";
                if (Port8818) return "Có cổng 8818";
                return Vendor;
            }
        }
    }
}
