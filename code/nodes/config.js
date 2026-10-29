// Settings for every invoice (Project 3 design doc, sections 3, 3b and 4).
// The eval run records MODEL and PROMPT_VERSION, so change them only on purpose.
const MODEL = 'gemini-3.5-flash-lite';
const PROMPT_VERSION = 'p3-prompt-v2'; // v2 (28 Oct): rule 8, supplier's full name (R1: T04, T09)
const MAX_OUTPUT_TOKENS = 8192;

// Checks done by code after the AI has read the invoice (stage 4).
const HOME_CURRENCY = 'USD';
const MONEY_TOLERANCE = 0.01; // differences up to 1 cent are rounding, not an error
const TIMEZONE = 'America/Denver'; // "today" for the future-date check

const CATEGORIES = [
  { code: 'coffee_tea', name: 'Coffee & Tea', definition: 'Roasted coffee beans, ground coffee, cold brew packs and tea.' },
  { code: 'dairy', name: 'Dairy & Milk Alternatives', definition: 'Milk, cream, half and half, and plant-based milks such as oat, almond or soy.' },
  { code: 'food', name: 'Food & Bakery', definition: 'Food sold to customers or used to make it: pastries, baked goods, sandwiches, food ingredients. Never the bags or boxes food goes in.' },
  { code: 'packaging', name: 'To-Go Packaging & Disposables', definition: 'Anything handed to a customer with an order: cups, lids, sleeves, straws, stirrers, napkins, carriers, bags and food containers.' },
  { code: 'supplies', name: 'Kitchen & Cleaning Supplies', definition: 'Items staff use up that customers never take: gloves, paper towels, food-safety labels, cleaning chemicals, trash bags.' },
  { code: 'cleaning_services', name: 'Cleaning & Maintenance Services', definition: 'Work billed by a service company: janitorial visits, hood and grease trap cleaning, floor care, window and carpet cleaning.' },
  { code: 'freight', name: 'Freight & Delivery Fees', definition: 'Delivery, freight or shipping charges on any invoice.' },
];

// Stores and the words that identify them in a delivery address or a line description.
// "shared" = a line for several stores; reports split it equally.
const BRANCHES = [
  { code: 'larimer', name: 'Larimer St', keywords: ['larimer'] },
  { code: 'highlands', name: 'Highlands', keywords: ['highlands', '32nd ave'] },
  { code: 'washpark', name: 'Wash Park', keywords: ['wash park', 'gaylord'] },
  { code: 'shared', name: 'Shared', keywords: [] },
];
const SHARED_PHRASES = ['all 3 stores', 'all three stores', 'all stores', 'all locations'];

// QuickBooks Online (stage 6b): sandbox company, IDs from design doc section 5b.
// Vendors are matched by name at run time and never created by the workflow.
const QUICKBOOKS = {
  base_url: 'https://sandbox-quickbooks.api.intuit.com/v3/company/YOUR_QUICKBOOKS_COMPANY_ID',
  minor_version: '75',
  accounts: { // cost category -> expense account
    coffee_tea: '1150040000', dairy: '1150040001', food: '1150040002', packaging: '1150040003',
    cleaning_services: '1150040004', supplies: '1150040005', freight: '1150040006',
  },
  tax_account: '1150040007', // Sales Tax Paid
  classes: { larimer: '741030', highlands: '741031', washpark: '741032', shared: '741033' }, // store -> Class
  doc_number_max: 21, // QuickBooks limit for the bill number
};

const SYSTEM_PROMPT = [
  'You read one supplier document for the accounts payable team of Copper Kettle Café',
  'and copy what is printed into JSON. You never calculate, correct or complete',
  'anything: code checks the numbers after you.',
  '',
  '1. is_invoice is true only for a bill that asks Copper Kettle to pay for goods or',
  '   services (it shows an amount due). A copy or reminder that contains the invoice',
  '   itself counts. Price lists, menus, quotes and brochures are false. If false, set',
  '   every other field to null and line_items to [].',
  '2. Copy exactly what is printed. If the numbers on the document do not agree with',
  '   each other, still copy them as printed. Never fix a subtotal, tax, total or',
  '   line amount.',
  '3. Use null for anything that is not printed. Do not guess. PO numbers, account',
  '   numbers and customer numbers are not invoice numbers: if the invoice number',
  '   field is empty, invoice_number is null.',
  '4. Dates as YYYY-MM-DD. US suppliers write the month first: 10/04/2026 is 2026-10-04.',
  '5. Amounts as plain numbers, without currency symbols or thousands separators.',
  '   A tax printed as 0.00 is 0, not null. currency is the 3-letter code.',
  '6. Every row of the item table is one line item, including freight and delivery',
  '   fees, in the printed order. Read every page. Subtotal, tax and total rows are',
  '   not line items.',
  '7. ship_to is the delivery address block only (labelled Ship to, Deliver to or',
  '   similar), copied on one line. Bill to, Sold to and Client blocks are the head',
  '   office billing address, not a delivery address. No delivery block: null.',
  '8. supplier_name is the supplier\'s full business name. If the logo shows only a short',
  '   name and the full name is printed elsewhere (for example after "payable to" or in',
  '   the footer), copy that full name.',
  '9. category: pick one code per line from the list below, using its definition.',
  '   If none fits, use null. Never invent a new code.',
  '',
  'Categories:',
  ...CATEGORIES.map(c => '- ' + c.code + ' (' + c.name + '): ' + c.definition),
].join('\n');

return $input.all().map(item => ({
  json: {
    ...item.json,
    config: {
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      home_currency: HOME_CURRENCY,
      money_tolerance: MONEY_TOLERANCE,
      timezone: TIMEZONE,
      categories: CATEGORIES,
      branches: BRANCHES,
      shared_phrases: SHARED_PHRASES,
      quickbooks: QUICKBOOKS,
      system_prompt: SYSTEM_PROMPT,
    },
  },
  binary: item.binary,
}));
