// Local tests for the stage 2 parse, stage 4 and stage 5 Code nodes, run outside n8n.
// Usage: NODE_PATH=<dir with luxon> node stage45.test.js <p3-eval-cases-v1.json or v2> <p3-test-set-source.json>
// (needs `npm install luxon`; the node files are read from ../nodes)
// A. The 12 test documents, read perfectly (answer key as the AI reading), go through
//    Check & Allocate and Decide Route like an eval run: every route and reason must match the key.
// B. Unit tests for the rules that have no PDF of their own (design doc, section 4).
// C. Email mode: earlier invoices come from Airtable records.
// D. Parse Reading handles Gemini errors, empty replies and broken JSON.
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const NODES = path.join(__dirname, '..', 'nodes');
const code = (f) => fs.readFileSync(path.join(NODES, f), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Minimal n8n Code node: runOnceForAllItems (default) or runOnceForEachItem.
async function run(file, input, refs = {}, opts = {}) {
  const $input = { all: () => input, first: () => input[0], item: input[0] };
  const $now = opts.now || DateTime.now();
  const $execution = { id: 'test-exec' };
  if (opts.eachItem) {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const $ = (name) => ({ all: () => refs[name], first: () => refs[name][0], item: refs[name][i] });
      const fn = new AsyncFunction('$input', '$json', '$', '$now', '$execution', code(file));
      out.push(await fn({ ...$input, item: input[i] }, input[i].json, $, $now, $execution));
    }
    return out;
  }
  const $ = (name) => ({ all: () => refs[name], first: () => refs[name][0], item: refs[name][0] });
  const fn = new AsyncFunction('$input', '$json', '$', '$now', '$execution', code(file));
  return fn($input, input[0] && input[0].json, $, $now, $execution);
}

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const rawKey = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const key = Array.isArray(rawKey) ? rawKey : rawKey.cases; // p3-eval-cases-v1/v2.json or _check.json
  const src = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const loc = src.company.locations;
  const SHIP = { T01: 'larimer', T02: 'highlands', T03: 'larimer', T04: null, T06: 'washpark', T07: 'larimer',
    T08: 'highlands', T09: null, T10: 'washpark', T11: 'larimer', T12: 'washpark' };

  const [cfgItem] = await run('config.js', [{ json: { source: 'eval' }, binary: { data: { fileName: 'x.pdf' } } }]);
  const config = cfgItem.json.config;
  ok(config.system_prompt.includes('Categories:\n- coffee_tea (Coffee & Tea)'), 'config: prompt ends with the category list');
  ok(cfgItem.binary && cfgItem.binary.data, 'config: binary passed through');

  const readingFromKey = (k) => (k.expect_is_invoice !== 'yes'
    ? { is_invoice: false, invoice_number: null, supplier_name: null, invoice_date: null, due_date: null, currency: null,
      subtotal: null, tax: null, total: null, ship_to: null, line_items: [] }
    : { is_invoice: true, invoice_number: k.invoice_number, supplier_name: k.supplier, invoice_date: k.invoice_date,
      due_date: k.due_date, currency: k.currency, subtotal: Number(k.subtotal), tax: Number(k.tax), total: Number(k.total),
      ship_to: SHIP[k.case_id] ? loc[SHIP[k.case_id]] : null,
      line_items: k.line_items.map((l) => ({ ...l, category: l.category || 'packaging' })) }); // v1 key has no categories

  const parsed = (extra) => ({ json: { source: 'eval', run_id: 'p3-test', file_name: 'f.pdf', prior_dup_keys: [], config,
    reading: null, ai_failed: false, ai_error: null, read_path: 'text_layer', ...extra }, binary: { data: { fileName: 'f.pdf' } } });

  async function route(items) {
    const checked = await run('check_allocate.js', items);
    const decided = await run('decide_route.js', checked, { 'Check & Allocate': checked });
    return { checked, decided };
  }

  console.log('\nA. Twelve test documents as an eval run (reading = answer key)');
  const prior = [];
  for (const k of key) {
    const item = parsed({ case_id: k.case_id, file_name: k.file_name, reading: readingFromKey(k), prior_dup_keys: [...prior] });
    const { decided } = await route([item]);
    const d = decided[0].json;
    const wantReasons = k.expect_reason ? [k.expect_reason] : [];
    ok(d.route === k.expect_route && same(d.reasons, wantReasons),
      `${k.case_id} ${d.route} [${d.reasons.join(',')}]` + (d.duplicate_of ? ` duplicate of ${d.duplicate_of.ref}` : ''));
    if (k.duplicate_of) ok(d.duplicate_of && d.duplicate_of.ref === k.duplicate_of, `${k.case_id} points to ${k.duplicate_of}`);
    if (d.route === 'recorded' || d.route === 'needs_review') prior.push({ dup_key: d.dup_key, total: d.invoice.total, case_id: k.case_id });
    const [res] = await run('eval_result.js', decided);
    ok(res.json.case_id === k.case_id && res.json.route === d.route && Array.isArray(res.json.reasons) && 'dup_key' in res.json,
      `${k.case_id} eval result shape`);
  }
  const t08 = (await route([parsed({ reading: readingFromKey(key[7]) })])).checked[0].json;
  ok(same(t08.details.sum_mismatch, { lines_total: 1240, subtotal: 1420, difference: 180 }), 'T08 details: 1,240.00 vs 1,420.00, $180.00 difference');
  const t09 = (await route([parsed({ reading: readingFromKey(key[8]) })])).checked[0].json;
  ok(same(t09.allocation.lines.map((l) => l.branch), ['shared', 'highlands']), 'T09 branches: shared, highlands');
  const t04 = (await route([parsed({ reading: readingFromKey(key[3]) })])).checked[0].json;
  ok(t04.allocation.ship_to_branch === null && same(t04.allocation.lines.map((l) => l.branch), ['larimer', 'highlands', 'washpark', 'larimer', 'highlands']), 'T04 branches from each line');
  const t02 = (await route([parsed({ reading: readingFromKey(key[1]) })])).checked[0].json;
  const t12 = (await route([parsed({ reading: readingFromKey(key[11]) })])).checked[0].json;
  ok(t02.dup_key === 'meadow dairy|INV-2041' && t12.dup_key === 'packright packaging supply|INV-2041', `dup keys differ by supplier: ${t02.dup_key} / ${t12.dup_key}`);

  console.log('\nB. Rules without a PDF of their own');
  const base = readingFromKey(key[0]); // T01, clean
  const one = async (change, extra = {}) => (await route([parsed({ reading: { ...JSON.parse(JSON.stringify(base)), ...change }, ...extra })])).decided[0].json;
  let d;
  d = await one({}); ok(d.route === 'recorded' && !d.reasons.length, 'clean T01 -> recorded');
  d = await one({ supplier_name: null }); ok(same(d.reasons, ['missing_supplier']) && d.dup_key === null, 'missing_supplier (and no dup key)');
  d = await one({ invoice_date: '10/02/2026' }); ok(same(d.reasons, ['missing_invoice_date']), 'date not written YYYY-MM-DD -> missing_invoice_date');
  d = await one({ invoice_date: '2026-02-30' }); ok(d.reasons.includes('missing_invoice_date'), 'impossible date 2026-02-30 -> missing_invoice_date');
  d = await one({ total: null }); ok(same(d.reasons, ['missing_total']), 'missing_total');
  d = await one({ line_items: [] }); ok(same(d.reasons, ['missing_line_items', 'sum_mismatch'].filter((r) => r !== 'sum_mismatch')) , 'missing_line_items only (no sum check on zero lines)');
  const bad = JSON.parse(JSON.stringify(base)); bad.line_items[1].amount = 274; bad.subtotal = 799; bad.total = 799;
  d = await one(bad); ok(same(d.reasons, ['line_math_mismatch']) && d.details.line_math_mismatch.lines[0].line_no === 2 && d.details.line_math_mismatch.lines[0].expected === 272, 'line_math_mismatch on line 2 (4 x 68.00 = 272.00, printed 274.00)');
  const noAmt = JSON.parse(JSON.stringify(base)); noAmt.line_items[0].amount = null;
  d = await one(noAmt); ok(d.reasons.includes('line_math_mismatch') && d.reasons.includes('sum_mismatch'), 'line amount not read -> line_math_mismatch + sum_mismatch');
  d = await one({ total: 800 }); ok(same(d.reasons, ['total_mismatch']) && d.details.total_mismatch.expected === 797, 'total_mismatch (797.00 + 0.00 vs 800.00)');
  d = await one({ total: 797.01 }); ok(d.route === 'recorded', '1 cent difference is rounding -> recorded');
  d = await one({ tax: null }); ok(d.route === 'recorded', 'tax not printed (null) counts as 0');
  d = await one({ subtotal: null }); ok(d.route === 'recorded', 'no subtotal: lines + tax compared with total');
  d = await one({ invoice_date: '2099-01-02', due_date: '2099-02-01' }); ok(same(d.reasons, ['future_date']), 'future_date');
  d = await one({ due_date: null }); ok(d.route === 'recorded', 'empty due date does not send to review');
  d = await one({ currency: 'cad' }); ok(same(d.reasons, ['currency_not_usd']), 'currency_not_usd (cad)');
  d = await one({ currency: null }); ok(d.route === 'recorded', 'currency not printed is not flagged');
  d = await one({ ship_to: 'Copper Kettle Café LLC, Attn: Accounts Payable, 2150 Blake St, Denver, CO 80205' });
  ok(same(d.reasons, ['branch_unknown']) && d.details.branch_unknown.lines === 4 && d.details.branch_unknown.amount === 797, 'bill-to copied as ship-to -> branch_unknown (4 lines, $797.00)');
  const cat = JSON.parse(JSON.stringify(base)); cat.line_items[0].category = null; cat.line_items[1].category = 'coffee';
  d = await one(cat); ok(same(d.reasons, ['uncategorized_line']) && d.details.uncategorized_line.lines === 2, 'uncategorized_line (null and an invented code)');
  d = await one({ quantity: 1 }); ok(d.route === 'recorded', 'unknown extra field ignored');
  d = await one({ subtotal: '797.00', total: '$797.00' }); ok(d.route === 'recorded', 'numbers sent as text are read as numbers');
  d = await one({}, { prior_dup_keys: [{ dup_key: 'highland bean roasters|HB-10482', total: 790, case_id: 'T00' }] });
  ok(d.route === 'needs_review' && same(d.reasons, ['duplicate_amount_differs']), 'same key, different total -> duplicate_amount_differs');
  d = await one({ supplier_name: 'HIGHLAND BEAN ROASTERS, LLC', invoice_number: 'hb-10482 ' }, { prior_dup_keys: [{ dup_key: 'highland bean roasters|HB-10482', total: 797, case_id: 'T01' }] });
  ok(d.route === 'duplicate', 'supplier and number written differently still match (LLC, case, spaces)');
  d = await one({ total: null }, { prior_dup_keys: [{ dup_key: 'highland bean roasters|HB-10482', total: 797, case_id: 'T01' }] });
  ok(d.route === 'needs_review' && d.reasons.includes('duplicate_amount_differs'), 'same key but total not read -> review, not silently skipped');
  d = await one({ is_invoice: false }); ok(d.route === 'not_invoice' && !d.reasons.length, 'is_invoice false -> not_invoice, no validation');
  d = (await route([parsed({ reading: null, ai_failed: true, ai_error: 'Gemini request failed: 429' })])).decided[0].json;
  ok(d.route === 'error' && d.error_step === 'read' && d.error_message.includes('429'), 'AI failed -> error with the message kept');
  const two = await route([parsed({ case_id: 'A', reading: base }), parsed({ case_id: 'B', reading: base })]);
  ok(two.decided[0].json.route === 'recorded' && two.decided[1].json.route === 'duplicate', 'same invoice twice in one email -> second is duplicate');
  ok(two.decided.every((x) => x.binary && x.binary.data), 'binary (the PDF) kept for stage 6');
  ok(two.checked[0].json.dup_lookup_formula === 'OR({Dup key}="highland bean roasters|HB-10482")', 'Airtable formula: one key even with two copies');
  const mixed = await run('check_allocate.js', [parsed({ reading: base }), parsed({ reading: readingFromKey(key[11]) }), parsed({ reading: readingFromKey(key[4]) })]);
  ok(mixed[2].json.dup_lookup_formula === 'OR({Dup key}="highland bean roasters|HB-10482",{Dup key}="packright packaging supply|INV-2041")', 'Airtable formula: two invoices + a brochure in one email');
  const noKey = await run('check_allocate.js', [parsed({ reading: readingFromKey(key[4]) })]);
  ok(noKey[0].json.dup_lookup_formula === 'FALSE()', 'Airtable formula: no keys -> FALSE() (finds nothing)');
  const quote = await run('check_allocate.js', [parsed({ reading: { ...base, invoice_number: 'A"1\\2' } })]);
  ok(quote[0].json.dup_lookup_formula === 'OR({Dup key}="highland bean roasters|A\\"1\\\\2")', 'Airtable formula: quotes and backslashes escaped');

  console.log('\nC. Email mode: earlier invoices from Airtable');
  const gm = (r) => parsed({ source: 'gmail', reading: r });
  const checked = await run('check_allocate.js', [gm(base)]);
  const airtableHit = [{ json: { id: 'recABC123', createdTime: '2026-10-28T06:00:00.000Z', 'Dup key': 'highland bean roasters|HB-10482', Total: 797, Invoice: 'Highland Bean Roasters · HB-10482', 'Received at': '2026-10-28T05:47:02.000Z', Status: 'Recorded' } }];
  d = (await run('decide_route.js', airtableHit, { 'Check & Allocate': checked }))[0].json;
  ok(d.route === 'duplicate' && d.duplicate_of.ref === 'recABC123', 'Airtable record with same key and total -> duplicate (flattened fields)');
  d = (await run('decide_route.js', [{ json: { id: 'recABC123', fields: { 'Dup key': 'highland bean roasters|HB-10482', Total: 700 } } }], { 'Check & Allocate': checked }))[0].json;
  ok(d.route === 'needs_review' && d.reasons.includes('duplicate_amount_differs'), 'Airtable record (nested fields) with different total -> review');
  d = (await run('decide_route.js', [{ json: {} }], { 'Check & Allocate': checked }))[0].json;
  ok(d.route === 'recorded' && d.earlier_found === 0, 'no Airtable match (empty item from alwaysOutputData) -> recorded');
  const evalPrior = await run('check_allocate.js', [parsed({ reading: base, prior_dup_keys: [] })]);
  d = (await run('decide_route.js', evalPrior, { 'Check & Allocate': evalPrior }))[0].json;
  ok(d.route === 'recorded', 'test file ignores Airtable input entirely');

  console.log('\nD. Parse Reading');
  const rp = [{ json: { case_id: 'T01', config, read_started_at: Date.now() - 1500, gemini_request: { big: true } }, binary: { data: {} } }];
  const reply = (text, extra = {}) => [{ json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1179, candidatesTokenCount: 435 }, modelVersion: 'gemini-3.5-flash-lite', ...extra } }];
  let p = (await run('parse_reading.js', reply('{"is_invoice":true}'), { 'Read Path': rp }, { eachItem: true }))[0].json;
  ok(p.reading.is_invoice === true && !p.ai_failed && !('gemini_request' in p) && p.tokens_in === 1179 && p.read_ms >= 1500, 'good reply parsed, request dropped, tokens kept');
  p = (await run('parse_reading.js', [{ json: { error: { message: 'The service is receiving too many requests', httpCode: '429' } } }], { 'Read Path': rp }, { eachItem: true }))[0].json;
  ok(p.ai_failed && p.ai_error.startsWith('Gemini request failed: The service'), 'HTTP error item -> ai_failed with message');
  p = (await run('parse_reading.js', reply('{"is_invoice":tr'), { 'Read Path': rp }, { eachItem: true }))[0].json;
  ok(p.ai_failed && /not valid JSON/.test(p.ai_error), 'cut-off JSON -> ai_failed');
  p = (await run('parse_reading.js', [{ json: { candidates: [{ finishReason: 'SAFETY' }] } }], { 'Read Path': rp }, { eachItem: true }))[0].json;
  ok(p.ai_failed && /SAFETY/.test(p.ai_error), 'no text (SAFETY) -> ai_failed with the reason');
  p = (await run('parse_reading.js', reply('[1,2]'), { 'Read Path': rp }, { eachItem: true }))[0].json;
  ok(p.ai_failed, 'JSON array instead of object -> ai_failed');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
