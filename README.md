# n8n-ai-invoice-processor
n8n workflow that reads supplier invoice PDFs from Gmail with Gemini, checks every number with code, and records bills in QuickBooks with the PDF attached. Invoices that don't add up go to an Airtable review queue with a Slack alert. Tested on 12 invoices with an answer key.
