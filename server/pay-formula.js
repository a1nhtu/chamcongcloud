// BỘ TÍNH CÔNG THỨC LƯƠNG (kiểu Excel / AMIS) — hàm thuần, KHÔNG dùng eval / new Function.
//   =IF(CHUC_DANH="Giám đốc", 1000000, 500000) * CONG / CONG_CHUAN
//   =ROUND(LUONG_DONG_BH*8/100, 0)   ·   =MIN(AN_CA, 730000)   ·   =IF(AND(CONG>=26, DI_TRE_LAN=0), 300000, 0)
// Hỗ trợ: số thập phân dùng dấu chấm (1.5; dấu phẩy / chấm phẩy là ngăn cách đối số), chuỗi "…", biến MÃ_IN_HOA, + - * / ^ %, & (nối chuỗi),
// so sánh = <> != < > <= >=, hàm IF IFS AND OR NOT ROUND ROUNDUP ROUNDDOWN INT MIN MAX ABS SUM AVERAGE MOD CEILING FLOOR.
// Biến chưa có giá trị → 0 (số) để công thức không gãy khi thiếu dữ liệu; lỗi cú pháp báo bằng tiếng Việt kèm vị trí.

const FUNCS = {
  IF: { min: 2, max: 3, lazy: true },
  IFS: { min: 2, max: 40, lazy: true },
  AND: { min: 1, max: 40 }, OR: { min: 1, max: 40 }, NOT: { min: 1, max: 1 },
  ROUND: { min: 1, max: 2 }, ROUNDUP: { min: 1, max: 2 }, ROUNDDOWN: { min: 1, max: 2 }, INT: { min: 1, max: 1 },
  MIN: { min: 1, max: 60 }, MAX: { min: 1, max: 60 }, SUM: { min: 1, max: 60 }, AVERAGE: { min: 1, max: 60 },
  ABS: { min: 1, max: 1 }, MOD: { min: 2, max: 2 }, CEILING: { min: 1, max: 2 }, FLOOR: { min: 1, max: 2 },
};
export const FORMULA_FUNCS = Object.keys(FUNCS);

export class FormulaError extends Error {
  constructor(msg, pos) { super(pos != null ? `${msg} (ở ký tự ${pos + 1})` : msg); this.pos = pos; }
}

/* ---------------- tách từ ---------------- */
function tokenize(src) {
  const s = String(src ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new FormulaError(`Số "${raw}" không hợp lệ`, i);
      out.push({ t: 'num', v: parseFloat(raw), p: i }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1, v = '';
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j += 2; continue; }
        if (s[j] === '"') break;
        v += s[j++];
      }
      if (j >= s.length) throw new FormulaError('Thiếu dấu " đóng chuỗi', i);
      out.push({ t: 'str', v, p: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_À-ỹĐđ]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_À-ỹĐđ]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j).toUpperCase(), p: i }); i = j; continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two, p: i }); i += 2; continue; }
    if ('+-*/^%&=<>(),;'.includes(c)) { out.push({ t: c === '(' || c === ')' ? c : c === ',' || c === ';' ? ',' : 'op', v: c === ';' ? ',' : c, p: i }); i++; continue; }
    throw new FormulaError(`Ký tự "${c}" không dùng được trong công thức`, i);
  }
  out.push({ t: 'end', p: s.length });
  return out;
}

/* ---------------- phân tích cú pháp (đệ quy xuống) ----------------
   expr   := cmp
   cmp    := concat (( = | <> | < | > | <= | >= ) concat)*
   concat := add ( & add )*
   add    := mul (( + | - ) mul)*
   mul    := pow (( * | / ) pow)*
   pow    := unary ( ^ unary )*
   unary  := ( - | + ) unary | post
   post   := atom ( % )*
   atom   := num | str | id | id ( args ) | ( expr )                                   */
