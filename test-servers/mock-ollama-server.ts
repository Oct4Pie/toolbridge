/**
 * Mock Ollama Server
 * Simulates Ollama API with chat completions and streaming support
 */

import { createServer } from 'http';

import express from 'express';

import type { Request, Response } from 'express';

const app = express();
app.use(express.json());

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  format?: 'json';
  num_predict?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  seed?: number;
  stop?: string[];
  num_ctx?: number;
  mirostat?: number;
  mirostat_eta?: number;
  mirostat_tau?: number;
  tfs_z?: number;
  keep_alive?: string;
}

// Generate mock response
function generateResponse(request: OllamaRequest): any {
  const content = `Mock Ollama response for model ${request.model}. ` +
                 `Temperature: ${request.temperature ?? 0.8}. ` +
                 `Context length: ${request.num_ctx ?? 4096}.`;
  
  return {
    model: request.model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: request.format === 'json' ? JSON.stringify({ response: content }) : content,
    },
    done: true,
    total_duration: Math.floor(Math.random() * 1000000000) + 500000000, // 0.5-1.5s in nanoseconds
    load_duration: Math.floor(Math.random() * 100000000) + 50000000,   // 50-150ms
    prompt_eval_count: Math.floor(Math.random() * 50) + 20,
    prompt_eval_duration: Math.floor(Math.random() * 500000000) + 200000000,
    eval_count: Math.floor(Math.random() * 100) + 30,
    eval_duration: Math.floor(Math.random() * 800000000) + 300000000,
  };
}

// Generate streaming chunks
function* generateStreamingChunks(request: OllamaRequest): Generator<any> {
  const baseResponse = {
    model: request.model,
    created_at: new Date().toISOString(),
    done: false,
  };
  
  const fullContent = `Mock Ollama streaming response for model ${request.model}. ` +
                     `This simulates Ollama's streaming format with proper token timing.`;
  
  const words = fullContent.split(' ');
  
  // Stream content word by word
  for (let i = 0; i < words.length; i++) {
    const isLast = i === words.length - 1;
    const content = words[i] + (isLast ? '' : ' ');
    
    yield {
      ...baseResponse,
      message: {
        role: 'assistant',
        content: content,
      },
      done: false,
    };
  }
  
  // Final chunk with statistics
  yield {
    model: request.model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: '',
    },
    done: true,
    total_duration: Math.floor(Math.random() * 1000000000) + 500000000,
    load_duration: Math.floor(Math.random() * 100000000) + 50000000,
    prompt_eval_count: Math.floor(Math.random() * 50) + 20,
    prompt_eval_duration: Math.floor(Math.random() * 500000000) + 200000000,
    eval_count: words.length,
    eval_duration: Math.floor(Math.random() * 800000000) + 300000000,
  };
}

// Ollama chat endpoint
app.post('/api/chat', (req: Request, res: Response) => {
  const request = req.body as OllamaRequest;
  
  console.log(`[Mock Ollama] ${request.stream ? 'Streaming' : 'Non-streaming'} request:`);
  console.log(`  Model: ${request.model}`);
  console.log(`  Messages: ${request.messages.length}`);
  console.log(`  Format: ${request.format ?? 'text'}`);
  console.log(`  Temperature: ${request.temperature}`);
  console.log(`  Context: ${request.num_ctx ?? 4096}`);
  
  if (request.stream) {
    // Streaming response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    const chunks = generateStreamingChunks(request);
    
    function writeChunk() {
      const { value, done } = chunks.next();
      if (done) {
        res.end();
        return;
      }
      
      res.write(JSON.stringify(value) + '\\n');
      setTimeout(writeChunk, 80); // 80ms delay between chunks (slower than OpenAI)
    }
    
    writeChunk();
  } else {
    // Non-streaming response
    const response = generateResponse(request);
    res.json(response);
  }
});

// Ollama generate endpoint (legacy)
app.post('/api/generate', (req: Request, res: Response) => {
  const { model, prompt, stream } = req.body;
  
  console.log(`[Mock Ollama] Generate endpoint (legacy):`);
  console.log(`  Model: ${model}`);
  console.log(`  Prompt length: ${prompt?.length ?? 0}`);
  console.log(`  Stream: ${stream}`);
  
  const response = {
    model,
    created_at: new Date().toISOString(),
    response: `Mock generate response for: ${prompt?.slice(0, 50)}...`,
    done: !stream,
    total_duration: Math.floor(Math.random() * 1000000000) + 500000000,
    eval_count: Math.floor(Math.random() * 100) + 30,
  };
  
  if (stream) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Send chunks
    const words = response.response.split(' ');
    words.forEach((word, i) => {
      setTimeout(() => {
        const chunk = {
          ...response,
          response: word + ' ',
          done: i === words.length - 1,
        };
        res.write(JSON.stringify(chunk) + '\n');
        if (i === words.length - 1) {
          res.end();
        }
      }, i * 100);
    });
  } else {
    res.json(response);
  }
});

