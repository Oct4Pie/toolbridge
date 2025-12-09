import chalk from "chalk";

import logger from "./logger.js";

import type { Request } from "express";

function formatMethod(method: string): string {
  const upperMethod = method.toUpperCase();

  switch (upperMethod) {
    case "GET":
      return chalk.green(upperMethod);
    case "POST":
      return chalk.yellow(upperMethod);
    case "PUT":
      return chalk.blue(upperMethod);
    case "DELETE":
      return chalk.red(upperMethod);
    case "PATCH":
      return chalk.cyan(upperMethod);
    default:
      return chalk.white(upperMethod);
  }
}

function getStatusColor(status: number): typeof chalk.red {
  if (status >= 500) {return chalk.red;}
  if (status >= 400) {return chalk.yellow;}
  if (status >= 300) {return chalk.cyan;}
  if (status >= 200) {return chalk.green;}
  return chalk.white;
}

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };

  return statusMap[status] ?? "";
}

export function logRequest(req: Request, routeName: string): void {
  const timestamp = new Date().toISOString();
  const method = formatMethod(req.method);
  const endpoint = chalk.cyan(req.originalUrl);

  logger.info(`${chalk.blue("➤")} ${chalk.dim(timestamp)} ${method} ${endpoint} ${chalk.yellow(routeName)}`);

  if (
    routeName.includes("CHAT COMPLETIONS") &&
    req.body &&
    (req.body as Record<string, unknown>)['stream'] === true
  ) {
    logger.info(`  ${chalk.dim("stream:")} ${chalk.yellow("enabled")}`);
  }
}

export function logResponse(
  status: number, 
  routeName: string, 
  duration?: number
): void {
  const statusColor = getStatusColor(status);
  const statusText = statusColor(`${status} ${getStatusText(status)}`);

  let output = `${chalk.blue("⮑")} ${statusText} ${chalk.yellow(routeName)}`;

  if (duration) {
    output += ` ${chalk.dim("in")} ${chalk.magenta(duration + "ms")}`;
  }

  logger.info(output);
}

export default {
  logRequest,
  logResponse,
};