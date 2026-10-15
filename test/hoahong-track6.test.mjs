// "Bảng theo dõi chấm công" 6 dòng/người/ngày (Vào 1 · Ra 1 · Vào 2 · Ra 2 · Giờ HC · Giờ TC). Hàm thuần track6.js. Chạy: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackTimes, trackCell, TRACK_ROWS } from '../server/track6.js';

const T = (hm) => Date.parse(`2026-08-12T${hm}+07:00`);
const iso = (hm) => new Date(T(hm)).toISOString();
const BS = T('11:30:00');

test('6 dòng đúng thứ tự', () => {
  assert.deepEqual(TRACK_ROWS.map((x) => x[1]), ['Vào 1', 'Ra 1', 'Vào 2', 'Ra 2', 'Giờ HC', 'Giờ TC']);
});

test('công THẬT, 4 lần quẹt: Vào 1 = Đến, Ra 1, Vào 2, Ra 2 = Về; giờ HC / TC theo dòng công', () => {
  const c = { check_in_at: iso('06:55:20'), check_out_at: iso('18:03:26'), work_minutes: 392, ot_min: 90 };
  const r = trackCell({ virt: false, c, punches: [T('06:55:20'), T('11:30:39'), T('14:28:01'), T('18:03:26')], breakStart: BS });
  assert.deepEqual(r, { v1: '06:55', r1: '11:30', v2: '14:28', r2: '18:03', hc: 6.53, tc: 1.5 });
});

test('công THẬT, 2 lần quẹt: chỉ Vào 1 và Ra 2; 6 lần quẹt: Ra 1 = Vào 2 như HR-ERP', () => {
  const c2 = { check_in_at: iso('06:50:00'), check_out_at: iso('16:35:00'), work_minutes: 480, ot_min: 0 };
  assert.deepEqual(trackCell({ virt: false, c: c2, punches: [T('06:50:00'), T('16:35:00')], breakStart: BS }), { v1: '06:50', r1: '', v2: '', r2: '16:35', hc: 8, tc: 0 });
  const c6 = { check_in_at: iso('06:54:57'), check_out_at: iso('18:06:19'), work_minutes: 225, ot_min: 90 };
  const r6 = trackCell({ virt: false, c: c6, punches: [T('06:54:57'), T('07:05:04'), T('11:20:03'), T('11:34:15'), T('12:58:36'), T('18:06:19')], breakStart: BS });
  assert.equal(r6.r1, '11:34'); assert.equal(r6.v2, '11:34'); assert.equal(r6.r2, '18:06');
});

test('không có lượt quẹt máy (chấm điện thoại / sửa tay): lấy giờ vào / ra của dòng công', () => {
  const c = { check_in_at: iso('07:01:00'), check_out_at: iso('16:31:00'), work_minutes: 479, ot_min: 0 };
  assert.deepEqual(trackCell({ virt: false, c, punches: [], breakStart: null }), { v1: '07:01', r1: '', v2: '', r2: '16:31', hc: 7.98, tc: 0 });
});

test('công ẢO: dùng giờ vào / ra ảo + giờ trưa ảo kiểu K; KHÔNG lộ lượt quẹt thật; chưa bật K thì Ra 1 / Vào 2 trống', () => {
  const c = { check_in_at: iso('06:58:18'), check_out_at: iso('18:01:49'), k_ra: iso('11:30:02'), k_vao: iso('12:56:41'), work_minutes: 480, ot_min: 90 };
  assert.deepEqual(trackCell({ virt: true, c, punches: [T('06:26:36'), T('11:30:02'), T('12:45:25'), T('20:00:03')], breakStart: BS }),
    { v1: '06:58', r1: '11:30', v2: '12:56', r2: '18:01', hc: 8, tc: 1.5 });
  const noK = { ...c, k_ra: undefined, k_vao: undefined };
  const r = trackCell({ virt: true, c: noK, punches: [T('06:26:36'), T('20:00:03')], breakStart: BS });
  assert.equal(r.r1, ''); assert.equal(r.v2, ''); assert.equal(r.v1, '06:58');
});

test('ngày không có công: hiện ký hiệu nghỉ ở dòng Vào 1, còn lại trống', () => {
  assert.deepEqual(trackCell({ virt: false, c: null, punches: null, breakStart: null, leaveSym: 'E' }), { v1: 'E', r1: '', v2: '', r2: '', hc: '', tc: '' });
  assert.deepEqual(trackCell({ virt: false, c: null, punches: null, breakStart: null }), { v1: '', r1: '', v2: '', r2: '', hc: '', tc: '' });
});

test('ngày nghỉ hằng tuần làm việc: Giờ HC = 0, Giờ TC = giờ tăng ca', () => {
  const c = { check_in_at: iso('06:59:29'), check_out_at: iso('16:33:14'), work_minutes: 0, ot_min: 430, ot_type: 'cuoi_tuan' };
  const r = trackCell({ virt: false, c, punches: [T('06:59:29'), T('11:30:36'), T('13:50:48'), T('16:33:14')], breakStart: BS });
  assert.equal(r.hc, 0); assert.equal(r.tc, 7.17);
  assert.equal(trackTimes({ virt: false, c, punches: [], breakStart: null }).v1, T('06:59:29'));
});
