-- One email per payment, invoice or transfer, not one per kind.
ALTER TABLE "EmailDelivery" ADD COLUMN "key" TEXT NOT NULL DEFAULT '';
DROP INDEX "EmailDelivery_merchantId_kind_key";
CREATE UNIQUE INDEX "EmailDelivery_merchantId_kind_key_key" ON "EmailDelivery"("merchantId", "kind", "key");

-- A merchant can turn off the receipt for each payment received.
ALTER TABLE "Merchant" ADD COLUMN "emailPayIn" BOOLEAN NOT NULL DEFAULT true;
