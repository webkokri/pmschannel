-- CreateTable
CREATE TABLE "PropertyPageContent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "heroHeadline" TEXT NOT NULL DEFAULT '',
    "heroSubheadline" TEXT NOT NULL DEFAULT '',
    "heroImageUrl" TEXT NOT NULL DEFAULT '',
    "primaryColor" TEXT NOT NULL DEFAULT '#356ef4',
    "aboutText" TEXT NOT NULL DEFAULT '',
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "galleryImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyPageContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyPageContent_propertyId_key" ON "PropertyPageContent"("propertyId");

-- AddForeignKey
ALTER TABLE "PropertyPageContent" ADD CONSTRAINT "PropertyPageContent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

