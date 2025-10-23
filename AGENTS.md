# CLAUDE.md - ToolBridge Development Guide

## 🚀 Project Overview

**ToolBridge** is a sophisticated Multi-LLM Proxy Server that enables seamless function calling, format translation, and tool detection across different LLM backends including OpenAI, Ollama, Azure OpenAI, and more. It features advanced stream processing, bi-directional format conversion, and comprehensive XML/JSON tool call detection.

### Current Status (January 2025)
- ✅ **100% TypeScript** - Complete migration with strict type safety
- ✅ **Ultra-Strict ESLint** - Maximum code quality enforcement
- ✅ **Zero TypeScript Errors** - Full compilation success
- ✅ **Multi-Backend Support** - OpenAI, Ollama, Azure OpenAI integration
- ✅ **Universal Translation Layer** - Any-to-any format conversion
- ✅ **Dual Client Support** - Works with both OpenAI SDK and Ollama clients
- ✅ **Advanced Stream Processing** - Real-time tool call detection
- ✅ **Mock Test Servers** - Comprehensive testing infrastructure

## 🏗️ Architecture

### Core Components

1. **Entry Point**: `src/index.ts` - Express server with health endpoints
2. **Chat Handler**: `src/handlers/chatHandler.ts` - Main request processing
3. **Stream Processors**: Real-time tool call detection and formatting
4. **Format Converters**: Bi-directional OpenAI ⟷ Ollama ⟷ Azure conversion
5. **Translation Layer**: Universal LLM format translation system
6. **Mock Servers**: Test servers for OpenAI, Ollama, and Azure APIs
7. **Configuration**: Environment-based setup with validation

### Stream Processing Architecture

```
Client Request → Format Detection → Backend Request → Stream Response
                                                    ↓
                                            Stream Processors
                                                    ↓
                    Tool Call Detection ← Response Processing
                            ↓
                    Format Conversion → Client Response
```

### Translation Layer Architecture

```
Source Format → Generic Intermediate Format → Target Format
     ↓                      ↓                      ↓
  OpenAI         Universal Schema              Ollama
  Azure          with Capabilities             OpenAI
  Ollama         Tracking                      Azure
```

### Stream Processors

- **OpenAIStreamProcessor**: Handles OpenAI streaming format
- **OllamaStreamProcessor**: Handles Ollama streaming format  
- **FormatConvertingStreamProcessor**: Cross-format conversion
- **WrapperAwareStreamProcessor**: XML wrapper detection

### Translation Components

- **TranslationEngine**: Core translation orchestrator
- **ProviderConverters**: Format-specific converters (OpenAI, Ollama, Azure)
- **GenericLLMSchema**: Universal intermediate format
- **CapabilityTracking**: Feature compatibility checking

## ⚙️ Development Setup

### Prerequisites
- Node.js 18+
- TypeScript 5.0+
- npm or yarn

### Installation
```bash
npm install
```

### Key Commands

#### Development
```bash
npm run dev              # Start development server with hot reload
npm run build           # Compile TypeScript to JavaScript
npm run start           # Start production server
```

#### Code Quality
```bash
npm run type-check      # TypeScript compilation check
npm run lint            # ESLint with ultra-strict rules
npm run lint:fix        # Auto-fix ESLint issues
npx eslint              # Full project linting
npx eslint src/         # Source files only
npx eslint --fix        # Auto-fix issues
```

#### Testing
```bash
npm test                    # Run all tests
npm run test:unit          # Unit tests only  
npm run test:integration   # Integration tests only
npm run test:llm           # Real LLM integration tests
npm run test:pattern       # Pattern detection tests
npm run test:dual-client   # Dual client support tests
```

### Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required
BACKEND_LLM_BASE_URL=https://api.openai.com/v1
BACKEND_LLM_API_KEY=your_api_key
PROXY_HOST=localhost
PROXY_PORT=3000

# Optional - Azure Support
AZURE_OPENAI_RESOURCE=your_resource
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_SUBSCRIPTION_ID=your_subscription_id
AZURE_RESOURCE_GROUP=your_resource_group
AZURE_ACCOUNT_NAME=your_account_name

# Optional - Ollama Support  
OLLAMA_BASE_URL=http://localhost:11434

