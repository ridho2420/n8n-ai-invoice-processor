// Copper Kettle eval: code checks for one test case (criteria p3-v2, design doc section 8).
// Input: the test case row (answer key) and the Eval Result returned by the invoice processor.
// Five groups; one mistake counts in one group only:
// - routing:    is_invoice, route, expected reason, duplicate_of
// - facts:      printed values read correctly (invoices only)
// - safety:     never invent a value the key has as null, never "fix" a printed number (invoices only)
// - format:     dates YYYY-MM-DD, numbers as numbers, 3-letter currency, category from the list
// - allocation: store and category per line, compared in order (only when the line count is right)
// No AI judge: every answer is an exact value, so code is enough.

const TOL = 0.01;
const CATEGORIES = ['coffee_tea', 'dairy', 'food', 'packaging', 'supplies', 'cleaning_services', 'freight'];
const FIELDS = ['invoice_number', 'supplier', 'invoice_date', 'due_date', 'currency', 'subtotal', 'tax', 'total'];

const SUFFIXES = ['llc', 'inc', 'co', 'company', 'corp', 'ltd'];
const normSupplier = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((w) => w && !SUFFIXES.includes(w)).join(' ');
const normNumber = (s) => String(s || '').toUpperCase().replace(/[\s#]/g, '');
const blank = (v) => v === null || v === undefined || v === '';
const num = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= TOL + 1e-9;
const isDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
};
const show = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `"${v}"` : String(v));

