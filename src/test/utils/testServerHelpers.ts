import { createServerLifecycle, type ServerLifecycle } from './serverLifecycle.js';
import { getTestPort, releaseTestPort } from './portManager.js';
import { TEST_CONFIG } from './testConfig.js';

/**
 * Test server setup with automatic port allocation and cleanup
 * SSOT for all integration test server management
 */
export interface TestServerSetup {
  /** Dynamically allocated port number */
  port: number;
  /** Full base URL (http://host:port) */
  baseUrl: string;
  /** OpenAI API base URL (baseUrl + /v1) */
  openaiBaseUrl: string;
  /** Server lifecycle manager */
  lifecycle: ServerLifecycle;
  /** Cleanup function (stops server + releases port) */
  cleanup: () => Promise<void>;
}

export interface TestServerOptions {
  /** Backend mode: 'openai' | 'ollama' | undefined (auto-detect) */
  backendMode?: 'openai' | 'ollama';
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Custom readiness path (default: '/') */
  readinessPath?: string;
  /** Readiness timeout (default: 15000ms) */
  timeoutMs?: number;
  /** Check for existing server (default: true) */
  checkExisting?: boolean;
  /** Pass tools to backend (default: false) */
  passTools?: boolean;
  /** Enable debug mode (default: false) */
  debugMode?: boolean;
}

/**
 * Set up ToolBridge proxy server for integration testing
 *
 * SSOT for test server lifecycle:
 * - Allocates dynamic port (prevents conflicts)
 * - Starts ToolBridge proxy server
 * - Waits for readiness
 * - Returns cleanup function
 *
 * @example
 * ```typescript
 * let server: TestServerSetup;
 *
 * before(async () => {
 *   server = await setupTestServer({ backendMode: 'ollama' });
 * });
 *
 * after(async () => {
 *   await server.cleanup();
 * });
 *
 * it("test", async () => {
 *   const client = new OpenAI({ baseURL: server.openaiBaseUrl, apiKey: "test" });
 *   // ...
 * });
 * ```
 */
export async function setupTestServer(options: TestServerOptions = {}): Promise<TestServerSetup> {
  const {
    backendMode,
    env = {},
    readinessPath = '/',
    timeoutMs = 15000,
    checkExisting = true,
    passTools = false,
    debugMode = process.env.DEBUG_MODE === 'true',
  } = options;

  // Allocate dynamic port
  const port = await getTestPort();
  const host = TEST_CONFIG.server.proxyHost;
  const baseUrl = `http://${host}:${port}`;
  const openaiBaseUrl = `${baseUrl}/v1`;

  // Build environment
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PROXY_PORT: port.toString(),
    DEBUG_MODE: debugMode.toString(),
    PASS_TOOLS: passTools.toString(),
    ...env,
  };

  if (backendMode) {
    serverEnv['BACKEND_MODE'] = backendMode;
  }

  // Create lifecycle manager
  const lifecycle = createServerLifecycle({
    baseUrl,
    command: 'node',
    args: ['dist/src/index.js'],
    readinessPath,
    env: serverEnv,
    stdio: debugMode ? 'inherit' : 'pipe',
    timeoutMs,
    checkExisting,
  });

  // Start server
  await lifecycle.start();

  // Return setup with cleanup
  return {
    port,
    baseUrl,
    openaiBaseUrl,
    lifecycle,
    async cleanup() {
      await lifecycle.stop();
      releaseTestPort(port);
    },
  };
}

/**
 * Set up TWO ToolBridge servers (for dual-backend tests)
 *
 * Used for tests that need both OpenAI and Ollama backends simultaneously
 *
 * @example
 * ```typescript
 * let servers: DualTestServerSetup;
 *
 * before(async () => {
 *   servers = await setupDualTestServers();
 * });
 *
 * after(async () => {
 *   await servers.cleanup();
 * });
 * ```
 */
export interface DualTestServerSetup {
  openai: TestServerSetup;
  ollama: TestServerSetup;
  cleanup: () => Promise<void>;
}

export async function setupDualTestServers(
  openaiOptions?: TestServerOptions,
  ollamaOptions?: TestServerOptions
): Promise<DualTestServerSetup> {
  const openaiServer = await setupTestServer({
    backendMode: 'openai',
    ...openaiOptions,
  });
  const ollamaServer = await setupTestServer({
    backendMode: 'ollama',
    ...ollamaOptions,
  });

  return {
    openai: openaiServer,
    ollama: ollamaServer,
    async cleanup() {
      await Promise.all([
        openaiServer.cleanup(),
        ollamaServer.cleanup(),
      ]);
    },
  };
}
