import prisma from "../../database/prisma";

export class DashboardService {
  async getStats(): Promise<object> {
    const [records, entities, media, events] = await Promise.all([
      prisma.record.count(),
      prisma.entity.count(),
      prisma.mediaAsset.count(),
      prisma.timelineEvent.count(),
    ]);
    return { records, entities, media, events };
  }

  async getRecentActivity(): Promise<object[]> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { email: true } } },
    });
    return logs;
  }
}
