-- Migration: alertEmails, replyToEmail, senderName on company_settings
ALTER TABLE "company_settings" ADD COLUMN "alertEmails" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "company_settings" ADD COLUMN "replyToEmail" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "senderName" TEXT;
