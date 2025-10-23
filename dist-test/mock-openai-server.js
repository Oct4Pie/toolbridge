/**
 * Mock OpenAI Compatible Server
 * Simulates OpenAI API with chat completions, tools, and streaming support
 */
import express from 'express';
import { createServer } from 'http';
const app = express();
app.use(express.json());
// Mock tool execution
function executeToolCall(toolName, parameters) {
    switch (toolName) {
        case 'get_weather':
            return `The weather in ${parameters.location || 'Unknown'} is sunny, 72°F`;
        case 'search_web':
            return `Search results for "${parameters.query}": Found 42 results about ${parameters.query}`;
        case 'calculate':
            return `Calculation result: ${parameters.expression} = ${Math.random() * 100}`;
        default:
            return `Tool ${toolName} executed with parameters: ${JSON.stringify(parameters)}`;
    }
}
// Generate mock response
function generateResponse(request) {
    const hasTools = request.tools && request.tools.length > 0;
    const shouldCallTool = hasTools && Math.random() > 0.5; // 50% chance to call tool
    const response = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: shouldCallTool ? null : `Mock response for model ${request.model}. Temperature: ${request.temperature || 1}`,
                },
                finish_reason: shouldCallTool ? 'tool_calls' : 'stop',
            }],
        usage: {
            prompt_tokens: Math.floor(Math.random() * 100) + 20,
            completion_tokens: Math.floor(Math.random() * 200) + 50,
            total_tokens: 0,
        }
    };
    response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
    // Add tool calls if needed
    if (shouldCallTool && request.tools) {
        const tool = request.tools[Math.floor(Math.random() * request.tools.length)];
        response.choices[0].message.tool_calls = [{
                id: `call_${Date.now()}`,
                type: 'function',
                function: {
                    name: tool.function.name,
                    arguments: JSON.stringify({ location: 'San Francisco', query: 'test' }),
                }
            }];
    }
    return response;
}
// Generate streaming chunks
function* generateStreamingChunks(request) {
    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    // First chunk with role
    yield {
        id,
        object: 'chat.completion.chunk',
        created,
        model: request.model,
        choices: [{
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null,
            }]
    };
    const hasTools = request.tools && request.tools.length > 0;
    const shouldCallTool = hasTools && Math.random() > 0.5;
    if (shouldCallTool && request.tools) {
        // Tool call chunks
        const tool = request.tools[Math.floor(Math.random() * request.tools.length)];
        const toolCallId = `call_${Date.now()}`;
        yield {
            id, object: 'chat.completion.chunk', created, model: request.model,
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
                }]
        };
        // Arguments chunks
        const args = JSON.stringify({ location: 'San Francisco', query: 'test' });
        for (let i = 0; i < args.length; i += 3) {
            yield {
                id, object: 'chat.completion.chunk', created, model: request.model,
                choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                    index: 0,
                                    function: { arguments: args.slice(i, i + 3) }
                                }]
                        },
                        finish_reason: null,
                    }]
            };
        }
        // Final chunk with tool_calls finish reason
        yield {
            id, object: 'chat.completion.chunk', created, model: request.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: {
                prompt_tokens: Math.floor(Math.random() * 100) + 20,
                completion_tokens: Math.floor(Math.random() * 200) + 50,
                total_tokens: 0,
            }
        };
    }
    else {
        // Content chunks
        const content = `Mock streaming response for model ${request.model}. This simulates OpenAI's streaming format.`;
        const words = content.split(' ');
        for (const word of words) {
            yield {
                id, object: 'chat.completion.chunk', created, model: request.model,
                choices: [{
                        index: 0,
                        delta: { content: word + ' ' },
                        finish_reason: null,
                    }]
            };
        }
        // Final chunk
        yield {
            id, object: 'chat.completion.chunk', created, model: request.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: {
                prompt_tokens: Math.floor(Math.random() * 100) + 20,
                completion_tokens: Math.floor(Math.random() * 200) + 50,
                total_tokens: 0,
            }
        };
    }
}
// Chat completions endpoint
app.post('/v1/chat/completions', (req, res) => {
    const request = req.body;
    console.log(`[Mock OpenAI] ${request.stream ? 'Streaming' : 'Non-streaming'} request:`);
    console.log(`  Model: ${request.model}`);
    console.log(`  Messages: ${request.messages.length}`);
    console.log(`  Tools: ${request.tools?.length || 0}`);
    console.log(`  Temperature: ${request.temperature}`);
    if (request.stream) {
        // Streaming response
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Transfer-Encoding', 'chunked');
        const chunks = generateStreamingChunks(request);
        function writeChunk() {
            const { value, done } = chunks.next();
            if (done) {
                res.write('data: [DONE]\\n\\n');
                res.end();
                return;
            }
            res.write(`data: ${JSON.stringify(value)}\\n\\n`);
            setTimeout(writeChunk, 50); // 50ms delay between chunks
        }
        writeChunk();
    }
    else {
        // Non-streaming response
        const response = generateResponse(request);
        res.json(response);
    }
});
// Models endpoint
app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
            { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
            { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' },
        ]
    });
});
// Health endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', server: 'mock-openai', timestamp: Date.now() });
});
export function startMockOpenAI(port = 3001) {
    return new Promise((resolve) => {
        const server = createServer(app);
        server.listen(port, () => {
            console.log(`🤖 Mock OpenAI Server running on http://localhost:${port}`);
            console.log(`   Endpoints:`);
            console.log(`   - POST /v1/chat/completions (streaming & non-streaming)`);
            console.log(`   - GET  /v1/models`);
            console.log(`   - GET  /health`);
            resolve(server);
        });
    });
}
// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startMockOpenAI(3001);
}
