import type { Express, RequestHandler, ErrorRequestHandler } from "express";

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSentry() {
  // Make Sentry an optional dependency at runtime (and avoid hard TS dependency).
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const sentry = require("@sentry/node") as any;
  return sentry;
}

export function isSentryEnabled() {
  return Boolean(process.env.SENTRY_DSN);
}

export function initSentry(app: Express) {
  if (!isSentryEnabled()) return;

  const Sentry = getSentry();
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseNumber(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  });

  app.set("sentry", Sentry);
}

export function sentryRequestHandler(): RequestHandler | null {
  if (!isSentryEnabled()) return null;
  const Sentry = getSentry();
  const handler = Sentry.Handlers?.requestHandler?.();
  return handler ?? null;
}

export function sentryErrorHandler(): ErrorRequestHandler | null {
  if (!isSentryEnabled()) return null;
  const Sentry = getSentry();
  const handler = Sentry.Handlers?.errorHandler?.();
  return handler ?? null;
}

export function captureSentryException(error: unknown, context?: Record<string, unknown>) {
  if (!isSentryEnabled()) return;
  const Sentry = getSentry();
  Sentry.withScope((scope: any) => {
    if (context) scope.setContext("extra", context);
    Sentry.captureException(error);
  });
}
