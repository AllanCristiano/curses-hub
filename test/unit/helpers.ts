/** Utilitários de mock para os testes unitários dos services. */
export function createPrismaMock(extra: Record<string, any> = {}) {
  const model = () => ({
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    delete: jest.fn(),
  });
  const prisma: any = {
    user: model(),
    organization: model(),
    membership: model(),
    refreshToken: model(),
    leadStage: model(),
    lead: model(),
    course: model(),
    lesson: model(),
    enrollment: model(),
    lessonProgress: model(),
    availability: model(),
    appointment: model(),
    invoice: model(),
    payment: model(),
    notification: model(),
    $executeRaw: jest.fn(),
    ...extra,
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  return prisma;
}

export const auditMock = () => ({ log: jest.fn().mockResolvedValue(undefined) });
export const notificationsMock = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  notifyManagers: jest.fn().mockResolvedValue(undefined),
});
