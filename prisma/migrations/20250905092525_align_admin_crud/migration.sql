/*
  Warnings:

  - The `price` column on the `products` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "public"."jobs" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedBy" TEXT;

-- AlterTable
ALTER TABLE "public"."products" DROP COLUMN "price",
ADD COLUMN     "price" DECIMAL(10,2);
