import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { isExclusionViolation } from '../../src/common/errors/all-exceptions.filter';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const uniq = () => Math.random().toString(36).slice(2, 12);
const D = (v: string) => new Prisma.Decimal(v);

describe('Integração — Prisma + PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterAll(async () => app.close());

  async function newOrg() {
    const id = uniq();
    const res = await auth.register({
      name: `Dono ${id}`,
      email: `int-${id}@example.com`,
      password: 'Senha@12345',
      organizationName: `Org ${id}`,
    });
    return { orgId: res.organization.id, userId: res.user.id };
  }

  describe('organização + membership', () => {
    it('register cria usuário, organização, membership OWNER, funil e auditoria numa transação', async () => {
      const { orgId, userId } = await newOrg();
      const membership = await prisma.membership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      });
      expect(membership.role).toBe('OWNER');
      expect(await prisma.leadStage.count({ where: { organizationId: orgId } })).toBe(5);
      expect(
        await prisma.auditLog.count({ where: { organizationId: orgId, action: 'auth.register' } }),
      ).toBe(1);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    });

    it('um usuário participa de várias organizações; (organizationId, userId) é único', async () => {
      const a = await newOrg();
      const b = await newOrg();
      await prisma.membership.create({
        data: { organizationId: a.orgId, userId: b.userId, role: 'MEMBER' },
      });
      expect(await prisma.membership.count({ where: { userId: b.userId } })).toBe(2);
      await expect(
        prisma.membership.create({ data: { organizationId: a.orgId, userId: b.userId } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('slug da organização e e-mail do usuário são únicos', async () => {
      const a = await newOrg();
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: a.orgId } });
      await expect(
        prisma.organization.create({ data: { name: 'Dup', slug: org.slug } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
      await expect(
        prisma.user.create({ data: { name: 'Dup', email: user.email, passwordHash: 'x' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('CRM', () => {
    it('persiste lead com relacionamento de etapa; LeadStage.position é único por organização', async () => {
      const { orgId } = await newOrg();
      const stage = await prisma.leadStage.findFirstOrThrow({
        where: { organizationId: orgId },
        orderBy: { position: 'asc' },
      });
      const lead = await prisma.lead.create({
        data: { organizationId: orgId, stageId: stage.id, name: 'Maria', email: 'm@x.com' },
        include: { stage: true },
      });
      expect(lead.stage.name).toBe('Novo');
      await expect(
        prisma.leadStage.create({ data: { organizationId: orgId, name: 'Dup', position: 1 } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // a mesma posição pode existir em outra organização
      const other = await newOrg();
      expect(
        await prisma.leadStage.count({ where: { organizationId: other.orgId, position: 1 } }),
      ).toBe(1);
    });
  });

  describe('cursos', () => {
    it('matrícula única por (curso, usuário) e progresso único por (matrícula, aula)', async () => {
      const { orgId, userId } = await newOrg();
      const course = await prisma.course.create({
        data: {
          organizationId: orgId,
          title: 'Curso',
          status: 'PUBLISHED',
          modules: {
            create: [
              {
                title: 'M1',
                position: 1,
                lessons: {
                  create: [
                    { title: 'A1', position: 1 },
                    { title: 'A2', position: 2 },
                  ],
                },
              },
            ],
          },
        },
        include: { modules: { include: { lessons: true } } },
      });
      const enrollment = await prisma.enrollment.create({
        data: { organizationId: orgId, courseId: course.id, userId },
      });
      await expect(
        prisma.enrollment.create({ data: { organizationId: orgId, courseId: course.id, userId } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const lesson = course.modules[0].lessons[0];
      await prisma.lessonProgress.create({
        data: { enrollmentId: enrollment.id, lessonId: lesson.id },
      });
      await expect(
        prisma.lessonProgress.create({
          data: { enrollmentId: enrollment.id, lessonId: lesson.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await prisma.lessonProgress.count({ where: { enrollmentId: enrollment.id } })).toBe(1);
    });

    it('excluir o curso remove módulos, aulas, matrículas e progresso em cascata', async () => {
      const { orgId, userId } = await newOrg();
      const course = await prisma.course.create({
        data: {
          organizationId: orgId,
          title: 'C',
          modules: {
            create: [
              { title: 'M', position: 1, lessons: { create: [{ title: 'A', position: 1 }] } },
            ],
          },
        },
        include: { modules: { include: { lessons: true } } },
      });
      const enrollment = await prisma.enrollment.create({
        data: { organizationId: orgId, courseId: course.id, userId },
      });
      await prisma.lessonProgress.create({
        data: { enrollmentId: enrollment.id, lessonId: course.modules[0].lessons[0].id },
      });
      await prisma.course.delete({ where: { id: course.id } });
      expect(await prisma.lesson.count({ where: { moduleId: course.modules[0].id } })).toBe(0);
      expect(await prisma.enrollment.count({ where: { id: enrollment.id } })).toBe(0);
    });
  });

  describe('financeiro', () => {
    async function invoice(orgId: string) {
      return prisma.invoice.create({
        data: {
          organizationId: orgId,
          customerName: 'Cliente',
          subtotal: D('300.00'),
          discount: D('9.00'),
          total: D('291.00'),
          items: {
            create: [
              { description: 'Item', quantity: 2, unitPrice: D('150.00'), total: D('300.00') },
            ],
          },
        },
        include: { items: true },
      });
    }

    it('fatura + itens + pagamento persistem com precisão decimal', async () => {
      const { orgId } = await newOrg();
      const inv = await invoice(orgId);
      const payment = await prisma.payment.create({
        data: { invoiceId: inv.id, amount: inv.total, externalId: `evt_${uniq()}` },
      });
      expect(inv.items).toHaveLength(1);
      expect(payment.amount.toFixed(2)).toBe('291.00');

      const tiny = await prisma.invoice.create({
        data: {
          organizationId: orgId,
          customerName: 'Centavos',
          subtotal: D('0.30'),
          total: D('0.30'),
        },
      });
      expect(tiny.total.toString()).toBe('0.3');
    });

    it('CHECK do banco: total deve ser subtotal − desconto e valores não negativos', async () => {
      const { orgId } = await newOrg();
      await expect(
        prisma.invoice.create({
          data: {
            organizationId: orgId,
            customerName: 'X',
            subtotal: D('100'),
            discount: D('10'),
            total: D('100'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.invoice.create({
          data: {
            organizationId: orgId,
            customerName: 'X',
            subtotal: D('100'),
            discount: D('200'),
            total: D('-100'),
          },
        }),
      ).rejects.toThrow();
      const inv = await invoice(orgId);
      await expect(
        prisma.invoiceItem.create({
          data: {
            invoiceId: inv.id,
            description: 'Errado',
            quantity: 2,
            unitPrice: D('10'),
            total: D('999'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.payment.create({ data: { invoiceId: inv.id, amount: D('0') } }),
      ).rejects.toThrow();
    });

    it('Payment.externalId é único (base da idempotência do webhook)', async () => {
      const { orgId } = await newOrg();
      const inv = await invoice(orgId);
      const externalId = `evt_${uniq()}`;
      await prisma.payment.create({ data: { invoiceId: inv.id, amount: inv.total, externalId } });
      await expect(
        prisma.payment.create({ data: { invoiceId: inv.id, amount: inv.total, externalId } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('agendamentos — constraint de exclusão (última linha de defesa contra dupla reserva)', () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2031, 0, 6, h, m));
    const make = (
      orgId: string,
      ownerUserId: string,
      s: Date,
      e: Date,
      status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED',
    ) =>
      prisma.appointment.create({
        data: {
          organizationId: orgId,
          ownerUserId,
          customerName: 'Cliente',
          startAt: s,
          endAt: e,
          status,
        },
      });

    it('o banco recusa sobreposição de agendamentos CONFIRMED do mesmo responsável', async () => {
      const { orgId, userId } = await newOrg();
      await make(orgId, userId, at(14), at(15));
      const error = await make(orgId, userId, at(14, 30), at(15, 30)).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(isExclusionViolation(error)).toBe(true); // o filtro global converte em 409
    });

    it('permite horários encostados, cancelados e responsáveis diferentes', async () => {
      const a = await newOrg();
      const b = await newOrg();
      await make(a.orgId, a.userId, at(14), at(15));
      await make(a.orgId, a.userId, at(15), at(16)); // encostado
      await make(a.orgId, a.userId, at(13), at(14)); // encostado
      await make(a.orgId, a.userId, at(14), at(15), 'CANCELLED'); // cancelado não bloqueia
      await make(b.orgId, b.userId, at(14), at(15)); // outro responsável
      expect(await prisma.appointment.count({ where: { ownerUserId: a.userId } })).toBe(4);
    });

    it('CHECK: endAt deve ser posterior a startAt', async () => {
      const { orgId, userId } = await newOrg();
      await expect(make(orgId, userId, at(15), at(14))).rejects.toThrow();
      await expect(make(orgId, userId, at(15), at(15))).rejects.toThrow();
    });
  });

  describe('AuditLog — somente inserção', () => {
    it('UPDATE é bloqueado pelo trigger; INSERT funciona', async () => {
      const { orgId, userId } = await newOrg();
      const log = await prisma.auditLog.create({
        data: { organizationId: orgId, userId, action: 'test.action', resource: 'test' },
      });
      await expect(
        prisma.auditLog.update({ where: { id: log.id }, data: { action: 'adulterado' } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.auditLog.updateMany({ where: { id: log.id }, data: { resource: 'x' } }),
      ).rejects.toThrow(/append-only/);
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).action).toBe(
        'test.action',
      );
    });

    it('remover o usuário preserva o log (userId vira NULL) e excluir a organização remove os logs', async () => {
      const { orgId, userId } = await newOrg();
      await prisma.membership.deleteMany({ where: { userId } });
      const log = await prisma.auditLog.create({
        data: { organizationId: orgId, userId, action: 'test.keep', resource: 'test' },
      });
      await prisma.user.delete({ where: { id: userId } });
      expect(
        (await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).userId,
      ).toBeNull();
      await prisma.organization.delete({ where: { id: orgId } });
      expect(await prisma.auditLog.count({ where: { organizationId: orgId } })).toBe(0);
    });
  });
});
