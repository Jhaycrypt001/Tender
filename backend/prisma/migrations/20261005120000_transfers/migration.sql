-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('PAYOUT', 'REFUND', 'SPLIT');


-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('AWAITING_SIGNATURE', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'AWAITING_SIGNATURE',
    "asset" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "totalAmount" DECIMAL(36,18) NOT NULL,
    "paymentId" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_txHash_key" ON "Transfer"("txHash");

-- CreateIndex
CREATE INDEX "Transfer_merchantId_createdAt_idx" ON "Transfer"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_status_expiresAt_idx" ON "Transfer"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Transfer_paymentId_idx" ON "Transfer"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLine_transferId_index_key" ON "TransferLine"("transferId", "index");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

