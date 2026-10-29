// Copper Kettle – Error Alerts: runs when the Invoice Processor stops with an error
// (production runs only). Writes the alert for #automation-errors and one row for
// p3_processing_log. The run may have stopped half-way, so the message says how to
// check what was already recorded before the email is forwarded again.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (s, n = 400) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Hint by the node that failed (node names of the Invoice Processor).
const HINTS = [
  [/QuickBooks|Create Bill|Attach PDF/i, 'QuickBooks: in n8n, check that the credential uses the Sandbox environment and reconnect it (open n8n through the ngrok address).'],
  [/Gmail|Email|Drive|Test File/i, 'Google: reconnect the Gmail and Drive credentials, opening n8n through the ngrok address. The Google app is in Testing, so access expires every 7 days.'],
  [/Airtable|Invoice Record|Line Items|Earlier Invoices|Bill ID/i, 'Airtable: check the token "n8n Copper Kettle AP" and that no field in the base was renamed.'],
  [/Gemini/i, 'Gemini: check the API key, the model name and the quota.'],
  [/Slack/i, 'Slack: check that Invoice Bot is still in the channel and its token is valid.'],
  [/Save Log/i, 'n8n data table p3_processing_log: check that the table and its columns still exist.'],
];

const out = [];
for (const item of $input.all()) {
  const e = item.json || {};
  const exec = e.execution || null;
  const wfName = (e.workflow && e.workflow.name) || 'A workflow';
  const failedAt = exec ? exec.lastNodeExecuted : (e.trigger && e.trigger.error && e.trigger.error.node && e.trigger.error.node.name) || 'the trigger';
  const error = exec ? exec.error : (e.trigger && e.trigger.error) || {};
  const message = (error && (error.message || error.description)) || 'unknown error';
  const hint = (HINTS.find(([re]) => re.test(failedAt || '')) || [null, 'This looks like a bug in a code step. Open the execution and fix it before forwarding the email again.'])[1];
  const execRef = exec ? `execution ${exec.id}` : 'no execution was started';

  const lines = [
    `🛑 ${esc(wfName)} stopped at "${esc(failedAt)}" (${execRef}).`,
    exec
      ? `Impact: the invoices in this run may be only partly recorded. Before forwarding the email again, look in Airtable for records with Execution ID ${exec.id}, so nothing is recorded twice.`
      : 'Impact: no email was processed.',
    'Saved: the email is still in the inbox.',
    `Next: ${hint}`,
    `Error: ${esc(short(message))}`,
  ];
  if (exec && exec.url) lines.push(`<${exec.url}|Open the execution>`);

  out.push({
    json: {
      text: lines.join('\n'),
      log: {
        received_at: new Date().toISOString(),
        mode: 'error_workflow',
        route: 'error',
        error_step: String(failedAt),
        error_message: short(message, 1000),
        execution_id: exec ? String(exec.id) : null,
      },
    },
  });
}
return out;