# Optional - Features
DEBUG_MODE=true
ENABLE_TOOL_REINJECTION=true
HTTP_REFERER=your_referer
X_TITLE=your_title
```

## 📁 Project Structure

```
src/
├── index.ts                    # Main server entry point
├── config.ts                   # Environment configuration
├── genericProxy.ts             # Generic endpoint proxy
├── handlers/
│   ├── chatHandler.ts          # Main chat completions handler
│   ├── formatDetector.ts       # Request format detection
│   ├── backendLLM.ts          # Backend API communication
│   ├── streamingHandler.ts    # Stream processing coordination
│   ├── toolCallHandler.ts     # Tool call detection logic
│   ├── azureOpenAIBridge.ts   # Azure OpenAI integration
│   └── stream/                 # Stream processors
│       ├── openaiStreamProcessor.ts
│       ├── ollamaStreamProcessor.ts
│       ├── formatConvertingStreamProcessor.ts
│       └── wrapperAwareStreamProcessor.ts
├── translation/                # Universal translation layer
│   ├── index.ts               # Translation exports
│   ├── engine/
│   │   ├── translator.ts      # Core translation engine
│   │   └── router.ts          # Translation HTTP endpoints
│   ├── converters/            # Provider-specific converters
│   │   ├── base.ts           # Base converter class
│   │   ├── openai-simple.ts  # OpenAI converter
│   │   ├── ollama.ts         # Ollama converter
│   │   └── azure.ts          # Azure converter
│   └── types/                 # Translation type definitions
│       ├── generic.ts         # Universal schema types
│       └── providers.ts       # Provider capabilities
├── utils/
│   ├── formatConverters.ts    # Request/response conversion
│   ├── sseUtils.ts           # Server-sent events utilities
│   ├── xmlUtils.ts           # XML parsing for tool calls
│   ├── logger.ts             # Structured logging
│   └── httpUtils.ts          # HTTP utilities
├── types/
│   ├── index.ts              # Type exports
│   ├── openai.ts             # OpenAI type definitions
│   ├── ollama.ts             # Ollama type definitions
│   └── toolbridge.ts         # Core ToolBridge types
└── test/                     # Comprehensive test suite
    ├── unit/                 # Unit tests
    ├── integration/          # Integration tests
    │   ├── dual-client-*.ts # Dual client support tests
    │   └── azure-bridge-*.ts # Azure bridge tests
    └── utils/                # Test utilities
        └── testHelpers.ts    # Test helper functions

test-servers/                 # Mock servers for testing
├── mock-openai-server.ts     # Mock OpenAI API server
├── mock-ollama-server.ts     # Mock Ollama API server
├── mock-azure-openai-server.ts # Mock Azure OpenAI server
└── comprehensive-format-tests.ts # Format testing suite
```

## 🔧 Configuration Details

### TypeScript Configuration (`tsconfig.json`)
- **Strict Mode**: All strict checks enabled
- **exactOptionalPropertyTypes**: Ultra-strict optional handling
- **ESM Modules**: Modern ES module system
- **Path Mapping**: Clean import paths
- **Test Servers**: Included in compilation

### ESLint Configuration (`eslint.config.js`)
- **Ultra-Strict Rules**: Maximum type safety
- **TypeScript Integration**: @typescript-eslint plugin
- **Import Organization**: Structured import ordering
- **Test File Overrides**: Relaxed rules for test files

Key enforced rules:
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/strict-boolean-expressions`  
- `@typescript-eslint/prefer-nullish-coalescing`
- `@typescript-eslint/prefer-optional-chain`
- Import ordering and organization

## 🧪 Testing Strategy

### Test Infrastructure

#### Mock Servers
- **Mock OpenAI Server** (`test-servers/mock-openai-server.ts`)
  - Port: 3001
  - Endpoints: `/v1/chat/completions`, `/v1/models`, `/health`
  - Features: Streaming, tool calls, multimodal support

- **Mock Ollama Server** (`test-servers/mock-ollama-server.ts`)
  - Port: 11434
  - Endpoints: `/api/chat`, `/api/generate`, `/v1/chat/completions`
  - Features: Native Ollama format, OpenAI compatibility mode

- **Mock Azure Server** (`test-servers/mock-azure-openai-server.ts`)
  - Port: 3003
  - Endpoints: `/openai/deployments/*/chat/completions`
  - Features: Deployment management, Azure-specific extensions

