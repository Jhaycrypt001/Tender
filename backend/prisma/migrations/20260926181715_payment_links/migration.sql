-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(36,18),
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_token_key" ON "PaymentLink"("token");

-- CreateIndex
CREATE INDEX "PaymentLink_merchantId_createdAt_idx" ON "PaymentLink"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

