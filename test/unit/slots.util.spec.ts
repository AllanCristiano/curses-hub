import {
  generateSlots,
  isWithinAvailability,
  overlaps,
  toMinutes,
} from '../../src/modules/scheduling/slots.util';

const d = (iso: string) => new Date(iso);
// 2026-10-12 é uma segunda-feira (dayOfWeek = 1)
const monday = [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }];

describe('slots.util', () => {
  it('toMinutes converte HH:mm', () => {
    expect(toMinutes('09:30')).toBe(570);
  });

  describe('overlaps — intervalos [início, fim)', () => {
    const a = { startAt: d('2026-10-12T10:00:00Z'), endAt: d('2026-10-12T11:00:00Z') };
    it('detecta sobreposição parcial e total', () => {
      expect(
        overlaps(a, { startAt: d('2026-10-12T10:30:00Z'), endAt: d('2026-10-12T11:30:00Z') }),
      ).toBe(true);
      expect(
        overlaps(a, { startAt: d('2026-10-12T09:00:00Z'), endAt: d('2026-10-12T12:00:00Z') }),
      ).toBe(true);
    });
    it('horários encostados não conflitam', () => {
      expect(
        overlaps(a, { startAt: d('2026-10-12T11:00:00Z'), endAt: d('2026-10-12T12:00:00Z') }),
      ).toBe(false);
      expect(
        overlaps(a, { startAt: d('2026-10-12T09:00:00Z'), endAt: d('2026-10-12T10:00:00Z') }),
      ).toBe(false);
    });
  });

  describe('isWithinAvailability', () => {
    it('aceita intervalo contido na janela', () => {
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-12T09:00:00Z'), endAt: d('2026-10-12T10:00:00Z') },
          monday,
        ),
      ).toBe(true);
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-12T11:00:00Z'), endAt: d('2026-10-12T12:00:00Z') },
          monday,
        ),
      ).toBe(true);
    });
    it('rejeita intervalo que ultrapassa a janela, outro dia da semana ou vira o dia', () => {
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-12T11:30:00Z'), endAt: d('2026-10-12T12:30:00Z') },
          monday,
        ),
      ).toBe(false);
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-13T09:00:00Z'), endAt: d('2026-10-13T10:00:00Z') },
          monday,
        ),
      ).toBe(false);
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-12T23:00:00Z'), endAt: d('2026-10-13T01:00:00Z') },
          monday,
        ),
      ).toBe(false);
    });
    it('sem janelas, nada é permitido', () => {
      expect(
        isWithinAvailability(
          { startAt: d('2026-10-12T09:00:00Z'), endAt: d('2026-10-12T10:00:00Z') },
          [],
        ),
      ).toBe(false);
    });
  });

  describe('generateSlots', () => {
    const base = {
      date: '2026-10-12',
      durationMinutes: 60,
      windows: monday,
      now: d('2026-10-01T00:00:00Z'),
    };

    it('gera slots consecutivos dentro da janela', () => {
      const slots = generateSlots({ ...base, busy: [] });
      expect(slots.map((s) => s.startAt.toISOString())).toEqual([
        '2026-10-12T09:00:00.000Z',
        '2026-10-12T10:00:00.000Z',
        '2026-10-12T11:00:00.000Z',
      ]);
    });

    it('remove slots ocupados e slots no passado', () => {
      const busy = [{ startAt: d('2026-10-12T10:00:00Z'), endAt: d('2026-10-12T11:00:00Z') }];
      const slots = generateSlots({ ...base, busy, now: d('2026-10-12T09:30:00Z') });
      expect(slots.map((s) => s.startAt.toISOString())).toEqual(['2026-10-12T11:00:00.000Z']);
    });

    it('dia sem disponibilidade não tem slots', () => {
      expect(generateSlots({ ...base, date: '2026-10-13', busy: [] })).toEqual([]);
    });

    it('duração maior que a janela não gera slots', () => {
      expect(generateSlots({ ...base, durationMinutes: 240, busy: [] })).toEqual([]);
    });
  });
});
