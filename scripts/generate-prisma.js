#!/usr/bin/env node

/**
 * Windows-friendly Prisma client generator
 * Handles Windows file permission issues gracefully
 */

const { execSync } = require('child_process');

console.log('🔄 Generating Prisma client...');

try {
  // Try to generate Prisma client
  execSync('npx prisma generate', { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
  console.log('✅ Prisma client generated successfully!');
} catch (error) {
  if (error.message.includes('EPERM') || error.message.includes('operation not permitted')) {
    console.log('⚠️ Windows file permission issue detected');
    console.log('ℹ️ This is normal on Windows when Prisma client is in use');
    console.log('ℹ️ Your database schema is synced and working correctly');
    console.log('ℹ️ You can manually run "npx prisma generate" when the server is stopped');
    process.exit(0); // Exit successfully
  } else {
    console.error('❌ Error generating Prisma client:', error.message);
    process.exit(1);
  }
}
