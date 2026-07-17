/**
 * Shared type contracts for the future Community system (posts, comments,
 * reactions, reports, notifications, moderation). Nothing here is wired to
 * working functionality yet — see docs/community-architecture.md.
 *
 * String-literal unions (not Prisma enums) to match the rest of this
 * codebase's convention of String columns with documented allowed values
 * (see Translation.status, PreservationRecord.status in prisma/schema.prisma).
 */

export const COMMUNITY_TARGET_TYPES = ["POST", "COMMENT"] as const;
export type CommunityTargetType = typeof COMMUNITY_TARGET_TYPES[number];

export const REPORT_TARGET_TYPES = ["POST", "COMMENT", "MEMBER"] as const;
export type ReportTargetType = typeof REPORT_TARGET_TYPES[number];

export const REACTION_TYPES = [
  "HELPFUL",
  "INFORMATIVE",
  "WELL_RESEARCHED",
  "NEEDS_VERIFICATION",
] as const;
export type ReactionType = typeof REACTION_TYPES[number];

// Anti-abuse focus per "Comment Philosophy" — historical disagreement and
// evidence-based debate are not restricted; these reasons target conduct,
// not opinion.
export const REPORT_REASONS = [
  "SPAM",
  "FLOODING",
  "BOT",
  "PROMOTIONAL",
  "ADVERTISING",
  "MALICIOUS_LINK",
  "FALSE_ACCUSATION",
  "HARASSMENT",
  "IMPERSONATION",
  "OTHER",
] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export const MODERATION_ACTIONS = [
  "HIDE",
  "RESTORE",
  "DELETE",
  "WARN_MEMBER",
  "SUSPEND_MEMBER",
  "BAN_MEMBER",
] as const;
export type ModerationAction = typeof MODERATION_ACTIONS[number];

export const NOTIFICATION_TYPES = [
  "REPLY",
  "MENTION",
  "COMMENT_APPROVED",
  "REPORT_UPDATE",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

// Archive entity types a community post may attach to. Mirrors the generic
// entityType/entityId convention already used by Translation and
// PreservationRecord — no schema change is needed on Record/Entity/
// TimelineEvent to support this.
export const DISCUSSABLE_ENTITY_TYPES = ["record", "entity", "timeline_event"] as const;
export type DiscussableEntityType = typeof DISCUSSABLE_ENTITY_TYPES[number];