### Test Categories

1. **Unit Tests** (`src/test/unit/`)
   - Individual function testing
   - Format conversion validation
   - Utility function verification

2. **Integration Tests** (`src/test/integration/`)
   - End-to-end proxy functionality
   - Real LLM API integration
   - Stream processing validation
   - Dual client support testing

3. **Pattern Tests** (`src/test/pattern/`)
   - Tool call detection patterns
   - XML parsing edge cases
   - Format conversion scenarios

### Test Execution
```bash
# All tests with coverage
npm test

# Specific test categories
npm run test:unit
npm run test:integration  
npm run test:llm
npm run test:dual-client

# Pattern testing
npm run test:pattern

# Sequential execution (for CI)
npm run test:sequential
```

## 🚀 Major Features (2025)

### 1. Universal Translation Layer
The translation layer provides any-to-any conversion between LLM providers:

```typescript
// Example: Convert OpenAI request to Ollama format
import { translate } from './src/translation';

const result = await translate({
  from: 'openai',
  to: 'ollama',
  request: openAIRequest
});
```

**Supported Conversions:**
- OpenAI ⟷ Ollama
- OpenAI ⟷ Azure
- Ollama ⟷ Azure
- Any future provider via generic schema

### 2. Dual Client Support
ToolBridge works seamlessly with multiple client SDKs:

```typescript
// OpenAI SDK
const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'your-key'
});

// Ollama Client (custom or via test helpers)
const ollama = new OllamaClient({
  baseURL: 'http://localhost:3000',
  apiKey: 'your-key'
});
```

### 3. Azure OpenAI Bridge
Bidirectional bridge between Azure OpenAI and OpenAI APIs:
- Dynamic deployment discovery via Azure ARM
- No hardcoded model mappings
- Streaming support (SSE)
- Azure-specific extensions (data sources, enhancements)

### 4. Tool Call Detection
Advanced XML and JSON tool call detection:
- Real-time streaming detection
- XML format: `<function_name>parameters</function_name>`
- JSON format: Native OpenAI tool_calls field
- Wrapper support: `<toolbridge:calls>` detection
- Partial extraction and buffer management

### 5. Mock Test Servers
Comprehensive testing infrastructure:
- Standalone mock servers for each provider
- Streaming simulation
- Tool call generation
- Error scenario testing
- Performance benchmarking support

## 🔍 Key Features

### Tool Call Detection
- **XML Format**: `<function_name>parameters</function_name>`
- **JSON Format**: Native OpenAI tool_calls field
- **Stream Processing**: Real-time detection during streaming
- **Wrapper Support**: `<toolbridge:calls>` wrapper detection
- **Partial Extraction**: Handle incomplete tool calls gracefully

### Format Conversion
- **Request Conversion**: OpenAI ⟷ Ollama ⟷ Azure transformation
- **Response Conversion**: Bi-directional response formatting
- **Stream Conversion**: Real-time format conversion during streaming
- **Tool Integration**: Seamless tool calling across formats
- **Capability Tracking**: Feature compatibility checking

### Stream Processing
- **Multiple Processors**: Format-specific stream handlers
- **Buffer Management**: Efficient content buffering
- **Tool Call Buffering**: XML content accumulation
- **Error Recovery**: Graceful error handling and fallback
- **Performance Optimization**: Minimal overhead during streaming

## 🔧 Development Workflows

### Adding New Features
1. **Plan**: Update todo list and architectural design
2. **Types**: Define TypeScript interfaces in `src/types/`
3. **Implementation**: Follow existing patterns and conventions
4. **Testing**: Add comprehensive unit and integration tests
5. **Mock Servers**: Update mock servers if needed
6. **Linting**: Ensure ESLint compliance (`npx eslint --fix`)
7. **Type Check**: Verify TypeScript compilation (`npm run type-check`)

### Adding New Provider Support
1. **Create Converter**: Extend `BaseConverter` in `src/translation/converters/`
2. **Define Types**: Add provider types to `src/translation/types/`
3. **Register Converter**: Add to converter registry
4. **Create Mock Server**: Add mock server in `test-servers/`
5. **Add Tests**: Create integration tests for the new provider
6. **Update Documentation**: Document the new provider support

