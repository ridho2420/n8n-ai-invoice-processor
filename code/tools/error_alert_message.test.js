// Local test for the Error Alerts message. Usage: node error_alert_message.test.js
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'error_alert_message.js'), 'utf8');
const run = (input) => new Function('$input', code)({ all: () => input.map((json) => ({ json })) });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const failure = (node, message) => ({ execution: { id: '501', url: 'https://n8n.example.com/workflow/abc/executions/501', error: { message }, lastNodeExecuted: node, mode: 'trigger' },
  workflow: { id: 'YOUR_INVOICE_PROCESSOR_WORKFLOW_ID', name: 'Copper Kettle – Invoice Processor' } });

const [bill] = run([failure('Create Bill', 'Bad request - please check your parameters')]);
console.log('\n' + bill.json.text + '\n');
const lines = bill.json.text.split('\n');
ok(lines[0] === '🛑 Copper Kettle – Invoice Processor stopped at "Create Bill" (execution 501).', 'workflow, node and execution');
ok(/Execution ID 501, so nothing is recorded twice/.test(lines[1]) && lines[2] === 'Saved: the email is still in the inbox.', 'partly recorded warning and what is saved');
ok(/^Next: QuickBooks: .*Sandbox/.test(lines[3]) && lines[4] === 'Error: Bad request - please check your parameters' && lines[5] === '<https://n8n.example.com/workflow/abc/executions/501|Open the execution>', 'QuickBooks hint, error, link');
ok(/^Next: QuickBooks/.test(run([failure('Attach PDF to Bill', 'x')])[0].json.text.split('\n')[3]) && /^Next: Airtable/.test(run([failure('Save Bill ID', 'x')])[0].json.text.split('\n')[3]), '"Create Bill" is QuickBooks, "Save Bill ID" is Airtable');
ok(/^Next: Google/.test(run([failure('Save PDF to Drive', 'x')])[0].json.text.split('\n')[3]) && /^Next: Google/.test(run([failure('New Invoice Email', 'x')])[0].json.text.split('\n')[3]), 'Drive and Gmail: Google login');
ok(/^Next: Airtable/.test(run([failure('Create Invoice Record', 'x')])[0].json.text.split('\n')[3]) && /^Next: Slack/.test(run([failure('Slack: Review Needed', 'x')])[0].json.text.split('\n')[3]), 'Airtable and Slack hints');
ok(/bug in a code step/.test(run([failure('Bill Requests', 'No QuickBooks account or Class for X')])[0].json.text), 'code step: treated as a bug');
ok(bill.json.log.mode === 'error_workflow' && bill.json.log.error_step === 'Create Bill' && bill.json.log.execution_id === '501' && bill.json.log.route === 'error', 'log row for p3_processing_log');
const [trig] = run([{ trigger: { error: { message: 'Gmail login expired', node: { name: 'New Invoice Email' } } }, workflow: { name: 'Copper Kettle – Invoice Processor' } }]);
ok(/stopped at "New Invoice Email" \(no execution was started\)/.test(trig.json.text) && /no email was processed/.test(trig.json.text) && trig.json.log.execution_id === null, 'trigger failure (no execution)');
const [amp] = run([failure('Code <x>', 'a & b')]);
ok(/stopped at "Code &lt;x&gt;"/.test(amp.json.text) && /Error: a &amp; b/.test(amp.json.text), 'escaped for Slack');
console.log(`\n${fails} problem(s)`);
process.exit(fails ? 1 : 0);
