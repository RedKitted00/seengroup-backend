/*
  Warnings:

  - Added the required column `contactReason` to the `contact_submissions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."contact_submissions" ADD COLUMN     "contactReason" TEXT NOT NULL,
ADD COLUMN     "message" TEXT,
ALTER COLUMN "requirements" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "contact_submissions_contactReason_idx" ON "public"."contact_submissions"("contactReason");
