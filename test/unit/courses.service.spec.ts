import { CoursesService } from '../../src/modules/courses/courses.service';
import { auditMock, createPrismaMock, notificationsMock } from './helpers';

function setup() {
  const prisma = createPrismaMock({ lessonProgress: undefined });
  prisma.lessonProgress = {
    upsert: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  };
  const audit = auditMock();
  const notifications = notificationsMock();
  return {
    prisma,
    audit,
    notifications,
    service: new CoursesService(prisma, audit as any, notifications as any),
  };
}

const student = { id: 'u1', role: 'STUDENT' as const };
const admin = { id: 'a1', role: 'ADMIN' as const };

describe('CoursesService', () => {
  describe('enroll', () => {
    it('só aceita matrícula em curso PUBLISHED (422)', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT', title: 'X' });
      await expect(service.enroll('o1', student, 'c1', {})).rejects.toMatchObject({
        status: 422,
        code: 'BUSINESS_RULE_VIOLATION',
      });
    });

    it('não permite duas matrículas ativas no mesmo curso (409)', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', status: 'PUBLISHED', title: 'X' });
      prisma.enrollment.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      await expect(service.enroll('o1', student, 'c1', {})).rejects.toMatchObject({ status: 409 });
    });

    it('aluno não matricula outra pessoa (403)', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', status: 'PUBLISHED', title: 'X' });
      await expect(service.enroll('o1', student, 'c1', { userId: 'outro' })).rejects.toMatchObject({
        status: 403,
      });
    });

    it('cria a matrícula, audita e notifica o aluno', async () => {
      const { prisma, audit, notifications, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', status: 'PUBLISHED', title: 'Nest' });
      prisma.enrollment.findUnique.mockResolvedValue(null);
      prisma.enrollment.create.mockResolvedValue({ id: 'e1' });

      await service.enroll('o1', student, 'c1', {});

      expect(prisma.enrollment.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'enrollment.created' }),
        expect.anything(),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ENROLLMENT_CREATED', userId: 'u1' }),
        expect.anything(),
      );
    });
  });

  describe('completeLesson', () => {
    beforeEach(() => jest.clearAllMocks());

    it('T04 — concluir aula sem matrícula retorna 403', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', title: 'X' });
      prisma.lesson.findFirst.mockResolvedValue({ id: 'l1' });
      prisma.enrollment.findFirst.mockResolvedValue(null);
      await expect(service.completeLesson('o1', student, 'c1', 'l1')).rejects.toMatchObject({
        status: 403,
      });
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
    });

    it('aula de outro curso retorna 404', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', title: 'X' });
      prisma.lesson.findFirst.mockResolvedValue(null);
      await expect(service.completeLesson('o1', student, 'c1', 'l-x')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('registra o progresso e devolve o percentual (2 de 4 = 50%)', async () => {
      const { prisma, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', title: 'X' });
      prisma.lesson.findFirst.mockResolvedValue({ id: 'l2' });
      prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      prisma.lesson.count.mockResolvedValue(4);
      prisma.lessonProgress.count.mockResolvedValue(2);

      const res = await service.completeLesson('o1', student, 'c1', 'l2');

      expect(res).toMatchObject({
        percentage: 50,
        completedLessons: 2,
        totalLessons: 4,
        completed: false,
      });
      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('ao chegar a 100% conclui a matrícula e notifica uma única vez', async () => {
      const { prisma, notifications, service } = setup();
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', title: 'Nest' });
      prisma.lesson.findFirst.mockResolvedValue({ id: 'l4' });
      prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      prisma.lesson.count.mockResolvedValue(4);
      prisma.lessonProgress.count.mockResolvedValue(4);
      prisma.enrollment.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.completeLesson('o1', student, 'c1', 'l4');

      expect(res.completed).toBe(true);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'COURSE_COMPLETED' }),
      );
    });
  });

  it('getProgress consulta de outro aluno exige OWNER/ADMIN', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ id: 'c1' });
    await expect(service.getProgress('o1', student, 'c1', 'outro')).rejects.toMatchObject({
      status: 403,
    });
    prisma.membership.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.enrollment.findFirst.mockResolvedValue(null);
    await expect(service.getProgress('o1', admin, 'c1', 'outro')).rejects.toMatchObject({
      status: 404,
    });
  });
});
