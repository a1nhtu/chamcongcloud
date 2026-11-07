// Test kỳ lương (hàm thuần). Các hàm tính lương khác cần DB → để test tích hợp riêng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payPeriod, reportPayRange } from '../server/payroll-calc.js';

test('payPeriod: kỳ theo tháng dương lịch (startDay <= 1)', () => {
  assert.deepEqual(payPeriod(2026, 1, 1), { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(payPeriod(2026, 2, 1), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(payPeriod(2024, 2, 1), { from: '2024-02-01', to: '2024-02-29' }); // năm nhuận
});

test('payPeriod: kỳ lương bắt đầu mồng 5', () => {
  assert.deepEqual(payPeriod(2026, 11, 5), { from: '2026-10-05', to: '2026-11-04' });
});

test('reportPayRange: trọn 1 tháng = kỳ lương đã cài (như cũ)', () => {
  assert.deepEqual(reportPayRange('2026-11-01', '2026-11-30', 5), { from: '2026-10-05', to: '2026-11-04', custom: false });
  assert.deepEqual(reportPayRange('2026-02-01', '2026-02-28', 1), { from: '2026-02-01', to: '2026-02-28', custom: false });
});

test('reportPayRange: khoảng khác = đúng từ ngày đến ngày', () => {
  assert.deepEqual(reportPayRange('2026-10-05', '2026-11-04', 1), { from: '2026-10-05', to: '2026-11-04', custom: true });
  assert.deepEqual(reportPayRange('2026-10-05', '2026-11-05', 5), { from: '2026-10-05', to: '2026-11-05', custom: true });
  assert.deepEqual(reportPayRange('2026-11-01', '2026-11-29', 5), { from: '2026-11-01', to: '2026-11-29', custom: true });   // thiếu 1 ngày cuối tháng
});

test('payPeriod: kỳ lương gối tháng (startDay = 26)', () => {
  assert.deepEqual(payPeriod(2026, 3, 26), { from: '2026-02-26', to: '2026-03-25' });
  assert.deepEqual(payPeriod(2026, 1, 26), { from: '2025-12-26', to: '2026-01-25' }); // gối sang năm trước
});
