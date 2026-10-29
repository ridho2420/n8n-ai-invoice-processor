// One evaluation run of the Copper Kettle invoice processor (Project 3).
// CRITERIA_VERSION goes up whenever a check or a test case changes.
// Scores are only compared between runs with the same criteria version.
const CRITERIA_VERSION = 'p3-v2';
// What changed since the last run (prompt, model, rule). Updated before each run.
const NOTE = 'Regression check after stages 6-7: Config now holds QuickBooks IDs, Gemini retries 3 to 5. Prompt unchanged (p3-prompt-v2)';
// For a quick test, list case IDs here (for example ['T01', 'T11']). Empty = all cases.
const ONLY = [];

const now = $now.setZone('Asia/Jakarta');
return [{
  json: {
    project: 'p3',
    run_id: 'p3-' + now.toFormat('yyyyLLdd-HHmm'),
    criteria_version: CRITERIA_VERSION,
    note: NOTE,
    started_at: $now.toISO(),
    only: ONLY,
  },
}];
