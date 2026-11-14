-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex (NULLs never collide, so invoices made without a key are unaffected)
CREATE UNIQUE INDEX "Invoice_merchantId_idempotencyKey_key" ON "Invoice"("merchantId", "idempotencyKey");
