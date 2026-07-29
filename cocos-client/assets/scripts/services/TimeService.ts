export interface Clock { now(): number; }
export interface LocalTime { year: number; month: number; day: number; hour: number; minute: number; second: number; }

export const systemClock: Clock = { now: () => Date.now() };

export class TimeService {
  private readonly clock: Clock;
  private readonly timezone: string;
  constructor(clock: Clock = systemClock, timezone = 'Asia/Shanghai') { this.clock = clock; this.timezone = timezone; }

  now(): number { return this.clock.now(); }

  localParts(at = this.now()): LocalTime {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
  }

  dayKey(at = this.now()): string { const p = this.localParts(at); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }

  weekKey(at = this.now()): string {
    const p = this.localParts(at); const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const weekday = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - weekday + 1);
    const thursday = new Date(date); thursday.setUTCDate(date.getUTCDate() + 3);
    return `${thursday.getUTCFullYear()}-W${String(this.isoWeek(date)).padStart(2, '0')}`;
  }

  private isoWeek(date: Date): number {
    const thursday = new Date(date); thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
    first.setUTCDate(first.getUTCDate() + 3 - (first.getUTCDay() || 7));
    return Math.floor((thursday.getTime() - first.getTime()) / 604800000) + 1;
  }

  offlineDurationMs(lastSeen: number, at = this.now(), maxMs = 24 * 60 * 60 * 1000): number {
    if (!Number.isFinite(lastSeen) || !Number.isFinite(at) || !Number.isFinite(maxMs) || maxMs < 0) return 0;
    return Math.min(maxMs, Math.max(0, at - lastSeen));
  }
}
