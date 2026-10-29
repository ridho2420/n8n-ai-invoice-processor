# Evals: 12 fixed test documents

The invoice workflow is tested on the same 12 documents every time the prompt, the model or the checks change. The question each run answers: did the change make the workflow better, or did it break something that used to work?

The PDFs are in [`../test-set/`](../test-set). Every page carries a small footer "Demo document · fictional company and data".

## How a run works

The **Eval Runner** workflow:

1. Reads the answer key from the data table `p3_eval_cases` and lists the PDFs in the Drive folder `test-set`. A case whose file is missing still runs, so the failure shows.
2. Sends each document through the real Invoice Processor in test mode (one execution per document). The document goes through the same reading, checks and routing code as an email attachment, then stops before anything is saved. For the duplicate check, the runner passes the duplicate keys of earlier documents in the same run, instead of searching Airtable.
3. Scores the result with code ([`../code/eval/check.js`](../code/eval/check.js)) and saves one row per document to `eval_results`.
4. Saves one row per run to `eval_runs` and posts a summary to Slack `#eval-runs`, compared with the last full run that used the same criteria.

Each document waits 5 seconds first, to stay under Gemini's free-tier limit.

## The cases

| Case | File | Type | Expected | What it tests |
|---|---|---|---|---|
| T01 | HB-10482.pdf | normal | recorded | Clean invoice; tax printed as 0.00 |
| T02 | MeadowDairy_INV-2041.pdf | normal | recorded | Date 10/04/2026 (October 4); account and PO numbers next to the invoice number; "Deliver to" instead of "Ship to" |
| T03 | PackRight_INV-2036.pdf | normal | recorded | 21 lines over two pages, totals only on page 2; packaging and supplies mixed; head office address labelled "SOLD TO"; a pastry bag is packaging, not food |
| T04 | BrightClean_BC-2026-0412.pdf | normal | recorded | Cleaning service for three stores: no delivery address, each line names its store; quantity 3.5 |
| T05 | BrightClean_Service_Menu_2027.pdf | not_invoice | not_invoice | Price list in the same email as T04: has prices and a supplier, but isn't a bill |
| T06 | Scan_2026-10-09_0842.pdf | scan | recorded | Office scan, no text layer |
| T07 | IMG_4471.pdf | scan | recorded | Tilted phone photo with uneven light; 10/11/2026 is October 11 |
| T08 | PackRight_INV-2039.pdf | anomaly | needs_review · `sum_mismatch` | Lines add up to $1,240.00, printed subtotal $1,420.00; tax and total follow the wrong subtotal |
| T09 | BrightClean_BC-2026-0419.pdf | anomaly | needs_review · `due_before_invoice` | Due Sep 14, invoice Oct 14; one line for "all 3 stores" becomes Shared |
| T10 | MeadowDairy_Invoice_Oct16.pdf | anomaly | needs_review · `missing_invoice_number` | "Invoice #" printed empty; PO-5512 and CK-0042 are not invoice numbers |
| T11 | HB-10482_reminder.pdf | duplicate | duplicate of T01 | T01 sent again with a reminder stamp |
| T12 | PackRight_INV-2041.pdf | duplicate_trap | recorded | Same number as T02 (INV-2041), different supplier: not a duplicate |

The answer key ([`test-cases.json`](test-cases.json)) holds **what is printed, not what should be there**: T08's subtotal is 1420.00, T09's due date is 2026-09-14, T10's invoice number is `null`. An AI that quietly corrects a number or invents a missing one fails.

## Scoring (criteria `p3-v2`)

Every document is scored in five groups. One mistake counts in one group only.

| Group | What is checked | Documents |
|---|---|---|
| Routing | is it an invoice, the route, the reason, and which earlier case it duplicates | 12 |
| Facts | invoice number, supplier, dates, currency, subtotal, tax, total, and every line (quantity, unit price, amount, in order) | 11 invoices |
| Safety | nothing invented (a field that is `null` in the key must be `null`) and nothing corrected (a value that differs from the key but matches the math: subtotal = sum of lines, total = subtotal + tax, amount = quantity × price) | 11 invoices |
| Format | dates `YYYY-MM-DD` or `null`, numbers as numbers, 3-letter currency, category codes from the list | 12 |
| Allocation | the store of the invoice, and the store and category of every line | 11 invoices |

How values are compared:

- **Supplier:** normalized like the duplicate key (lowercase, no punctuation, no LLC / Inc. / Co.).
- **Invoice number:** uppercase, spaces and `#` removed. `INV-2041` is not `2041`.
- **Numbers:** equal within 0.01. **Dates:** exactly equal.
- **Lines:** the count must match, then quantity, unit price and amount line by line. Descriptions aren't scored.
- **Allocation** is only scored when the line count is right; otherwise the mistake counts in Facts only.
- **Stores** are scored from the code's result (`allocate()`), not from the address text the AI copied, so a differently written address isn't a failure as long as the store is right.
- **T05:** only Routing is scored.

