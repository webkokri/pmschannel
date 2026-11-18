-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Organization" DROP CONSTRAINT "Organization_supportManagerId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "status",
DROP COLUMN "supportManagerAssignedAt",
DROP COLUMN "supportManagerId",
DROP COLUMN "suspendedAt",
DROP COLUMN "suspendedReason",
DROP COLUMN "trialEndsAt",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isSupportManager",
ADD COLUMN     "assignedPropertyId" TEXT;

-- DropTable
DROP TABLE "Invoice";

-- DropTable
DROP TABLE "Plan";

-- DropTable
DROP TABLE "Subscription";

-- DropEnum
DROP TYPE "BillingCycle";

-- DropEnum
DROP TYPE "InvoiceStatus";

-- DropEnum
DROP TYPE "OrganizationStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- CreateIndex
CREATE INDEX "User_assignedPropertyId_idx" ON "User"("assignedPropertyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_assignedPropertyId_fkey" FOREIGN KEY ("assignedPropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

