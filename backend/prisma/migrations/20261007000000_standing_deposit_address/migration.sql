-- A merchant's standing deposit address is modelled as one long-lived Invoice
-- of kind STANDING, so its deposits reuse the poller, Payment rows, balance,
-- Activity list and webhooks. Existing invoices are all STANDARD.
CREATE TYPE "InvoiceKind" AS ENUM ('STANDARD', 'STANDING');

ALTER TABLE "Invoice" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'STANDARD';