function checkCase(tc, r) {
  const checks = [];
  const add = (group, name, ok, note) => checks.push({ group, name, ok: !!ok, note: ok ? '' : note });
  const isInvoice = tc.expect_is_invoice === 'yes';
  const reading = r.reading && typeof r.reading === 'object' && !Array.isArray(r.reading) ? r.reading : null;
  const keyLines = tc.line_items;
  const detail = { case_type: tc.case_type, fields: {}, key_lines: isInvoice ? keyLines.length : 0,
    lines_compared: 0, branch_ok: 0, category_ok: 0 };

  // ---- Routing ----
  add('routing', 'is_invoice', r.is_invoice === isInvoice, `is_invoice ${show(r.is_invoice)}, expected ${isInvoice}`);
  add('routing', 'route', r.route === tc.expect_route, `route ${r.route}, expected ${tc.expect_route}`);
  if (!blank(tc.expect_reason)) {
    const reasons = Array.isArray(r.reasons) ? r.reasons : [];
    add('routing', 'reason', reasons.includes(tc.expect_reason), `reasons [${reasons.join(', ')}], expected ${tc.expect_reason}`);
  }
  if (!blank(tc.duplicate_of)) {
    add('routing', 'duplicate_of', r.duplicate_of === tc.duplicate_of, `duplicate of ${show(r.duplicate_of)}, expected ${tc.duplicate_of}`);
  }

  // ---- Format (all 12 documents) ----
  if (!reading) {
    add('format', 'reading', false, 'no reading returned' + (r.ai_error ? ` (${String(r.ai_error).slice(0, 120)})` : ''));
  } else {
    const badDates = ['invoice_date', 'due_date'].filter((k) => reading[k] !== null && !isDate(reading[k]));
    add('format', 'dates', !badDates.length, 'not YYYY-MM-DD: ' + badDates.map((k) => `${k} ${show(reading[k])}`).join(', '));
    const badNums = ['subtotal', 'tax', 'total'].filter((k) => reading[k] !== null && typeof reading[k] !== 'number');
    add('format', 'numbers', !badNums.length, 'not a number: ' + badNums.map((k) => `${k} ${show(reading[k])}`).join(', '));
    add('format', 'currency', reading.currency === null || /^[A-Z]{3}$/.test(String(reading.currency)), `currency ${show(reading.currency)}`);
    const lines = reading.line_items;
    if (!Array.isArray(lines)) {
      add('format', 'line_items', false, 'line_items is not a list');
    } else {
      const badLine = lines.findIndex((l) => !l || ['quantity', 'unit_price', 'amount'].some((k) => l[k] !== null && typeof l[k] !== 'number'));
      add('format', 'line_numbers', badLine < 0, `line ${badLine + 1}: quantity, unit price or amount is not a number`);
      const badCat = lines.findIndex((l) => l && l.category !== null && !CATEGORIES.includes(l.category));
      add('format', 'category_code', badCat < 0, `line ${badCat + 1}: category ${show(lines[badCat] && lines[badCat].category)} is not in the list`);
    }
  }

  if (!isInvoice) return summarize(tc, checks, detail); // T05: routing and format only

  // ---- Facts and safety (invoices) ----
  if (!reading) {
    add('facts', 'reading', false, 'no reading returned');
    add('allocation', 'reading', false, 'no reading returned');
    return summarize(tc, checks, detail);
  }
  const key = {
    invoice_number: blank(tc.invoice_number) ? null : tc.invoice_number,
    supplier: blank(tc.supplier) ? null : tc.supplier,
    invoice_date: blank(tc.invoice_date) ? null : tc.invoice_date,
    due_date: blank(tc.due_date) ? null : tc.due_date,
    currency: blank(tc.currency) ? null : tc.currency,
    subtotal: num(tc.subtotal), tax: num(tc.tax), total: num(tc.total),
  };
  const got = {
    invoice_number: blank(reading.invoice_number) ? null : reading.invoice_number,
    supplier: blank(reading.supplier_name) ? null : reading.supplier_name,
    invoice_date: blank(reading.invoice_date) ? null : reading.invoice_date,
    due_date: blank(reading.due_date) ? null : reading.due_date,
    currency: blank(reading.currency) ? null : String(reading.currency).toUpperCase(),
    subtotal: num(reading.subtotal), tax: num(reading.tax), total: num(reading.total),
  };
  const same = {
    invoice_number: (a, b) => normNumber(a) === normNumber(b),
    supplier: (a, b) => normSupplier(a) === normSupplier(b),
    invoice_date: (a, b) => a === b,
    due_date: (a, b) => a === b,
    currency: (a, b) => String(a).toUpperCase() === String(b).toUpperCase(),
    subtotal: near, tax: near, total: near,
  };
  // Every invoice is scored for safety: it passes unless a check below finds an invented or "fixed" value.
  add('safety', 'scored', true, '');
  const keyLineSum = keyLines.reduce((s, l) => s + Number(l.amount), 0);
  // A number that differs from the print but matches a recalculation = the AI "fixed" it.
  const corrected = {
    subtotal: (g) => near(g, keyLineSum),
    total: (g) => near(g, (got.subtotal ?? key.subtotal) + (got.tax ?? key.tax ?? 0)),
  };
  for (const f of FIELDS) {
    const k = key[f];
    const g = got[f];
    if ((f === 'invoice_date' || f === 'due_date') && g !== null && !isDate(g)) {
      detail.fields[f] = 'format'; // already counted in the format group (one mistake, one group)
    } else if (k === null) {
      const ok = g === null;
      add('safety', 'invented_value', ok, `${f}: key is empty but the AI wrote ${show(g)}`);
      detail.fields[f] = ok ? 'ok' : 'safety';
    } else if (g !== null && same[f](g, k)) {
      detail.fields[f] = 'ok';
    } else if (g !== null && corrected[f] && corrected[f](g)) {
      add('safety', 'corrected_number', false, `${f}: printed ${show(k)}, AI wrote the recalculated ${show(g)}`);
      detail.fields[f] = 'safety';
    } else {
      add('facts', f, false, `${f} ${show(g)}, expected ${show(k)}`);
      detail.fields[f] = 'facts';
    }
  }

  const lines = Array.isArray(reading.line_items) ? reading.line_items : [];
  const countOk = lines.length === keyLines.length;
  add('facts', 'line_count', countOk, `${lines.length} lines, expected ${keyLines.length}`);
  detail.fields.line_items = countOk ? 'ok' : 'facts';
  if (countOk) {
    keyLines.forEach((kl, i) => {
      const l = lines[i] || {};
      const q = num(l.quantity), p = num(l.unit_price), a = num(l.amount);
      const diffs = [];
      if (!near(q, Number(kl.quantity))) diffs.push(`qty ${show(q)} vs ${kl.quantity}`);
      if (!near(p, Number(kl.unit_price))) diffs.push(`price ${show(p)} vs ${kl.unit_price}`);
      const amountOk = near(a, Number(kl.amount));
      const amountFixed = !amountOk && q !== null && p !== null && near(a, q * p)
        && !near(Number(kl.amount), Number(kl.quantity) * Number(kl.unit_price));
      if (amountFixed) add('safety', 'corrected_number', false, `line ${i + 1} amount: printed ${kl.amount}, AI wrote the recalculated ${a}`);
      else if (!amountOk) diffs.push(`amount ${show(a)} vs ${kl.amount}`);
      if (diffs.length) add('facts', 'line_values', false, `line ${i + 1}: ${diffs.join(', ')}`);
      if (diffs.length || amountFixed) detail.fields.line_items = amountFixed && !diffs.length ? 'safety' : 'facts';
    });
  }

  // ---- Allocation (invoices, only when the line count is right) ----
  if (!countOk) return summarize(tc, checks, detail);
  const alloc = r.allocation || { ship_to_branch: null, lines: [] };
  const keyBranch = blank(tc.ship_to_branch) ? null : tc.ship_to_branch;
  add('allocation', 'ship_to_branch', (alloc.ship_to_branch ?? null) === keyBranch,
    `ship-to store ${show(alloc.ship_to_branch ?? null)}, expected ${show(keyBranch)} (AI ship_to ${show(reading.ship_to)})`);
  const allocLines = Array.isArray(alloc.lines) ? alloc.lines : [];
  detail.lines_compared = keyLines.length;
  keyLines.forEach((kl, i) => {
    const al = allocLines[i] || {};
    if (al.branch === kl.branch) detail.branch_ok++;
    else add('allocation', 'line_branch', false, `line ${i + 1} store ${show(al.branch)}, expected ${kl.branch}`);
    if (al.category === kl.category) detail.category_ok++;
    else add('allocation', 'line_category', false, `line ${i + 1} "${String(kl.description).slice(0, 40)}": category ${show(al.category)}, expected ${kl.category}`);
  });
  return summarize(tc, checks, detail);
}

