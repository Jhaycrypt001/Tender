-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN "rampWebhookToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_rampWebhookToken_key" ON "Merchant"("rampWebhookToken");

-- CreateEnum
CREATE TYPE "RampSaleStatus" AS ENUM ('CREATED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "RampSale" (
    "id" TEXT NOT NULL,
    "rampSaleId" TEXT NOT NULL,
    "merchantId" TEXT,
    "status" "RampSaleStatus" NOT NULL,
    "cryptoSymbol" TEXT NOT NULL,
    "cryptoChain" TEXT NOT NULL,
    "cryptoAmount" DECIMAL(36,18) NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "fiatAmount" DECIMAL(36,18) NOT NULL,
    "payoutMethod" TEXT,
    "transactionHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RampSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RampSale_rampSaleId_key" ON "RampSale"("rampSaleId");

-- CreateIndex
CREATE INDEX "RampSale_merchantId_createdAt_idx" ON "RampSale"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "RampSale" ADD CONSTRAINT "RampSale_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
