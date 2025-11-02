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
function generateResponse(request: OllamaRequest): Record<string, unknown> {
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
function* generateStreamingChunks(request: OllamaRequest): Generator<unknown> {
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
      const chunk = value as Record<string, unknown>;
      const openaiChunk = {
        id: `chatcmpl-ollama-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: chunk['model'],
        choices: [{
          index: 0,
          delta: {
            role: chunk['done'] ? undefined : 'assistant',
            content: (chunk['message'] as Record<string, unknown>)['content'],
          },
          finish_reason: chunk['done'] ? 'stop' : null,
        }]
      };
      
      if (chunk['done'] && chunk['eval_count']) {
        (openaiChunk as Record<string, unknown>)['usage'] = {
          prompt_tokens: (chunk['prompt_eval_count'] as number) ?? 0,
          completion_tokens: chunk['eval_count'] as number,
          total_tokens: ((chunk['prompt_eval_count'] as number) ?? 0) + (chunk['eval_count'] as number),
        };
      }
      
      res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
      setTimeout(writeChunk, 80);
    }
    
    writeChunk();
  } else {
    const ollamaResponse = generateResponse(ollamaRequest);
    
    // Convert to OpenAI format
    const response = ollamaResponse as Record<string, unknown>;
    const message = (response['message'] ?? {}) as Record<string, unknown>;
    const promptEvalCount = (response['prompt_eval_count'] as number) ?? 0;
    const evalCount = (response['eval_count'] as number) ?? 0;
    
    const openaiResponse = {
      id: `chatcmpl-ollama-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response['model'],
      choices: [{
        index: 0,
        message: {
          role: message['role'],
          content: message['content'],
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: promptEvalCount,
        completion_tokens: evalCount,
        total_tokens: promptEvalCount + evalCount,
      }
    };
    
    res.json(openaiResponse);
  }
});

// Tags endpoint (list models)
app.get('/api/tags', (_req: Request, res: Response) => {
  console.log('[Mock Ollama] GET /api/tags');
  res.json({
    models: [
      {
        name: 'llama3.1:8b',
        model: 'llama3.1:8b',
        modified_at: new Date(Date.now() - 86400000).toISOString(),
        size: 4661189808,
        digest: 'sha256:mock-digest-llama3-8b',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '8.0B',
          quantization_level: 'Q4_K_M',
        },
      },
      {
        name: 'llama3.1:70b',
        model: 'llama3.1:70b',
        modified_at: new Date(Date.now() - 172800000).toISOString(),
        size: 39892342848,
        digest: 'sha256:mock-digest-llama3-70b',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '70.0B',
          quantization_level: 'Q4_K_M',
        },
      },
      {
        name: 'codestral:22b',
        model: 'codestral:22b',
        modified_at: new Date(Date.now() - 259200000).toISOString(),
        size: 12804985185,
        digest: 'sha256:mock-digest-codestral-22b',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '22.0B',
          quantization_level: 'Q4_K_M',
        },
      },
    ],
  });
});

// Show model info
app.post('/api/show', (req: Request, res: Response) => {
  const { name, model } = req.body;
  const modelName = name ?? model ?? 'unknown';
  console.log(`[Mock Ollama] POST /api/show - model: ${modelName}`);

  res.json({
    modelfile: `# Modelfile for ${modelName}\nFROM ${modelName}\nTEMPLATE """{{ if .System }}{{ .System }}{{ end }}{{ if .Prompt }}{{ .Prompt }}{{ end }}"""\nPARAMETER temperature 0.8\nPARAMETER num_ctx 4096\nPARAMETER stop "AI assistant"`,
    parameters: 'temperature 0.8\nnum_ctx 4096\nstop "AI assistant"',
    template: '{{ if .System }}{{ .System }}{{ end }}{{ if .Prompt }}{{ .Prompt }}{{ end }}',
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '8.0B',
      quantization_level: 'Q4_K_M',
    },
    model_info: {
      'general.architecture': 'llama',
      'general.file_type': 2,
      'general.parameter_count': 8030261248,
      'llama.context_length': 8192,
      'llama.embedding_length': 4096,
      'llama.block_count': 32,
      'llama.attention.head_count': 32,
      'llama.attention.head_count_kv': 8,
    },
  });
});

// Version endpoint
app.get('/api/version', (_req: Request, res: Response) => {
  console.log('[Mock Ollama] GET /api/version');
  res.json({
    version: '0.5.0',
  });
});

// PS endpoint (list running models)
app.get('/api/ps', (_req: Request, res: Response) => {
  console.log('[Mock Ollama] GET /api/ps');
  res.json({
    models: [
      {
        name: 'llama3.1:8b',
        model: 'llama3.1:8b',
        size: 4661189808,
        digest: 'sha256:mock-digest-llama3-8b',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '8.0B',
          quantization_level: 'Q4_K_M',
        },
        expires_at: new Date(Date.now() + 300000).toISOString(), // 5 minutes from now
        size_vram: 4661189808,
      },
    ],
  });
});

// Create model endpoint
app.post('/api/create', (req: Request, res: Response) => {
  const { name, stream } = req.body;
  console.log(`[Mock Ollama] POST /api/create - name: ${name}, stream: ${stream}`);

  if (stream) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const statuses = [
      { status: 'parsing modelfile' },
      { status: 'looking for model' },
      { status: 'creating model layer' },
      { status: 'writing layer', digest: 'sha256:mock-layer-1', total: 100, completed: 100 },
      { status: 'writing manifest' },
      { status: 'success' },
    ];

    let index = 0;
    const sendStatus = () => {
      if (index < statuses.length) {
        res.write(JSON.stringify(statuses[index]) + '\n');
        index++;
        setTimeout(sendStatus, 200);
      } else {
        res.end();
      }
    };
    sendStatus();
  } else {
    res.json({ status: 'success' });
  }
});

