export interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string; // HH:mm (UTC)
  endTime: string; // HH:mm (UTC)
}

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const minutesOfDay = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

const sameUtcDay = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

/** Dois intervalos [início, fim) se sobrepõem? Horários encostados não conflitam. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** O intervalo cabe inteiramente em uma janela de disponibilidade do mesmo dia (UTC)? */
export function isWithinAvailability(range: TimeRange, windows: AvailabilityWindow[]): boolean {
  if (!sameUtcDay(range.startAt, range.endAt)) return false;
  const day = range.startAt.getUTCDay();
  const start = minutesOfDay(range.startAt);
  const end = minutesOfDay(range.endAt);
  return windows.some(
    (w) => w.dayOfWeek === day && start >= toMinutes(w.startTime) && end <= toMinutes(w.endTime),
  );
}

/**
 * Calcula os horários livres de um dia (UTC): percorre cada janela da disponibilidade em
 * passos de `durationMinutes`, descartando os que já passaram ou colidem com agendamentos.
 */
export function generateSlots(params: {
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  windows: AvailabilityWindow[];
  busy: TimeRange[];
  now: Date;
}): TimeRange[] {
  const { date, durationMinutes, windows, busy, now } = params;
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayOfWeek = dayStart.getUTCDay();
  const slots: TimeRange[] = [];

  for (const w of windows.filter((x) => x.dayOfWeek === dayOfWeek)) {
    const winEnd = toMinutes(w.endTime);
    for (let m = toMinutes(w.startTime); m + durationMinutes <= winEnd; m += durationMinutes) {
      const slot = {
        startAt: new Date(dayStart.getTime() + m * 60_000),
        endAt: new Date(dayStart.getTime() + (m + durationMinutes) * 60_000),
      };
      if (slot.startAt < now) continue;
      if (busy.some((b) => overlaps(slot, b))) continue;
      slots.push(slot);
    }
  }
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
