-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rows that exist now were recorded in the past. Give them their Aurora dates (not "today"), or the money-email sweep
-- would see every old payment as new and email it.
UPDATE "Payment" SET "recordedAt" = COALESCE("settledAt", "firstSeenAt");
