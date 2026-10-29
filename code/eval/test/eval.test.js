// Local tests for the Eval Runner Code nodes (Build Request, Check, Summarize), run outside n8n.
// The invoice processor's own node files (../../nodes) produce the results, so this is the
// same code path as a real run, with the AI reading replaced by the answer key.
// Usage: NODE_PATH=<dir with luxon> node eval.test.js <p3-eval-cases-v1.json> <p3-test-set-source.json>
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const AF = Object.getPrototypeOf(async function () {}).constructor;
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
async function run(file, input, refs = {}, extra = {}) {
  const $ = (name) => ({
    all: (branch, runIdx) => (typeof runIdx === 'number' ? (refs[name + '#' + runIdx] || []) : refs[name]),
    first: () => refs[name][0],
    item: refs[name] && refs[name][0],
  });
  const fn = new AF('$input', '$json', '$', '$now', '$execution', '$runIndex', read(file));
  return fn({ all: () => input, first: () => input[0] }, input[0] && input[0].json, $, DateTime.now(), { id: 'exec-1' }, extra.runIndex || 0);
}
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

// Categories of the answer key v2 (line order as printed)
const CAT = {
  T01: ['coffee_tea', 'coffee_tea', 'coffee_tea', 'freight'], T02: ['dairy', 'dairy', 'dairy', 'dairy', 'freight'],
  T03: [...Array(15).fill('packaging'), 'supplies', 'supplies', 'supplies', 'supplies', 'packaging', 'freight'],
  T04: Array(5).fill('cleaning_services'), T06: ['coffee_tea', 'coffee_tea', 'coffee_tea', 'freight'],
  T07: ['dairy', 'dairy', 'dairy', 'dairy', 'freight'], T08: [...Array(5).fill('packaging'), 'freight'],
  T09: ['cleaning_services', 'cleaning_services'], T10: ['dairy', 'dairy', 'dairy', 'freight'],
  T11: ['coffee_tea', 'coffee_tea', 'coffee_tea', 'freight'], T12: Array(4).fill('packaging'),
};
const SHIP = { T01: 'larimer', T02: 'highlands', T03: 'larimer', T04: null, T06: 'washpark', T07: 'larimer',
  T08: 'highlands', T09: null, T10: 'washpark', T11: 'larimer', T12: 'washpark' };

