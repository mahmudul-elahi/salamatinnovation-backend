# POS & ERP Domain Business Rules

## Financial Calculations & Precision
- **Zero Floating-Point Math**: Never perform price, tax, discount, total, or exchange rate calculations using native JavaScript math operators (`+`, `-`, `*`, `/`).
- **Use `decimal.js`**: Always use `Decimal` from `decimal.js` for arithmetic (e.g., `new Decimal(price).times(quantity).minus(discount)`).
- **Rounding Policy**: Round to 2 decimal places (or currency specification) only at the final invoice/receipt total level to avoid intermediate rounding drift.

## Inventory & Stock Management
- **Audit Ledger (Stock Movements)**:
  - Do NOT simply update a product's stock number without an audit trail.
  - Every increase or decrease must be recorded in an immutable `StockMovement` / `InventoryLog` table with: `productId`, `branchId`, `quantityDelta`, `reason` (e.g. `SALE`, `PURCHASE_RECEIPT`, `RETURN`, `DAMAGE`, `TRANSFER`, `ADJUSTMENT`), `referenceId`, and `performedBy`.
- **Atomic Concurrency**:
  - Stock deductions during POS checkout must run inside a database transaction with row-level locking (`Pessimistic Write` or transactional checks) to prevent overselling.

## Barcode & Document Generation
- **Barcodes & QR Codes**: Use `bwip-js` for generating barcode symbologies (EAN-13, UPC-A, Code-128) and QR codes for digital receipts and payments.
- **Documents & Receipts**:
  - Use `pdfmake` for formatting standard A4 invoices, purchase orders, and 58mm / 80mm thermal receipt formats.
  - Use `exceljs` for exporting accounting ledgers, stock balance sheets, and sales reports.
- **Date & Time**:
  - Always record dates in UTC ISO-8601 strings in the database.
  - Format local branch timestamps using `dayjs`.
