// Stage 4: code checks what the AI read, then decides the store (branch) of every line.
// The AI only copied what is printed. Every number is recalculated here, and every problem
// becomes a reason code (design doc, section 4). Any reason sends the invoice to review.
// Duplicates are decided in stage 5 (Decide Route), with the dup_key built here.

// ---- allocate.js (criteria p3-v2): branch by rule, category checked against the list ----
function branchesIn(text, cfg) {
  const t = String(text || '').toLowerCase();
  return Object.entries(cfg.branches)
    .filter(([, b]) => b.keywords.some((k) => t.includes(k)))
    .map(([code]) => code);
}
function defaultBranch(shipTo, cfg) {
  const found = branchesIn(shipTo, cfg);
  return found.length === 1 ? found[0] : null;
}
function lineBranch(description, fallback, cfg) {
  const t = String(description || '').toLowerCase();
  if (cfg.sharedPhrases.some((p) => t.includes(p))) return 'shared';
  const found = branchesIn(t, cfg);
  if (found.length > 1) return 'shared';
  if (found.length === 1) return found[0];
  return fallback || 'unassigned';
}
function allocate(invoice, cfg) {
  const shipToBranch = defaultBranch(invoice.ship_to, cfg);
  const lines = (invoice.line_items || []).map((li) => {
    const category = li.category ?? null;
    return {
      branch: lineBranch(li.description, shipToBranch, cfg),
      category,
      category_ok: category !== null && cfg.categories.includes(category),
    };
  });
  const reasons = [];
  if (lines.some((l) => l.branch === 'unassigned')) reasons.push('branch_unknown');
  if (lines.some((l) => !l.category_ok)) reasons.push('uncategorized_line');
  return { ship_to_branch: shipToBranch, lines, reasons };
}

// ---- reading the AI output safely ----
const text = (v) => { const s = String(v ?? '').trim(); return s ? s : null; };
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v) => { // a real calendar date written YYYY-MM-DD, otherwise null
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null;
};
const cents = (n) => Math.round(n * 100) / 100;
const differs = (a, b, tol) => Math.abs(a - b) > tol + 1e-9;