export function parseFormula(src) {
  let text = String(src ?? '').trim();
  if (text.startsWith('=')) text = text.slice(1);
  if (!text.trim()) throw new FormulaError('Công thức đang trống');
  const tk = tokenize(text);
  let k = 0;
  const peek = () => tk[k];
  const take = () => tk[k++];
  const isOp = (...ops) => peek().t === 'op' && ops.includes(peek().v);
  const expect = (t) => { if (peek().t !== t) throw new FormulaError(t === ')' ? 'Thiếu dấu ")"' : `Thiếu "${t}"`, peek().p); return take(); };

  const cmp = () => {
    let a = concat();
    while (isOp('=', '<>', '<', '>', '<=', '>=')) { const op = take().v; a = { k: 'bin', op, a, b: concat() }; }
    return a;
  };
  const concat = () => { let a = add(); while (isOp('&')) { take(); a = { k: 'bin', op: '&', a, b: add() }; } return a; };
  const add = () => { let a = mul(); while (isOp('+', '-')) { const op = take().v; a = { k: 'bin', op, a, b: mul() }; } return a; };
  const mul = () => { let a = pow(); while (isOp('*', '/')) { const op = take().v; a = { k: 'bin', op, a, b: pow() }; } return a; };
  const pow = () => { let a = unary(); while (isOp('^')) { take(); a = { k: 'bin', op: '^', a, b: unary() }; } return a; };
  const unary = () => {
    if (isOp('-')) { take(); return { k: 'neg', a: unary() }; }
    if (isOp('+')) { take(); return unary(); }
    return post();
  };
  const post = () => { let a = atom(); while (isOp('%')) { take(); a = { k: 'bin', op: '/', a, b: { k: 'num', v: 100 } }; } return a; };
  const atom = () => {
    const t = peek();
    if (t.t === 'num') { take(); return { k: 'num', v: t.v }; }
    if (t.t === 'str') { take(); return { k: 'str', v: t.v }; }
    if (t.t === '(') { take(); const e = cmp(); expect(')'); return e; }
    if (t.t === 'id') {
      take();
      if (peek().t === '(') {
        const f = FUNCS[t.v];
        if (!f) throw new FormulaError(`Không có hàm ${t.v} (dùng được: ${FORMULA_FUNCS.join(', ')})`, t.p);
        take();
        const args = [];
        if (peek().t !== ')') {
          args.push(cmp());
          while (peek().t === ',') { take(); args.push(cmp()); }
        }
        expect(')');
        if (args.length < f.min || args.length > f.max) throw new FormulaError(`Hàm ${t.v} cần ${f.min === f.max ? f.min : `${f.min}–${f.max}`} đối số, đang có ${args.length}`, t.p);
        return { k: 'fn', name: t.v, args };
      }
      if (t.v === 'TRUE') return { k: 'num', v: 1 };
      if (t.v === 'FALSE') return { k: 'num', v: 0 };
      return { k: 'var', name: t.v };
    }
    if (t.t === 'end') throw new FormulaError('Công thức bị cụt — thiếu số / biến ở cuối', t.p);
    throw new FormulaError(`Không hiểu "${t.v}" ở đây`, t.p);
  };
  const ast = cmp();
  if (peek().t !== 'end') throw new FormulaError(`Thừa "${peek().v}" — có thể thiếu dấu phép tính`, peek().p);
  return ast;
}

// Danh sách biến (MÃ) công thức dùng — để sắp thứ tự tính & báo biến lạ
export function formulaVars(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'var') out.add(ast.name);
  else if (ast.k === 'bin') { formulaVars(ast.a, out); formulaVars(ast.b, out); }
  else if (ast.k === 'neg') formulaVars(ast.a, out);
  else if (ast.k === 'fn') ast.args.forEach((a) => formulaVars(a, out));
  return out;
}

/* ---------------- tính ---------------- */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null || v === '') return 0;
  const x = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
};
const truthy = (v) => (typeof v === 'string' ? v !== '' && v !== '0' : num(v) !== 0);
// Làm tròn kiểu Excel: ROUND(x, -3) → hàng nghìn; .5 làm tròn ra xa số 0
function xround(x, d, mode) {
  const n = Math.trunc(num(d));
  const f = Math.pow(10, n);
  const v = num(x) * f;
  const a = Math.abs(v), s = Math.sign(v);
  const eps = 1e-9;
  const r = mode === 'up' ? Math.ceil(a - eps) : mode === 'down' ? Math.floor(a + eps) : Math.floor(a + 0.5 + eps);
  return (s * r) / f;
}
const eq = (a, b) => (typeof a === 'string' || typeof b === 'string'
  ? String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  : num(a) === num(b));

