import { calculateProgress } from '../../src/modules/courses/progress.util';

describe('calculateProgress (regra 8.3)', () => {
  it('T05 — 2 de 4 aulas concluídas = 50%', () => {
    expect(calculateProgress(2, 4)).toEqual({
      completedLessons: 2,
      totalLessons: 4,
      percentage: 50,
      completed: false,
    });
  });

  it('8 de 10 aulas = 80% (exemplo A.3 do documento)', () => {
    expect(calculateProgress(8, 10)).toMatchObject({ percentage: 80, completed: false });
  });

  it('todas as aulas concluídas = 100% e completed', () => {
    expect(calculateProgress(5, 5)).toMatchObject({ percentage: 100, completed: true });
  });

  it('curso sem aulas não gera progresso positivo', () => {
    expect(calculateProgress(3, 0)).toEqual({
      completedLessons: 0,
      totalLessons: 0,
      percentage: 0,
      completed: false,
    });
  });

  it('arredonda para duas casas e nunca passa de 100%', () => {
    expect(calculateProgress(1, 3).percentage).toBe(33.33);
    expect(calculateProgress(9, 3).percentage).toBe(100);
  });
});
