-- CreateTable
CREATE TABLE "RampEventLog" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "merchantId" TEXT,
    "body" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "RampEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RampEventLog_eventKey_key" ON "RampEventLog"("eventKey");

-- CreateIndex
CREATE INDEX "RampEventLog_processedAt_idx" ON "RampEventLog"("processedAt");
