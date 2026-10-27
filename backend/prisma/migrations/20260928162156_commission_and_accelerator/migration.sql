-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "viaAccelerator" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "commissionRateBps" INTEGER,
ADD COLUMN     "stripeConnectAccountId" TEXT,
ADD COLUMN     "stripeConnectStatus" TEXT NOT NULL DEFAULT 'not_started';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "commissionCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferredToConnectAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Accelerator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "priceCentsPaid" INTEGER,
    "stripePaymentIntentId" TEXT,
    "boostedChannelCodes" TEXT[],
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accelerator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Accelerator_organizationId_key" ON "Accelerator"("organizationId");

-- AddForeignKey
ALTER TABLE "Accelerator" ADD CONSTRAINT "Accelerator_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