A document passes when all its checks pass. The run score is documents passed / 12. The summary also gives accuracy per field (x/11), store and category per line (x/64), accuracy per case type, and Gemini time per document.

There is no AI judge: every answer is an exact value, so code is enough.

The checks were tested before the first run ([`../code/eval/test/eval.test.js`](../code/eval/test/eval.test.js), 35 checks): a perfect reading scores 12/12, and injected mistakes land in the right group. That test found one bug before any real run: Safety only appeared for cases with an empty field in the key, so it could show "1/2" instead of "x/11".

## Runs

All runs: model `gemini-3.5-flash-lite`, criteria `p3-v2`, October 28, 2026.

| Run | Prompt | Passed | Run time | Gemini per document |
|---|---|---|---|---|
| R1 | v1 | 10/12 (T04, T09) | 2 min 31 s | 4.2 s average, slowest 13.6 s |
| R2a | v2 | **12/12** | 2 min 42 s | 3.5 s average, slowest 7.4 s |
| R2b | v2 | **12/12** | 2 min 18 s | 3.3 s average, slowest 9.5 s |
| R3 | v2, after adding QuickBooks, Slack and the log | 12/12 | 4 min 17 s | 13.4 s average, slowest 26.8 s |

In every run: Routing 12/12, Safety 11/11, Format 12/12, Allocation 11/11, and all 64 lines got the right store and category. R1 failed only in Facts (supplier 9/11).

**What passed in R1, before any fix:** T08's wrong subtotal was copied as printed and flagged by code. T10's invoice number stayed empty (PO and account numbers ignored). The price list was recognized as not an invoice. Both US dates were read month first. All 21 lines of T03 were read from two pages, the head office address wasn't used, and the pastry bag went to packaging. The scan and the phone photo were read without a mistake. T11 was caught as a duplicate of T01, and T12 was not mistaken for a duplicate of T02.

**R1 failures:** T04 and T09 were both read as "BrightClean" instead of "BrightClean Commercial Services". The logo prints the name on two lines, and the AI copied only the first, although the full name is also printed in the "payable to" line and the footer. The route was still right, but in real use the QuickBooks vendor match would fail, and a second copy read with the full name would not be caught as a duplicate.

**Fix (prompt v2):** one rule asking for the supplier's full legal name. Both runs scored 12/12, with nothing else broken. Side effect: the name now sometimes includes "LLC" or ", Inc." and sometimes not. Matching ignores these suffixes, so it doesn't change any result.

**R3** was a regression check after stages 6 and 7 were added (test mode stops before them). Same score. Gemini was much slower that evening, with one 503 error in another execution; the score didn't change.

**Honest note:** 12/12 was measured on the same documents used to find the problem. The fix is one general rule and three runs agree, but a few extra invoices used only for scoring would be a stronger test.

## Final run by email (October 29)

Not scored by the Eval Runner, but checked against the same answer key: 11 emails with the 12 PDFs, the first three one at a time and the other eight at the same moment.

- 7 invoices → QuickBooks bills, each with its PDF attached, the right accounts and Classes (the three-store cleaning invoice became one bill with three Classes)
- T08, T09, T10 → Airtable review queue with a Slack message each
- T11 → skipped as a duplicate of T01, T05 → skipped as not an invoice, both with a Slack note

This run found a bug the evals couldn't: the Gmail trigger was set to fetch one email per check, and after the queue was empty it started fetching old emails again. The limit was removed, and the workflow now skips emails already in the processing log. Forwarding the same 11 emails again afterwards: every email processed exactly once, no new bills. T10 was recorded again because a new email with an invoice that has no number can't be recognized as a duplicate (a known limit).

## Data tables

`p3_eval_cases`: import [`test-cases.csv`](test-cases.csv). `ord`, `email_no` and `line_count` are numbers, the rest text. `line_items` is JSON text.

`eval_results` (one row per document):

| Column | Type |
|---|---|
| project, run_id, criteria_version, case_id | text |
| passed | boolean |
| routing_ok, facts_ok, safety_ok, format_ok, allocation_ok | text (`pass`, `fail`, or `-` when not scored) |
| failed_checks, route, reason, reply, read_path, detail, execution_id | text |
| read_ms | number |

`reply` is a short JSON summary of what was read, so a failure can be understood without opening the execution. `detail` holds every field result.

`eval_runs` (one row per run):

| Column | Type |
|---|---|
| project, run_id, criteria_version, note | text |
| cases, passed | number |
| routing, facts, safety, format, allocation | text (`x/y`) |
| failed_cases, started_at, finished_at, detail | text |

These two tables are shared with my previous project, so the live tables also have a few columns this project leaves empty.
