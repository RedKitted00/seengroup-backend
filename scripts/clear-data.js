import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearData() {
  try {
    // First, delete all products (due to foreign key constraints)
    const deletedProducts = await prisma.product.deleteMany({});
    
    // Then delete all categories
    const deletedCategories = await prisma.category.deleteMany({});
    
  } catch (error) {
    console.error('❌ Error during data cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearData();
