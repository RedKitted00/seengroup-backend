#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// Check if .env file exists
const envPath = join(__dirname, '../.env');
if (!existsSync(envPath)) {
  console.error('❌ .env file not found!');
  process.exit(1);
}

// Read current .env
const envContent = readFileSync(envPath, 'utf8');

// Check if DATABASE_URL is already cloud-based
if (envContent.includes('supabase.co') || envContent.includes('neon.tech')) {
  // Database URL appears to be cloud-based already
} else {
  // Database URL appears to be local - update .env file with cloud database URL first
}

// Check if we can connect to database                
try {
  execSync('npm run generate', { cwd: join(__dirname, '..'), stdio: 'inherit' });
} catch (error) {
  console.error('❌ Failed to generate Prisma client');
  console.error('Please check your DATABASE_URL and try again');
}
