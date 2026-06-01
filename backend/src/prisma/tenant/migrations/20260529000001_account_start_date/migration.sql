-- Migration: add accountStartDate to getaround_accounts
ALTER TABLE "getaround_accounts" ADD COLUMN "accountStartDate" TIMESTAMP(3);
