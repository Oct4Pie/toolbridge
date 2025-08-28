import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsingChallengeData {
  content: string | null | undefined;
  parserResult: unknown;
  error: {
    message: string;
    stack?: string;
    name: string;
  } | null;
  timestamp: number;
  metadata: {
    contentLength: number | undefined;
    hasXmlTags: boolean;
    hasClosingTags: boolean;
  };
}

function hasXmlIndicators(content: string | null | undefined): boolean {
  if (!content || typeof content !== "string") {
    return false;
  }

  return (
    content.includes("<") &&
    content.includes(">") &&
    /<\w+>.*<\/\w+>/s.test(content)
  );
}

function isSuccessfulParse(result: unknown): boolean {
  const r = result as Record<string, unknown> | null;
  if (!r) {
    return false;
  }

  const name = r.name;
  const parameters = r.parameters as Record<string, unknown> | undefined;

  return (
    typeof name === "string" &&
  Boolean(parameters) &&
  Object.keys(parameters ?? {}).length > 0
  );
}

function hasMatchingTags(content: string | null | undefined): boolean {
  if (!content || typeof content !== "string") {return false;}

  const tagPattern = /<(\/?[a-zA-Z0-9_]+)[^>]*>/g;
  const tags: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content)) !== null) {
    const tag = match[1];
    if (tag.startsWith("/")) {
      const openTag = tag.substring(1);
      if (tags.length === 0 || tags.pop() !== openTag) {
        return false;
      }
    } else {
      tags.push(tag);
    }
  }

  return tags.length === 0;
}

function sanitizeForJson(obj: unknown): unknown {
  if (obj === undefined || obj === null) {return null;}
  if (typeof obj !== "object") {return obj;}

  try {
    JSON.stringify(obj);
    return obj;
  } catch (_jsonError) {
    const simplified: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "function") {
        simplified[key] = "[Function]";
      } else if (typeof value === "object" && value !== null) {
        simplified[key] = sanitizeForJson(value as unknown);
      } else if (value !== undefined) {
        simplified[key] = value;
      }
    }
    return simplified;
  }
}

export function captureParsingChallenge(
  content: string | null | undefined, 
  parserResult: unknown, 
  error?: Error | null
): void {
  if (
    error ||
    (hasXmlIndicators(content) && !isSuccessfulParse(parserResult))
  ) {
    try {
      const challengesDir = path.join(__dirname, "..", "test", "challenges");

      if (!fs.existsSync(challengesDir)) {
        fs.mkdirSync(challengesDir, { recursive: true });
      }

      const timestamp = Date.now();
      const randomSuffix = Math.floor(Math.random() * 10000);
      const filename = `challenge-${timestamp}-${randomSuffix}.json`;

      const challengeData: ParsingChallengeData = {
        content,
        parserResult: sanitizeForJson(parserResult),
        error: error
          ? {
              message: error.message,
              stack: error.stack ?? '',
              name: error.name,
            }
          : null,
        timestamp,
        metadata: {
          contentLength: content?.length,
          hasXmlTags: Boolean(content && content.includes("<") && content.includes(">")),
          hasClosingTags: hasMatchingTags(content),
        },
      };

      fs.writeFileSync(
        path.join(challengesDir, filename),
        JSON.stringify(challengeData, null, 2),
      );

      logger.info(`[ParsingChallenger] Captured parsing challenge: ${filename}`);
    } catch (captureError: unknown) {
      const errorMessage = captureError instanceof Error ? captureError.message : 'Unknown error';
      logger.error(
        "[ParsingChallenger] Failed to capture parsing challenge:",
        errorMessage,
      );
    }
  }
}