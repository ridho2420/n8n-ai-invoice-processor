// The Airtable request for one invoice, now that the PDF is in Drive.
// typecast lets Airtable accept the select values as text (they match the field options).
const rec = $('Prepare Record').item.json;
const fileId = $json.id;
return {
  json: {
    drive_file_id: fileId,
    drive_url: fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : null,
    body: {
      typecast: true,
      records: [{
        fields: {
          ...rec.record.invoice_fields,
          'PDF': fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : undefined,
          'Execution ID': String($execution.id),
        },
      }],
    },
  },
};