// ---- duplicate key: same supplier + same invoice number, written loosely ----
const SUFFIXES = ['llc', 'inc', 'co', 'company', 'corp', 'ltd'];
const normSupplier = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((w) => w && !SUFFIXES.includes(w)).join(' ');
const normNumber = (s) => String(s || '').toUpperCase().replace(/[\s#]/g, '');

const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const cfg = j.config;
  const tol = cfg.money_tolerance;
  const allocCfg = {
    branches: Object.fromEntries(cfg.branches.filter((b) => b.keywords.length).map((b) => [b.code, { name: b.name, keywords: b.keywords }])),
    sharedPhrases: cfg.shared_phrases,
    categories: cfg.categories.map((c) => c.code),
  };
  const base = { ...j, check_status: null, invoice: null, allocation: null, dup_key: null, reasons: [], details: {} };

  // AI failed: nothing to check. Stage 7 logs it and tells the team.
  if (j.ai_failed || !j.reading) {
    out.push({ json: { ...base, check_status: 'error', error_step: 'read', error_message: j.ai_error || 'No reading' }, binary: item.binary });
    continue;
  }
  const r = j.reading;
  if (r.is_invoice !== true) {
    out.push({ json: { ...base, check_status: 'not_invoice' }, binary: item.binary });
    continue;
  }

  // What the AI read, cleaned up (types only, never corrected).
  const inv = {
    invoice_number: text(r.invoice_number),
    supplier: text(r.supplier_name),
    invoice_date: isoDate(r.invoice_date),
    due_date: isoDate(r.due_date),
    currency: text(r.currency) ? text(r.currency).toUpperCase() : null,
    subtotal: num(r.subtotal),
    tax: num(r.tax),
    total: num(r.total),
    ship_to: text(r.ship_to),
    line_items: (Array.isArray(r.line_items) ? r.line_items : []).map((li, n) => ({
      line_no: n + 1,
      description: text(li && li.description) || '',
      quantity: num(li && li.quantity),
      unit_price: num(li && li.unit_price),
      amount: num(li && li.amount),
      category: text(li && li.category),
    })),
  };
  const lines = inv.line_items;
  const reasons = [];
  const details = {};
  const flag = (code, info) => { reasons.push(code); if (info) details[code] = info; };

  // Required fields
  if (!inv.invoice_number) flag('missing_invoice_number', { field: 'invoice number' });
  if (!inv.supplier) flag('missing_supplier', { field: 'supplier name' });
  if (!inv.invoice_date) flag('missing_invoice_date', { field: 'invoice date', printed: r.invoice_date ?? null });
  if (inv.total === null) flag('missing_total', { field: 'total' });
  if (!lines.length) flag('missing_line_items', { field: 'line items' });

  // Each line: quantity x unit price = amount (a missing amount also needs a person)
  const badLines = lines.filter((l) => l.amount === null
    || (l.quantity !== null && l.unit_price !== null && differs(l.quantity * l.unit_price, l.amount, tol)))
    .map((l) => ({ line_no: l.line_no, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      expected: l.quantity !== null && l.unit_price !== null ? cents(l.quantity * l.unit_price) : null, printed: l.amount }));
  if (badLines.length) flag('line_math_mismatch', { lines: badLines });

  // Lines add up to the subtotal; subtotal + tax = total
  const linesTotal = cents(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
  if (lines.length && inv.subtotal !== null && differs(linesTotal, inv.subtotal, tol)) {
    flag('sum_mismatch', { lines_total: linesTotal, subtotal: inv.subtotal, difference: cents(Math.abs(linesTotal - inv.subtotal)) });
  }
  const before = inv.subtotal !== null ? inv.subtotal : (lines.length ? linesTotal : null);
  if (inv.total !== null && before !== null && differs(before + (inv.tax ?? 0), inv.total, tol)) {
    flag('total_mismatch', { subtotal: before, tax: inv.tax ?? 0, expected: cents(before + (inv.tax ?? 0)), printed: inv.total });
  }

  // Dates and currency
  const today = $now.setZone(cfg.timezone).toISODate();
  if (inv.invoice_date && inv.due_date && inv.due_date < inv.invoice_date) {
    flag('due_before_invoice', { due_date: inv.due_date, invoice_date: inv.invoice_date });
  }
  if (inv.invoice_date && inv.invoice_date > today) flag('future_date', { invoice_date: inv.invoice_date, today });
  if (inv.currency && inv.currency !== cfg.home_currency) flag('currency_not_usd', { currency: inv.currency });

  // Branch per line (rule) and category check (AI chose, code checks)
  const alloc = allocate(inv, allocCfg);
  if (alloc.reasons.includes('branch_unknown')) {
    const un = lines.filter((l, n) => alloc.lines[n].branch === 'unassigned');
    flag('branch_unknown', { lines: un.length, amount: cents(un.reduce((s, l) => s + (l.amount ?? 0), 0)) });
  }
  if (alloc.reasons.includes('uncategorized_line')) {
    const un = lines.filter((l, n) => !alloc.lines[n].category_ok);
    flag('uncategorized_line', { lines: un.length, amount: cents(un.reduce((s, l) => s + (l.amount ?? 0), 0)),
      examples: un.slice(0, 3).map((l) => l.description) });
  }

  const dupKey = inv.supplier && inv.invoice_number ? normSupplier(inv.supplier) + '|' + normNumber(inv.invoice_number) : null;
  out.push({
    json: {
      ...base,
      check_status: 'invoice',
      invoice: { ...inv, lines_total: linesTotal },
      allocation: { ship_to_branch: alloc.ship_to_branch, lines: alloc.lines.map(({ branch, category }) => ({ branch, category })) },
      dup_key: dupKey,
      reasons,
      details,
    },
    binary: item.binary,
  });
}

// One Airtable search per email finds earlier invoices for all its PDFs (stage 5, email only).
const keys = [...new Set(out.map((o) => o.json.dup_key).filter(Boolean))];
const formula = keys.length
  ? 'OR(' + keys.map((k) => '{Dup key}="' + k.replace(/["\\]/g, '\\$&') + '"').join(',') + ')'
  : 'FALSE()';
for (const o of out) o.json.dup_lookup_formula = formula;
return out;
