-- AlterTable
ALTER TABLE "public"."career_applications" ADD COLUMN     "emailConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."contact_submissions" ADD COLUMN     "emailConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailConsentAt" TIMESTAMP(3);
