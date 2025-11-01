/**
 * Translation Service Implementation
 * 
 * SSOT for all format conversions. All handlers MUST use this service.
 * Direct converter imports in handlers are FORBIDDEN.
 */

import { setupStreamHandler } from '../handlers/streamingHandler.js';
import { translate, translateResponse } from '../translation/index.js';

import type { TranslationService } from './contracts.js';
import type { LLMProvider } from '../translation/types/index.js';
import type { OpenAITool, RequestFormat } from '../types/index.js';
import type { Response } from 'express';
import type { Readable } from 'stream';

class TranslationServiceImpl implements TranslationService {
  async translateRequest(
    request: unknown,
    from: LLMProvider,
    to: LLMProvider,
    toolNames: string[]
  ): Promise<unknown> {
    const result = await translate({
      from,
      to,
      request,
      context: {
        knownToolNames: toolNames,
        enableXMLToolParsing: toolNames.length > 0,
      },
    });

    if (!result.success) {
      throw result.error ?? new Error('Translation failed');
    }

    return result.data;
  }

  async translateResponse(
    response: unknown,
    from: LLMProvider,
    to: LLMProvider,
    toolNames: string[]
  ): Promise<unknown> {
    const result = await translateResponse(
      response,
      from,
      to,
      {
        knownToolNames: toolNames,
        enableXMLToolParsing: toolNames.length > 0,
      }
    );

    if (!result.success) {
      throw result.error ?? new Error('Response translation failed');
    }

    return result.data;
  }

  translateStream(
    _stream: Readable,
    _from: LLMProvider,
    _to: LLMProvider,
    _tools: OpenAITool[],
    _streamOptions?: { include_usage?: boolean }
  ): Readable {
    // This is a simplified adapter - in practice we'd return a PassThrough stream
    // For now, we keep the existing setupStreamHandler pattern but will refactor
    throw new Error('Stream translation requires Response object - use setupStreamHandler directly for now');
  }

  /**
   * Temporary bridge method until we refactor streaming to not require Response
   */
  setupStreamTranslation(
    backendStream: Readable,
    res: Response,
    clientFormat: RequestFormat,
    backendFormat: RequestFormat,
    tools: OpenAITool[],
    streamOptions?: { include_usage?: boolean }
  ): void {
    setupStreamHandler(
      backendStream,
      res,
      clientFormat,
      backendFormat,
      tools,
      streamOptions
    );
  }
}

export const translationService = new TranslationServiceImpl();
