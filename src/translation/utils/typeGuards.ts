import type { GenericMessageRole } from '../types/generic.js';

const GENERIC_MESSAGE_ROLES: ReadonlySet<GenericMessageRole> = new Set([
  'system',
  'user',
  'assistant',
  'tool',
]);
/**
 * Type Guards - SSOT for Runtime Type Checking
 *
 * Centralizes type guard utilities used across converters.
 * Prevents duplication of type-checking logic.
 */

/**
 * Type alias for unknown record objects
 */
export type UnknownRecord = Record<string, unknown>;

/**
 * Type guard to check if value is a plain object (not array, not null)
 * 
 * SSOT for object type checking across all converters.
 * Used for parameter normalization and validation.
 */
export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Type guard to check if value is a string
 */
export const isString = (value: unknown): value is string =>
  typeof value === "string";

/**
 * Type guard to check if value is a number
 */
export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && !Number.isNaN(value);

/**
 * Type guard to check if value is a boolean
 */
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

/**
 * Type guard to check if value is an array
 */
export const isArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

/**
 * Type guard to check if value is null or undefined
 */
export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

export const isGenericMessageRole = (value: unknown): value is GenericMessageRole =>
  typeof value === 'string' && GENERIC_MESSAGE_ROLES.has(value as GenericMessageRole);
