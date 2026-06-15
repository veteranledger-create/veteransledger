import { Request } from "express";

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export enum UserRole {
  VIEWER     = "VIEWER",
  EDITOR     = "EDITOR",
  ADMIN      = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page:  number;
  limit: number;
}

export interface PaginatedResult<T> {
  data:        T[];
  total:       number;
  page:        number;
  totalPages:  number;
  hasNext:     boolean;
  hasPrev:     boolean;
}

// ─── Records ──────────────────────────────────────────────────────────────────

export type RecordType =
  | "CAMPAIGN"
  | "ARMAMENT"
  | "LETTER"
  | "ARTICLE"
  | "TIMELINE_EVENT"
  | "DOCUMENT";

export interface RecordListQuery extends PaginationQuery {
  type?:     RecordType;
  search?:   string;
  tag?:      string;
  year?:     number;
  theater?:  string;
}

// ─── Personnel ────────────────────────────────────────────────────────────────

export type PersonnelBranch =
  | "ARMY"
  | "LUFTWAFFE"
  | "KRIEGSMARINE"
  | "WAFFEN_SS"
  | "FOREIGN";

export interface PersonnelListQuery extends PaginationQuery {
  branch?:  PersonnelBranch;
  search?:  string;
  nation?:  string;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineCategory =
  | "military"
  | "political"
  | "diplomatic"
  | "economic"
  | "social";

export interface TimelineListQuery {
  year?:      number;
  category?:  TimelineCategory;
  search?:    string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchQuery {
  q:     string;
  type?: string;
  page?: number;
}

export interface SearchResult {
  records:  unknown[];
  entities: unknown[];
  total:    number;
  query:    string;
  took_ms:  number;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export interface ContactPayload {
  name:     string;
  email:    string;
  subject:  string;
  message:  string;
}

// ─── Media ────────────────────────────────────────────────────────────────────

export type MediaType = "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";

export interface UploadedFile {
  fieldname:  string;
  originalname: string;
  encoding:   string;
  mimetype:   string;
  size:       number;
  filename:   string;
  path:       string;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  success: true;
  data:    T;
  meta?:   Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error:   string;
  code?:   string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  records:    number;
  entities:   number;
  media:      number;
  events:     number;
  users:      number;
  lastBackup: string | null;
}
