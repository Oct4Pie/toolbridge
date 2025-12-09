/**
 * Test Configuration Validation Module
 *
 * This module validates the test configuration loaded from testConfigLoader
 * to ensure all settings are valid before tests begin execution.
 *
 * Validation performed:
 * - Required configuration values are present
 * - Port numbers are valid (1-65535)
 * - Port ranges are properly ordered (start < end)
 * - Reserved port range (< 1024) is not used unless necessary
 * - URLs are valid HTTP/HTTPS
 * - Timeout values are positive numbers
 * - Model names are non-empty strings
 * - Concurrent test limit is a positive number
 *
 * Usage:
 *   import { validateTestConfig } from './validateTestConfig.js';
 *
 *   // In test bootstrap (e.g., mocha.opts or before-all hook):
 *   validateTestConfig();  // Throws if validation fails, returns silently if OK
 */

import { testConfigLoader, type TestingConfig } from "./testConfigLoader.js";

/**
 * Validation result with collected errors
 * @internal
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * List of well-known reserved port numbers that should not be used
 * These are typically used by system services or other critical applications
 * @internal
 */
const RESERVED_PORTS = [
  22, // SSH
  25, // SMTP
  53, // DNS
  80, // HTTP
  110, // POP3
  143, // IMAP
  443, // HTTPS
  465, // SMTPS
  587, // SMTP TLS
  993, // IMAPS
  995, // POP3S
  3306, // MySQL
  5432, // PostgreSQL
  5984, // CouchDB
  6379, // Redis
  8080, // Common alternate HTTP
  8443, // Common alternate HTTPS
  27017, // MongoDB
  11434, // Ollama default
];

/**
 * Parse and validate a URL string
 * Ensures the URL is valid HTTP or HTTPS
 *
 * @param url URL string to validate
 * @returns True if URL is valid, false otherwise
 * @internal
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate a single port number
 * Checks that port is within valid range (1-65535)
 *
 * @param port Port number to validate
 * @returns Error message if invalid, empty string if valid
 * @internal
 */
function validatePort(port: number, portName: string): string {
  if (!Number.isInteger(port)) {
    return `${portName} must be an integer, got: ${port}`;
  }
  if (port < 1 || port > 65535) {
    return `${portName} must be between 1 and 65535, got: ${port}`;
  }
  return "";
}

/**
 * Validate a port range (start < end)
 * @internal
 */
function validatePortRange(
  start: number,
  end: number,
  rangeName: string,
): string {
  if (start >= end) {
    return `${rangeName} start (${start}) must be less than end (${end})`;
  }
  return "";
}

/**
 * Validate a model name (non-empty string)
 * @internal
 */
function validateModelName(modelName: string, modelLabel: string): string {
  if (typeof modelName !== "string" || modelName.trim().length === 0) {
    return `${modelLabel} must be a non-empty string, got: ${JSON.stringify(modelName)}`;
  }
  return "";
}

/**
 * Validate a timeout value (positive number)
 * @internal
 */
function validateTimeout(timeoutMs: number, timeoutLabel: string): string {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return `${timeoutLabel} must be a positive integer (ms), got: ${timeoutMs}`;
  }
  return "";
}

/**
 * Collect all validation errors from the test configuration
 *
 * @param config TestingConfig to validate
 * @returns ValidationResult with list of any errors found
 * @internal
 */
