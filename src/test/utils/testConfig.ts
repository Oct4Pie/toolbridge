import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

interface EnvVariables {
  [key: string]: string;
}

interface TestConfig {
  PROXY_PORT: number;
  PROXY_HOST: string;
  MOCK_PORT: number;
  TEST_MODEL: string;
  TEST_API_KEY: string;
}

function readEnvFile(): EnvVariables {
  try {
    const envPathLocal = path.join(projectRoot, ".env");
    if (fs.existsSync(envPathLocal)) {
      const envContent = fs.readFileSync(envPathLocal, "utf8");
      const envVariables: EnvVariables = {};

      envContent.split("\n").forEach((line) => {
        line = line.trim();

        if (line && !line.startsWith("#") && !line.startsWith("//")) {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            let value = match[2].trim();

            if (
              (value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))
            ) {
              value = value.substring(1, value.length - 1);
            }

            envVariables[key] = value;
          }
        }
      });

  return envVariables;
    }
    return {};
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error reading .env file:", errorMessage);
    return {};
  }
}

const envVars = readEnvFile();

function getEnvString(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string') { return process.env[key]; }
  if (typeof envVars[key] === 'string') { return envVars[key]; }
  return fallback;
}

function getEnvNumber(key: string, fallback: number): number {
  const envVal = typeof process.env[key] === 'string' ? process.env[key] : envVars[key];
  if (typeof envVal === 'string') {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed)) { return parsed; }
  }
  return fallback;
}

export const TEST_CONFIG: TestConfig = {
  PROXY_PORT: getEnvNumber('PROXY_PORT', 3000),
  PROXY_HOST: getEnvString('PROXY_HOST', 'localhost'),
  MOCK_PORT: getEnvNumber('TEST_MOCK_PORT', 3001),
  TEST_MODEL: getEnvString('TEST_MODEL', 'gpt-3.5-turbo'),
  TEST_API_KEY: getEnvString('TEST_API_KEY', 'dummy-key'),
};

export function getProxyUrl(subpath: string = ""): string {
  const formattedPath = subpath ? (subpath.startsWith("/") ? subpath : `/${subpath}`) : "";
  return `http://${TEST_CONFIG.PROXY_HOST}:${TEST_CONFIG.PROXY_PORT}${formattedPath}`;
}

export function getMockServerUrl(subpath: string = ""): string {
  const formattedPath = subpath ? (subpath.startsWith("/") ? subpath : `/${subpath}`) : "";
  return `http://localhost:${TEST_CONFIG.MOCK_PORT}${formattedPath}`;
}

export async function isProxyRunning(): Promise<boolean> {
  try {
    const axios = (await import("axios")).default;
    await axios.get(getProxyUrl());
    return true;
  } catch (error: unknown) {
    if (error.code === "ECONNREFUSED") {
      return false;
    }

    return true;
  }
}