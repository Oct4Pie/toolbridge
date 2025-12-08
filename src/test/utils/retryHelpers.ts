const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const computeDelay = (attempt: number, base: number, max: number): number => {
  const delay = base * (2 ** attempt);
  return Math.min(delay, max);
};

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    shouldRetry,
    onRetry,
  } = options;

  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error: unknown) {
      const canRetry = attempt < maxRetries;
      const allowRetry = canRetry && (shouldRetry ? await shouldRetry(error, attempt) : true);

      if (!allowRetry) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs);
      if (onRetry) {
        await onRetry(error, attempt, delayMs);
      }
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

export interface FetchRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetryStatus?: (status: number) => boolean;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const numericValue = Number(header);
  if (Number.isFinite(numericValue)) {
    return Math.max(0, Math.floor(numericValue * 1000));
  }

  const dateValue = Date.parse(header);
  if (!Number.isNaN(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 2,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = 3100,
    shouldRetryStatus = (status: number) => status === 429,
  } = options;

  let attempt = 0;

  for (;;) {
    const response = await fetch(url, init);

    if (!shouldRetryStatus(response.status) || attempt >= maxRetries) {
      return response;
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const delayMs = retryAfterMs ?? computeDelay(attempt, baseDelayMs, maxDelayMs);
    await sleep(delayMs);
    attempt += 1;
  }
}

 

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.includes("429") || /rate limit/i.test(message);
  }

  const candidate = error as { status?: number; message?: string };
  if (typeof candidate.status === "number" && candidate.status === 429) {
    return true;
  }

  const message = candidate.message ?? (error instanceof Error ? error.message : undefined);
  if (typeof message === "string") {
    return message.includes("429") || /rate limit/i.test(message);
  }

  return false;
}