function collectValidationErrors(config: TestingConfig): ValidationResult {
  const errors: string[] = [];

  // ========================================================================
  // Validate server configuration
  // ========================================================================

  const portError = validatePort(config.server.proxyPort, "server.proxyPort");
  if (portError) errors.push(portError);

  if (typeof config.server.proxyHost !== "string" || config.server.proxyHost.trim().length === 0) {
    errors.push(`server.proxyHost must be a non-empty string, got: ${JSON.stringify(config.server.proxyHost)}`);
  }

  const portRangeStartError = validatePort(config.server.portRangeStart, "server.portRangeStart");
  if (portRangeStartError) errors.push(portRangeStartError);

  const portRangeEndError = validatePort(config.server.portRangeEnd, "server.portRangeEnd");
  if (portRangeEndError) errors.push(portRangeEndError);

  const rangeError = validatePortRange(
    config.server.portRangeStart,
    config.server.portRangeEnd,
    "server.portRange",
  );
  if (rangeError) errors.push(rangeError);

  // Warn about reserved ports
  if (config.server.proxyPort < 1024 && !RESERVED_PORTS.includes(config.server.proxyPort)) {
    errors.push(`server.proxyPort (${config.server.proxyPort}) is in reserved range (< 1024)`);
  }

  // ========================================================================
  // Validate mock servers configuration
  // ========================================================================

  const openaiPortError = validatePort(config.mockServers.openaiPort, "mockServers.openaiPort");
  if (openaiPortError) errors.push(openaiPortError);

  const ollamaPortError = validatePort(config.mockServers.ollamaPort, "mockServers.ollamaPort");
  if (ollamaPortError) errors.push(ollamaPortError);

  if (config.mockServers.openaiPort === config.mockServers.ollamaPort) {
    errors.push(
      `mockServers.openaiPort and mockServers.ollamaPort cannot be the same: ${config.mockServers.openaiPort}`,
    );
  }

  if (config.mockServers.openaiPort === config.server.proxyPort) {
    errors.push(
      `mockServers.openaiPort (${config.mockServers.openaiPort}) conflicts with server.proxyPort`,
    );
  }

  if (config.mockServers.ollamaPort === config.server.proxyPort) {
    errors.push(
      `mockServers.ollamaPort (${config.mockServers.ollamaPort}) conflicts with server.proxyPort`,
    );
  }

  const responseDelayError = validateTimeout(
    config.mockServers.defaultResponseDelay,
    "mockServers.defaultResponseDelay",
  );
  if (responseDelayError) errors.push(responseDelayError);

  // ========================================================================
  // Validate models configuration
  // ========================================================================

  const modelError = validateModelName(config.models.openaiCompatible, "models.openaiCompatible");
  if (modelError) errors.push(modelError);

  const ollamaModelError = validateModelName(config.models.ollama, "models.ollama");
  if (ollamaModelError) errors.push(ollamaModelError);

  const fallbackOpenaiError = validateModelName(
    config.models.fallbacks.openaiCompatible,
    "models.fallbacks.openaiCompatible",
  );
  if (fallbackOpenaiError) errors.push(fallbackOpenaiError);

  const fallbackOllamaError = validateModelName(
    config.models.fallbacks.ollama,
    "models.fallbacks.ollama",
  );
  if (fallbackOllamaError) errors.push(fallbackOllamaError);

  // ========================================================================
  // Validate backends configuration
  // ========================================================================

  if (!isValidUrl(config.backends.openaiCompatibleUrl)) {
    errors.push(
      `backends.openaiCompatibleUrl must be a valid HTTP/HTTPS URL, got: ${config.backends.openaiCompatibleUrl}`,
    );
  }

  if (!isValidUrl(config.backends.ollamaUrl)) {
    errors.push(
      `backends.ollamaUrl must be a valid HTTP/HTTPS URL, got: ${config.backends.ollamaUrl}`,
    );
  }

  // ========================================================================
  // Validate timeouts configuration
  // ========================================================================

  const standardTimeoutError = validateTimeout(config.timeouts.standard, "timeouts.standard");
  if (standardTimeoutError) errors.push(standardTimeoutError);

  const connectionTimeoutError = validateTimeout(config.timeouts.connection, "timeouts.connection");
  if (connectionTimeoutError) errors.push(connectionTimeoutError);

  const socketTimeoutError = validateTimeout(config.timeouts.socket, "timeouts.socket");
  if (socketTimeoutError) errors.push(socketTimeoutError);

  const portWaitTimeoutError = validateTimeout(config.timeouts.portWait, "timeouts.portWait");
  if (portWaitTimeoutError) errors.push(portWaitTimeoutError);

  // ========================================================================
  // Validate features configuration
  // ========================================================================

  if (typeof config.features.enableStreamTesting !== "boolean") {
    errors.push(
      `features.enableStreamTesting must be a boolean, got: ${typeof config.features.enableStreamTesting}`,
    );
  }

  if (typeof config.features.enableToolCalling !== "boolean") {
    errors.push(
      `features.enableToolCalling must be a boolean, got: ${typeof config.features.enableToolCalling}`,
    );
  }

  if (typeof config.features.enableDualClient !== "boolean") {
    errors.push(
      `features.enableDualClient must be a boolean, got: ${typeof config.features.enableDualClient}`,
    );
  }

  if (!Number.isInteger(config.features.concurrentTestLimit) || config.features.concurrentTestLimit <= 0) {
    errors.push(
      `features.concurrentTestLimit must be a positive integer, got: ${config.features.concurrentTestLimit}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the test configuration
 * Throws an Error if validation fails with a descriptive message listing all errors.
 * Returns silently (void) if all validation checks pass.
 *
 * Should be called once during test bootstrap/initialization, before any tests run.
 * This ensures configuration problems are caught early with clear error messages.
 *
 * @throws Error if configuration is invalid with descriptive error message
 * @returns void (returns silently if validation passes)
 *
 * Example:
 *   import { validateTestConfig } from './validateTestConfig.js';
 *
 *   // In test setup hook or before tests run:
 *   before(() => {
 *     validateTestConfig();
 *   });
 *
 *   // Or at module load time (not recommended - blocks imports):
 *   validateTestConfig();
 */
export function validateTestConfig(): void {
  const config = testConfigLoader.getConfig();
  const result = collectValidationErrors(config);

  if (!result.valid) {
    const errorMessage = [
      "Test Configuration Validation Failed:",
      "The testing configuration in config.json or environment variables is invalid.",
      "Please review the errors below and correct them before running tests.",
      "",
      "Errors:",
      ...result.errors.map((err) => `  • ${err}`),
      "",
      "Configuration location: ./config.json (testing section)",
      "Environment variable prefix: TEST_ (e.g., TEST_MODEL_OPENAI_COMPATIBLE)",
    ].join("\n");

    throw new Error(errorMessage);
  }
}

/**
 * Get a detailed validation report as a string
 * Useful for debugging or verbose logging during test startup
 *
 * @returns Human-readable validation report
 * @internal
 */
export function getValidationReport(): string {
  const config = testConfigLoader.getConfig();
  const result = collectValidationErrors(config);

  const lines = [
    "=== Test Configuration Validation Report ===",
    "",
    `Status: ${result.valid ? "✓ VALID" : "✗ INVALID"}`,
    "",
  ];

  if (result.valid) {
    lines.push("All configuration checks passed.");
    lines.push("");
    lines.push("Configuration Summary:");
    lines.push(`  Proxy: ${config.server.proxyHost}:${config.server.proxyPort}`);
    lines.push(`  Port Range: ${config.server.portRangeStart}-${config.server.portRangeEnd}`);
    lines.push(`  Mock OpenAI Port: ${config.mockServers.openaiPort}`);
    lines.push(`  Mock Ollama Port: ${config.mockServers.ollamaPort}`);
    lines.push(`  Primary Models: ${config.models.openaiCompatible} / ${config.models.ollama}`);
    lines.push(`  Features: Stream=${config.features.enableStreamTesting}, Tools=${config.features.enableToolCalling}, DualClient=${config.features.enableDualClient}`);
  } else {
    lines.push(`Found ${result.errors.length} validation error(s):`);
    lines.push("");
    result.errors.forEach((err) => {
      lines.push(`  • ${err}`);
    });
  }

  lines.push("");
  return lines.join("\n");
}
