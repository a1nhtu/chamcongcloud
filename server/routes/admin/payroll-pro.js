// Nhóm route TIỀN LƯƠNG NÂNG CAO (/admin/pay/*) — sau công tắc pay_pro (mặc định TẮT → 403) + quyền "Bảng lương".
// Duyệt / chốt / mở khoá khi bật "Gửi duyệt": quyền "Duyệt bảng lương" (pay_approve). Mọi thao tác ghi đã có nhật ký (auditMiddleware).
import { db, getSetting } from '../../db.js';
import { hasPerm } from '../../auth.js';
import { sendCaughtError } from '../../util.js';
import { notifyEmployee } from '../../push.js';
import * as P from '../../payroll-pro.js';
import { DEFAULT_PARAMS, SYSTEM_VARS, RESULT_CODES, COMP_TYPES, COMP_KINDS, COMP_GROUPS, insuranceCalc, progressiveTax, regionMin, siCap, uiCap } from '../../pay-rules.js';
import { checkFormula, parseFormula, evalFormula, FORMULA_FUNCS } from '../../pay-formula.js';
import { ExcelJS, sendXlsx, tableSheet, readFirstSheet, findHeader, normText, cellText, parseMoneyCell, parseDateCell } from '../../pay-xlsx.js';

const who = (req) => req.user?.full_name || req.user?.username || 'Quản lý';
// lỗi người dùng (userError, status 4xx) → trả đúng câu; lỗi khác → ẩn chi tiết
const wrap = (name, fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e && (e.userFacing || e.user)) return res.status(e.status || 400).json({ error: e.message });
    sendCaughtError(res, name, e);
  }
};
const ids = (a) => (Array.isArray(a) ? a.map(Number).filter(Boolean) : []);
const pdisp = (p) => `${p.slice(5)}/${p.slice(0, 4)}`;
const company = () => getSetting('company_name', '');

