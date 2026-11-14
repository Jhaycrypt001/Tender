-- AlterEnum
ALTER TYPE "DestStatus" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "TransferLine" ADD COLUMN "auroraSender" TEXT;
