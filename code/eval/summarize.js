// One summary per run: score, score per check group, accuracy per field and per line
// (store and category), score per case type, Gemini time per document, change vs the
// previous full run with the same criteria version, and the failed cases.
const start = $('Start Run').first().json;
const rows = $('Read Run Results').all().map((i) => i.json)
  .filter((r) => r.run_id === start.run_id)
  .sort((a, b) => String(a.case_id).localeCompare(String(b.case_id)));
const isPass = (v) => v === true || v === 'true';
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
const total = rows.length;
const passed = rows.filter((r) => isPass(r.passed)).length;
const group = (name) => {
  const have = rows.filter((r) => r[name + '_ok'] === 'pass' || r[name + '_ok'] === 'fail');
  return have.filter((r) => r[name + '_ok'] === 'pass').length + '/' + have.length;
};
const details = rows.map((r) => ({ case_id: r.case_id, passed: isPass(r.passed), ...parse(r.detail) }));

// Fields, over the invoices of the run (a run failure counts as wrong)
const invoices = details.filter((d) => d.key_lines > 0);
const FIELDS = ['invoice_number', 'supplier', 'invoice_date', 'due_date', 'currency', 'subtotal', 'tax', 'total', 'line_items'];
const fieldScore = {};
for (const f of FIELDS) fieldScore[f] = invoices.filter((d) => d.fields && d.fields[f] === 'ok').length + '/' + invoices.length;

// Lines: store and category per line, over all answer-key lines of the invoices in the run
const keyLines = invoices.reduce((s, d) => s + (d.key_lines || 0), 0);
const compared = invoices.reduce((s, d) => s + (d.lines_compared || 0), 0);
const branchOk = invoices.reduce((s, d) => s + (d.branch_ok || 0), 0);
const categoryOk = invoices.reduce((s, d) => s + (d.category_ok || 0), 0);

// Case types
const types = {};
for (const d of details) {
  const t = d.case_type || 'unknown';
  types[t] = types[t] || { passed: 0, cases: 0 };
  types[t].cases++;
  if (d.passed) types[t].passed++;
}

// Gemini: one call per document (retries inside n8n are not counted)
const times = rows.map((r) => Number(r.read_ms)).filter((n) => Number.isFinite(n) && n > 0);
const avgSeconds = times.length ? Math.round(times.reduce((s, n) => s + n, 0) / times.length / 100) / 10 : null;
const maxSeconds = times.length ? Math.round(Math.max(...times) / 100) / 10 : null;

const prev = $('Read Previous Runs').all().map((i) => i.json)
  // Only full runs of the same size and criteria are comparable (a quick test with ONLY is not).
  .filter((r) => r.run_id && r.run_id !== start.run_id && r.project === start.project
    && r.criteria_version === start.criteria_version && Number(r.cases) === total)
  .sort((a, b) => String(b.run_id).localeCompare(String(a.run_id)))[0];
const failed = rows.filter((r) => !isPass(r.passed));

let delta = '';
if (prev) {
  const d = passed - Number(prev.passed);
  delta = ` (${d > 0 ? '+' + d : d === 0 ? '±0' : d} vs ${prev.run_id}: ${prev.passed}/${prev.cases})`;
}
const weakFields = FIELDS.filter((f) => !fieldScore[f].startsWith(String(invoices.length) + '/'));
const lines = [];
lines.push(`:test_tube: *Eval run ${start.run_id}* · Copper Kettle invoice processor · criteria ${start.criteria_version}`);
lines.push(`*Passed: ${passed}/${total}*${delta}`);
lines.push(`Routing ${group('routing')} · Facts ${group('facts')} · Safety ${group('safety')} · Format ${group('format')} · Allocation ${group('allocation')}`);
if (keyLines) lines.push(`Lines: store ${branchOk}/${keyLines} · category ${categoryOk}/${keyLines}` + (compared < keyLines ? ` (${keyLines - compared} lines not compared: line count wrong)` : ''));
if (invoices.length) lines.push('Fields: ' + (weakFields.length ? weakFields.map((f) => `${f} ${fieldScore[f]}`).join(' · ') : `all ${FIELDS.length} fields ${invoices.length}/${invoices.length}`));
lines.push('By type: ' + Object.entries(types).map(([t, v]) => `${t} ${v.passed}/${v.cases}`).join(' · '));
if (avgSeconds !== null) lines.push(`Gemini: ${times.length} documents, ${avgSeconds} s average, ${maxSeconds} s slowest`);
if (failed.length) {
  lines.push('*Failed:*');
  for (const r of failed) lines.push(`• ${r.case_id}: ${String(r.failed_checks).split(' | ').slice(0, 2).join('; ').slice(0, 240)}`);
}
if (start.note) lines.push(`_Change: ${start.note}_`);

return [{
  json: {
    project: start.project,
    run_id: start.run_id,
    criteria_version: start.criteria_version,
    note: start.note,
    cases: total,
    passed,
    routing: group('routing'),
    facts: group('facts'),
    safety: group('safety'),
    format: group('format'),
    allocation: group('allocation'),
    failed_cases: failed.map((r) => r.case_id).join(', '),
    started_at: start.started_at,
    finished_at: $now.toISO(),
    detail: JSON.stringify({ fields: fieldScore, lines: { key_lines: keyLines, compared, store_ok: branchOk, category_ok: categoryOk },
      types, gemini: { documents: times.length, avg_seconds: avgSeconds, max_seconds: maxSeconds } }),
    slack_text: lines.join('\n'),
  },
}];