(async () => {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const key = Array.isArray(raw) ? raw : raw.cases;
  const src = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const loc = src.company.locations;
  const [cfgItem] = await run('../../nodes/config.js', [{ json: { source: 'eval' }, binary: {} }]);
  const config = cfgItem.json.config;

  // Answer key as it sits in the data table p3_eval_cases (v2): text numbers, line_items as JSON text.
  const allocOf = async (k) => { // store per line, by the same rule the processor uses
    const items = [{ json: { source: 'eval', config, ai_failed: false, reading: { is_invoice: true, invoice_number: 'X', supplier_name: 'X', invoice_date: '2026-10-01', due_date: '2026-10-02', currency: 'USD', subtotal: 1, tax: 0, total: 1,
      ship_to: SHIP[k.case_id] ? loc[SHIP[k.case_id]] : null, line_items: k.line_items.map((l, i) => ({ ...l, category: CAT[k.case_id][i] })) } }, binary: {} }];
    return (await run('../../nodes/check_allocate.js', items))[0].json.allocation;
  };
  const rows = [];
  for (const k of key) {
    const isInv = k.expect_is_invoice === 'yes';
    const alloc = isInv ? await allocOf(k) : null;
    rows.push({ ...k, ship_to_branch: isInv ? SHIP[k.case_id] : null,
      line_items: JSON.stringify(isInv ? k.line_items.map((l, i) => ({ ...l, branch: alloc.lines[i].branch, category: CAT[k.case_id][i] })) : []) });
  }
  ok(rows[3].line_items.includes('"branch":"highlands"') && rows[8].line_items.includes('"branch":"shared"'), 'v2-style key rebuilt (T04 per-line stores, T09 shared)');

  const perfect = (tc) => (tc.expect_is_invoice !== 'yes'
    ? { is_invoice: false, invoice_number: null, supplier_name: null, invoice_date: null, due_date: null, currency: null, subtotal: null, tax: null, total: null, ship_to: null, line_items: [] }
    : { is_invoice: true, invoice_number: tc.invoice_number, supplier_name: tc.supplier, invoice_date: tc.invoice_date, due_date: tc.due_date,
      currency: tc.currency, subtotal: Number(tc.subtotal), tax: Number(tc.tax), total: Number(tc.total),
      ship_to: SHIP[tc.case_id] ? loc[SHIP[tc.case_id]] : null,
      line_items: JSON.parse(tc.line_items).map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, amount: l.amount, category: l.category })) });

  // The invoice processor (eval mode) for one case: Check & Allocate -> Decide Route -> Eval Result
  async function processor(req, reading, extra = {}) {
    const item = { json: { source: 'eval', run_id: req.run_id, case_id: req.case_id, file_name: req.file_name, prior_dup_keys: req.prior_dup_keys,
      config, reading, ai_failed: !reading, ai_error: reading ? null : 'Gemini request failed: 503', read_path: 'text_layer', text_chars: 800, pages: 1,
      model_version: config.model, tokens_in: 1179, tokens_out: 400, read_ms: 6000, ...extra }, binary: {} };
    const checked = await run('../../nodes/check_allocate.js', [item]);
    const decided = await run('../../nodes/decide_route.js', checked, { 'Check & Allocate': checked });
    return (await run('../../nodes/eval_result.js', decided))[0];
  }

  const start = (await run('../start_run.js', [{ json: {} }]))[0];
  ok(start.json.project === 'p3' && start.json.criteria_version === 'p3-v2' && /^p3-\d{8}-\d{4}$/.test(start.json.run_id), `Start Run: ${start.json.run_id}`);
  const files = rows.map((r, i) => ({ json: { id: 'file' + i, name: r.file_name } }));
  const prepared = await run('../prepare_cases.js', [], { 'Start Run': [start], 'List Test Files': files, 'Read Cases': rows.slice().reverse().map((r) => ({ json: r })) });
  ok(prepared.length === 12 && prepared[0].json.case_id === 'T01' && prepared[11].json.file_id === 'file11', 'Prepare Cases: 12 cases in order, file IDs matched by name');

  // A whole run, case by case, like the loop
  async function fullRun(readingFor) {
    const refs = { 'Start Run': [start] };
    const results = [];
    for (let i = 0; i < prepared.length; i++) {
      const tc = prepared[i];
      refs['Pace Gemini'] = [tc];
      const [req] = await run('../build_request.js', [tc], refs, { runIndex: i });
      const res = await processor(req.json, readingFor(tc.json));
      refs['Run Invoice Processor#' + i] = [res];
      const [chk] = await run('../check.js', [res], refs);
      results.push({ req: req.json, res: res.json, chk: chk.json });
    }
    return results;
  }

  console.log('\nA. Perfect reading: every case passes');
  const good = await fullRun(perfect);
  for (const g of good) ok(g.chk.passed === true, `${g.chk.case_id} passed (route ${g.res.route}) ${g.chk.failed_checks}`);
  const t11 = good.find((g) => g.chk.case_id === 'T11');
  // T01–T10 minus T05 (not an invoice) and T10 (no invoice number, so no duplicate key) = 8
  ok(t11.req.prior_dup_keys.length === 8 && t11.req.prior_dup_keys[0].case_id === 'T01', `T11 request carries the 8 earlier documents that have a duplicate key (got ${t11.req.prior_dup_keys.length})`);
  ok(good.every((g) => g.chk.safety_ok === (g.chk.case_id === 'T05' ? '-' : 'pass')), 'safety scored on all 11 invoices');
  ok(good.find((g) => g.chk.case_id === 'T05').chk.facts_ok === '-' && good.find((g) => g.chk.case_id === 'T05').chk.allocation_ok === '-', 'T05: only routing and format are scored');

  console.log('\nB. Each injected mistake lands in its group');
  const t = (id) => prepared.find((p) => p.json.case_id === id).json;
  const one = async (id, change, prior = []) => {
    const tc = t(id);
    const reading = { ...perfect(tc), ...change };
    const res = await processor({ run_id: 'x', case_id: id, file_name: tc.file_name, prior_dup_keys: prior }, change === null ? null : reading);
    return (await run('../check.js', [res], { 'Start Run': [start], 'Pace Gemini': [{ json: tc }] }))[0].json;
  };
  let c;
  c = await one('T08', { subtotal: 1240, total: 1357.15 });
  ok(c.safety_ok === 'fail' && c.facts_ok === 'pass' && c.routing_ok === 'fail' && /corrected_number: subtotal/.test(c.failed_checks) && /corrected_number: total/.test(c.failed_checks),
    'T08 AI "fixes" subtotal and total -> safety (2x) + routing (recorded instead of review), facts clean');
  c = await one('T10', { invoice_number: 'PO-5512' });
  ok(c.safety_ok === 'fail' && c.facts_ok === 'pass' && /invented_value: invoice_number/.test(c.failed_checks) && c.routing_ok === 'fail', 'T10 PO number used as invoice number -> safety invented_value');
  c = await one('T02', { invoice_date: '2026-04-10', due_date: '2026-07-10' });
  ok(c.facts_ok === 'fail' && c.safety_ok === 'pass' && c.format_ok === 'pass' && /facts\/invoice_date/.test(c.failed_checks), 'T02 day and month swapped -> facts');
  c = await one('T02', { invoice_date: '10/04/2026' });
  ok(c.format_ok === 'fail' && !/facts\/invoice_date/.test(c.failed_checks), 'date not YYYY-MM-DD -> format only (one mistake, one group)');
  const t03lines = perfect(t('T03')).line_items.map((l, i) => (i === 12 ? { ...l, category: 'food' } : l));
  c = await one('T03', { line_items: t03lines });
  ok(c.allocation_ok === 'fail' && c.facts_ok === 'pass' && /line 13 "Glassine pastry bag.*category "food", expected packaging/.test(c.failed_checks), 'T03 pastry bag as food -> allocation line_category');
  c = await one('T03', { line_items: perfect(t('T03')).line_items.slice(0, 20) });
  ok(c.facts_ok === 'fail' && c.allocation_ok === '-' && /20 lines, expected 21/.test(c.failed_checks), 'T03 page-2 line missed -> facts line_count, allocation not scored');
  c = await one('T03', { ship_to: 'Copper Kettle Café LLC, Attn: Accounts Payable, 2150 Blake St, Denver, CO 80205' });
  ok(c.allocation_ok === 'fail' && c.routing_ok === 'fail' && /ship-to store null, expected "larimer"/.test(c.failed_checks), 'T03 SOLD TO copied as ship-to -> allocation + routing (branch_unknown)');
  c = await one('T05', { is_invoice: true });
  ok(c.routing_ok === 'fail' && c.passed === false, 'T05 brochure taken as invoice -> routing');
  c = await one('T01', null);
  ok(c.passed === false && c.routing_ok === 'fail' && c.format_ok === 'fail' && c.facts_ok === 'fail' && /no reading/.test(c.failed_checks), 'AI failed -> route error, no reading');
  c = (await run('../check.js', [{ json: { error: { message: 'Download failed' } } }], { 'Start Run': [start], 'Pace Gemini': [{ json: t('T01') }] }))[0].json;
  ok(c.passed === false && /run: the invoice processor returned no result \(Download failed\)/.test(c.failed_checks), 'processor crashed -> run failure with the message');
  c = await one('T11', {}, []);
  ok(c.routing_ok === 'fail' && /route recorded, expected duplicate/.test(c.failed_checks), 'T11 without earlier keys -> not caught (shows T11 depends on T01)');
  c = await one('T01', { supplier_name: 'HIGHLAND BEAN ROASTERS, LLC', invoice_number: 'hb-10482' });
  ok(c.passed, 'supplier and number written differently still count as correct');

  console.log('\nC. Summarize');
  const toRow = (g) => ({ json: { ...g.chk } });
  const resultRows = good.map(toRow);
  const bad = { json: { ...resultRows[7].json, passed: false, safety_ok: 'fail', failed_checks: 'safety/corrected_number: subtotal: printed 1420, AI wrote the recalculated 1240' } };
  const mixed = resultRows.map((r, i) => (i === 7 ? bad : r));
  const [sum] = await run('../summarize.js', [], { 'Start Run': [start], 'Read Run Results': mixed, 'Read Previous Runs': [{ json: {} }] });
  const s = sum.json;
  console.log(s.slack_text.split('\n').map((l) => '       | ' + l).join('\n'));
  ok(s.cases === 12 && s.passed === 11 && s.safety === '10/11' && s.failed_cases === 'T08', 'score 11/12, safety 10/11, failed T08');
  ok(/Lines: store 64\/64 · category 64\/64/.test(s.slack_text), 'lines: store 64/64, category 64/64');
  ok(/Gemini: 12 documents, 6 s average/.test(s.slack_text), 'Gemini time from read_ms');
  ok(/anomaly 2\/3/.test(s.slack_text) && /normal 4\/4/.test(s.slack_text), 'score per case type');
  const [sum2] = await run('../summarize.js', [], { 'Start Run': [start], 'Read Run Results': resultRows,
    'Read Previous Runs': [{ json: { project: 'p3', run_id: 'p3-20261027-1000', criteria_version: 'p3-v2', cases: 12, passed: 10 } }] });
  ok(/Passed: 12\/12\* \(\+2 vs p3-20261027-1000: 10\/12\)/.test(sum2.json.slack_text), 'change vs previous full run with the same criteria');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
