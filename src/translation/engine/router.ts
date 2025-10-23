/**
 * Universal Translation Router
 * 
 * Express router that provides endpoints for any-to-any LLM provider conversion.
 * This makes the translation system accessible via HTTP API.
 */

import { Router } from 'express';

import { translationEngine, translate, translateResponse } from './translator.js';

import type { LLMProvider } from '../types/index.js';
import type { Request, Response } from 'express';
// import { translateStream } from './translator.js'; // Unused for now

export const translationRouter = Router();

// Health check endpoint
translationRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    providers: translationEngine.getAvailableProviders(),
    timestamp: new Date().toISOString()
  });
});

// Get available providers
translationRouter.get('/providers', (_req: Request, res: Response) => {
  const providers = translationEngine.getAvailableProviders();
  const capabilities: Record<LLMProvider, ReturnType<typeof translationEngine.getProviderCapabilities>> = {} as Record<LLMProvider, ReturnType<typeof translationEngine.getProviderCapabilities>>;
  
  for (const provider of providers) {
    capabilities[provider] = translationEngine.getProviderCapabilities(provider);
  }
  
  res.json({
    providers,
    capabilities
  });
});

// Translate request between providers
translationRouter.post('/translate', async (req: Request, res: Response) => {
  try {
    const { from, to, request, strict = false } = req.body;
    
    if (!from || !to || !request) {
      return res.status(400).json({
        error: 'Missing required fields: from, to, request'
      });
    }
    
    if (!translationEngine.isProviderSupported(from as LLMProvider)) {
      return res.status(400).json({
        error: `Unsupported source provider: ${from}`
      });
    }
    
    if (!translationEngine.isProviderSupported(to as LLMProvider)) {
      return res.status(400).json({
        error: `Unsupported target provider: ${to}`
      });
    }
    
    const result = await translate({
      from: from as LLMProvider,
      to: to as LLMProvider,
      request,
      strict
    });
    
    if (result.success) {
      return res.json({
        success: true,
        data: result.data,
        compatibility: result.compatibility,
        transformations: result.transformations,
        context: result.context
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error?.message,
        compatibility: result.compatibility,
        context: result.context
      });
    }
    
  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({
      error: 'Internal server error during translation'
    });
  }
});

// Translate response between providers  
translationRouter.post('/translate-response', async (req: Request, res: Response) => {
  try {
    const { from, to, response } = req.body;
    
    if (!from || !to || !response) {
      return res.status(400).json({
        error: 'Missing required fields: from, to, response'
      });
    }
    
    const result = await translateResponse(response, from as LLMProvider, to as LLMProvider);
    
    if (result.success) {
      return res.json({
        success: true,
        data: result.data,
        transformations: result.transformations
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error?.message
      });
    }
    
  } catch (error) {
    console.error('Response translation error:', error);
    return res.status(500).json({
      error: 'Internal server error during response translation'
    });
  }
});

// Check compatibility between providers for a specific request
translationRouter.post('/compatibility', async (req: Request, res: Response) => {
  try {
    const { provider, request } = req.body;
    
    if (!provider || !request) {
      return res.status(400).json({
        error: 'Missing required fields: provider, request'
      });
    }
    
    if (!translationEngine.isProviderSupported(provider as LLMProvider)) {
      return res.status(400).json({
        error: `Unsupported provider: ${provider}`
      });
    }
    
    // Convert request to generic format first
    const translateResult = await translate({
      from: 'openai', // Assume input is OpenAI format
      to: 'openai',   // No-op conversion to get generic format
      request
    });
    
    if (!translateResult.success) {
      return res.status(400).json({
        error: 'Invalid request format'
      });
    }
    
    // Get compatibility info from provider capabilities
    const capabilities = translationEngine.getProviderCapabilities(provider as LLMProvider);
    
    return res.json({
      compatible: capabilities !== null,
      capabilities: capabilities ?? {}
    });
    
  } catch (error) {
    console.error('Compatibility check error:', error);
    return res.status(500).json({
      error: 'Internal server error during compatibility check'
    });
  }
});

// Universal chat completions endpoint - auto-detects and converts
translationRouter.post('/:targetProvider/chat/completions', async (req: Request, res: Response) => {
  try {
    const targetProvider = req.params.targetProvider as LLMProvider;
    
    if (!translationEngine.isProviderSupported(targetProvider)) {
      return res.status(400).json({
        error: `Unsupported target provider: ${targetProvider}`
      });
    }
    
    // Detect source format (simplified - assume OpenAI for now)
    const sourceProvider: LLMProvider = 'openai';
    
    // Translate request
    const result = await translate({
      from: sourceProvider,
      to: targetProvider,
      request: req.body
    });
    
    if (!result.success) {
      return res.status(400).json({
        error: result.error?.message,
        compatibility: result.compatibility
      });
    }
    
    // Return translated request (in real implementation, this would forward to actual provider)
    return res.json({
      message: `Request successfully translated to ${targetProvider} format`,
      translatedRequest: result.data,
      compatibility: result.compatibility,
      transformations: result.transformations
    });
    
  } catch (error) {
    console.error('Universal endpoint error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Stream translation endpoint (placeholder - would need actual implementation)
translationRouter.post('/translate-stream', async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = req.body;
    
    if (!from || !to) {
      res.status(400).json({
        error: 'Missing required fields: from, to'
      });
      return;
    }
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // This is a placeholder - real implementation would:
    // 1. Accept a source stream
    // 2. Convert chunks in real-time
    // 3. Stream converted chunks to client
    
    res.write('data: {"message": "Stream translation endpoint - implementation needed"}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream translation error:', error);
    // Can't use res.status after writeHead, so just end the response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error'
      });
    } else {
      res.end();
    }
  }
});

export default translationRouter;
