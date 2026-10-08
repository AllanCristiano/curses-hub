import { Injectable } from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import {
  BusinessRuleException,
  ConflictAppException,
  ForbiddenAppException,
  ResourceNotFoundException,
} from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateCourseDto,
  EnrollDto,
  ListCoursesQueryDto,
  ListEnrollmentsQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { calculateProgress } from './progress.util';

export interface Actor {
  id: string;
  role: MembershipRole;
}

const MANAGERS: MembershipRole[] = [MembershipRole.OWNER, MembershipRole.ADMIN];
const VALID_ENROLLMENT: EnrollmentStatus[] = [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED];

const courseDetailInclude = {
  modules: {
    orderBy: { position: 'asc' },
    include: {
      lessons: {
        orderBy: { position: 'asc' },
        select: { id: true, title: true, contentUrl: true, position: true },
      },
    },
  },
} satisfies Prisma.CourseInclude;

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // UC04 — Criar curso (com módulos e aulas)
  async create(organizationId: string, userId: string, dto: CreateCourseDto) {
    return this.prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          organizationId,
          title: dto.title,
          description: dto.description,
          status: dto.status ?? CourseStatus.DRAFT,
          modules: {
            create: (dto.modules ?? []).map((m, mi) => ({
              title: m.title,
              position: mi + 1,
              lessons: {
                create: (m.lessons ?? []).map((l, li) => ({
                  title: l.title,
                  contentUrl: l.contentUrl,
                  position: li + 1,
                })),
              },
            })),
          },
        },
        include: courseDetailInclude,
      });
      await this.audit.log(
        {
          organizationId,
          userId,
          action: 'course.created',
          resource: 'course',
          resourceId: course.id,
        },
        tx,
      );
      return course;
    });
  }

  async list(organizationId: string, actor: Actor, query: ListCoursesQueryDto) {
    const page = resolvePage(query);
    const search = query.search?.trim();
    const where: Prisma.CourseWhereInput = {
      organizationId,
      ...(actor.role === MembershipRole.STUDENT
        ? { status: CourseStatus.PUBLISHED }
        : query.status
          ? { status: query.status }
          : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        include: { _count: { select: { modules: true } } },
        orderBy: { createdAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.course.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  async get(organizationId: string, actor: Actor, id: string) {
    const course = await this.prisma.course.findFirst({
      where: {
        id,
        organizationId,
        ...(actor.role === MembershipRole.STUDENT ? { status: CourseStatus.PUBLISHED } : {}),
      },
      include: courseDetailInclude,
    });
    if (!course) throw new ResourceNotFoundException('Curso não encontrado');
    return course;
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateCourseDto) {
    const current = await this.findCourse(organizationId, id);
    const course = await this.prisma.course.update({
      where: { id: current.id },
      data: { title: dto.title, description: dto.description, status: dto.status },
      include: courseDetailInclude,
    });
    await this.audit.log({
      organizationId,
      userId,
      action:
        dto.status && dto.status !== current.status ? 'course.status_changed' : 'course.updated',
      resource: 'course',
      resourceId: id,
      metadata: { fields: Object.keys(dto), fromStatus: current.status, toStatus: course.status },
    });
    return course;
  }

  // UC05 — Matricular aluno
  async enroll(organizationId: string, actor: Actor, courseId: string, dto: EnrollDto) {
    const course = await this.findCourse(organizationId, courseId);
    const targetUserId = await this.resolveTargetUser(organizationId, actor, dto.userId);

    // regra 8.3: só cursos PUBLICADOS recebem matrícula
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BusinessRuleException('Somente cursos publicados aceitam matrícula');
    }

    const existing = await this.prisma.enrollment.findUnique({
      where: { courseId_userId: { courseId, userId: targetUserId } },
    });
    if (existing && existing.status !== EnrollmentStatus.CANCELLED) {
      throw new ConflictAppException('Usuário já possui matrícula ativa neste curso');
    }

    const enrollment = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.enrollment.update({
            where: { id: existing.id },
            data: { status: EnrollmentStatus.ACTIVE },
          })
        : await tx.enrollment.create({
            data: { organizationId, courseId, userId: targetUserId },
          });
      await this.audit.log(
        {
          organizationId,
          userId: actor.id,
          action: 'enrollment.created',
          resource: 'enrollment',
          resourceId: saved.id,
          metadata: { courseId, targetUserId },
        },
        tx,
      );
      await this.notifications.notify(
        {
          organizationId,
          userId: targetUserId,
          type: 'ENROLLMENT_CREATED',
          title: 'Matrícula confirmada',
          body: `Você foi matriculado no curso "${course.title}"`,
        },
        tx,
      );
      return saved;
    });
    return enrollment;
  }

  // UC06 — Consultar progresso
  async getProgress(organizationId: string, actor: Actor, courseId: string, queryUserId?: string) {
    await this.findCourse(organizationId, courseId);
    const userId = await this.resolveTargetUser(organizationId, actor, queryUserId, false);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, userId, organizationId },
    });
    if (!enrollment)
      throw new ResourceNotFoundException('Matrícula não encontrada para este curso');
    return { courseId, ...(await this.progressFor(enrollment.id, courseId)) };
  }

  // UC06 — Concluir aula
  async completeLesson(organizationId: string, actor: Actor, courseId: string, lessonId: string) {
    const course = await this.findCourse(organizationId, courseId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, module: { courseId } },
    });
    if (!lesson) throw new ResourceNotFoundException('Aula não encontrada neste curso');

    // regra 8.3: aula só pode ser concluída por usuário com matrícula válida
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        courseId,
        userId: actor.id,
        organizationId,
        status: { in: VALID_ENROLLMENT },
      },
    });
    if (!enrollment)
      throw new ForbiddenAppException('É necessário ter uma matrícula válida no curso');

    await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
      create: { enrollmentId: enrollment.id, lessonId },
      update: {},
    });

    const progress = await this.progressFor(enrollment.id, courseId);
    if (progress.completed) {
      // só o primeiro a concluir (mesmo com requisições concorrentes) dispara o evento
      const updated = await this.prisma.enrollment.updateMany({
        where: { id: enrollment.id, status: EnrollmentStatus.ACTIVE },
        data: { status: EnrollmentStatus.COMPLETED },
      });
      if (updated.count === 1) {
        await this.notifications.notify({
          organizationId,
          userId: actor.id,
          type: 'COURSE_COMPLETED',
          title: 'Curso concluído',
          body: `Você concluiu 100% do curso "${course.title}"`,
        });
        await this.audit.log({
          organizationId,
          userId: actor.id,
          action: 'course.completed',
          resource: 'enrollment',
          resourceId: enrollment.id,
        });
      }
    }
    return { courseId, lessonId, ...progress };
  }

  async myEnrollments(organizationId: string, userId: string, query: ListEnrollmentsQueryDto) {
    const page = resolvePage(query);
    const where: Prisma.EnrollmentWhereInput = { organizationId, userId };
    const [enrollments, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where,
        include: { course: { select: { id: true, title: true, status: true } } },
        orderBy: { createdAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.enrollment.count({ where }),
    ]);

    // agregações em lote (evita N+1)
    const courseIds = enrollments.map((e) => e.courseId);
    const enrollmentIds = enrollments.map((e) => e.id);
    const [lessons, done] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { module: { courseId: { in: courseIds } } },
        select: { module: { select: { courseId: true } } },
      }),
      this.prisma.lessonProgress.groupBy({
        by: ['enrollmentId'],
        where: { enrollmentId: { in: enrollmentIds } },
        _count: { _all: true },
      }),
    ]);
    const totalByCourse = new Map<string, number>();
    for (const l of lessons) {
      totalByCourse.set(l.module.courseId, (totalByCourse.get(l.module.courseId) ?? 0) + 1);
    }
    const doneByEnrollment = new Map(done.map((d) => [d.enrollmentId, d._count._all]));

    const data = enrollments.map((e) => ({
      id: e.id,
      status: e.status,
      createdAt: e.createdAt,
      course: e.course,
      progress: calculateProgress(
        doneByEnrollment.get(e.id) ?? 0,
        totalByCourse.get(e.courseId) ?? 0,
      ),
    }));
    return paginated(data, total, page);
  }

  // ----------------------------------------------------------------- helpers

  private async findCourse(organizationId: string, id: string) {
    const course = await this.prisma.course.findFirst({ where: { id, organizationId } });
    if (!course) throw new ResourceNotFoundException('Curso não encontrado');
    return course;
  }

  private async progressFor(enrollmentId: string, courseId: string) {
    const [total, completed] = await Promise.all([
      this.prisma.lesson.count({ where: { module: { courseId } } }),
      this.prisma.lessonProgress.count({ where: { enrollmentId } }),
    ]);
    return calculateProgress(completed, total);
  }

  /** Só OWNER/ADMIN agem em nome de outro usuário, que deve ser membro ativo da organização. */
  private async resolveTargetUser(
    organizationId: string,
    actor: Actor,
    requested?: string,
    requireMembership = true,
  ): Promise<string> {
    if (!requested || requested === actor.id) return actor.id;
    if (!MANAGERS.includes(actor.role)) throw new ForbiddenAppException();
    if (requireMembership) {
      const member = await this.prisma.membership.findFirst({
        where: { organizationId, userId: requested, status: MembershipStatus.ACTIVE },
      });
      if (!member) throw new ResourceNotFoundException('Usuário não é membro desta organização');
    }
    return requested;
  }
}
