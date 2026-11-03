// MẪU BÁO CÁO RIÊNG của từng công ty — dựa trên 1 báo cáo DẠNG BẢNG có sẵn, chỉ lưu CÁCH TRÌNH BÀY trong CSDL của công ty đó:
// cột nào hiện, thứ tự, tên cột, tiêu đề, cột công thức. Số liệu vẫn do báo cáo gốc (routes/reports.js) tính → bản cập nhật
// sửa / cải tiến báo cáo gốc thì mẫu riêng hưởng luôn; cột gốc nào bản mới bỏ đi thì mẫu riêng bỏ qua cột đó (không lỗi).
// Máy chủ nhiều công ty: mỗi công ty (tên miền) 1 CSDL riêng → mẫu của công ty A chỉ công ty A thấy.
// Chưa có mẫu riêng nào (mặc định) → trang Báo cáo y như cũ. Chỉ tài khoản tổng tạo / sửa / xoá (routes/admin/custom-reports.js).
import { db } from './db.js';
import { parseFormula, evalFormula } from './pay-formula.js';

// Báo cáo gốc dùng được: dạng bảng cột chung (xem + xuất Excel cùng một đường). Báo cáo ma trận có cách xuất Excel riêng,
// bảng lương, công ảo, giờ sửa tay → không làm gốc.
export const CR_BASES = [
  ['summary', 'Tổng hợp nhân viên'], ['absence', 'Vắng mặt / nghỉ phép'], ['leave', 'Nghỉ phép / đơn từ'],
  ['horizontal', 'Bảng công ngang'], ['symbol', 'Bảng ký hiệu / Thống kê tháng'],
  ['detail', 'Chi tiết theo ngày'], ['detaillist', 'Chi tiết chấm công (danh sách)'], ['detailmulti', 'Chi tiết chấm công (nhiều lần vào/ra)'],
  ['attendance', 'Bản ghi chấm công'], ['late', 'Đi muộn / về sớm'], ['ot', 'Tăng ca'], ['firstlast', 'Giờ vào & ra đầu/cuối'],
];
const BASE_SET = new Set(CR_BASES.map(([t]) => t));

// Mã loại báo cáo của mẫu riêng: 'cr' + id (VD cr3)
export const crType = (id) => 'cr' + id;
export const crId = (type) => { const m = /^cr(\d+)$/.exec(String(type || '')); return m ? +m[1] : null; };

export const DAYS_KEY = '@days';                      // gộp mọi cột ngày (d2026-10-01 …) thành 1 mục
const DAY_RE = /^d\d{4}-\d\d-\d\d$/;
export const PAIR_BASE = ['cin', 'cout', 'inReal', 'outReal'];   // cột giờ vào/ra tách theo lần chấm (cin_1, cin_2 …) khi nhiều lần vào/ra
const pairOf = (key) => { const m = /^(.+)_(\d+)$/.exec(key); return m && PAIR_BASE.includes(m[1]) ? m : null; };

const parseCols = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const rowOut = (r) => ({ id: r.id, name: r.name, base: r.base, title: r.title, cols: parseCols(r.cols), updated_at: r.updated_at });

export function listCustom() {
  return db.prepare('SELECT * FROM custom_reports ORDER BY sort_order, id').all().map(rowOut);
}
export function getCustom(id) {
  const r = db.prepare('SELECT * FROM custom_reports WHERE id = ?').get(+id);
  return r ? rowOut(r) : null;
}

