-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- Carry every existing merchant key over BEFORE the columns go: no merchant loses access.
INSERT INTO "ApiKey" ("id", "merchantId", "prefix", "hash", "createdAt")
SELECT 'key_' || "id", "id", "apiKeyPrefix", "apiKeyHash", "createdAt" FROM "Merchant";

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_merchantId_idx" ON "ApiKey"("merchantId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "Merchant_apiKeyPrefix_key";

-- AlterTable
ALTER TABLE "Merchant" DROP COLUMN "apiKeyHash",
DROP COLUMN "apiKeyPrefix";
