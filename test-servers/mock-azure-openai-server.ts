/**
 * Mock Azure OpenAI Server
 * Simulates Azure OpenAI API with deployments, chat completions, tools, and streaming
 */

import { createServer } from 'http';

import express from 'express';

import type { Request, Response } from 'express';

const app = express();
app.use(express.json());

interface AzureOpenAIRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: any;
    };
  }>;
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  n?: number;
  // Azure-specific
  dataSources?: Array<{
    type: string;
    parameters: any;
  }>;
}

// Mock deployments
const MOCK_DEPLOYMENTS = {
  'gpt-4o': {
    id: 'gpt-4o',
    model: 'gpt-4o',
    status: 'succeeded',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    model: 'gpt-4o-mini',
    status: 'succeeded',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  'gpt-35-turbo': {
    id: 'gpt-35-turbo',
    model: 'gpt-3.5-turbo',
    status: 'succeeded',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
};

// Extract deployment name from path
// function extractDeploymentName(path: string): string {
//   const match = path.match(/\/deployments\/([^\/]+)/);
//   return match ? match[1] : 'gpt-4o';
// }

// Generate mock response
function generateAzureResponse(request: AzureOpenAIRequest, deployment: string): any {
  const hasTools = request.tools && request.tools.length > 0;
  const shouldCallTool = hasTools && Math.random() > 0.5;
  
  // Handle Azure data sources
  let baseContent = `Mock Azure OpenAI response from deployment "${deployment}".`;
  if (request.dataSources && request.dataSources.length > 0) {
    baseContent += ` Used data sources: ${request.dataSources.map(ds => ds.type).join(', ')}.`;
  }
  
  const response = {
    id: `chatcmpl-azure-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: deployment,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: shouldCallTool ? null : baseContent,
      },
      finish_reason: shouldCallTool ? 'tool_calls' : 'stop',
      content_filter_results: {
        hate: { filtered: false, severity: 'safe' },
        self_harm: { filtered: false, severity: 'safe' },
        sexual: { filtered: false, severity: 'safe' },
        violence: { filtered: false, severity: 'safe' },
      }
    }],
    usage: {
      prompt_tokens: Math.floor(Math.random() * 100) + 20,
      completion_tokens: Math.floor(Math.random() * 200) + 50,
      total_tokens: 0,
    },
    system_fingerprint: `fp_${Date.now().toString(36)}`,
  };
  
  response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
  
  // Add tool calls if needed
  if (shouldCallTool && request.tools) {
    const tool = request.tools[Math.floor(Math.random() * request.tools.length)];
    (response.choices[0].message as any).tool_calls = [{
      id: `call_azure_${Date.now()}`,
      type: 'function',
      function: {
        name: tool.function.name,
        arguments: JSON.stringify({ location: 'Seattle', query: 'azure test' }),
      }
    }];
  }
  
  return response;
}

// Generate streaming chunks
function* generateAzureStreamingChunks(request: AzureOpenAIRequest, deployment: string): Generator<any> {
  const id = `chatcmpl-azure-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  
  // First chunk with role
  yield {
    id,
    object: 'chat.completion.chunk',
    created,
    model: deployment,
    system_fingerprint: `fp_${Date.now().toString(36)}`,
    choices: [{
      index: 0,
      delta: { role: 'assistant' },
      finish_reason: null,
      content_filter_results: {}
    }]
  };
  
  const hasTools = request.tools && request.tools.length > 0;
  const shouldCallTool = hasTools && Math.random() > 0.5;
  
  if (shouldCallTool && request.tools) {
    // Tool call streaming
    const tool = request.tools[Math.floor(Math.random() * request.tools.length)];
    const toolCallId = `call_azure_${Date.now()}`;
    
    yield {
      id, object: 'chat.completion.chunk', created, model: deployment,
      system_fingerprint: `fp_${Date.now().toString(36)}`,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: toolCallId,
            type: 'function',
            function: { name: tool.function.name, arguments: '' }
          }]
        },
        finish_reason: null,
        content_filter_results: {}
      }]
    };
    
    // Stream arguments
    const args = JSON.stringify({ location: 'Seattle', query: 'azure test' });
    for (let i = 0; i < args.length; i += 4) {
      yield {
        id, object: 'chat.completion.chunk', created, model: deployment,
        system_fingerprint: `fp_${Date.now().toString(36)}`,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: args.slice(i, i + 4) }
            }]
          },
          finish_reason: null,
          content_filter_results: {}
        }]
      };
    }
    
    // Final tool chunk
    yield {
      id, object: 'chat.completion.chunk', created, model: deployment,
      system_fingerprint: `fp_${Date.now().toString(36)}`,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
        content_filter_results: {
          hate: { filtered: false, severity: 'safe' },
          self_harm: { filtered: false, severity: 'safe' },
          sexual: { filtered: false, severity: 'safe' },
          violence: { filtered: false, severity: 'safe' },
        }
      }],
      usage: {
        prompt_tokens: Math.floor(Math.random() * 100) + 20,
        completion_tokens: Math.floor(Math.random() * 200) + 50,
        total_tokens: 0,
      }
    };
    
  } else {
    // Content streaming
    let content = `Mock Azure OpenAI streaming response from deployment "${deployment}".`;
    if (request.dataSources && request.dataSources.length > 0) {
      content += ` Using data sources: ${request.dataSources.map(ds => ds.type).join(', ')}.`;
    }
    
    const words = content.split(' ');
    
    for (const word of words) {
      yield {
        id, object: 'chat.completion.chunk', created, model: deployment,
        system_fingerprint: `fp_${Date.now().toString(36)}`,
        choices: [{
          index: 0,
          delta: { content: word + ' ' },
          finish_reason: null,
          content_filter_results: {}
        }]
      };
    }
    
    // Final chunk
    yield {
      id, object: 'chat.completion.chunk', created, model: deployment,
      system_fingerprint: `fp_${Date.now().toString(36)}`,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
        content_filter_results: {
          hate: { filtered: false, severity: 'safe' },
          self_harm: { filtered: false, severity: 'safe' },
          sexual: { filtered: false, severity: 'safe' },
          violence: { filtered: false, severity: 'safe' },
        }
      }],
      usage: {
        prompt_tokens: Math.floor(Math.random() * 100) + 20,
        completion_tokens: Math.floor(Math.random() * 200) + 50,
        total_tokens: 0,
      }
    };
  }
}