// OpenAI-compatible endpoint
app.post('/v1/chat/completions', (req: Request, res: Response) => {
  console.log(`[Mock Ollama] OpenAI-compatible endpoint:`);
  
  // Convert OpenAI format to Ollama format
  const openaiRequest = req.body;
  const ollamaRequest: OllamaRequest = {
    model: openaiRequest.model,
    messages: openaiRequest.messages,
    stream: openaiRequest.stream,
    num_predict: openaiRequest.max_tokens,
    temperature: openaiRequest.temperature,
    top_p: openaiRequest.top_p,
    seed: openaiRequest.seed,
    stop: Array.isArray(openaiRequest.stop) ? openaiRequest.stop : 
          (openaiRequest.stop ? [openaiRequest.stop] : undefined),
  };
  
  if (openaiRequest.response_format?.type === 'json_object') {
    ollamaRequest.format = 'json';
  }
  
  console.log(`  Converted to Ollama format`);
  console.log(`  Model: ${ollamaRequest.model}`);
  console.log(`  Stream: ${ollamaRequest.stream}`);
  
  // Generate response in Ollama format, then convert back to OpenAI format
  if (ollamaRequest.stream) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    const chunks = generateStreamingChunks(ollamaRequest);
    // let contentBuffer = '';
    
    function writeChunk() {
      const { value, done } = chunks.next();
      if (done) {
        res.write('data: [DONE]\\n\\n');
        res.end();
        return;
      }
      
      // Convert Ollama chunk to OpenAI format
      const openaiChunk = {
        id: `chatcmpl-ollama-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: value.model,
        choices: [{
          index: 0,
          delta: {
            role: value.done ? undefined : 'assistant',
            content: value.message.content,
          },
          finish_reason: value.done ? 'stop' : null,
        }]
      };
      
      if (value.done && value.eval_count) {
        (openaiChunk as any).usage = {
          prompt_tokens: value.prompt_eval_count ?? 0,
          completion_tokens: value.eval_count,
          total_tokens: (value.prompt_eval_count ?? 0) + value.eval_count,
        };
      }
      
      res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
      setTimeout(writeChunk, 80);
    }
    
    writeChunk();
  } else {
    const ollamaResponse = generateResponse(ollamaRequest);
    
    // Convert to OpenAI format
    const openaiResponse = {
      id: `chatcmpl-ollama-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: ollamaResponse.model,
      choices: [{
        index: 0,
        message: {
          role: ollamaResponse.message.role,
          content: ollamaResponse.message.content,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: ollamaResponse.prompt_eval_count,
        completion_tokens: ollamaResponse.eval_count,
        total_tokens: ollamaResponse.prompt_eval_count + ollamaResponse.eval_count,
      }
    };
    
    res.json(openaiResponse);
  }
});

// Tags endpoint (list models)
app.get('/api/tags', (_req: Request, res: Response) => {
  res.json({
    models: [
      { name: 'llama3.1:8b', size: 4661189808 },
      { name: 'llama3.1:70b', size: 39892342848 },
      { name: 'codestral:22b', size: 12804985185 },
      { name: 'phi3:mini', size: 2292024576 },
    ]
  });
});

// Show model info
app.post('/api/show', (req: Request, res: Response) => {
  const { name } = req.body;
  res.json({
    modelfile: `# Mock modelfile for ${name}`,
    parameters: `temperature 0.8\\nnum_ctx 4096\\nstop "AI assistant"`,
    template: `{{ if .System }}{{ .System }}{{ end }}{{ if .Prompt }}{{ .Prompt }}{{ end }}`,
  });
});

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'mock-ollama', timestamp: Date.now() });
});

export function startMockOllama(port: number = 11434): Promise<any> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(port, () => {
      console.log(`🦙 Mock Ollama Server running on http://localhost:${port}`);
      console.log(`   Endpoints:`);
      console.log(`   - POST /api/chat (native Ollama format)`);
      console.log(`   - POST /api/generate (legacy format)`);
      console.log(`   - POST /v1/chat/completions (OpenAI-compatible)`);
      console.log(`   - GET  /api/tags (list models)`);
      console.log(`   - POST /api/show (model info)`);
      console.log(`   - GET  /health`);
      resolve(server);
    });
  });
}



// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void startMockOllama(11434);
}

