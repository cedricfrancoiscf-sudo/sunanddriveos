-- AlterTable: add Slack webhook URL for Enterprise notifications
ALTER TABLE "company_settings" ADD COLUMN "slackWebhookUrl" TEXT;
