/*
  Warnings:

  - Made the column `externalRatePlanId` on table `RoomMapping` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "RoomMapping" ALTER COLUMN "externalRatePlanId" SET NOT NULL,
ALTER COLUMN "externalRatePlanId" SET DEFAULT '';
