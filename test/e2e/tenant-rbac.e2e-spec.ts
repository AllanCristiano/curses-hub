import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, PASSWORD, addMemberAndLogin, auth, createApp, register, uniq } from './helpers';

describe('Isolamento multi-tenant e RBAC (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  it('T03 — usuário da Organização A não acessa recursos da Organização B', async () => {
    const orgA = await register(app, 'A');
    const orgB = await register(app, 'B');

    const leadB = await http()
      .post(`${API}/leads`)
      .set(auth(orgB))
      .send({ name: 'Lead de B', email: 'b@b.com' })
      .expect(201);
    const stageB = (await http().get(`${API}/lead-stages`).set(auth(orgB)).expect(200)).body[0];
    const courseB = await http()
      .post(`${API}/courses`)
      .set(auth(orgB))
      .send({ title: 'Curso B', status: 'PUBLISHED' })
      .expect(201);
    const invoiceB = await http()
      .post(`${API}/invoices`)
      .set(auth(orgB))
      .send({
        customerName: 'Cliente B',
        items: [{ description: 'Item', quantity: 1, unitPrice: 10 }],
      })
      .expect(201);

    // leitura, escrita e exclusão cruzadas => 404 (recurso "inexistente" para este tenant)
    await http().get(`${API}/leads/${leadB.body.id}`).set(auth(orgA)).expect(404);
    await http()
      .patch(`${API}/leads/${leadB.body.id}`)
      .set(auth(orgA))
      .send({ name: 'hack' })
      .expect(404);
    await http().delete(`${API}/leads/${leadB.body.id}`).set(auth(orgA)).expect(404);
    await http()
      .patch(`${API}/leads/${leadB.body.id}/stage`)
      .set(auth(orgA))
      .send({ stageId: stageB.id })
      .expect(404);
    await http().get(`${API}/courses/${courseB.body.id}`).set(auth(orgA)).expect(404);
    await http()
      .post(`${API}/courses/${courseB.body.id}/enroll`)
      .set(auth(orgA))
      .send({})
      .expect(404);
    await http().get(`${API}/invoices/${invoiceB.body.id}`).set(auth(orgA)).expect(404);
    await http()
      .patch(`${API}/invoices/${invoiceB.body.id}/pay`)
      .set(auth(orgA))
      .send({})
      .expect(404);

    // mover o PRÓPRIO lead para uma etapa de outro tenant também falha
    const ownLead = await http()
      .post(`${API}/leads`)
      .set(auth(orgA))
      .send({ name: 'Lead de A', email: 'a@a.com' })
      .expect(201);
    await http()
      .patch(`${API}/leads/${ownLead.body.id}/stage`)
      .set(auth(orgA))
      .send({ stageId: stageB.id })
      .expect(404);

    // listagens só trazem dados do próprio tenant
    const list = await http().get(`${API}/leads`).set(auth(orgA)).expect(200);
    expect(list.body.data.map((l: any) => l.id)).toEqual([ownLead.body.id]);

    // dados de B continuam intactos
    const stillThere = await http()
      .get(`${API}/leads/${leadB.body.id}`)
      .set(auth(orgB))
      .expect(200);
    expect(stillThere.body.name).toBe('Lead de B');
  });

  it('o header x-organization-id não permite acessar organização da qual o usuário não participa', async () => {
    const orgA = await register(app, 'A');
    const orgB = await register(app, 'B');
    const res = await http()
      .get(`${API}/leads`)
      .set(auth(orgA))
      .set('x-organization-id', orgB.organizationId)
      .expect(403);
    expect(res.body.error).toBe('FORBIDDEN');
    await http()
      .get(`${API}/leads`)
      .set(auth(orgA))
      .set('x-organization-id', 'nao-uuid')
      .expect(400);
  });

  it('usuário em duas organizações alterna o contexto com x-organization-id (validado por Membership)', async () => {
    const orgA = await register(app, 'A');
    const orgB = await register(app, 'B');
    // A convida o dono de B como MEMBER
    await http()
      .post(`${API}/organizations/me/members`)
      .set(auth(orgA))
      .send({ email: orgB.email, role: 'MEMBER' })
      .expect(201);

    await http()
      .post(`${API}/leads`)
      .set(auth(orgB))
      .send({ name: 'Lead B', email: 'x@b.com' })
      .expect(201);
    // token de B (org padrão B) enxerga A apenas escolhendo A explicitamente
    const asA = await http()
      .get(`${API}/leads`)
      .set(auth(orgB))
      .set('x-organization-id', orgA.organizationId)
      .expect(200);
    expect(asA.body.data).toEqual([]);
    const asB = await http().get(`${API}/leads`).set(auth(orgB)).expect(200);
    expect(asB.body.data).toHaveLength(1);

    const me = await http().get(`${API}/auth/me`).set(auth(orgB)).expect(200);
    expect(me.body.memberships).toHaveLength(2);
  });

  it('T10 — papéis: MEMBER não executa ações de OWNER; STUDENT não acessa CRM/financeiro', async () => {
    const owner = await register(app);
    const admin = await addMemberAndLogin(app, owner, 'ADMIN');
    const member = await addMemberAndLogin(app, owner, 'MEMBER');
    const student = await addMemberAndLogin(app, owner, 'STUDENT');

    // ações de OWNER
    await http()
      .patch(`${API}/organizations/me`)
      .set(auth(member))
      .send({ name: 'Hack' })
      .expect(403);
    await http()
      .patch(`${API}/organizations/me`)
      .set(auth(admin))
      .send({ name: 'Hack' })
      .expect(403);
    await http()
      .post(`${API}/organizations/me/members`)
      .set(auth(member))
      .send({ email: `x${uniq()}@x.com`, role: 'ADMIN', name: 'X Y', password: PASSWORD })
      .expect(403);
    await http()
      .delete(`${API}/organizations/me/members/${admin.userId}`)
      .set(auth(member))
      .expect(403);
    await http()
      .patch(`${API}/organizations/me`)
      .set(auth(owner))
      .send({ name: 'Nome Novo' })
      .expect(200);

    // listar membros: OWNER/ADMIN apenas
    await http().get(`${API}/organizations/me/members`).set(auth(admin)).expect(200);
    await http().get(`${API}/organizations/me/members`).set(auth(member)).expect(403);

    // ADMIN gerencia financeiro e cursos; MEMBER não
    const invoiceBody = {
      customerName: 'Cliente',
      items: [{ description: 'Item', quantity: 1, unitPrice: 10 }],
    };
    await http().post(`${API}/invoices`).set(auth(admin)).send(invoiceBody).expect(201);
    await http().post(`${API}/invoices`).set(auth(member)).send(invoiceBody).expect(403);
    await http().post(`${API}/courses`).set(auth(member)).send({ title: 'Curso X' }).expect(403);

    // MEMBER opera CRM; STUDENT não
    await http()
      .post(`${API}/leads`)
      .set(auth(member))
      .send({ name: 'Lead M', email: 'm@m.com' })
      .expect(201);
    await http().get(`${API}/leads`).set(auth(student)).expect(403);
    await http().get(`${API}/invoices`).set(auth(student)).expect(403);
    await http().get(`${API}/appointments`).set(auth(student)).expect(403);
  });

  it('OWNER não pode ser rebaixado/removido; membro removido perde o acesso', async () => {
    const owner = await register(app);
    const member = await addMemberAndLogin(app, owner, 'MEMBER');

    const protectedOwner = await http()
      .patch(`${API}/organizations/me/members/${owner.userId}`)
      .set(auth(owner))
      .send({ role: 'MEMBER' })
      .expect(422);
    expect(protectedOwner.body.error).toBe('BUSINESS_RULE_VIOLATION');
    await http()
      .delete(`${API}/organizations/me/members/${owner.userId}`)
      .set(auth(owner))
      .expect(422);

    await http().get(`${API}/leads`).set(auth(member)).expect(200);
    await http()
      .patch(`${API}/organizations/me/members/${member.userId}`)
      .set(auth(owner))
      .send({ role: 'ADMIN' })
      .expect(200);
    await http()
      .delete(`${API}/organizations/me/members/${member.userId}`)
      .set(auth(owner))
      .expect(204);
    await http().get(`${API}/leads`).set(auth(member)).expect(403);
  });
});
