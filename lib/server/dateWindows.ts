import type { MetricWindow } from "@/lib/shared/types";

export type WindowRange = {
  key: MetricWindow;
  label: string;
  start: Date;
  end: Date;
};

const PT_TIMEZONE = "America/Los_Angeles";

function getPtDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

export function getPacificDateParts(date: Date): { year: number; month: number; day: number } {
  return getPtDateParts(date);
}

function ptOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    timeZoneName: "shortOffset"
  });
  const offset = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT-8";
  const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return -8 * 60;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function ptMidnightUtc(date: Date): Date {
  const { year, month, day } = getPtDateParts(date);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offset = ptOffsetMinutes(utcGuess);
  return new Date(utcGuess.getTime() - offset * 60 * 1000);
}

export function getMetricWindows(now = new Date()): WindowRange[] {
  const todayStart = ptMidnightUtc(now);
  const end = now;

  return [
    { key: "today", label: "Today", start: todayStart, end },
    { key: "sevenDays", label: "Past 7 days", start: new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000), end },
    { key: "thirtyDays", label: "Past 30 days", start: new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000), end }
  ];
}

export function ptDateKey(date: Date): string {
  const parts = getPtDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getPastThirtyDayKeys(now = new Date()): string[] {
  const todayStart = ptMidnightUtc(now);
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(todayStart.getTime() - (29 - index) * 24 * 60 * 60 * 1000);
    return ptDateKey(date);
  });
}

export function getPastThirtyDayRange(now = new Date()): WindowRange {
  const windows = getMetricWindows(now);
  const thirtyDays = windows.find((window) => window.key === "thirtyDays");
  if (!thirtyDays) throw new Error("Thirty day window could not be created.");
  return thirtyDays;
}

export function formatPt(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function toPacificTimestampString(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond} ${PT_TIMEZONE}`;
}

export function appleReportDate(date: Date): string {
  const parts = getPtDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
