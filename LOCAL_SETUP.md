# Local Development Setup

## Prerequisites
1. Install PostgreSQL locally
2. Make sure PostgreSQL is running on localhost:5432

## Setup Steps

### 1. Database Setup
- Open PostgreSQL terminal or pgAdmin
- Run the commands in setup-database.sql
- Or create database manually: CREATE DATABASE pryve_local;

### 2. Environment Setup
- The .env file has been created with local settings
- Update DATABASE_URL if your PostgreSQL credentials are different

### 3. Install Dependencies
npm install

### 4. Run Database Migration
npm run db:migrate

### 5. Generate Prisma Client
npm run db:generate

### 6. Start Development Server
npm run dev

## Local URLs
- API Server: http://localhost:3000
- API Documentation: http://localhost:3000/api-docs
- Database Studio: npm run db:studio

## Testing
- Test upload: http://localhost:3000/test-upload
- Health check: http://localhost:3000/api/v1/users

## Notes
- All external services (AWS, SendGrid, etc.) are optional for local development
- You can mock these services or use test credentials
- The app will work without external services for basic functionality
