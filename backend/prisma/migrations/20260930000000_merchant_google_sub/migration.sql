-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_googleSub_key" ON "Merchant"("googleSub");
