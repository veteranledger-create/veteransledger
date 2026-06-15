import { PaginatedResult, PaginationQuery } from "../types/index";

export function parsePagination(query: Record<string, unknown>): PaginationQuery {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit };
}

export function buildPaginatedResult<T>(
  data:  T[],
  total: number,
  { page, limit }: PaginationQuery,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    total,
    page,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function paginationOffset({ page, limit }: PaginationQuery): number {
  return (page - 1) * limit;
}
