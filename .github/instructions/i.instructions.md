---
applyTo: '**'
---
# CLAUDE.md - ToolBridge Development Guide

## 🚀 Project Overview

**ToolBridge** is a sophisticated OpenAI Tool Proxy Server that enables seamless function calling between different LLM backends (OpenAI, Ollama) with advanced stream processing, format conversion, and XML/JSON tool call detection.

### Current Status (2025)
- ✅ **100% TypeScript** - Complete migration with strict type safety
- ✅ **Ultra-Strict ESLint** - Maximum code quality enforcement
- ✅ **Zero TypeScript Errors** - Full compilation success
- ✅ **DRY/SSOT/Type Safety** - Architectural principles enforced
- ✅ **Advanced Stream Processing** - Real-time tool call detection
- ✅ **Multi-Format Support** - OpenAI ⟷ Ollama conversion

## 🏗️ Architecture

### Core Components

1. **Entry Point**: `src/index.ts` - Express server with health endpoints
2. **Chat Handler**: `src/handlers/chatHandler.ts` - Main request processing
3. **Stream Processors**: Real-time tool call detection and formatting
4. **Format Converters**: Bi-directional OpenAI ⟷ Ollama conversion
5. **Configuration**: Environment-based setup with validation

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

### Stream Processors

- **OpenAIStreamProcessor**: Handles OpenAI streaming format
- **OllamaStreamProcessor**: Handles Ollama streaming format  
- **FormatConvertingStreamProcessor**: Cross-format conversion
- **WrapperAwareStreamProcessor**: XML wrapper detection

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
```

### Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required
BACKEND_LLM_BASE_URL=https://api.openai.com/v1
BACKEND_LLM_API_KEY=your_api_key
PROXY_HOST=localhost
PROXY_PORT=3000

# Optional  
OLLAMA_BASE_URL=http://localhost:11434
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
│   └── stream/                 # Stream processors
│       ├── openaiStreamProcessor.ts
│       ├── ollamaStreamProcessor.ts
│       ├── formatConvertingStreamProcessor.ts
│       └── wrapperAwareStreamProcessor.ts
├── utils/
│   ├── formatConverters.ts    # Request/response conversion
│   ├── sseUtils.ts           # Server-sent events utilities
│   ├── xmlUtils.ts           # XML parsing for tool calls
│   ├── logger.ts             # Structured logging
│   └── format/               # Format-specific converters
│       ├── openai/
│       └── ollama/
├── types/
│   ├── index.ts              # Type exports
│   ├── openai.ts             # OpenAI type definitions
│   ├── ollama.ts             # Ollama type definitions
│   └── toolbridge.ts         # Core ToolBridge types
└── test/                     # Comprehensive test suite
    ├── unit/                 # Unit tests
    ├── integration/          # Integration tests
    └── utils/                # Test utilities
```

## 🔧 Configuration Details

### TypeScript Configuration (`tsconfig.json`)
- **Strict Mode**: All strict checks enabled
- **exactOptionalPropertyTypes**: Ultra-strict optional handling
- **ESM Modules**: Modern ES module system
- **Path Mapping**: Clean import paths

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

### Test Categories

1. **Unit Tests** (`src/test/unit/`)
   - Individual function testing
   - Format conversion validation
   - Utility function verification

2. **Integration Tests** (`src/test/integration/`)
   - End-to-end proxy functionality
   - Real LLM API integration
   - Stream processing validation

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

# Pattern testing
npm run test:pattern

