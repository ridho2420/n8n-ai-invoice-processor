// Requests from the Eval Runner (or the dev door), cleaned up before the download.
// prior_dup_keys = earlier documents of the same eval run (for the duplicate check);
// accepted as a list or as JSON text.
const list = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
};
return $input.all().map(i => {
  const r = i.json;
  return { json: {
    source: r.source || 'eval',
    run_id: r.run_id ? String(r.run_id) : null,
    case_id: r.case_id ? String(r.case_id) : null,
    file_id: String(r.file_id || ''),
    file_name: String(r.file_name || ''),
    prior_dup_keys: list(r.prior_dup_keys),
  } };
});
