# TẠO ẢNH MẪU BÁO CÁO — bước 2: chụp file Excel mẫu (bước 1: xuat-excel-mau.mjs) thành ảnh PNG cho nút "Xem mẫu" ở màn Báo cáo.
# Dùng Excel thật (COM, mở 1 phiên Excel RIÊNG, ẩn — không đụng file Anh đang mở) → xuất PDF vùng góc trên trái → PyMuPDF dựng ảnh → cắt lề trắng.
# Chạy: python -I tools/anh-mau-bao-cao/render-anh.py <thư mục xlsx> <thư mục ảnh ra>
import sys, os, glob, io
import win32com.client, pythoncom
import fitz
from PIL import Image, ImageChops

src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
MAX_ROWS, MAX_COLS, MAX_W = 26, 22, 1500   # góc trên trái đủ thấy kiểu bảng; ảnh rộng tối đa 1500 px

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
            rows = min(ur.Row + ur.Rows.Count - 1, MAX_ROWS)
            cols = min(ur.Column + ur.Columns.Count - 1, MAX_COLS)
            rng = ws.Range(ws.Cells(1, 1), ws.Cells(rows, cols))
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
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.2, 2.2), alpha=False)
        doc.close()
        os.remove(pdf)
        im = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
        bbox = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).getbbox()
        if bbox:
            im = im.crop((max(0, bbox[0] - 12), max(0, bbox[1] - 12), min(im.width, bbox[2] + 12), min(im.height, bbox[3] + 12)))
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        im = im.quantize(colors=128, method=Image.Quantize.MEDIANCUT)   # bảng ít màu → PNG nhẹ
        im.save(os.path.join(out, name + '.png'), optimize=True)
        ok += 1
        print('anh', name, im.size)
finally:
    xl.Quit()
print('Xong', ok, 'anh ->', out)
