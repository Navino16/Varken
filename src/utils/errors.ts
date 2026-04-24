import type { AxiosError } from 'axios';

/**
 * Optional context for enriching error explanations with service-specific hints.
 */
export interface ErrorContext {
  /** Service name — "Sonarr", "InfluxDB 2.x", etc. */
  service?: string;
  /** URL or endpoint being accessed, used to disambiguate multi-host setups in hints. */
  url?: string;
  /** Auth style used by the service, to steer 401/403 hints. */
  authType?: 'apiKey' | 'token' | 'basic' | 'none';
}

/**
 * Structured error explanation returned by `explainError`.
 *
 * Callers can render `format()` for a single-line log entry, or surface
 * `message` / `hint` separately (e.g. logs + alerting).
 */
export interface ExplainedError {
  message: string;
  hint: string | null;
  detail: string | null;
  format(): string;
}

const DOCS_URL = 'https://github.com/Navino16/Varken#troubleshooting';

/**
 * Produce an actionable explanation for an error raised during HTTP or
 * service interactions. Falls back gracefully for non-Axios / non-Error inputs.
 *
 * Examples of hints produced:
 * - ECONNREFUSED → "Check that <service> is running and reachable on <url>"
 * - ETIMEDOUT    → "Increase global.httpTimeoutMs or check network connectivity"
 * - 401 / 403    → "Check the API key/token has the required permissions"
 * - 404          → "Check the URL / API path matches your service version"
 * - HTML body    → "The service returned a login page — wrong URL or missing auth"
 */
export function explainError(error: unknown, context: ErrorContext = {}): ExplainedError {
  const { message, hint, detail } = buildParts(error, context);
  return {
    message,
    hint,
    detail,
    format(): string {
      const parts = [message];
      if (hint) {
        parts.push(`Hint: ${hint}`);
      }
      if (detail) {
        parts.push(`Details: ${detail}`);
      }
      parts.push(`See: ${DOCS_URL}`);
      return parts.join(' | ');
    },
  };
}

/**
 * Shorthand when you just want a single log-friendly string.
 */
export function formatHelpfulError(error: unknown, context: ErrorContext = {}): string {
  return explainError(error, context).format();
}

function buildParts(
  error: unknown,
  context: ErrorContext
): { message: string; hint: string | null; detail: string | null } {
  const serviceLabel = context.service ?? 'the service';
  const urlLabel = context.url ?? 'the configured URL';

  if (isAxiosLike(error)) {
    return explainAxiosError(error, context, serviceLabel, urlLabel);
  }

  if (error instanceof Error) {
    return { message: error.message, hint: null, detail: null };
  }

  return { message: String(error), hint: null, detail: null };
}

/**
 * Duck-type axios errors without relying on `axios.isAxiosError` so the helper
 * stays usable under test mocks that replace the axios module wholesale.
 */
function isAxiosLike(error: unknown): error is AxiosError {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { isAxiosError?: unknown }).isAxiosError === true
  );
}

function explainAxiosError(
  error: AxiosError,
  context: ErrorContext,
  serviceLabel: string,
  urlLabel: string
): { message: string; hint: string | null; detail: string | null } {
  // Server responded with an error status
  if (error.response) {
    const status = error.response.status;
    const statusText = error.response.statusText;
    const url = error.config?.url || urlLabel;
    const baseMessage = `HTTP ${status} ${statusText} from ${serviceLabel} at ${url}`;

    const detail = extractResponseDetail(error.response.data);
    const hint = hintForStatus(status, context);

    // Detect HTML responses (wrong URL, login page)
    if (detail && /<html|<!doctype/i.test(detail)) {
      return {
        message: baseMessage,
        hint:
          `${serviceLabel} returned HTML instead of JSON. ` +
          'Check the URL includes the correct API path (e.g. /api/v3) and that auth is configured.',
        detail: null,
      };
    }

    return { message: baseMessage, hint, detail };
  }

  // Request sent but no response received (network-level failures)
  if (error.request) {
    const url = error.config?.url || urlLabel;
    const code = error.code;

    if (code === 'ECONNREFUSED') {
      return {
        message: `Connection refused by ${serviceLabel} at ${url}`,
        hint:
          `Verify that ${serviceLabel} is running and reachable on this URL, ` +
          'and that no firewall is blocking the connection.',
        detail: code,
      };
    }
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
      return {
        message: `Request to ${serviceLabel} timed out`,
        hint:
          'Increase `global.httpTimeoutMs` in varken.yaml if the service is slow, ' +
          'or verify network connectivity.',
        detail: code ?? null,
      };
    }
    if (code === 'ENOTFOUND') {
      return {
        message: `Host not found for ${serviceLabel} (${url})`,
        hint:
          'Check the URL spelling, DNS resolution, and that the hostname is reachable ' +
          'from the Varken container/process.',
        detail: code,
      };
    }
    if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return {
        message: `TLS certificate error talking to ${serviceLabel} at ${url}`,
        hint:
          'Renew the certificate, or set `verifySsl: false` on the plugin config ' +
          'if you trust the endpoint (development/self-signed only — do NOT use in production).',
        detail: code,
      };
    }

    return {
      message: `No response from ${serviceLabel} at ${url}`,
      hint: 'Check the service is running and the network is reachable.',
      detail: code ?? error.message,
    };
  }

  // Error thrown during request setup (invalid config, etc.)
  return { message: error.message, hint: null, detail: null };
}

function hintForStatus(status: number, context: ErrorContext): string | null {
  if (status === 401 || status === 403) {
    const authLabel =
      context.authType === 'token'
        ? 'token'
        : context.authType === 'basic'
          ? 'username/password'
          : 'API key';
    return `Check the ${authLabel} is correct and has the required permissions.`;
  }
  if (status === 404) {
    return 'Check the URL and API path match your service version (e.g. /api/v3 vs /api/v1).';
  }
  if (status === 429) {
    return 'Rate limited by the service. Varken will retry with backoff; if this persists, reduce collection frequency.';
  }
  if (status >= 500 && status < 600) {
    return 'The service returned a server error. Check its logs — this is usually a transient issue.';
  }
  return null;
}

function extractResponseDetail(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }
  if (typeof data === 'string') {
    return data.length > 300 ? `${data.slice(0, 300)}…` : data;
  }
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
    if (typeof record.error === 'string') {
      return record.error;
    }
    try {
      const json = JSON.stringify(data);
      return json.length > 300 ? `${json.slice(0, 300)}…` : json;
    } catch {
      return null;
    }
  }
  return String(data);
}
