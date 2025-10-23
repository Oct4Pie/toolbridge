import { request as undici } from 'undici';

import {
  AZURE_OPENAI_RESOURCE,
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  AZURE_SUBSCRIPTION_ID,
  AZURE_RESOURCE_GROUP,
  AZURE_ACCOUNT_NAME
} from '../config.js';
import logger from '../utils/logger.js';

import type { Request, Response } from 'express';

// ---------- Configuration ----------
export const OPENAI_BASE = 'https://api.openai.com/v1';

// Azure endpoints
export const getAzureBaseV1 = () => `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/v1`;
export const getAzureBaseClassic = () => `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai`;

// ARM endpoints for deployment discovery
const getArmUrl = () => `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.CognitiveServices/accounts/${AZURE_ACCOUNT_NAME}/deployments?api-version=2024-10-01`;

// ---------- Types ----------
export interface DeploymentInfo {
  name: string;
  model: string;
  version?: string | undefined;
  state?: string | undefined;
}

interface CacheEntry<T> {
  data: T;
  exp: number;
}

interface ArmTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface AzureDeployment {
  name: string;
  properties?: {
    model?: {
      name?: string;
      version?: string;
    };
    provisioningState?: string;
  };
}

interface AzureDeploymentsResponse {
  value: AzureDeployment[];
}

// ---------- Cache Management ----------
class CacheManager {
  private deploymentsCache: CacheEntry<DeploymentInfo[]> | null = null;
  private armTokenCache: CacheEntry<string> | null = null;
  private readonly CACHE_TTL = 60_000; // 60 seconds
  private readonly TOKEN_BUFFER = 30_000; // 30 seconds before expiry

  private isExpired<T>(entry: CacheEntry<T> | null, bufferMs: number = 0): boolean {
    if (entry === null) {
      return true;
    }
    return entry.exp <= Date.now() + bufferMs;
  }

  setDeployments(data: DeploymentInfo[]): void {
    this.deploymentsCache = {
      data,
      exp: Date.now() + this.CACHE_TTL
    };
  }

  getDeployments(): DeploymentInfo[] | null {
    const cacheEntry = this.deploymentsCache;
    if (this.isExpired(cacheEntry)) {
      return null;
    }
    return cacheEntry?.data ?? null;
  }

  setArmToken(token: string, expiresIn: number): void {
    this.armTokenCache = {
      data: token,
      exp: Date.now() + (expiresIn * 1000)
    };
  }

  getArmToken(): string | null {
    const cacheEntry = this.armTokenCache;
    if (this.isExpired(cacheEntry, this.TOKEN_BUFFER)) {
      return null;
    }
    return cacheEntry?.data ?? null;
  }
}

const cache = new CacheManager();

