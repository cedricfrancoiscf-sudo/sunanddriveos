-- Migration: cancelledReason on sequence_executions + targetUrl on notifications
ALTER TABLE "sequence_executions" ADD COLUMN "cancelledReason" TEXT;
ALTER TABLE "notifications" ADD COLUMN "targetUrl" TEXT;
