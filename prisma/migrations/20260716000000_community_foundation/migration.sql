-- CreateTable
CREATE TABLE "community_members" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reactions" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_moderation_actions" (
    "id" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_notifications" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_members_email_key" ON "community_members"("email");

-- CreateIndex
CREATE INDEX "community_posts_entityType_entityId_idx" ON "community_posts"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "community_posts_authorId_idx" ON "community_posts"("authorId");

-- CreateIndex
CREATE INDEX "community_posts_status_idx" ON "community_posts"("status");

-- CreateIndex
CREATE INDEX "community_comments_postId_idx" ON "community_comments"("postId");

-- CreateIndex
CREATE INDEX "community_comments_parentId_idx" ON "community_comments"("parentId");

-- CreateIndex
CREATE INDEX "community_comments_authorId_idx" ON "community_comments"("authorId");

-- CreateIndex
CREATE INDEX "community_reactions_targetType_targetId_idx" ON "community_reactions"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "community_reactions_memberId_targetType_targetId_type_key" ON "community_reactions"("memberId", "targetType", "targetId", "type");

-- CreateIndex
CREATE INDEX "community_reports_targetType_targetId_idx" ON "community_reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "community_reports_status_idx" ON "community_reports"("status");

-- CreateIndex
CREATE INDEX "community_moderation_actions_targetType_targetId_idx" ON "community_moderation_actions"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "community_moderation_actions_moderatorId_idx" ON "community_moderation_actions"("moderatorId");

-- CreateIndex
CREATE INDEX "community_notifications_memberId_read_idx" ON "community_notifications"("memberId", "read");

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "community_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "community_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "community_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reactions" ADD CONSTRAINT "community_reactions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "community_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "community_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_notifications" ADD CONSTRAINT "community_notifications_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "community_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