// Copy model endpoint
app.post('/api/copy', (req: Request, res: Response) => {
  const { source, destination } = req.body;
  console.log(`[Mock Ollama] POST /api/copy - source: ${source}, destination: ${destination}`);
  res.status(200).send();
});

// Delete model endpoint
app.delete('/api/delete', (req: Request, res: Response) => {
  const { name, model } = req.body;
  const modelName = name ?? model ?? 'unknown';
  console.log(`[Mock Ollama] DELETE /api/delete - model: ${modelName}`);
  res.status(200).send();
});

// Pull model endpoint
app.post('/api/pull', (req: Request, res: Response) => {
  const { name, model, stream } = req.body;
  const modelName = name ?? model ?? 'unknown';
  console.log(`[Mock Ollama] POST /api/pull - model: ${modelName}, stream: ${stream}`);

  if (stream) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const totalSize = 4661189808;
    const chunks = 10;
    let completed = 0;

    const sendProgress = () => {
      if (completed < chunks) {
        completed++;
        const progress = {
          status: 'downloading',
          digest: 'sha256:mock-digest',
          total: totalSize,
          completed: Math.floor((totalSize / chunks) * completed),
        };
        res.write(JSON.stringify(progress) + '\n');
        setTimeout(sendProgress, 300);
      } else {
        res.write(JSON.stringify({ status: 'success' }) + '\n');
        res.end();
      }
    };
    sendProgress();
  } else {
    res.json({ status: 'success' });
  }
});

// Push model endpoint
app.post('/api/push', (req: Request, res: Response) => {
  const { name, model, stream } = req.body;
  const modelName = name ?? model ?? 'unknown';
  console.log(`[Mock Ollama] POST /api/push - model: ${modelName}, stream: ${stream}`);

  if (stream) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const statuses = [
      { status: 'retrieving manifest' },
      { status: 'pushing manifest' },
      { status: 'success' },
    ];

    let index = 0;
    const sendStatus = () => {
      if (index < statuses.length) {
        res.write(JSON.stringify(statuses[index]) + '\n');
        index++;
        setTimeout(sendStatus, 200);
      } else {
        res.end();
      }
    };
    sendStatus();
  } else {
    res.json({ status: 'success' });
  }
});

// Embed endpoint
app.post('/api/embed', (req: Request, res: Response) => {
  const { model, input } = req.body;
  console.log(`[Mock Ollama] POST /api/embed - model: ${model}, input length: ${input?.length ?? 0}`);

  // Generate mock embeddings
  const embeddings = Array.isArray(input)
    ? input.map(() => Array.from({ length: 384 }, () => Math.random() * 2 - 1))
    : [Array.from({ length: 384 }, () => Math.random() * 2 - 1)];

  res.json({
    model,
    embeddings,
  });
});

// Embeddings endpoint (legacy)
app.post('/api/embeddings', (req: Request, res: Response) => {
  const { model } = req.body;
  console.log(`[Mock Ollama] POST /api/embeddings - model: ${model}`);

  res.json({
    embedding: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
  });
});

// Blob endpoints
app.head('/api/blobs/:digest', (req: Request, res: Response) => {
  const { digest } = req.params;
  console.log(`[Mock Ollama] HEAD /api/blobs/${digest}`);
  res.status(200).send();
});

app.post('/api/blobs/:digest', (req: Request, res: Response) => {
  const { digest } = req.params;
  console.log(`[Mock Ollama] POST /api/blobs/${digest}`);
  res.status(201).send();
});

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'mock-ollama', timestamp: Date.now() });
});

export function startMockOllama(port: number = 11434): Promise<unknown> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(port, () => {
      console.log(`🦙 Mock Ollama Server running on http://localhost:${port}`);
      console.log(`   Chat & Generation:`);
      console.log(`   - POST /api/chat (native Ollama format)`);
      console.log(`   - POST /api/generate (legacy format)`);
      console.log(`   - POST /v1/chat/completions (OpenAI-compatible)`);
      console.log(`   Model Management:`);
      console.log(`   - GET    /api/tags (list models)`);
      console.log(`   - POST   /api/show (model info)`);
      console.log(`   - POST   /api/create (create model)`);
      console.log(`   - POST   /api/copy (copy model)`);
      console.log(`   - DELETE /api/delete (delete model)`);
      console.log(`   - POST   /api/pull (pull model)`);
      console.log(`   - POST   /api/push (push model)`);
      console.log(`   Embeddings:`);
      console.log(`   - POST /api/embed (generate embeddings)`);
      console.log(`   - POST /api/embeddings (legacy)`);
      console.log(`   System:`);
      console.log(`   - GET  /api/version (server version)`);
      console.log(`   - GET  /api/ps (running models)`);
      console.log(`   Blobs:`);
      console.log(`   - HEAD /api/blobs/:digest`);
      console.log(`   - POST /api/blobs/:digest`);
      console.log(`   Other:`);
      console.log(`   - GET  /health`);
      resolve(server);
    });
  });
}



// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void startMockOllama(11434);
}