// Kiểm tra + chuẩn hoá danh sách cột. Mỗi mục: { key, label? } (cột gốc, label '' = giữ tên gốc) · { key: '@days' } · { key: 'cf1', label, f: '=…' }
function cleanCols(cols) {
  if (!Array.isArray(cols) || !cols.length) throw new Error('Chọn ít nhất 1 cột cho mẫu');
  if (cols.length > 300) throw new Error('Mẫu có quá nhiều cột');
  const out = [], seen = new Set();
  let n = 0;
  for (const c of cols) {
    const label = String(c?.label ?? '').trim().slice(0, 80);
    if (c && c.f != null) {
      const f = String(c.f).trim();
      if (!f) throw new Error(`Cột công thức "${label || '(chưa đặt tên)'}" chưa có công thức`);
      if (!label) throw new Error('Cột công thức phải có tên cột');
      try { parseFormula(f.replace(/^=/, '')); } catch (e) { throw new Error(`Công thức cột "${label}": ${e.message}`); }
      out.push({ key: 'cf' + (++n), label, f });
      continue;
    }
    const key = String(c?.key ?? '').trim();
    if (!key || key.length > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push(key === DAYS_KEY ? { key } : { key, label });
  }
  if (!out.length) throw new Error('Chọn ít nhất 1 cột cho mẫu');
  return out;
}

export function saveCustom(b) {
  const name = String(b.name || '').trim().slice(0, 100);
  if (!name) throw new Error('Nhập tên mẫu báo cáo');
  const base = String(b.base || '');
  if (!BASE_SET.has(base)) throw new Error('Báo cáo gốc không dùng được cho mẫu riêng');
  const title = String(b.title || '').trim().slice(0, 150);
  const cols = JSON.stringify(cleanCols(b.cols));
  if (b.id) {
    const r = db.prepare("UPDATE custom_reports SET name = ?, base = ?, title = ?, cols = ?, updated_at = datetime('now') WHERE id = ?").run(name, base, title, cols, +b.id);
    if (!r.changes) throw new Error('Không tìm thấy mẫu báo cáo');
    return getCustom(+b.id);
  }
  const id = Number(db.prepare('INSERT INTO custom_reports(name, base, title, cols) VALUES (?,?,?,?)').run(name, base, title, cols).lastInsertRowid);
  return getCustom(id);
}

export function deleteCustom(id) {
  return db.prepare('DELETE FROM custom_reports WHERE id = ?').run(+id).changes > 0;
}

// Số trong ô báo cáo (công thức): số giữ nguyên; chuỗi số "8,5" / "8.5" → 8.5; còn lại (giờ "08:00", ký hiệu…) → 0
const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : 0;
};
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Áp mẫu riêng lên kết quả báo cáo gốc { title, columns, rows } → { title, columns, rows } (thuần, không CSDL).
 *  - cột gốc theo đúng thứ tự mẫu, đổi tên nếu mẫu đặt tên; cột không còn trong báo cáo gốc → bỏ qua
 *  - '@days' → mọi cột ngày của kỳ đang xem
 *  - cột giờ vào / ra bị tách theo lần chấm (cin_1, cin_2 …) → mẫu chọn 'cin' là hiện đủ các cột tách
 *  - cột công thức: biến = mã cột gốc (VD =cong*8 + ot) hoặc mã cột công thức đứng trước (cf1); lỗi khi tính → ô trống
 */
export function applyTemplate(rep, tpl) {
  const byKey = new Map(rep.columns.map((c) => [c.key, c]));
  const cols = [], formulas = [];
  for (const it of tpl.cols) {
    if (it.f != null) {
      let ast = null; try { ast = parseFormula(String(it.f).replace(/^=/, '')); } catch {}
      cols.push({ key: it.key, label: it.label, w: 14 }); formulas.push({ key: it.key, ast });
      continue;
    }
    if (it.key === DAYS_KEY) { cols.push(...rep.columns.filter((c) => DAY_RE.test(c.key))); continue; }
    const c = byKey.get(it.key);
    if (c) { cols.push(it.label ? { ...c, label: it.label } : c); continue; }
    const split = rep.columns.filter((x) => { const m = pairOf(x.key); return m && m[1] === it.key; });
    cols.push(...(it.label ? split.map((x) => ({ ...x, label: `${it.label} ${pairOf(x.key)[2]}` })) : split));
  }
  const rows = !formulas.length ? rep.rows : rep.rows.map((r) => {
    if (r._off) return r;   // dòng ngày không đi làm (ô "Hiện cả ngày không đi làm"): cột công thức cũng để trống
    const vars = {};
    for (const [k, v] of Object.entries(r)) vars[k.toUpperCase()] = toNum(v);   // bộ tính công thức đọc tên biến IN HOA (không phân biệt hoa / thường)
    const out = { ...r };
    for (const { key, ast } of formulas) {
      let v = '';
      if (ast) { try { const x = evalFormula(ast, vars); v = typeof x === 'number' && Number.isFinite(x) ? round2(x) : x; } catch { v = ''; } }
      out[key] = v; vars[key.toUpperCase()] = toNum(v);
    }
    return out;
  });
  return { title: rep.title, columns: cols, rows };
}