// ---------- ARM Token Management ----------
export async function getArmToken(): Promise<string> {
  // Check cache first
  const cachedToken = cache.getArmToken();
  if (cachedToken !== null) {
    logger.debug("Using cached ARM token");
    return cachedToken;
  }

  logger.debug("Fetching new ARM token");
  
  try {
    const response = await undici(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID ?? '',
        client_secret: AZURE_CLIENT_SECRET ?? '',
        scope: 'https://management.azure.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });

    if (response.statusCode !== 200) {
      const errorText = await response.body.text();
      throw new Error(`ARM token request failed ${response.statusCode}: ${errorText}`);
    }

    const tokenData = await response.body.json() as ArmTokenResponse;
    
    // Cache the token
    cache.setArmToken(tokenData.access_token, tokenData.expires_in);
    
    logger.debug("ARM token obtained and cached");
    return tokenData.access_token;
  } catch (error) {
    logger.error("Failed to get ARM token:", error);
    throw new Error(`ARM authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ---------- Azure Deployment Discovery ----------
export async function listAzureDeployments(): Promise<DeploymentInfo[]> {
  // Check cache first
  const cached = cache.getDeployments();
  if (cached !== null) {
    logger.debug(`Using cached deployments (${cached.length} items)`);
    return cached;
  }

  logger.debug("Fetching Azure deployments from ARM");
  
  try {
    const token = await getArmToken();
    const url = getArmUrl();

    const response = await undici(url, {
      headers: { 'authorization': `Bearer ${token}` }
    });

    if (response.statusCode !== 200) {
      const errorText = await response.body.text();
      throw new Error(`ARM deployments list failed ${response.statusCode}: ${errorText}`);
    }

    const body = await response.body.json() as AzureDeploymentsResponse;
    
    const deploymentItems = Array.isArray(body.value) ? body.value : [];
    const deployments: DeploymentInfo[] = deploymentItems.map((deployment: AzureDeployment) => {
      const modelName = deployment.properties?.model?.name ?? undefined;
      const modelVersion = deployment.properties?.model?.version ?? undefined;
      const provisioningState = deployment.properties?.provisioningState ?? undefined;

      const resolvedModelName =
        typeof modelName === "string" && modelName.trim() !== "" ? modelName : "unknown";
      const resolvedModelVersion =
        typeof modelVersion === "string" && modelVersion.trim() !== "" ? modelVersion : undefined;
      const resolvedProvisioningState =
        typeof provisioningState === "string" && provisioningState.trim() !== ""
          ? provisioningState
          : undefined;

      return {
        name: deployment.name,
        model: resolvedModelName,
        version: resolvedModelVersion,
        state: resolvedProvisioningState,
      };
    });

    // Cache the results
    cache.setDeployments(deployments);
    
    logger.debug(`Fetched and cached ${deployments.length} deployments`);
    return deployments;
  } catch (error) {
    logger.error("Failed to list Azure deployments:", error);
    throw new Error(`Failed to discover Azure deployments: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ---------- Model ⇄ Deployment Resolution ----------
export async function pickDeploymentForModel(model: string): Promise<string | null> {
  const deployments = await listAzureDeployments();
  
  // 1) Check if model is already a deployment name
  const directMatch = deployments.find(d => d.name === model && d.state === 'Succeeded');
  if (directMatch) {
    logger.debug(`Model '${model}' matches deployment name directly`);
    return model;
  }
  
  // 2) Find deployment whose underlying model matches
  const modelMatches = deployments.filter(d => d.model === model && d.state === 'Succeeded');
  if (modelMatches.length > 0) {
    const deployment = modelMatches[0]; // Simple policy: take first match
    logger.debug(`Model '${model}' resolved to deployment '${deployment.name}'`);
    return deployment.name;
  }
  
  logger.warn(`No deployment found for model '${model}'. Available: ${deployments.map(d => `${d.name}(${d.model})`).join(', ')}`);
  return null;
}

export async function modelForDeployment(deploymentName: string): Promise<string | null> {
  const deployments = await listAzureDeployments();
  
  const deployment = deployments.find(d => d.name === deploymentName && d.state === 'Succeeded');
  if (deployment) {
    logger.debug(`Deployment '${deploymentName}' resolved to model '${deployment.model}'`);
    return deployment.model;
  }
  
  logger.warn(`Unknown deployment '${deploymentName}'. Available: ${deployments.map(d => d.name).join(', ')}`);
  return null;
}

// ---------- HTTP Utilities ----------
export function copyHeadersExcept(srcHeaders: Headers | Record<string, string | string[] | undefined>, res: Response, exclude: string[] = []): void {
  const excludeLower = exclude.map(h => h.toLowerCase());
  
  if (srcHeaders instanceof Headers) {
    // Web API Headers
    for (const [key, value] of srcHeaders) {
      if (!excludeLower.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
  } else {
    // Node.js IncomingHttpHeaders
    for (const [key, value] of Object.entries(srcHeaders)) {
      if (!excludeLower.includes(key.toLowerCase()) && value !== undefined) {
        res.setHeader(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }
  }
}

export async function pipeSSE(
  upstreamResponse: globalThis.Response, 
  res: Response, 
  transformer?: (line: string) => string
): Promise<void> {
  res.status(upstreamResponse.status);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  copyHeadersExcept(upstreamResponse.headers, res, ["content-length", "content-encoding", "transfer-encoding"]);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  
  try {
    let isDone = false;
    while (!isDone) {
      const { value, done } = await reader.read();
      if (done) {
        isDone = true;
        continue;
      }
      
      let chunk = decoder.decode(value, { stream: true });
      
      if (transformer) {
        chunk = chunk.split("\n").map(transformer).join("\n");
      }
      
      res.write(chunk);
    }
  } catch (error) {
    logger.error("SSE streaming error:", error);
    res.write(`data: {"error": {"message": "Streaming interrupted"}}\n\n`);
  } finally {
    res.end();
  }
}

export function isMultipart(req: Request): boolean {
  const contentType = req.headers["content-type"] ?? "";
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("multipart/");
}

export function buildUpstreamHeaders(req: Request, apiKey: string, isAzure: boolean = false): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // Copy relevant headers (excluding auth, host, content-length)
  const excludeHeaders = ["authorization", "host", "content-length"];
  
  for (const [key, value] of Object.entries(req.headers)) {
    if (!excludeHeaders.includes(key.toLowerCase()) && typeof value === "string") {
      headers[key] = value;
    }
  }
  
  // Set appropriate auth header
  if (isAzure) {
    headers["api-key"] = apiKey;
  } else {
    headers["authorization"] = `Bearer ${apiKey}`;
  }
  
  return headers;
}

// ---------- Error Response Helpers ----------
export function sendError(res: Response, status: number, message: string, code?: string): void {
  res.status(status).json({
    error: {
      message,
      type: "invalid_request_error",
      code: code ?? "invalid_request"
    }
  });
}

export function sendDeploymentNotFound(res: Response, model: string): void {
  sendError(res, 400, `No Azure deployment found for model '${model}'`, "model_not_found");
}

export function sendModelNotFound(res: Response, deployment: string): void {
  sendError(res, 400, `Unknown Azure deployment '${deployment}'`, "deployment_not_found");
}

// ---------- Health Check ----------
export async function healthCheck(): Promise<{ 
  status: string; 
  azure: { deployments: number }; 
  timestamp: string;
}> {
  try {
    const deployments = await listAzureDeployments();
    return {
      status: 'healthy',
      azure: {
        deployments: deployments.length
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error("Health check failed:", error);
    return {
      status: 'unhealthy',
      azure: { deployments: 0 },
      timestamp: new Date().toISOString()
    };
  }
}
