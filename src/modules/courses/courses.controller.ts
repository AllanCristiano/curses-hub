import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { AuthUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentUser, Roles, Tenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { CoursesService } from './courses.service';
import {
  CreateCourseDto,
  EnrollDto,
  ListCoursesQueryDto,
  ListEnrollmentsQueryDto,
  ProgressQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';

const actorOf = (user: AuthUser, tenant: TenantContext) => ({ id: user.id, role: tenant.role });

@ApiTags('Courses')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Post('courses')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Cria curso com módulos e aulas (OWNER, ADMIN)' })
  @ApiResponse({ status: 201, description: 'Curso criado' })
  @ApiStandardErrors()
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CreateCourseDto) {
    return this.courses.create(t.organizationId, u.id, dto);
  }

  @Get('courses')
  @ApiOperation({ summary: 'Lista cursos (alunos veem apenas cursos publicados)' })
  @ApiStandardErrors()
  list(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query() q: ListCoursesQueryDto) {
    return this.courses.list(t.organizationId, actorOf(u, t), q);
  }

  @Get('courses/:id')
  @ApiOperation({ summary: 'Detalha curso com módulos e aulas' })
  @ApiStandardErrors(404)
  get(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.courses.get(t.organizationId, actorOf(u, t), id);
  }

  @Patch('courses/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza curso (OWNER, ADMIN)' })
  @ApiStandardErrors(404)
  update(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courses.update(t.organizationId, u.id, id, dto);
  }

  @Post('courses/:id/enroll')
  @ApiOperation({ summary: 'Cria matrícula (UC05) — apenas cursos PUBLISHED' })
  @ApiResponse({ status: 201, description: 'Matrícula criada' })
  @ApiStandardErrors(404, 409, 422)
  enroll(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollDto,
  ) {
    return this.courses.enroll(t.organizationId, actorOf(u, t), id, dto);
  }

  @Get('courses/:id/progress')
  @ApiOperation({ summary: 'Consulta o progresso do aluno no curso' })
  @ApiStandardErrors(404)
  progress(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ProgressQueryDto,
  ) {
    return this.courses.getProgress(t.organizationId, actorOf(u, t), id, q.userId);
  }

  @Post('courses/:id/lessons/:lessonId/complete')
  @ApiOperation({ summary: 'Conclui uma aula (UC06) — exige matrícula válida' })
  @ApiResponse({ status: 201, description: 'Aula concluída; retorna o progresso atualizado' })
  @ApiStandardErrors(404)
  complete(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
  ) {
    return this.courses.completeLesson(t.organizationId, actorOf(u, t), id, lessonId);
  }

  @Get('enrollments/me')
  @ApiOperation({ summary: 'Lista as matrículas do usuário com o progresso de cada curso' })
  @ApiStandardErrors()
  myEnrollments(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Query() q: ListEnrollmentsQueryDto,
  ) {
    return this.courses.myEnrollments(t.organizationId, u.id, q);
  }
}
