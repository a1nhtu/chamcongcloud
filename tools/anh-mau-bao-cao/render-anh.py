# TẠO ẢNH MẪU BÁO CÁO — bước 2: chụp file Excel mẫu (bước 1: xuat-excel-mau.mjs) thành ảnh PNG cho nút "Xem mẫu" ở màn Báo cáo.
# Dùng Excel thật (COM, mở 1 phiên Excel RIÊNG, ẩn — không đụng file Anh đang mở) → xuất PDF vùng bảng (1 trang) → PyMuPDF dựng ảnh → cắt lề trắng.
# Chạy: python -I tools/anh-mau-bao-cao/render-anh.py <thư mục xlsx> <thư mục ảnh ra>
import sys, os, glob, io
import win32com.client, pythoncom
import pymupdf as fitz
from PIL import Image, ImageChops

src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
# Chụp ĐỦ mọi cột (khách kéo ngang xem hết các ngày); dòng tối đa MAX_ROWS nhưng không cắt đôi ô gộp (1 nhân viên nhiều dòng).
# Cỡ ảnh theo kích thước thật của vùng bảng (PX_PER_PT điểm ảnh / 1 point Excel) → chữ cùng cỡ ở mọi mẫu, đọc được khi xem 100%.
MAX_ROWS, PX_PER_PT, MAX_W = 70, 1.6, 6000

pythoncom.CoInitialize()
xl = win32com.client.DispatchEx('Excel.Application')
xl.Visible = False
xl.DisplayAlerts = False
xl.ScreenUpdating = False
ok = 0
try:
    for f in sorted(glob.glob(os.path.join(src, '*.xlsx'))):
        name = os.path.splitext(os.path.basename(f))[0]
        pdf = os.path.join(out, name + '.tmp.pdf')
        wb = xl.Workbooks.Open(f, ReadOnly=True)
        try:
            ws = wb.Worksheets(1)
            ur = ws.UsedRange
            last = ur.Row + ur.Rows.Count - 1
            rows = min(last, MAX_ROWS)
            cols = ur.Column + ur.Columns.Count - 1
            # dòng cuối nằm giữa 1 ô gộp (VD 1 nhân viên 6 dòng) → kéo tới hết ô gộp đó
            if rows < last:
                for c in range(1, min(cols, 8) + 1):
                    ma = ws.Cells(rows, c).MergeArea
                    rows = max(rows, ma.Row + ma.Rows.Count - 1)
            rng = ws.Range(ws.Cells(1, 1), ws.Cells(rows, cols))
            want_w = round(rng.Width * PX_PER_PT)
            ps = ws.PageSetup
            ps.PrintArea = rng.Address
            ps.Orientation = 2   # ngang
            ps.Zoom = False
            ps.FitToPagesWide = 1
            ps.FitToPagesTall = 1
            for k in ('LeftMargin', 'RightMargin', 'TopMargin', 'BottomMargin', 'HeaderMargin', 'FooterMargin'):
                setattr(ps, k, 10)
            ps.CenterHeader = ps.CenterFooter = ps.LeftFooter = ps.RightFooter = ''
            ws.ExportAsFixedFormat(0, pdf, IgnorePrintAreas=False, OpenAfterPublish=False)
        finally:
            wb.Close(SaveChanges=False)
        doc = fitz.open(pdf)
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(4, 4), alpha=False)   # dựng nét rồi thu về đúng cỡ
        doc.close()
        os.remove(pdf)
        im = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
        bbox = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).getbbox()
        if bbox:
            im = im.crop((max(0, bbox[0] - 12), max(0, bbox[1] - 12), min(im.width, bbox[2] + 12), min(im.height, bbox[3] + 12)))
        w = min(MAX_W, want_w + 24)
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im = im.quantize(colors=128, method=Image.Quantize.MEDIANCUT)   # bảng ít màu → PNG nhẹ
        im.save(os.path.join(out, name + '.png'), optimize=True)
        ok += 1
        print('anh', name, im.size)
finally:
    xl.Quit()
print('Xong', ok, 'anh ->', out)
