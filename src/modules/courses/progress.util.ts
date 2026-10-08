export interface CourseProgress {
  completedLessons: number;
  totalLessons: number;
  percentage: number;
  completed: boolean;
}

/**
 * Regra 8.3: percentual = aulas concluídas / total de aulas × 100.
 * Curso sem aulas nunca gera progresso positivo.
 */
export function calculateProgress(completedLessons: number, totalLessons: number): CourseProgress {
  if (totalLessons <= 0) {
    return { completedLessons: 0, totalLessons: 0, percentage: 0, completed: false };
  }
  const completed = Math.min(Math.max(completedLessons, 0), totalLessons);
  return {
    completedLessons: completed,
    totalLessons,
    percentage: Math.round((completed / totalLessons) * 10000) / 100,
    completed: completed === totalLessons,
  };
}
