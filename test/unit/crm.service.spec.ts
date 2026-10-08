import { CrmService } from '../../src/modules/crm/crm.service';
import { auditMock, createPrismaMock } from './helpers';

function setup() {
  const prisma = createPrismaMock();
  const audit = auditMock();
  return { prisma, audit, service: new CrmService(prisma, audit as any) };
}

describe('CrmService (LeadService)', () => {
  describe('createLead', () => {
    it('cria lead na primeira etapa quando stageId é omitido e audita', async () => {
      const { prisma, audit, service } = setup();
      prisma.leadStage.findFirst.mockResolvedValue({ id: 's1', name: 'Novo' });
      prisma.lead.create.mockResolvedValue({
        id: 'l1',
        name: 'Maria',
        stage: { id: 's1', name: 'Novo' },
      });

      const lead = await service.createLead('o1', 'u1', { name: 'Maria', email: 'm@x.com' });

      expect(lead.id).toBe('l1');
      expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({
        organizationId: 'o1',
        stageId: 's1',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.created', resourceId: 'l1' }),
      );
    });

    it('exige pelo menos um canal de contato (400)', async () => {
      const { service } = setup();
      await expect(service.createLead('o1', 'u1', { name: 'Sem contato' })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('etapa de outra organização retorna 404', async () => {
      const { prisma, service } = setup();
      prisma.leadStage.findFirst.mockResolvedValue(null);
      await expect(
        service.createLead('o1', 'u1', {
          name: 'Maria',
          phone: '79999999999',
          stageId: 'stage-de-outro-tenant',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.leadStage.findFirst).toHaveBeenCalledWith({
        where: { id: 'stage-de-outro-tenant', organizationId: 'o1' },
      });
    });
  });

  describe('getLead — isolamento por tenant', () => {
    it('sempre combina o id com o organizationId', async () => {
      const { prisma, service } = setup();
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.getLead('org-A', 'lead-da-org-B')).rejects.toMatchObject({
        status: 404,
      });
      expect(prisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lead-da-org-B', organizationId: 'org-A' } }),
      );
    });
  });

  describe('updateLead', () => {
    it('atualiza só o nome mantendo o canal de contato existente e audita os campos alterados', async () => {
      const { prisma, audit, service } = setup();
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', email: 'a@a.com', phone: null });
      prisma.lead.update.mockResolvedValue({ id: 'l1', name: 'Novo nome' });

      await service.updateLead('o1', 'u1', 'l1', { name: 'Novo nome' });

      expect(prisma.lead.update).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.updated', metadata: { fields: ['name'] } }),
      );
    });
  });

  describe('moveLead', () => {
    it('muda a etapa e gera AuditLog com origem e destino', async () => {
      const { prisma, audit, service } = setup();
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1', stageId: 's1' });
      prisma.leadStage.findFirst.mockResolvedValue({ id: 's2' });
      prisma.lead.update.mockResolvedValue({ id: 'l1', stageId: 's2' });

      await service.moveLead('o1', 'u1', 'l1', { stageId: 's2' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lead.stage_changed',
          metadata: { fromStageId: 's1', toStageId: 's2' },
        }),
        expect.anything(),
      );
    });
  });

  describe('archiveLead', () => {
    it('arquiva (exclusão lógica) em vez de apagar', async () => {
      const { prisma, service } = setup();
      prisma.lead.findFirst.mockResolvedValue({ id: 'l1' });
      await service.archiveLead('o1', 'u1', 'l1');
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ARCHIVED' } }),
      );
    });
  });
});
