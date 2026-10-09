-- Invoices created without a reference are numbered ORD-001, ORD-002… per merchant.
-- This holds the last number handed out; it is incremented atomically on each such create.
ALTER TABLE "Merchant" ADD COLUMN "invoiceSeq" INTEGER NOT NULL DEFAULT 0;
