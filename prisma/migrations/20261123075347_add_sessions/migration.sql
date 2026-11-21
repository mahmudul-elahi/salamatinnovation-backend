-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('PASSWORD', 'PASSKEY');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('LOGOUT', 'SIGNED_OUT_REMOTELY', 'LOGOUT_ALL', 'PASSWORD_CHANGED', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loginMethod" "LoginMethod" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "SessionEndReason",

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_userId_lastActiveAt_idx" ON "sessions"("userId", "lastActiveAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