### Code Quality Checklist
- [ ] TypeScript strict mode compliance
- [ ] ESLint ultra-strict rules passing
- [ ] Comprehensive test coverage
- [ ] Import organization and type imports
- [ ] Error handling and logging
- [ ] Mock server implementation
- [ ] Documentation updates

### Debugging
- **Logging**: Structured logging with debug levels
- **Environment**: `DEBUG_MODE=true` for verbose output
- **Stream Debugging**: Individual processor logging
- **Tool Call Tracing**: XML parsing and detection logging
- **Translation Debugging**: Conversion step tracking

## 📊 Performance Considerations

### Stream Processing
- **Buffer Management**: Efficient memory usage during streaming
- **Tool Call Detection**: Optimized XML parsing
- **Format Conversion**: Minimal overhead during conversion
- **Error Recovery**: Fast fallback mechanisms
- **Concurrent Processing**: Support for multiple streams

### Memory Management
- **Buffer Limits**: Configurable buffer sizes
- **Stream Cleanup**: Proper resource cleanup
- **Tool Call Buffering**: Bounded buffer sizes
- **JSON Parsing**: Streaming JSON parser implementation
- **Connection Pooling**: Reuse HTTP connections

## 🛠️ Troubleshooting

### Common Issues

1. **TypeScript Errors**
   ```bash
   npm run type-check  # Check compilation
   npx tsc --noEmit    # Alternative check
   ```

2. **ESLint Issues**
   ```bash
   npx eslint          # Check all files
   npx eslint --fix    # Auto-fix issues
   ```

3. **Stream Processing Issues**
   - Enable `DEBUG_MODE=true`
   - Check tool call detection logs
   - Verify XML format compliance
   - Review buffer sizes

4. **Format Conversion Issues**
   - Verify backend format configuration
   - Check request/response format detection
   - Review conversion utility logs
   - Test with mock servers first

5. **Mock Server Issues**
   - Ensure correct ports are used
   - Check server startup logs
   - Verify TypeScript compilation includes test-servers
   - Test endpoints with curl or Postman

### Configuration Validation
```bash
# Test configuration
npm run dev

# Check environment variables
node -e "console.log(process.env)"

# Test with mock servers
node dist/src/test/quick-server-test.js
```

## 📈 Metrics and Monitoring

### Development Metrics
- **TypeScript Coverage**: 100%
- **ESLint Compliance**: Full ultra-strict enforcement
- **Test Coverage**: 209+ passing tests
- **Build Success**: Zero compilation errors
- **Mock Servers**: 3 fully functional test servers

### Runtime Metrics
- **Stream Processing**: Real-time tool call detection
- **Format Conversion**: Bi-directional OpenAI ⟷ Ollama ⟷ Azure
- **Tool Call Success**: XML and JSON parsing accuracy
- **Error Recovery**: Graceful degradation and fallback
- **Client Compatibility**: OpenAI SDK and Ollama client support

## 🔐 Security Considerations

### API Key Management
- Environment-based configuration
- No hardcoded credentials
- Backend API key forwarding
- Client authorization passthrough
- Azure service principal support

### Request Validation
- Input sanitization
- Format validation
- Tool call verification
- Stream processing security
- Size limits enforcement

### Error Handling
- Secure error messages
- No sensitive data exposure
- Graceful error recovery
- Comprehensive logging
- Stack trace sanitization

## 📚 Additional Resources

### Documentation
- TypeScript handbook for strict mode
- ESLint TypeScript configuration
- Express.js streaming documentation
- OpenAI API documentation
- Ollama API documentation
- Azure OpenAI documentation

### Tools and Utilities
- **TypeScript**: Strict type checking
- **ESLint**: Ultra-strict code quality
- **Mocha/Chai**: Testing framework
- **Axios**: HTTP client for backend APIs
- **Express**: Web framework
- **OpenAI SDK**: Official OpenAI client
- **Mock Servers**: Testing infrastructure

### Related Projects
- LiteLLM: Universal LLM proxy
- Dev Proxy: Microsoft's API simulation tool
- Ollama: Local LLM runner
- Azure OpenAI Service: Enterprise LLM platform

---

**Last Updated**: January 2025  
**Version**: 2.0.0  
**Status**: Production Ready  
**Maintainer**: ToolBridge Development Team

This document serves as the complete development guide for ToolBridge. Keep it updated as the project evolves.