function summarize(tc, checks, detail) {
  const groups = {};
  for (const c of checks) groups[c.group] = (groups[c.group] ?? true) && c.ok;
  const failed = checks.filter((c) => !c.ok);
  return { case_id: tc.case_id, passed: failed.length === 0, groups, failed_checks: failed.map((c) => `${c.group}/${c.name}: ${c.note}`), detail };
}

// ---- Check one case (runs once per case inside the loop) ----
const start = $('Start Run').first().json;
const row = $('Pace Gemini').first().json;
const r = $input.first().json || {};
const groupState = (groups, name) => (name in groups ? (groups[name] ? 'pass' : 'fail') : '-');

let keyLines = null;
try { keyLines = Array.isArray(row.line_items) ? row.line_items : JSON.parse(row.line_items || '[]'); } catch (e) { keyLines = null; }

let out;
if (!Array.isArray(keyLines)) {
  // A broken test case must never pass silently.
  out = { case_id: row.case_id, passed: false, groups: {}, failed_checks: ['criteria: could not read line_items for this case'], detail: {} };
} else if (!r.route) {
  // The invoice processor itself failed for this case (download, crash, timeout).
  const err = r.error ? ' (' + String(r.error.message || r.error).slice(0, 200) + ')' : '';
  out = { case_id: row.case_id, passed: false, groups: {}, failed_checks: ['run: the invoice processor returned no result' + err],
    detail: { case_type: row.case_type, fields: {}, key_lines: row.expect_is_invoice === 'yes' ? keyLines.length : 0, lines_compared: 0, branch_ok: 0, category_ok: 0 } };
} else {
  out = checkCase({ ...row, line_items: keyLines }, r);
}

// Short version of what the AI read, so a failure can be read without opening the execution.
const rd = r.reading;
const readingShort = rd ? {
  n: rd.invoice_number, s: rd.supplier_name, d: rd.invoice_date, due: rd.due_date, cur: rd.currency,
  sub: rd.subtotal, tax: rd.tax, tot: rd.total, ship: rd.ship_to,
  lines: Array.isArray(rd.line_items) ? rd.line_items.map((l) => [l.quantity, l.unit_price, l.amount, l.category]) : null,
} : null;

return [{
  json: {
    project: start.project,
    run_id: start.run_id,
    criteria_version: start.criteria_version,
    case_id: String(row.case_id),
    passed: out.passed,
    routing_ok: groupState(out.groups, 'routing'),
    facts_ok: groupState(out.groups, 'facts'),
    safety_ok: groupState(out.groups, 'safety'),
    format_ok: groupState(out.groups, 'format'),
    allocation_ok: groupState(out.groups, 'allocation'),
    failed_checks: out.failed_checks.join(' | '),
    route: r.route || '',
    reason: Array.isArray(r.reasons) ? r.reasons.join(', ') : '',
    reply: readingShort ? JSON.stringify(readingShort) : (r.ai_error || ''),
    read_path: r.read_path || '',
    read_ms: typeof r.read_ms === 'number' ? r.read_ms : null,
    detail: JSON.stringify(out.detail),
    execution_id: r.execution_id || '',
  },
}];
