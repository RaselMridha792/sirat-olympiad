-- Teams (core C5b-3, CORE-PLAN D7): one per ambassador (owner_id UNIQUE), one per student (team_members.user_id
-- UNIQUE), a server-made join code, names unique in any letter case. Generated from schema.prisma. The new NOT NULL
-- join_code needs an empty teams table, which it is: nothing wrote to it before C5b-3.

-- DropIndex
DROP INDEX "team_members_user_id_idx";

-- DropIndex
DROP INDEX "teams_owner_id_idx";

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "join_code" CITEXT NOT NULL,
ALTER COLUMN "name" SET DATA TYPE CITEXT;

-- CreateIndex
CREATE UNIQUE INDEX "team_members_user_id_key" ON "team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_join_code_key" ON "teams"("join_code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_owner_id_key" ON "teams"("owner_id");

