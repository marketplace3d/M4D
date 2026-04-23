import { getM4dApiBase } from '../m4d/m4dApi';

/** Rust `m4d-api` `/health` URL for browser probes. */
export function getRustHealthUrl(): string {
  const base = getM4dApiBase();
  if (base !== undefined) {
    if (base === '') return '/health';
    return `${base}/health`;
  }
  if (import.meta.env.DEV) return '/m4d-api/health';
  return '/m4d-api/health';
}

/** Django `m4d-ds` forwards `/health` to Rust; default local dev. */
export function getDjangoHealthUrl(): string {
  const raw = (import.meta.env.VITE_M4D_DS_URL as string | undefined)?.trim() ?? '';
  if (raw === '0' || raw.toLowerCase() === 'off') return '';
  const base = (raw || 'http://127.0.0.1:8050').replace(/\/$/, '');
  return `${base}/health`;
}

/** Algo execution microservice (see `tools/algo-execution`). */
export function getAlgoExecBase(): string {
  const u = (import.meta.env.VITE_ALGO_EXEC_URL as string | undefined)?.trim();
  if (u) return u.replace(/\/$/, '');
  if (import.meta.env.DEV) {
    const on = (import.meta.env.VITE_ALGO_EXEC_DEV as string | undefined)?.trim().toLowerCase();
    if (on === '1' || on === 'on' || on === 'true') return '/algo-exec';
    return '';
  }
  return '';
}

export function getAlgoExecHealthUrl(): string {
  const b = getAlgoExecBase();
  return b ? `${b}/health` : '';
}