# Sequential execution (for CI)
npm run test:sequential
```

## 🚀 Recent Major Improvements (2025)

### 1. Complete TypeScript Migration
- **Before**: Mixed JS/TS codebase with type issues
- **After**: 100% TypeScript with strict type safety
- **Impact**: Zero compilation errors, enhanced developer experience

### 2. Ultra-Strict ESLint Configuration
- **Rules**: 1000+ issues detected and enforced
- **Benefits**: Consistent code style, null safety, import organization
- **Auto-fixes**: 176+ automatically fixable issues

### 3. Architecture Enhancements
- **Stream Processing**: Advanced real-time tool call detection
- **Format Conversion**: Bi-directional OpenAI ⟷ Ollama support
- **XML Processing**: Robust tool call extraction from XML content

### 4. Code Quality Standards
- **DRY Principle**: Don't Repeat Yourself
- **SSOT**: Single Source of Truth
- **Type Safety**: Full TypeScript strict mode
- **Import Organization**: Structured import ordering

## 🔍 Key Features

### Tool Call Detection
- **XML Format**: `<function_name>parameters</function_name>`
- **JSON Format**: Native OpenAI tool_calls field
- **Stream Processing**: Real-time detection during streaming
- **Wrapper Support**: `<toolbridge:calls>` wrapper detection

### Format Conversion
- **Request Conversion**: OpenAI ⟷ Ollama format transformation
- **Response Conversion**: Bi-directional response formatting
- **Stream Conversion**: Real-time format conversion during streaming
- **Tool Integration**: Seamless tool calling across formats

### Stream Processing
- **Multiple Processors**: Format-specific stream handlers
- **Buffer Management**: Efficient content buffering
- **Tool Call Buffering**: XML content accumulation
- **Error Recovery**: Graceful error handling and fallback

## 🔧 Development Workflows

### Adding New Features
1. **Plan**: Update todo list and architectural design
2. **Types**: Define TypeScript interfaces in `src/types/`
3. **Implementation**: Follow existing patterns and conventions
4. **Testing**: Add comprehensive unit and integration tests
5. **Linting**: Ensure ESLint compliance (`npx eslint --fix`)
6. **Type Check**: Verify TypeScript compilation (`npm run type-check`)

### Code Quality Checklist
- [ ] TypeScript strict mode compliance
- [ ] ESLint ultra-strict rules passing
- [ ] Comprehensive test coverage
- [ ] Import organization and type imports
- [ ] Error handling and logging
- [ ] Documentation updates

### Debugging
- **Logging**: Structured logging with debug levels
- **Environment**: `DEBUG_MODE=true` for verbose output
- **Stream Debugging**: Individual processor logging
- **Tool Call Tracing**: XML parsing and detection logging

## 📊 Performance Considerations

### Stream Processing
- **Buffer Management**: Efficient memory usage during streaming
- **Tool Call Detection**: Optimized XML parsing
- **Format Conversion**: Minimal overhead during conversion
- **Error Recovery**: Fast fallback mechanisms

### Memory Management
- **Buffer Limits**: Configurable buffer sizes
- **Stream Cleanup**: Proper resource cleanup
- **Tool Call Buffering**: Bounded buffer sizes
- **JSON Parsing**: Streaming JSON parser implementation

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

4. **Format Conversion Issues**
   - Verify backend format configuration
   - Check request/response format detection
   - Review conversion utility logs

### Configuration Validation
```bash
# Test configuration
npm run dev

# Check environment variables
node -e "console.log(process.env)"
```

## 📈 Metrics and Monitoring

### Development Metrics
- **TypeScript Coverage**: 100%
- **ESLint Issues**: ~1000 detected (shows strict enforcement)
- **Test Coverage**: Comprehensive unit and integration tests
- **Build Success**: Zero compilation errors

### Runtime Metrics
- **Stream Processing**: Real-time tool call detection
- **Format Conversion**: Bi-directional OpenAI ⟷ Ollama
- **Tool Call Success**: XML and JSON parsing accuracy
- **Error Recovery**: Graceful degradation and fallback

## 🔐 Security Considerations

### API Key Management
- Environment-based configuration
- No hardcoded credentials
- Backend API key forwarding
- Client authorization passthrough

### Request Validation
- Input sanitization
- Format validation
- Tool call verification
- Stream processing security

### Error Handling
- Secure error messages
- No sensitive data exposure
- Graceful error recovery
- Comprehensive logging

## 📚 Additional Resources

### Documentation
- TypeScript handbook for strict mode
- ESLint TypeScript configuration
- Express.js streaming documentation
- OpenAI API documentation
- Ollama API documentation

### Tools and Utilities
- **TypeScript**: Strict type checking
- **ESLint**: Ultra-strict code quality
- **Mocha/Chai**: Testing framework
- **Axios**: HTTP client for backend APIs
- **Express**: Web framework

---

**Last Updated**: January 2025  
**Status**: Production Ready  
**Maintainer**: ToolBridge Development Team

This document serves as the complete development guide for ToolBridge. Keep it updated as the project evolves.