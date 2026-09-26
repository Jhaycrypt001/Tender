-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "amountInUsd" DECIMAL(36,18),
ADD COLUMN     "assetIn" TEXT,
ADD COLUMN     "outcomeTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_outcomeTxHash_key" ON "Payment"("outcomeTxHash");

