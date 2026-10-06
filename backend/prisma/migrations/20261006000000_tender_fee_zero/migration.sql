-- Tender charges no fee. The stored value was only ever a displayed default (nothing
-- applied it), so bring new merchants to 0 and move existing ones off the old default.
ALTER TABLE "Merchant" ALTER COLUMN "feeBps" SET DEFAULT 0;
UPDATE "Merchant" SET "feeBps" = 0 WHERE "feeBps" = 40;
