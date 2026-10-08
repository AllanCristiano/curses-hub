/**
 * Seed de demonstração — idempotente (pode ser executado várias vezes).
 * Cria a organização "Demo Hub" com um usuário de cada papel, funil, cursos, agenda e faturas.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { CourseStatus, MembershipRole, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const url = new URL(process.env.DATABASE_URL ?? '');
const schema = url.searchParams.get('schema') ?? undefined;
url.searchParams.delete('schema');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

const PASSWORD = 'Demo@12345';

async function upsertUser(name: string, email: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, passwordHash },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const owner = await upsertUser('Olívia Owner', 'owner@demo.hub', passwordHash);
  const admin = await upsertUser('Adriano Admin', 'admin@demo.hub', passwordHash);
  const member = await upsertUser('Marina Member', 'member@demo.hub', passwordHash);
  const student = await upsertUser('Sérgio Student', 'student@demo.hub', passwordHash);

  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-hub' },
    update: {},
    create: { name: 'Demo Hub', slug: 'demo-hub' },
  });

  for (const [user, role] of [
    [owner, MembershipRole.OWNER],
    [admin, MembershipRole.ADMIN],
    [member, MembershipRole.MEMBER],
    [student, MembershipRole.STUDENT],
  ] as const) {
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { role },
      create: { organizationId: organization.id, userId: user.id, role },
    });
  }

  // Funil do CRM
  const stages = [
    { name: 'Novo', position: 1, isClosed: false },
    { name: 'Contato', position: 2, isClosed: false },
    { name: 'Proposta', position: 3, isClosed: false },
    { name: 'Ganho', position: 4, isClosed: true },
    { name: 'Perdido', position: 5, isClosed: true },
  ];
  for (const s of stages) {
    await prisma.leadStage.upsert({
      where: { organizationId_position: { organizationId: organization.id, position: s.position } },
      update: {},
      create: { organizationId: organization.id, ...s },
    });
  }
  const firstStage = await prisma.leadStage.findFirstOrThrow({
    where: { organizationId: organization.id },
    orderBy: { position: 'asc' },
  });
  if ((await prisma.lead.count({ where: { organizationId: organization.id } })) === 0) {
    await prisma.lead.createMany({
      data: [
        {
          name: 'Maria Silva',
          email: 'maria@example.com',
          phone: '79999999999',
          source: 'WEBSITE',
        },
        { name: 'Carlos Pereira', email: 'carlos@example.com', source: 'INSTAGRAM' },
        { name: 'Ana Souza', phone: '79988887777', source: 'INDICACAO' },
      ].map((l) => ({ ...l, organizationId: organization.id, stageId: firstStage.id })),
    });
  }

  // Curso publicado com 2 módulos e 4 aulas
  if ((await prisma.course.count({ where: { organizationId: organization.id } })) === 0) {
    const course = await prisma.course.create({
      data: {
        organizationId: organization.id,
        title: 'Backend com NestJS',
        description: 'Do zero a uma API multi-tenant completa.',
        status: CourseStatus.PUBLISHED,
        modules: {
          create: [
            {
              title: 'Fundamentos',
              position: 1,
              lessons: {
                create: [
                  { title: 'Introdução ao NestJS', position: 1 },
                  { title: 'Módulos e injeção de dependência', position: 2 },
                ],
              },
            },
            {
              title: 'Persistência',
              position: 2,
              lessons: {
                create: [
                  { title: 'PostgreSQL e Prisma', position: 1 },
                  { title: 'Migrations e seeds', position: 2 },
                ],
              },
            },
          ],
        },
      },
    });
    await prisma.course.create({
      data: {
        organizationId: organization.id,
        title: 'Curso em rascunho',
        status: CourseStatus.DRAFT,
      },
    });
    await prisma.enrollment.create({
      data: { organizationId: organization.id, courseId: course.id, userId: student.id },
    });
  }

  // Disponibilidade: seg–sex, 09:00–18:00 (UTC) para a Marina
  if ((await prisma.availability.count({ where: { organizationId: organization.id } })) === 0) {
    await prisma.availability.createMany({
      data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        organizationId: organization.id,
        ownerUserId: member.id,
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      })),
    });
  }

  // Faturas
  if ((await prisma.invoice.count({ where: { organizationId: organization.id } })) === 0) {
    await prisma.invoice.create({
      data: {
        organizationId: organization.id,
        customerName: 'João Costa',
        subtotal: new Prisma.Decimal('300.00'),
        discount: new Prisma.Decimal('9.00'),
        total: new Prisma.Decimal('291.00'),
        items: {
          create: [
            {
              description: 'Mentoria individual',
              quantity: 2,
              unitPrice: new Prisma.Decimal('150.00'),
              total: new Prisma.Decimal('300.00'),
            },
          ],
        },
      },
    });
  }

  console.log('Seed concluído.');
  console.log(`Organização: Demo Hub (slug demo-hub) — senha de todos os usuários: ${PASSWORD}`);
  console.log('  owner@demo.hub | admin@demo.hub | member@demo.hub | student@demo.hub');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
