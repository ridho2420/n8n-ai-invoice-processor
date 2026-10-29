// Matches every test case with its PDF in the Drive folder "test-set" (by file name),
// in case order. A quick test can limit the cases with ONLY in "Start Run".
// A case whose file is missing still runs, so the failure shows up in the results.
const start = $('Start Run').first().json;
const only = Array.isArray(start.only) ? start.only.map(String) : [];
const files = {};
for (const f of $('List Test Files').all()) {
  if (f.json && f.json.name) files[f.json.name] = f.json.id;
}
const rows = $('Read Cases').all().map((i) => i.json)
  .filter((r) => r.case_id && (!only.length || only.includes(String(r.case_id))))
  .sort((a, b) => Number(a.ord) - Number(b.ord));
return rows.map((r) => ({
  json: { ...r, run_id: start.run_id, file_id: files[r.file_name] || null },
}));
