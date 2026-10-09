-- A payout, refund or split line can leave Monad: Aurora carries the money from a one-off Monad
-- deposit address to the recipient's address on another chain. These columns describe that second
-- leg, per line, so a split can pay different recipients on different chains. The Monad leg of all
-- lines is still ONE transaction. All null for a plain Monad line.
CREATE TYPE "DestStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

ALTER TABLE "TransferLine"
  ADD COLUMN "destChain" TEXT,
  ADD COLUMN "destAddress" TEXT,
  ADD COLUMN "destAsset" TEXT,
  ADD COLUMN "destExpectedOut" TEXT,
  ADD COLUMN "destStatus" "DestStatus",
  ADD COLUMN "destDeliveredAt" TIMESTAMP(3);

CREATE INDEX "TransferLine_destStatus_idx" ON "TransferLine"("destStatus");
