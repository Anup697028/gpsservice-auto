-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" TEXT,
    "name" TEXT,
    "employeeId" TEXT,
    "phoneNumber" TEXT,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" SERIAL NOT NULL,
    "firebaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUEST_CREATED',
    "createdBy" TEXT,
    "createdByEmail" TEXT,
    "city" TEXT,
    "clientName" TEXT,
    "isBulkRequest" BOOLEAN NOT NULL DEFAULT false,
    "vehicleCount" INTEGER NOT NULL DEFAULT 0,
    "assignedRhUserId" TEXT,
    "assignedRhEmail" TEXT,
    "assignedRhEmailNormalized" TEXT,
    "rhStatus" TEXT,
    "rhApproval" BOOLEAN NOT NULL DEFAULT false,
    "rhApprovedAt" TIMESTAMP(3),
    "rhApprovalNotes" TEXT,
    "rhRejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentStatus" TEXT,
    "paymentApproved" BOOLEAN NOT NULL DEFAULT false,
    "paymentRejected" BOOLEAN NOT NULL DEFAULT false,
    "paymentActionTaken" BOOLEAN NOT NULL DEFAULT false,
    "paymentApprovedAt" TIMESTAMP(3),
    "paymentRejectedAt" TIMESTAMP(3),
    "paymentApproverName" TEXT,
    "vendorName" TEXT,
    "vendorStatus" TEXT,
    "vendorNotified" BOOLEAN NOT NULL DEFAULT false,
    "vendorApprovedBy" TEXT,
    "vendorApprovedAt" TIMESTAMP(3),
    "vendorBulkMailSentAt" TIMESTAMP(3),
    "assignedFoId" TEXT,
    "assignedFoEmail" TEXT,
    "foNotified" BOOLEAN NOT NULL DEFAULT false,
    "foNotifiedAt" TIMESTAMP(3),
    "foBulkNotifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestVehicle" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "vehicleNumber" TEXT,
    "city" TEXT,
    "serviceType" TEXT,
    "rhRejected" BOOLEAN NOT NULL DEFAULT false,
    "rhRejectionReason" TEXT,
    "paymentApproved" BOOLEAN NOT NULL DEFAULT false,
    "paymentRejected" BOOLEAN NOT NULL DEFAULT false,
    "paymentActionTaken" BOOLEAN NOT NULL DEFAULT false,
    "paymentApprovedAt" TIMESTAMP(3),
    "paymentRejectedAt" TIMESTAMP(3),
    "paymentRejectionReason" TEXT,
    "vendorNotified" BOOLEAN NOT NULL DEFAULT false,
    "vendorName" TEXT,
    "vehicleAvailabilityLocation" TEXT,
    "vehicleAvailableTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtpocDetail" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "vehicleNumber" TEXT,
    "ltpocName" TEXT,
    "ltpocPhone" TEXT,
    "ltpocEmail" TEXT,
    "lpoAdditional" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtpocDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestHistory" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "role" TEXT,
    "action" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER,
    "recipientEmail" TEXT,
    "recipientRole" TEXT,
    "notificationType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Request_firebaseId_key" ON "Request"("firebaseId");

-- CreateIndex
CREATE INDEX "RequestVehicle_requestId_idx" ON "RequestVehicle"("requestId");

-- CreateIndex
CREATE INDEX "LtpocDetail_requestId_idx" ON "LtpocDetail"("requestId");

-- CreateIndex
CREATE INDEX "RequestHistory_requestId_idx" ON "RequestHistory"("requestId");

-- CreateIndex
CREATE INDEX "RequestHistory_createdAt_idx" ON "RequestHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "RequestVehicle" ADD CONSTRAINT "RequestVehicle_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtpocDetail" ADD CONSTRAINT "LtpocDetail_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestHistory" ADD CONSTRAINT "RequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
