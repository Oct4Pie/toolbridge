import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from "child_process";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ServerLifecycleOptions {
  baseUrl: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  readinessPath?: string;
  readinessMethod?: string;
  readinessHeaders?: Record<string, string>;
  validateReady?: (response: Response) => boolean | Promise<boolean>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  checkExisting?: boolean;
}

export interface ServerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  ownsProcess(): boolean;
  getProcess(): ChildProcess | null;
}

const buildReadinessUrl = (baseUrl: string, path: string): string => {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/?$/, "")}/${path.replace(/^\//, "")}`;
  }
};

const defaultValidateReady = (response: Response): boolean => response.ok;

const probeReadiness = async (
  url: string,
  method: string,
  headers: Record<string, string>,
  validateReady: (response: Response) => boolean | Promise<boolean>,
): Promise<boolean> => {
  try {
    const response = await fetch(url, { method, headers });
    try {
      return await validateReady(response);
    } finally {
      response.body?.cancel().catch(() => {});
    }
  } catch {
    return false;
  }
};

export function createServerLifecycle(options: ServerLifecycleOptions): ServerLifecycle {
  const {
    baseUrl,
    command = "npm",
    args = ["start"],
    env,
    stdio,
    readinessPath = "/v1/models",
    readinessMethod = "GET",
    readinessHeaders = {},
    validateReady = defaultValidateReady,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    checkExisting = true,
  } = options;

  const readinessUrl = buildReadinessUrl(baseUrl, readinessPath);

  let child: ChildProcess | null = null;
  let started = false;
  let ownsChild = false;

  const waitForReadiness = async (): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (child && child.exitCode !== null) {
        if (child.exitCode === 0 && checkExisting) {
          // Child exited cleanly; fall back to probing an existing server.
          child = null;
        } else {
          throw new Error(`Test server exited with code ${child.exitCode} before readiness was detected.`);
        }
      }

      if (child && child.signalCode !== null) {
        throw new Error(`Test server terminated via signal ${child.signalCode} before readiness was detected.`);
      }

      const ready = await probeReadiness(readinessUrl, readinessMethod, readinessHeaders, validateReady);
      if (ready) {
        return;
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for test server readiness at ${readinessUrl}`);
      }

      await sleep(pollIntervalMs);
    }
  };

  const stopChild = async (): Promise<void> => {
    if (!child) {
      return;
    }

    const currentChild = child;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      currentChild.once("exit", () => finish());
      currentChild.once("error", () => finish());

      const killed = currentChild.kill();
      if (!killed) {
        finish();
      }

      setTimeout(() => finish(), 5000);
    });

    child = null;
  };

  return {
    async start(): Promise<void> {
      if (started) {
        return;
      }

      if (checkExisting) {
        const alreadyRunning = await probeReadiness(readinessUrl, readinessMethod, readinessHeaders, validateReady);
        if (alreadyRunning) {
          started = true;
          ownsChild = false;
          child = null;
          return;
        }
      }

      const spawnEnv: NodeJS.ProcessEnv | undefined = env ? { ...process.env, ...env } : process.env;
      const spawnOptions: SpawnOptions = {
        env: spawnEnv,
        stdio: stdio ?? (process.env.DEBUG_MODE === "true" ? "inherit" : "ignore"),
      };

      child = spawn(command, args, spawnOptions);
      ownsChild = true;

      try {
        await waitForReadiness();
        started = true;
      } catch (error) {
        await stopChild();
        ownsChild = false;
        started = false;
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
      }
    },

    async stop(): Promise<void> {
      if (!started) {
        return;
      }

      if (ownsChild) {
        await stopChild();
      }

      started = false;
      ownsChild = false;
    },

    isRunning(): boolean {
      return started;
    },

    ownsProcess(): boolean {
      return ownsChild;
    },

    getProcess(): ChildProcess | null {
      return child;
    },
  };
}
