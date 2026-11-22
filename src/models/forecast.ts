import { addMonths } from "../domain/dates.ts";

export const FORECAST_MODEL_ID = "bhi/seasonal-smoothing-v1";

const SEASON = 12;
const ALPHA = 0.4;
const BETA = 0.05;
const GAMMA = 0.2;

export interface ForecastSeries {
  area: string;
  values: number[];
}

export interface ForecastPoint {
  area: string;
  month: string;
  point: number;
  low: number;
  high: number;
}

interface Distribution {
  point: number[];
  low: number[];
  high: number[];
}

export function seasonalNaive(values: number[], horizon: number): number[] {
  if (!values.length) throw new Error("A forecast series needs at least one observation.");
  return Array.from({ length: horizon }, (_, step) => values[values.length - 12 + step] ?? values[values.length - 1]);
}

export function baselinePoints(series: ForecastSeries, originMonth: string, horizon: number): ForecastPoint[] {
  return seasonalNaive(series.values, horizon).map((value, step) => ({
    area: series.area,
    month: addMonths(originMonth, step + 1),
    point: value,
    low: value,
    high: value,
  }));
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function quantile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function ordinaryLeastSquares(values: number[]): { intercept: number; slope: number; residuals: number[] } {
  const count = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let index = 0; index < count; index += 1) {
    sumX += index;
    sumY += values[index];
    sumXY += index * values[index];
    sumXX += index * index;
  }
  const denominator = count * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  return {
    intercept,
    slope,
    residuals: values.map((value, index) => value - (intercept + slope * index)),
  };
}

function withIntervals(level: number, trend: number, season: number[] | null, origin: number, horizon: number, residuals: number[]): Distribution {
  const lowResidual = quantile(residuals, 0.1);
  const highResidual = quantile(residuals, 0.9);
  const point: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (let step = 1; step <= horizon; step += 1) {
    const seasonal = season ? season[(origin + step - 1) % season.length] : 0;
    const estimate = level + step * trend + seasonal;
    const width = Math.sqrt(step);
    point.push(estimate);
    low.push(estimate + lowResidual * width);
    high.push(estimate + highResidual * width);
  }
  return { point, low, high };
}

function holtWinters(values: number[], horizon: number): Distribution {
  const first = average(values.slice(0, SEASON));
  const second = average(values.slice(SEASON, SEASON * 2));
  let level = first;
  let trend = (second - first) / SEASON;
  const season = values.slice(0, SEASON).map((value) => value - first);
  const residuals: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const seasonal = season[index % SEASON];
    residuals.push(values[index] - (level + trend + seasonal));
    const previous = level;
    level = ALPHA * (values[index] - seasonal) + (1 - ALPHA) * (level + trend);
    trend = BETA * (level - previous) + (1 - BETA) * trend;
    season[index % SEASON] = GAMMA * (values[index] - level) + (1 - GAMMA) * seasonal;
  }
  return withIntervals(level, trend, season, values.length, horizon, residuals);
}

function seasonalTrend(values: number[], horizon: number): Distribution {
  const buckets = Array.from({ length: SEASON }, () => [] as number[]);
  values.forEach((value, index) => buckets[index % SEASON].push(value));
  const overall = average(values);
  const season = buckets.map((bucket) => (bucket.length ? average(bucket) : overall) - overall);
  const adjusted = values.map((value, index) => value - season[index % SEASON]);
  const fit = ordinaryLeastSquares(adjusted);
  const residuals = values.map((value, index) => value - (fit.intercept + fit.slope * index + season[index % SEASON]));
  const level = fit.intercept + fit.slope * (values.length - 1);
  return withIntervals(level, fit.slope, season, values.length, horizon, residuals);
}

export function smoothForecast(values: number[], horizon: number): Distribution {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("A forecast series needs finite monthly observations.");
  }
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 24) {
    throw new Error("Horizon must be from 1 to 24 months.");
  }
  if (values.length >= SEASON * 2) return holtWinters(values, horizon);
  if (values.length >= SEASON) return seasonalTrend(values, horizon);
  const fit = ordinaryLeastSquares(values);
  const level = fit.intercept + fit.slope * (values.length - 1);
  return withIntervals(level, fit.slope, null, values.length, horizon, fit.residuals);
}

function bounded(point: number, low: number, high: number): { point: number; low: number; high: number } {
  const rounded = Math.max(0, Math.round(point));
  return {
    point: rounded,
    low: Math.min(rounded, Math.max(0, Math.round(low))),
    high: Math.max(rounded, Math.max(0, Math.round(high))),
  };
}

export function forecastPoints(series: ForecastSeries, originMonth: string, horizon: number): ForecastPoint[] {
  const forecast = smoothForecast(series.values, horizon);
  return forecast.point.map((value, index) => ({
    area: series.area,
    month: addMonths(originMonth, index + 1),
    ...bounded(value, forecast.low[index], forecast.high[index]),
  }));
}
