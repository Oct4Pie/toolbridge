import { configService } from "../../services/configService.js";

const normalizeBase = (base: string): string => base.replace(/\/+$/, "");

const normalizePath = (path?: string): string => {
  if (!path) {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
};

export const getProxyBaseUrl = (): string => {
  const host = configService.getProxyHost();
  const port = configService.getProxyPort();
  return `http://${host}:${port}`;
};

export const buildProxyUrl = (path?: string): string => {
  return `${normalizeBase(getProxyBaseUrl())}${normalizePath(path)}`;
};

export const getBackendBaseUrl = (): string => {
  return configService.getBackendUrl();
};

export const buildBackendUrl = (path?: string): string => {
  return `${normalizeBase(getBackendBaseUrl())}${normalizePath(path)}`;
};

export const getOpenAIBackendBaseUrl = (): string => {
  return configService.getOpenAIBackendUrl();
};

export const buildOpenAIBackendUrl = (path?: string): string => {
  return `${normalizeBase(getOpenAIBackendBaseUrl())}${normalizePath(path)}`;
};

export const getOllamaBackendBaseUrl = (): string => {
  return configService.getOllamaBackendUrl();
};

export const buildOllamaBackendUrl = (path?: string): string => {
  return `${normalizeBase(getOllamaBackendBaseUrl())}${normalizePath(path)}`;
};