export function evalFormula(ast, vars = {}) {
  const ev = (n) => {
    switch (n.k) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var': { const v = vars[n.name]; return v == null ? 0 : v; }
      case 'neg': return -num(ev(n.a));
      case 'bin': {
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': return num(b) === 0 ? 0 : num(a) / num(b);   // chia 0 → 0 (thiếu công chuẩn không làm gãy cả bảng)
          case '^': return Math.pow(num(a), num(b));
          case '&': return `${a ?? ''}${b ?? ''}`;
          case '=': return eq(a, b) ? 1 : 0;
          case '<>': return eq(a, b) ? 0 : 1;
          case '<': return num(a) < num(b) ? 1 : 0;
          case '>': return num(a) > num(b) ? 1 : 0;
          case '<=': return num(a) <= num(b) ? 1 : 0;
          case '>=': return num(a) >= num(b) ? 1 : 0;
        }
        return 0;
      }
      case 'fn': {
        const A = n.args;
        switch (n.name) {
          case 'IF': return truthy(ev(A[0])) ? ev(A[1]) : (A[2] ? ev(A[2]) : 0);
          case 'IFS': { for (let i = 0; i + 1 < A.length; i += 2) if (truthy(ev(A[i]))) return ev(A[i + 1]); return 0; }
          case 'AND': return A.every((a) => truthy(ev(a))) ? 1 : 0;
          case 'OR': return A.some((a) => truthy(ev(a))) ? 1 : 0;
          case 'NOT': return truthy(ev(A[0])) ? 0 : 1;
          case 'ROUND': return xround(ev(A[0]), A[1] ? ev(A[1]) : 0);
          case 'ROUNDUP': return xround(ev(A[0]), A[1] ? ev(A[1]) : 0, 'up');
          case 'ROUNDDOWN': return xround(ev(A[0]), A[1] ? ev(A[1]) : 0, 'down');
          case 'INT': return Math.floor(num(ev(A[0])));
          case 'MIN': return Math.min(...A.map((a) => num(ev(a))));
          case 'MAX': return Math.max(...A.map((a) => num(ev(a))));
          case 'SUM': return A.reduce((s, a) => s + num(ev(a)), 0);
          case 'AVERAGE': return A.reduce((s, a) => s + num(ev(a)), 0) / A.length;
          case 'ABS': return Math.abs(num(ev(A[0])));
          case 'MOD': { const d = num(ev(A[1])); return d === 0 ? 0 : num(ev(A[0])) - d * Math.floor(num(ev(A[0])) / d); }
          case 'CEILING': { const m = A[1] ? Math.abs(num(ev(A[1]))) : 1; return m === 0 ? 0 : Math.ceil(num(ev(A[0])) / m - 1e-9) * m; }
          case 'FLOOR': { const m = A[1] ? Math.abs(num(ev(A[1]))) : 1; return m === 0 ? 0 : Math.floor(num(ev(A[0])) / m + 1e-9) * m; }
        }
        return 0;
      }
    }
    return 0;
  };
  return ev(ast);
}

// Kiểm tra nhanh 1 công thức: { ok, vars:[...], unknown:[...], error }
export function checkFormula(src, knownVars) {
  try {
    const ast = parseFormula(src);
    const vars = [...formulaVars(ast)];
    const unknown = knownVars ? vars.filter((v) => !knownVars.has(v)) : [];
    return { ok: !unknown.length, vars, unknown, error: unknown.length ? `Không có mã: ${unknown.join(', ')}` : null };
  } catch (e) {
    return { ok: false, vars: [], unknown: [], error: e.message };
  }
}

// Sắp thứ tự tính các mục có phụ thuộc nhau (topo). items: [{code, deps:[codes]}] → [codes] hoặc lỗi vòng lặp
export function orderByDeps(items) {
  const byCode = new Map(items.map((it) => [it.code, it]));
  const state = new Map();   // 1 = đang thăm, 2 = xong
  const out = [];
  const visit = (code, path) => {
    const st = state.get(code);
    if (st === 2) return;
    if (st === 1) throw new FormulaError(`Công thức vòng lặp: ${[...path, code].join(' → ')}`);
    state.set(code, 1);
    for (const d of byCode.get(code).deps || []) if (byCode.has(d)) visit(d, [...path, code]);
    state.set(code, 2);
    out.push(code);
  };
  for (const it of items) visit(it.code, []);
  return out;
}
