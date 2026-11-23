-- DropIndex
DROP INDEX "users_email_idx";

-- DropIndex
DROP INDEX "roles_slug_idx";

-- DropIndex
DROP INDEX "passkeys_credentialId_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

