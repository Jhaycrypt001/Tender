-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'DETECTED', 'SETTLED', 'OVERPAID', 'UNDERPAID', 'EXPIRED', 'CANCELLED', 'NEEDS_RECOVERY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DETECTED', 'SETTLED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RecoveryState" AS ENUM ('OPEN', 'RETRYING', 'WITHDRAWN', 'RESOLVED', 'FAILED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "settlementAddress" TEXT,
    "settlementAsset" TEXT,
    "settlementVerified" BOOLEAN NOT NULL DEFAULT false,
    "feeBps" INTEGER NOT NULL DEFAULT 40,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountExpected" DECIMAL(36,18) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redirectUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAddress" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "auroraSender" TEXT NOT NULL,
    "pollFailures" INTEGER NOT NULL DEFAULT 0,
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceAddressId" TEXT NOT NULL,
    "auroraTxHash" TEXT NOT NULL,
    "fromChain" TEXT NOT NULL,
    "amountIn" DECIMAL(36,18) NOT NULL,
    "amountSettled" DECIMAL(36,18),
    "status" "PaymentStatus" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "paymentId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryTask" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "RecoveryState" NOT NULL DEFAULT 'OPEN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_apiKeyPrefix_key" ON "Merchant"("apiKeyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_token_key" ON "Invoice"("token");

-- CreateIndex
CREATE INDEX "Invoice_status_expiresAt_idx" ON "Invoice"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_merchantId_reference_key" ON "Invoice"("merchantId", "reference");

-- CreateIndex
CREATE INDEX "InvoiceAddress_address_idx" ON "InvoiceAddress"("address");

-- CreateIndex
CREATE INDEX "InvoiceAddress_nextPollAt_idx" ON "InvoiceAddress"("nextPollAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceAddress_invoiceId_family_key" ON "InvoiceAddress"("invoiceId", "family");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_auroraTxHash_key" ON "Payment"("auroraTxHash");

-- CreateIndex
CREATE INDEX "InvoiceEvent_invoiceId_at_idx" ON "InvoiceEvent"("invoiceId", "at");

-- CreateIndex
CREATE INDEX "WebhookDelivery_deliveredAt_nextRetryAt_idx" ON "WebhookDelivery"("deliveredAt", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryTask_paymentId_key" ON "RecoveryTask"("paymentId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAddress" ADD CONSTRAINT "InvoiceAddress_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceAddressId_fkey" FOREIGN KEY ("invoiceAddressId") REFERENCES "InvoiceAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryTask" ADD CONSTRAINT "RecoveryTask_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