export function registerPayProRoutes(r, { need }) {
  const pay = [P.payGate, need('salary')];
  const canApprove = (req) => hasPerm(req.user, 'pay_approve');
  const needApprove = (req, res, next) => (canApprove(req) ? next() : res.status(403).json({ error: 'Cần quyền "Duyệt / chốt bảng lương"' }));

  /* ------------------------------ danh mục + cài đặt ------------------------------ */
  r.get('/pay/meta', pay, (req, res) => {
    const p = P.getParams();
    res.json({
      flags: P.payFlags(), flag_keys: P.FLAG_KEYS.map(([k, d, label]) => ({ key: k, def: d, label })),
      params: p, defaults: DEFAULT_PARAMS, caps: { si: siCap(p), ui: uiCap(p), region_min: regionMin(p) },
      comp_types: COMP_TYPES, comp_kinds: COMP_KINDS, comp_groups: COMP_GROUPS, system_vars: SYSTEM_VARS, result_codes: RESULT_CODES, funcs: FORMULA_FUNCS,
      hr_enabled: getSetting('hr_enabled', '0') === '1', can_approve: canApprove(req), company: company(),
      pay_period_start_day: getSetting('pay_period_start_day', '1'),
    });
  });
  r.put('/pay/settings', pay, wrap('PUT /admin/pay/settings', (req, res) => {
    const b = req.body || {};
    P.saveFlags(b);
    const p = b.params ? P.saveParams(b.params) : P.getParams();
    res.json({ ok: true, flags: P.payFlags(), params: p });
  }));
  // Thử nhanh BH + thuế với 1 mức lương (trang Thông số)
  r.post('/pay/calc-test', pay, (req, res) => {
    const b = req.body || {};
    const p = b.params ? { ...P.getParams(), ...b.params } : P.getParams();
    const gross = Math.max(0, +b.gross || 0), insSal = Math.max(0, +b.ins_salary || gross), deps = Math.max(0, parseInt(b.dependents, 10) || 0);
    const ins = insuranceCalc(insSal, p, { on: true });
    const family = p.self_deduct + deps * p.dep_deduct;
    const assessable = Math.max(0, gross - ins.emp_total - family);
    const tax = progressiveTax(assessable, p.brackets);
    res.json({ ins, family, assessable, tax, net: gross - ins.emp_total - tax });
  });

  /* ------------------------------ hồ sơ lương ------------------------------ */
  r.get('/pay/profiles', pay, (req, res) => res.json({ rows: P.listProfiles() }));
  r.put('/pay/profiles/:empId', pay, wrap('PUT /admin/pay/profiles', (req, res) => {
    const eid = +req.params.empId;
    if (!db.prepare('SELECT id FROM employees WHERE id = ?').get(eid)) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    P.saveProfile(eid, req.body || {});
    res.json({ ok: true });
  }));
  r.post('/pay/profiles/bulk', pay, wrap('POST /admin/pay/profiles/bulk', (req, res) => {
    const list = ids(req.body?.ids);
    if (!list.length) return res.status(400).json({ error: 'Chọn nhân viên' });
    const { ids: _, ...fields } = req.body || {};
    db.exec('BEGIN');
    try { for (const id of list) P.saveProfile(id, fields); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true, n: list.length });
  }));
  r.post('/pay/profiles/from-contracts', pay, wrap('POST /admin/pay/profiles/from-contracts', async (req, res) => {
    res.json(await P.syncFromContracts(ids(req.body?.ids)));
  }));

  /* ------------------------------ thành phần lương ------------------------------ */
  r.get('/pay/components', pay, (req, res) => res.json({ rows: P.listComponents() }));
  r.post('/pay/components', pay, wrap('POST /admin/pay/components', (req, res) => res.json({ ok: true, row: P.saveComponent(0, req.body || {}) })));
  r.put('/pay/components/:id', pay, wrap('PUT /admin/pay/components', (req, res) => res.json({ ok: true, row: P.saveComponent(+req.params.id, req.body || {}) })));
  r.delete('/pay/components/:id', pay, wrap('DELETE /admin/pay/components', (req, res) => res.json({ ok: true, ...P.deleteComponent(+req.params.id) })));
  r.post('/pay/components/samples', pay, wrap('POST /admin/pay/components/samples', (req, res) => res.json({ ok: true, added: P.createSamples() })));
  r.get('/pay/components/:id/assign', pay, (req, res) => res.json({ rows: P.compAssignments(+req.params.id) }));
  r.put('/pay/components/:id/assign', pay, wrap('PUT /admin/pay/components/assign', (req, res) => {
    P.saveAssignments(+req.params.id, Array.isArray(req.body?.rows) ? req.body.rows : [], { replace: !!req.body?.replace });
    res.json({ ok: true });
  }));
  // Kiểm tra công thức; có employee_id + period → tính thử cho NV đó
  r.post('/pay/formula/check', pay, wrap('POST /admin/pay/formula/check', (req, res) => {
    const b = req.body || {};
    const known = new Set([...SYSTEM_VARS.map(([k]) => k), ...db.prepare('SELECT code FROM pay_components').all().map((c) => c.code), String(b.code || '').toUpperCase()]);
    const ck = checkFormula(b.formula, known);
    if (!ck.ok || !b.employee_id || !b.period) return res.json(ck);
    const data = P.computeProRows(P.needPeriod(b.period), { ids: [+b.employee_id] });
    const row = data.rows[0];
    if (!row) return res.json({ ...ck, test: null, test_error: 'Nhân viên không có trong kỳ lương này' });
    const v = evalFormula(parseFormula(b.formula), { ...row.slip.vars, ...row.slip.comp });
    res.json({ ...ck, test: v, vars: Object.fromEntries(ck.vars.map((k) => [k, row.slip.vars[k] ?? row.slip.comp[k] ?? 0])) });
  }));

  /* ------------------------------ dữ liệu theo kỳ ------------------------------ */
  r.get('/pay/period-items', pay, wrap('GET /admin/pay/period-items', (req, res) => {
    const period = P.needPeriod(req.query.period);
    const comps = P.listComponents({ activeOnly: true });
    res.json({ period, comps, items: P.periodItems(period), employees: P.listProfiles().map((e) => ({ id: e.employee_id, code: e.code, full_name: e.full_name, department: e.department })) });
  }));
  r.put('/pay/period-items', pay, wrap('PUT /admin/pay/period-items', (req, res) => {
    const b = req.body || {};
    P.savePeriodItems(P.needPeriod(b.period), Array.isArray(b.cells) ? b.cells : [], who(req));
    res.json({ ok: true });
  }));
  r.get('/pay/period-items/template.xlsx', pay, wrap('GET /admin/pay/period-items/template', async (req, res) => {
    const period = P.needPeriod(req.query.period);
    const comps = P.listComponents({ activeOnly: true }).filter((c) => c.value_type === 'input' || req.query.all === '1');
    const emps = P.listProfiles();
    const items = new Map(P.periodItems(period).map((i) => [`${i.employee_id}:${i.component_id}`, i.amount]));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DuLieuKy');
    ws.addRow(['Mã NV', 'Họ tên', 'Bộ phận', ...comps.map((c) => `${c.name} (${c.code})`)]);
    for (const e of emps) ws.addRow([e.code, e.full_name, e.department || '', ...comps.map((c) => items.get(`${e.employee_id}:${c.id}`) ?? null)]);
    const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.height = 32;
    h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; });
    ws.getColumn(1).width = 12; ws.getColumn(1).numFmt = '@'; ws.getColumn(2).width = 26; ws.getColumn(3).width = 18;
    comps.forEach((c, i) => { ws.getColumn(4 + i).width = 18; ws.getColumn(4 + i).numFmt = '#,##0'; });
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    await sendXlsx(res, wb, `du_lieu_luong_${period}.xlsx`);
  }));
  r.post('/pay/period-items/import', pay, wrap('POST /admin/pay/period-items/import', async (req, res) => {
    const period = P.needPeriod(req.body?.period);
    const rows = await readFirstSheet(req.body?.fileBase64);
    const hm = findHeader(rows);
    if (!hm) return res.status(400).json({ error: 'Không thấy cột "Mã NV" ở dòng tiêu đề — dùng file mẫu tải từ phần mềm' });
    const comps = P.listComponents({ activeOnly: true });
    const colComp = new Map();
    for (const [j, t] of hm.cols) {
      if (j === hm.codeCol) continue;
      const m = /\(([A-Z][A-Z0-9_]+)\)\s*$/.exec(t);
      const c = comps.find((x) => (m && x.code === m[1]) || x.code === t.toUpperCase() || normText(x.name) === normText(t));
      if (c) colComp.set(j, c);
    }
    if (!colComp.size) return res.status(400).json({ error: 'Không thấy cột thành phần lương nào (tiêu đề phải là tên hoặc mã thành phần đang dùng)' });
    const byCode = new Map(db.prepare('SELECT id, code FROM employees').all().map((e) => [normText(e.code), e.id]));
    const cells = [], miss = [];
    for (let i = hm.headerRow + 1; i < rows.length; i++) {
      const v = rows[i]; if (!v) continue;
      const code = cellText(v[hm.codeCol]); if (!code) continue;
      const eid = byCode.get(normText(code));
      if (!eid) { if (miss.length < 20) miss.push(code); continue; }
      for (const [j, c] of colComp) {
        const raw = cellText(v[j]);
        if (raw === '') continue;
        cells.push({ employee_id: eid, component_id: c.id, amount: parseMoneyCell(v[j]) });
      }
    }
    P.savePeriodItems(period, cells, who(req));
    res.json({ ok: true, cells: cells.length, columns: [...colComp.values()].map((c) => c.name), missing: miss });
  }));

  /* ------------------------------ tạm ứng ------------------------------ */
  r.get('/pay/advances', pay, wrap('GET /admin/pay/advances', (req, res) => res.json({ rows: P.listAdvances(P.needPeriod(req.query.period)) })));
  r.post('/pay/advances', pay, wrap('POST /admin/pay/advances', (req, res) => res.json({ ok: true, id: P.saveAdvance(0, req.body || {}, who(req)) })));
  r.put('/pay/advances/:id', pay, wrap('PUT /admin/pay/advances', (req, res) => res.json({ ok: true, id: P.saveAdvance(+req.params.id, req.body || {}, who(req)) })));
  r.delete('/pay/advances/:id', pay, wrap('DELETE /admin/pay/advances', (req, res) => { P.deleteAdvance(+req.params.id); res.json({ ok: true }); }));
  r.post('/pay/advances/bulk', pay, wrap('POST /admin/pay/advances/bulk', (req, res) => res.json({ ok: true, n: P.bulkAdvance(req.body || {}, who(req)) })));
  r.post('/pay/advances/import', pay, wrap('POST /admin/pay/advances/import', async (req, res) => {
    const period = P.needPeriod(req.body?.period);
    const rows = await readFirstSheet(req.body?.fileBase64);
    const hm = findHeader(rows);
    if (!hm) return res.status(400).json({ error: 'Không thấy cột "Mã NV" ở dòng tiêu đề' });
    const col = (re) => [...hm.cols].find(([, t]) => re.test(normText(t)))?.[0];
    const cAmt = col(/^so tien|^tam ung/), cDate = col(/^ngay/), cNote = col(/^ghi chu|^noi dung/);
    if (!cAmt) return res.status(400).json({ error: 'Thiếu cột "Số tiền"' });
    const byCode = new Map(db.prepare('SELECT id, code FROM employees').all().map((e) => [normText(e.code), e.id]));
    let n = 0; const miss = [];
    db.exec('BEGIN');
    try {
      for (let i = hm.headerRow + 1; i < rows.length; i++) {
        const v = rows[i]; if (!v) continue;
        const code = cellText(v[hm.codeCol]); if (!code) continue;
        const eid = byCode.get(normText(code));
        const amount = parseMoneyCell(v[cAmt]);
        if (!eid) { if (miss.length < 20) miss.push(code); continue; }
        if (!amount) continue;
        P.saveAdvance(0, { employee_id: eid, period, amount, adv_date: cDate ? parseDateCell(v[cDate]) || '' : '', note: cNote ? cellText(v[cNote]) : '' }, who(req));
        n++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true, n, missing: miss });
  }));
  r.get('/pay/advances/template.xlsx', pay, wrap('GET /admin/pay/advances/template', async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('TamUng');
    ws.addRow(['Mã NV', 'Họ tên', 'Số tiền', 'Ngày ứng', 'Ghi chú']);
    for (const e of P.listProfiles()) ws.addRow([e.code, e.full_name, null, '', '']);
    ws.getRow(1).font = { bold: true }; ws.getColumn(1).numFmt = '@'; ws.getColumn(2).width = 26; ws.getColumn(3).numFmt = '#,##0'; ws.getColumn(3).width = 16; ws.getColumn(4).width = 14; ws.getColumn(5).width = 30;
    await sendXlsx(res, wb, 'mau_tam_ung.xlsx');
  }));

  /* ------------------------------ mẫu bảng lương ------------------------------ */
  r.get('/pay/templates', pay, (req, res) => res.json({ rows: P.listTemplates(), catalog: P.columnCatalog() }));
  r.post('/pay/templates', pay, wrap('POST /admin/pay/templates', (req, res) => res.json({ ok: true, id: P.saveTemplate(0, req.body || {}) })));
  r.put('/pay/templates/:id', pay, wrap('PUT /admin/pay/templates', (req, res) => res.json({ ok: true, id: P.saveTemplate(+req.params.id, req.body || {}) })));
  r.delete('/pay/templates/:id', pay, wrap('DELETE /admin/pay/templates', (req, res) => { P.deleteTemplate(+req.params.id); res.json({ ok: true }); }));

  /* ------------------------------ bảng lương ------------------------------ */
  r.get('/pay/sheets', pay, (req, res) => res.json({ rows: P.listSheets(req.query.period || null), flags: P.payFlags(), can_approve: canApprove(req) }));
  r.post('/pay/sheets', pay, wrap('POST /admin/pay/sheets', (req, res) => res.json({ ok: true, id: P.createSheet(req.body || {}, who(req), { compute: false }) })));
  r.get('/pay/sheets/:id', pay, wrap('GET /admin/pay/sheets/:id', (req, res) => res.json({ ...P.sheetDetail(+req.params.id), can_approve: canApprove(req), company: company() })));
  r.post('/pay/sheets/:id/compute', pay, wrap('POST /admin/pay/sheets/compute', (req, res) => res.json({ ok: true, totals: P.computeSheet(+req.params.id) })));
  r.put('/pay/sheets/:id', pay, wrap('PUT /admin/pay/sheets', (req, res) => { P.renameSheet(+req.params.id, req.body?.name); res.json({ ok: true }); }));
  r.delete('/pay/sheets/:id', pay, wrap('DELETE /admin/pay/sheets', (req, res) => { P.deleteSheet(+req.params.id); res.json({ ok: true }); }));
  r.post('/pay/sheets/:id/send', pay, wrap('POST /admin/pay/sheets/send', (req, res) => {
    if (!P.payFlags().approve) return res.status(400).json({ error: 'Chưa bật "Gửi duyệt bảng lương" — bấm Chốt bảng lương' });
    P.sendSheet(+req.params.id, who(req)); res.json({ ok: true });
  }));
  // Chốt: bật Gửi duyệt → chỉ người có quyền Duyệt; tắt Gửi duyệt → người có quyền Bảng lương chốt thẳng
  r.post('/pay/sheets/:id/lock', pay, wrap('POST /admin/pay/sheets/lock', (req, res) => {
    const f = P.payFlags();
    if (f.approve && !canApprove(req)) return res.status(403).json({ error: 'Cần quyền "Duyệt / chốt bảng lương"' });
    P.lockSheet(+req.params.id, who(req), { approve: f.approve }); res.json({ ok: true });
  }));
  r.post('/pay/sheets/:id/reject', pay, needApprove, wrap('POST /admin/pay/sheets/reject', (req, res) => { P.rejectSheet(+req.params.id, req.body?.note, who(req)); res.json({ ok: true }); }));
  r.post('/pay/sheets/:id/unlock', pay, (req, res, next) => (P.payFlags().approve ? needApprove(req, res, next) : next()),
    wrap('POST /admin/pay/sheets/unlock', (req, res) => { P.unlockSheet(+req.params.id); res.json({ ok: true }); }));
  r.post('/pay/sheets/:id/publish', pay, wrap('POST /admin/pay/sheets/publish', (req, res) => {
    if (!P.payFlags().app_slip) return res.status(400).json({ error: 'Chưa bật "Nhân viên xem phiếu lương trên app" (Lương › Thông số)' });
    const on = req.body?.on !== false;
    const emps = P.publishSheet(+req.params.id, on);
    if (on && req.body?.notify !== false) {
      const s = P.getSheet(+req.params.id);
      for (const eid of emps) notifyEmployee(eid, { title: 'Phiếu lương', body: `Đã có phiếu lương tháng ${pdisp(s.period)}. Mở app để xem.`, url: '/' }).catch(() => {});
    }
    res.json({ ok: true, n: emps.length });
  }));
  r.post('/pay/sheets/:id/paid', pay, wrap('POST /admin/pay/sheets/paid', (req, res) => { P.markPaid(+req.params.id, ids(req.body?.ids), req.body?.paid !== false); res.json({ ok: true }); }));
  r.post('/pay/sheets/:id/reply', pay, wrap('POST /admin/pay/sheets/reply', (req, res) => {
    P.replyFeedback(+req.params.id, +req.body?.employee_id, req.body?.reply);
    if (req.body?.employee_id) notifyEmployee(+req.body.employee_id, { title: 'Phản hồi phiếu lương', body: String(req.body.reply || '').slice(0, 120), url: '/' }).catch(() => {});
    res.json({ ok: true });
  }));
  r.get('/pay/feedback', pay, (req, res) => res.json({ rows: P.feedbackList() }));

  r.get('/pay/sheets/:id/export.xlsx', pay, wrap('GET /admin/pay/sheets/export', async (req, res) => {
    const { sheet, rows } = P.sheetDetail(+req.params.id);
    const wb = new ExcelJS.Workbook();
    tableSheet(wb, 'BangLuong', {
      company: company(), title: sheet.name.toUpperCase(),
      subtitle: `Kỳ lương ${sheet.from_date.split('-').reverse().join('/')} – ${sheet.to_date.split('-').reverse().join('/')} · ${sheet.status === 'locked' ? 'ĐÃ CHỐT' : sheet.status === 'pending' ? 'CHỜ DUYỆT' : 'NHÁP'}`,
      cols: sheet.columns, rows: rows.map((r) => r.cells), freeze: 3,
    });
    await sendXlsx(res, wb, `bang_luong_${sheet.period}_${sheet.id}.xlsx`);
  }));
  r.get('/pay/sheets/:id/bank.xlsx', pay, wrap('GET /admin/pay/sheets/bank', async (req, res) => {
    const { sheet, rows } = P.bankRows(+req.params.id);
    const content = String(req.query.content || `Luong thang ${pdisp(sheet.period)}`).slice(0, 120);
    const list = rows.filter((r) => r.net > 0).map((r) => ({ ...r, content: `${content} ${r.code}` }));
    const wb = new ExcelJS.Workbook();
    tableSheet(wb, 'ChuyenKhoan', {
      company: company(), title: 'DANH SÁCH CHUYỂN KHOẢN LƯƠNG', subtitle: `${sheet.name} · ${list.length} người · ${list.filter((r) => !r.bank_account).length} người chưa có số tài khoản`,
      cols: [{ key: 'code', label: 'Mã NV', type: 'text' }, { key: 'bank_holder', label: 'Tên chủ tài khoản', type: 'text' }, { key: 'bank_account', label: 'Số tài khoản', type: 'text' },
        { key: 'bank_name', label: 'Ngân hàng', type: 'text' }, { key: 'net', label: 'Số tiền', type: 'money' }, { key: 'content', label: 'Nội dung', type: 'text' }],
      rows: list, freeze: 2,
    });
    await sendXlsx(res, wb, `chuyen_khoan_luong_${sheet.period}.xlsx`);
  }));

  /* ------------------------------ báo cáo ------------------------------ */
  const REPORTS = {
    year: (q) => {
      const d = P.reportYear(q.year);
      const MM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
      const field = ['income', 'net', 'tax', 'ins'].includes(q.field) ? q.field : 'income';
      const label = { income: 'Tổng thu nhập', net: 'Thực lĩnh', tax: 'Thuế TNCN', ins: 'BH + đoàn phí NLĐ' }[field];
      const rows = d.rows.map((e) => {
        const o = { code: e.code, full_name: e.full_name, department: e.department };
        let t = 0;
        for (const m of MM) { const v = e.months[m]?.[field] || 0; o['m' + m] = v || null; t += v; }
        o.total = t;
        return o;
      });
      return { title: `TỔNG HỢP ${label.toUpperCase()} NĂM ${d.year}`, file: `tong_hop_thu_nhap_${d.year}`, rows,
        cols: [{ key: 'code', label: 'Mã NV', type: 'text' }, { key: 'full_name', label: 'Họ tên', type: 'text' }, { key: 'department', label: 'Bộ phận', type: 'text' },
          ...MM.map((m) => ({ key: 'm' + m, label: 'T' + +m, type: 'money' })), { key: 'total', label: 'Cả năm', type: 'money' }] };
    },
    insurance: (q) => {
      const d = P.reportInsurance(P.needPeriod(q.period));
      return { title: `BẢNG TRÍCH NỘP BẢO HIỂM THÁNG ${pdisp(d.period)}`, file: `bao_hiem_${d.period}`, rows: d.rows,
        cols: [{ key: 'code', label: 'Mã NV', type: 'text' }, { key: 'full_name', label: 'Họ tên', type: 'text' }, { key: 'department', label: 'Bộ phận', type: 'text' },
          { key: 'base_si', label: 'Lương đóng BHXH', type: 'money' }, { key: 'bhxh', label: 'BHXH NLĐ', type: 'money' }, { key: 'bhyt', label: 'BHYT NLĐ', type: 'money' }, { key: 'bhtn', label: 'BHTN NLĐ', type: 'money' },
          { key: 'emp_total', label: 'Cộng NLĐ', type: 'money' }, { key: 'co_bhxh', label: 'BHXH DN', type: 'money' }, { key: 'co_bhyt', label: 'BHYT DN', type: 'money' }, { key: 'co_bhtn', label: 'BHTN DN', type: 'money' },
          { key: 'co_kpcd', label: 'KPCĐ DN', type: 'money' }, { key: 'co_total', label: 'Cộng DN', type: 'money' }, { key: 'union_fee', label: 'Đoàn phí', type: 'money' }, { key: 'skipped', label: 'Ghi chú', type: 'text' }] };
    },
    tax: (q) => {
      const d = P.reportTax(P.needPeriod(q.period));
      const ML = { progressive: 'Lũy tiến', flat10: '10%', none: 'Không tính' };
      return { title: `BẢNG THUẾ TNCN THÁNG ${pdisp(d.period)}`, file: `thue_tncn_${d.period}`, rows: d.rows.map((r) => ({ ...r, mode: ML[r.tax_mode] || r.tax_mode })),
        cols: [{ key: 'code', label: 'Mã NV', type: 'text' }, { key: 'full_name', label: 'Họ tên', type: 'text' }, { key: 'mode', label: 'Cách tính', type: 'text' },
          { key: 'income', label: 'Tổng thu nhập', type: 'money' }, { key: 'taxable', label: 'TN chịu thuế', type: 'money' }, { key: 'ins_emp', label: 'BH bắt buộc', type: 'money' },
          { key: 'dependents', label: 'Số NPT', type: 'num' }, { key: 'family_deduct', label: 'Giảm trừ gia cảnh', type: 'money' }, { key: 'assessable', label: 'TN tính thuế', type: 'money' }, { key: 'tax', label: 'Thuế đã khấu trừ', type: 'money' }] };
    },
    settlement: (q) => {
      const d = P.reportSettlement(q.year);
      return { title: `QUYẾT TOÁN THUẾ TNCN NĂM ${d.year}`, file: `quyet_toan_tncn_${d.year}`, rows: d.rows.map((r) => ({ ...r, note: r.flat10 ? 'Có tháng khấu trừ 10% — xem lại điều kiện quyết toán thay' : '' })),
        cols: [{ key: 'code', label: 'Mã NV', type: 'text' }, { key: 'full_name', label: 'Họ tên', type: 'text' }, { key: 'months', label: 'Số tháng', type: 'num' },
          { key: 'taxable', label: 'TN chịu thuế cả năm', type: 'money' }, { key: 'ins_emp', label: 'BH bắt buộc', type: 'money' }, { key: 'family_deduct', label: 'Giảm trừ gia cảnh', type: 'money' },
          { key: 'assessable', label: 'TN tính thuế', type: 'money' }, { key: 'tax_due', label: 'Thuế phải nộp cả năm', type: 'money' }, { key: 'withheld', label: 'Đã khấu trừ', type: 'money' },
          { key: 'diff', label: 'Nộp thêm (+) / Hoàn (−)', type: 'money' }, { key: 'note', label: 'Ghi chú', type: 'text' }] };
    },
  };
  r.get('/pay/reports/:kind', pay, wrap('GET /admin/pay/reports', async (req, res) => {
    const f = REPORTS[req.params.kind.replace(/\.xlsx$/, '')];
    if (!f) return res.status(404).json({ error: 'Không có báo cáo này' });
    const rep = f(req.query);
    if (!req.params.kind.endsWith('.xlsx')) return res.json(rep);
    const wb = new ExcelJS.Workbook();
    tableSheet(wb, 'BaoCao', { company: company(), title: rep.title, cols: rep.cols, rows: rep.rows, freeze: 3 });
    await sendXlsx(res, wb, rep.file + '.xlsx');
  }));
}
