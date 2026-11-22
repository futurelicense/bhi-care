export function shiftDate(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
}

export function addMonths(month: string, count: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex - 1 + count, 1)).toISOString().slice(0, 7);
}
