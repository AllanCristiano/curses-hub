import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, addMemberAndLogin, auth, createApp, register } from './helpers';

describe('Courses (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  const courseBody = {
    title: 'Backend com NestJS',
    status: 'PUBLISHED',
    modules: [
      { title: 'Fundamentos', lessons: [{ title: 'Aula 1' }, { title: 'Aula 2' }] },
      {
        title: 'Persistência',
        lessons: [{ title: 'Aula 3' }, { title: 'Aula 4', contentUrl: 'https://example.com/a4' }],
      },
    ],
  };

  it('fluxo curso → matrícula → conclusão de aulas → progresso (T04, T05, A.3)', async () => {
    const owner = await register(app);
    const student = await addMemberAndLogin(app, owner, 'STUDENT');

    const course = (
      await http().post(`${API}/courses`).set(auth(owner)).send(courseBody).expect(201)
    ).body;
    const lessons = course.modules.flatMap((m: any) => m.lessons);
    expect(course.modules.map((m: any) => m.position)).toEqual([1, 2]);
    expect(lessons).toHaveLength(4);

    // T04 — concluir aula sem matrícula
    await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[0].id}/complete`)
      .set(auth(student))
      .expect(403);

    await http().post(`${API}/courses/${course.id}/enroll`).set(auth(student)).send({}).expect(201);
    // matrícula duplicada
    await http().post(`${API}/courses/${course.id}/enroll`).set(auth(student)).send({}).expect(409);

    const p0 = await http()
      .get(`${API}/courses/${course.id}/progress`)
      .set(auth(student))
      .expect(200);
    expect(p0.body).toEqual({
      courseId: course.id,
      completedLessons: 0,
      totalLessons: 4,
      percentage: 0,
      completed: false,
    });

    await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[0].id}/complete`)
      .set(auth(student))
      .expect(201);
    const second = await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[1].id}/complete`)
      .set(auth(student))
      .expect(201);
    // T05 — 2 de 4 = 50%
    expect(second.body).toMatchObject({
      completedLessons: 2,
      totalLessons: 4,
      percentage: 50,
      completed: false,
    });

    // idempotente: concluir a mesma aula de novo não duplica
    const again = await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[1].id}/complete`)
      .set(auth(student))
      .expect(201);
    expect(again.body.completedLessons).toBe(2);

    const mine = await http().get(`${API}/enrollments/me`).set(auth(student)).expect(200);
    expect(mine.body.data[0]).toMatchObject({
      status: 'ACTIVE',
      course: { id: course.id },
      progress: { percentage: 50 },
    });

    await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[2].id}/complete`)
      .set(auth(student))
      .expect(201);
    const done = await http()
      .post(`${API}/courses/${course.id}/lessons/${lessons[3].id}/complete`)
      .set(auth(student))
      .expect(201);
    expect(done.body).toMatchObject({ percentage: 100, completed: true });

    const mine2 = await http().get(`${API}/enrollments/me`).set(auth(student)).expect(200);
    expect(mine2.body.data[0].status).toBe('COMPLETED');

    // notificações: ao entrar na organização, matrícula e conclusão
    const notes = await http().get(`${API}/notifications`).set(auth(student)).expect(200);
    expect(notes.body.data.map((n: any) => n.type).sort()).toEqual([
      'COURSE_COMPLETED',
      'ENROLLMENT_CREATED',
      'MEMBER_ADDED',
    ]);
  });

  it('só cursos PUBLISHED aceitam matrícula (422 BUSINESS_RULE_VIOLATION)', async () => {
    const owner = await register(app);
    const student = await addMemberAndLogin(app, owner, 'STUDENT');
    const draft = (
      await http().post(`${API}/courses`).set(auth(owner)).send({ title: 'Rascunho' }).expect(201)
    ).body;
    expect(draft.status).toBe('DRAFT');

    const byStudent = await http()
      .post(`${API}/courses/${draft.id}/enroll`)
      .set(auth(student))
      .send({})
      .expect(422);
    expect(byStudent.body.error).toBe('BUSINESS_RULE_VIOLATION');
    await http()
      .post(`${API}/courses/${draft.id}/enroll`)
      .set(auth(owner))
      .send({ userId: student.userId })
      .expect(422);

    await http()
      .patch(`${API}/courses/${draft.id}`)
      .set(auth(owner))
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await http().post(`${API}/courses/${draft.id}/enroll`).set(auth(student)).send({}).expect(422);
  });

  it('OWNER matricula um aluno; aluno não matricula terceiros; progresso de terceiros só para gestores', async () => {
    const owner = await register(app);
    const s1 = await addMemberAndLogin(app, owner, 'STUDENT');
    const s2 = await addMemberAndLogin(app, owner, 'STUDENT');
    const course = (
      await http().post(`${API}/courses`).set(auth(owner)).send(courseBody).expect(201)
    ).body;

    await http()
      .post(`${API}/courses/${course.id}/enroll`)
      .set(auth(s1))
      .send({ userId: s2.userId })
      .expect(403);
    await http()
      .post(`${API}/courses/${course.id}/enroll`)
      .set(auth(owner))
      .send({ userId: s2.userId })
      .expect(201);
    await http()
      .get(`${API}/courses/${course.id}/progress?userId=${s2.userId}`)
      .set(auth(owner))
      .expect(200);
    await http()
      .get(`${API}/courses/${course.id}/progress?userId=${s2.userId}`)
      .set(auth(s1))
      .expect(403);
    await http().get(`${API}/courses/${course.id}/progress`).set(auth(s1)).expect(404); // s1 não está matriculado
  });

  it('aluno lista apenas cursos publicados; rascunho publicado via PATCH passa a aparecer', async () => {
    const owner = await register(app);
    const student = await addMemberAndLogin(app, owner, 'STUDENT');
    const draft = (
      await http().post(`${API}/courses`).set(auth(owner)).send({ title: 'Em breve' }).expect(201)
    ).body;
    await http()
      .post(`${API}/courses`)
      .set(auth(owner))
      .send({ title: 'No ar', status: 'PUBLISHED' })
      .expect(201);

    expect(
      (await http().get(`${API}/courses`).set(auth(student)).expect(200)).body.data.map(
        (c: any) => c.title,
      ),
    ).toEqual(['No ar']);
    expect((await http().get(`${API}/courses`).set(auth(owner)).expect(200)).body.meta.total).toBe(
      2,
    );
    await http().get(`${API}/courses/${draft.id}`).set(auth(student)).expect(404);

    await http()
      .patch(`${API}/courses/${draft.id}`)
      .set(auth(owner))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    await http().get(`${API}/courses/${draft.id}`).set(auth(student)).expect(200);
  });

  it('validação aninhada devolve o caminho do campo', async () => {
    const owner = await register(app);
    const res = await http()
      .post(`${API}/courses`)
      .set(auth(owner))
      .send({
        title: 'Curso',
        modules: [{ title: 'M', lessons: [{ title: 'A', contentUrl: 'não-é-url' }] }],
      })
      .expect(400);
    expect(res.body.details.map((d: any) => d.field)).toEqual(
      expect.arrayContaining([
        'modules.0.title',
        'modules.0.lessons.0.title',
        'modules.0.lessons.0.contentUrl',
      ]),
    );
  });

  it('aula de outro curso não pode ser concluída (404)', async () => {
    const owner = await register(app);
    const student = await addMemberAndLogin(app, owner, 'STUDENT');
    const c1 = (await http().post(`${API}/courses`).set(auth(owner)).send(courseBody).expect(201))
      .body;
    const c2 = (await http().post(`${API}/courses`).set(auth(owner)).send(courseBody).expect(201))
      .body;
    await http().post(`${API}/courses/${c1.id}/enroll`).set(auth(student)).send({}).expect(201);
    await http()
      .post(`${API}/courses/${c1.id}/lessons/${c2.modules[0].lessons[0].id}/complete`)
      .set(auth(student))
      .expect(404);
  });
});