// Azure OpenAI chat completions endpoint
app.post('/openai/deployments/:deploymentName/chat/completions', (req: Request, res: Response) => {
  const deployment = req.params.deploymentName;
  const request = req.body as AzureOpenAIRequest;
  const apiVersion = req.query['api-version'] ?? '2024-10-21';
  
  console.log(`[Mock Azure OpenAI] ${request.stream ? 'Streaming' : 'Non-streaming'} request:`);
  console.log(`  Deployment: ${deployment}`);
  console.log(`  API Version: ${apiVersion}`);
  console.log(`  Messages: ${request.messages.length}`);
  console.log(`  Tools: ${request.tools?.length ?? 0}`);
  console.log(`  Data Sources: ${request.dataSources?.length ?? 0}`);
  console.log(`  Temperature: ${request.temperature}`);
  
  if (request.stream) {
    // Streaming response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    const chunks = generateAzureStreamingChunks(request, deployment);
    
    function writeChunk() {
      const { value, done } = chunks.next();
      if (done) {
        res.write('data: [DONE]\\n\\n');
        res.end();
        return;
      }
      
      res.write(`data: ${JSON.stringify(value)}\\n\\n`);
      setTimeout(writeChunk, 60); // 60ms delay between chunks
    }
    
    writeChunk();
  } else {
    // Non-streaming response
    const response = generateAzureResponse(request, deployment);
    res.json(response);
  }
});

// OpenAI v1 compatible endpoint (for testing format conversion)
app.post('/openai/v1/chat/completions', (req: Request, res: Response) => {
  console.log(`[Mock Azure OpenAI] OpenAI v1 compatible endpoint`);
  
  // Use default deployment
  const deployment = 'gpt-4o';
  const request = req.body as AzureOpenAIRequest;
  
  console.log(`  Using deployment: ${deployment}`);
  console.log(`  Model from request: ${(request as any).model}`);
  
  if (request.stream) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    const chunks = generateAzureStreamingChunks(request, deployment);
    
    function writeChunk() {
      const { value, done } = chunks.next();
      if (done) {
        res.write('data: [DONE]\\n\\n');
        res.end();
        return;
      }
      
      res.write(`data: ${JSON.stringify(value)}\\n\\n`);
      setTimeout(writeChunk, 60);
    }
    
    writeChunk();
  } else {
    const response = generateAzureResponse(request, deployment);
    res.json(response);
  }
});

// List deployments endpoint
app.get('/openai/deployments', (req: Request, res: Response) => {
  const apiVersion = req.query['api-version'] ?? '2024-10-21';
  
  console.log(`[Mock Azure OpenAI] List deployments (API version: ${apiVersion})`);
  
  res.json({
    data: Object.values(MOCK_DEPLOYMENTS),
    object: 'list'
  });
});

// Get specific deployment
app.get('/openai/deployments/:deploymentName', (req: Request, res: Response) => {
  const deployment = req.params.deploymentName;
  const apiVersion = req.query['api-version'] ?? '2024-10-21';
  
  console.log(`[Mock Azure OpenAI] Get deployment: ${deployment} (API version: ${apiVersion})`);
  
  const deploymentInfo = MOCK_DEPLOYMENTS[deployment as keyof typeof MOCK_DEPLOYMENTS];
  if (deploymentInfo) {
    res.json(deploymentInfo);
  } else {
    res.status(404).json({
      error: {
        code: 'DeploymentNotFound',
        message: `The deployment '${deployment}' was not found.`
      }
    });
  }
});

// Models endpoint
app.get('/openai/models', (req: Request, res: Response) => {
  const apiVersion = req.query['api-version'] ?? '2024-10-21';
  
  console.log(`[Mock Azure OpenAI] List models (API version: ${apiVersion})`);
  
  res.json({
    data: [
      { id: 'gpt-4o', object: 'model', owned_by: 'azure-openai' },
      { id: 'gpt-4o-mini', object: 'model', owned_by: 'azure-openai' },
      { id: 'gpt-35-turbo', object: 'model', owned_by: 'azure-openai' },
    ],
    object: 'list'
  });
});

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    server: 'mock-azure-openai', 
    deployments: Object.keys(MOCK_DEPLOYMENTS).length,
    timestamp: Date.now() 
  });
});

export function startMockAzureOpenAI(port: number = 3002): Promise<any> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(port, () => {
      console.log(`☁️  Mock Azure OpenAI Server running on http://localhost:${port}`);
      console.log(`   Endpoints:`);
      console.log(`   - POST /openai/deployments/:name/chat/completions`);
      console.log(`   - POST /openai/v1/chat/completions (OpenAI compatible)`);
      console.log(`   - GET  /openai/deployments (list deployments)`);
      console.log(`   - GET  /openai/deployments/:name (get deployment)`);
      console.log(`   - GET  /openai/models`);
      console.log(`   - GET  /health`);
      console.log(`   Available deployments: ${Object.keys(MOCK_DEPLOYMENTS).join(', ')}`);
      resolve(server);
    });
  });
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void startMockAzureOpenAI(3002);
}

