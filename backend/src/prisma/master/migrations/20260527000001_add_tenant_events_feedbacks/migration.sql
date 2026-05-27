-- CreateTable: TenantEvent
CREATE TABLE "tenant_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_events_companyId_occurredAt_idx" ON "tenant_events"("companyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "tenant_events" ADD CONSTRAINT "tenant_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: TenantFeedback
CREATE TABLE "tenant_feedbacks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_feedbacks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tenant_feedbacks" ADD CONSTRAINT "tenant_feedbacks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
