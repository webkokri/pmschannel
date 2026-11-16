-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "gateway" TEXT NOT NULL DEFAULT 'stripe';

-- CreateTable
CREATE TABLE "PendingDirectBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDirectBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingDirectBooking_organizationId_idx" ON "PendingDirectBooking"("organizationId");

