// Stage 6b-2: attach the invoice PDF to its new QuickBooks bill.
// QuickBooks takes files through its upload endpoint: one multipart request with two parts,
// file_metadata_01 (JSON: which bill, file name, type) and file_content_01 (the PDF).
// The metadata is sent as a small JSON file, so that part goes out as application/json.
const toBase64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(s));
const prepared = $('Prepare Record').all();
const requests = $('Bill Requests').all().map((r) => r.json);
const out = [];

$('Create Bill').all().forEach((item, i) => {
  const bill = item.json.Bill;
  const req = requests[i];
  if (!bill || !bill.Id || !req) return;
  // Create Bill answers in the order it was asked; make sure the pair really belongs together.
  if (String(bill.DocNumber) !== String(req.body.DocNumber)) {
    throw new Error(`Bill ${bill.Id} has number ${bill.DocNumber}, but request ${i + 1} was for ${req.body.DocNumber}.`);
  }
  const source = prepared.find((p) => p.json.dup_key === req.dup_key);
  if (!source || !source.binary || !source.binary.data) {
    throw new Error(`No PDF found for bill ${bill.Id} (${req.invoice_number}).`);
  }
  const qb = source.json.config.quickbooks;
  const fileName = source.json.record.drive_file_name;
  const meta = {
    AttachableRef: [{ EntityRef: { type: 'Bill', value: String(bill.Id) }, IncludeOnSend: false }],
    FileName: fileName,
    ContentType: 'application/pdf',
  };
  out.push({
    json: {
      bill_id: String(bill.Id),
      invoice_number: req.invoice_number,
      file_name: fileName,
      upload_url: `${qb.base_url}/upload?minorversion=${qb.minor_version}`,
    },
    binary: {
      meta: { data: toBase64(JSON.stringify(meta)), mimeType: 'application/json', fileName: 'metadata.json', fileExtension: 'json' },
      file: { ...source.binary.data, fileName, mimeType: 'application/pdf' },
    },
  });
});
return out;
