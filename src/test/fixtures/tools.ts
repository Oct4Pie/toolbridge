/**
 * SHARED TOOL FIXTURES FOR INTEGRATION TESTS
 *
 * SSOT for all test tool definitions to eliminate duplication.
 * All integration tests should import tools from this file.
 */

import type OpenAI from 'openai';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface WeatherArgs {
  location: string;
  unit?: "celsius" | "fahrenheit";
}

export interface WeatherResult {
  location: string;
  temperature: string;
  condition: string;
  humidity: string;
  forecast: string;
}

export interface CalculateArgs {
  expression: string;
  operation?: string;
  a?: number;
  b?: number;
}

export interface CalculateResult {
  expression: string;
  result?: string;
  error?: string;
  operation: string;
}

export interface SearchArgs {
  query: string;
  table?: string;
  limit?: number;
}

export interface SearchResult {
  query: string;
  table: string;
  total_results: number;
  results: Array<{
    id: number;
    name: string;
    email: string;
    joined: string;
    matched: string;
  }>;
}

export interface CreateFileArgs {
  filename: string;
  content: string;
}

export interface CreateFileResult {
  success: boolean;
  filename: string;
  size: number;
  created_at: string;
  path: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  body?: string;
}

export interface SendEmailResult {
  success: boolean;
  message_id: string;
  to: string;
  subject: string;
  sent_at: string;
  status: string;
}

// ============================================================================
// TOOL DEFINITIONS (OpenAI Format)
// ============================================================================

/**
 * Weather tool - Get current weather information for a location
 */
export const weatherTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather information for a location",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state, e.g. San Francisco, CA"
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "Temperature unit"
        }
      },
      required: ["location"]
    }
  }
};

/**
 * Calculator tool - Perform mathematical calculations
 */
export const calculatorTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"]
        },
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
        expression: {
          type: "string",
          description: "The mathematical expression to evaluate"
        }
      },
      required: []
    }
  }
};

/**
 * Database search tool - Search the database
 */
export const searchDatabaseTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_database",
    description: "Search the database",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        table: { type: "string", description: "Database table" },
        limit: { type: "number", description: "Maximum results" }
      },
      required: ["query"]
    }
  }
};

/**
 * File creation tool - Create a new file with content
 */
export const createFileTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_file",
    description: "Create a new file with content",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Name of the file" },
        content: { type: "string", description: "File content" }
      },
      required: ["filename", "content"]
    }
  }
};

/**
 * Email tool - Send an email
 */
export const sendEmailTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_email",
    description: "Send an email",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" }
      },
      required: ["to", "subject"]
    }
  }
};

// ============================================================================
// TOOL COLLECTIONS
// ============================================================================

/**
 * Basic tools - Weather and calculator (most commonly used)
 */
export const basicTools = [weatherTool, calculatorTool];

/**
 * All tools - Complete set for comprehensive testing
 */
export const allTools = [
  weatherTool,
  calculatorTool,
  searchDatabaseTool,
  createFileTool,
  sendEmailTool
];

// ============================================================================
// FUNCTION IMPLEMENTATIONS (For execution tests)
// ============================================================================

/**
 * Type for available function implementations
 */
export type AvailableFunction =
  | ((args: WeatherArgs) => Promise<WeatherResult>)
  | ((args: CalculateArgs) => Promise<CalculateResult>)
  | ((args: SearchArgs) => Promise<SearchResult>)
  | ((args: CreateFileArgs) => Promise<CreateFileResult>)
  | ((args: SendEmailArgs) => Promise<SendEmailResult>);

/**
 * Function implementations for testing real execution
 */
const WEATHER_PROFILES: Array<{
  displayName: string;
  aliases: string[];
  tempC: number;
  condition: string;
  humidity: number;
}> = [
  {
    displayName: "Tokyo",
    aliases: ["tokyo", "tokyo, japan"],
    tempC: 22,
    condition: "partly cloudy",
    humidity: 65,
  },
  {
    displayName: "London",
    aliases: ["london", "london, uk", "london, england"],
    tempC: 15,
    condition: "rainy",
    humidity: 80,
  },
  {
    displayName: "New York",
    aliases: ["new york", "new york city", "nyc", "new york, usa"],
    tempC: 18,
    condition: "sunny",
    humidity: 55,
  },
  {
    displayName: "Paris",
    aliases: ["paris", "paris, france"],
    tempC: 17,
    condition: "cloudy",
    humidity: 70,
  },
  {
    displayName: "San Francisco",
    aliases: ["san francisco", "sf", "san francisco, ca", "san francisco, california"],
    tempC: 16,
    condition: "foggy",
    humidity: 75,
  },
];

const resolveWeatherProfile = (rawLocation: string) => {
  const normalized = rawLocation.trim().toLowerCase();
  const candidates = [normalized, normalized.split(",")[0]?.trim()].filter(Boolean) as string[];

  for (const profile of WEATHER_PROFILES) {
    if (profile.aliases.some(alias => candidates.some(candidate => candidate === alias || candidate.includes(alias)))) {
      return profile;
    }
  }

  return null;
};

export const availableFunctions: Record<string, AvailableFunction> = {
  get_weather: async ({ location, unit = "celsius" }: WeatherArgs): Promise<WeatherResult> => {
    await Promise.resolve(); // Make async

    const profile = resolveWeatherProfile(location);
    const displayLocation = profile?.displayName ?? location;
    const tempC = profile?.tempC ?? 20;
    const condition = profile?.condition ?? "unknown";
    const humidityValue = profile?.humidity ?? 60;

    const tempUnit = unit === "fahrenheit" ? "F" : "C";
    const tempValue = unit === "fahrenheit" ? Math.round(tempC * 9/5 + 32) : tempC;

    return {
      location: displayLocation,
      temperature: `${tempValue}°${tempUnit}`,
      condition,
      humidity: `${humidityValue}%`,
      forecast: "Stable for next 24 hours"
    };
  },

  calculate: async ({ expression, operation, a, b }: CalculateArgs): Promise<CalculateResult> => {
    // Real calculator function
    try {
      await Promise.resolve(); // Make async

      // If explicit operation with a/b
      if (operation && a !== undefined && b !== undefined) {
        let result: number;
        switch (operation) {
          case "add": result = a + b; break;
          case "subtract": result = a - b; break;
          case "multiply": result = a * b; break;
          case "divide": result = b !== 0 ? a / b : NaN; break;
          default: throw new Error("Invalid operation");
        }
        return {
          expression: `${a} ${operation} ${b}`,
          result: result.toString(),
          operation: operation ?? "calculation"
        };
      }

      // Otherwise evaluate expression
      const cleanExpr = expression.replace(/[^0-9+\-*/().\s]/g, "");
      // eslint-disable-next-line no-eval
      const result = eval(cleanExpr);
      return {
        expression,
        result: result.toString(),
        operation: operation ?? "calculation"
      };
    } catch (_error: unknown) {
      return {
        expression,
        error: "Invalid expression",
        operation: operation ?? "calculation"
      };
    }
  },

  search_database: async ({ query, table, limit = 10 }: SearchArgs): Promise<SearchResult> => {
    // Simulate database search
    await Promise.resolve();
    const mockResults = [];
    for (let i = 1; i <= Math.min(limit, 5); i++) {
      mockResults.push({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        joined: "2024-01-" + String(i).padStart(2, "0"),
        matched: query.toLowerCase()
      });
    }

    return {
      query,
      table: table ?? "users",
      total_results: mockResults.length,
      results: mockResults
    };
  },

  create_file: async ({ filename, content }: CreateFileArgs): Promise<CreateFileResult> => {
    // Simulate file creation (don't actually create files in tests)
    await Promise.resolve();
    return {
      success: true,
      filename,
      size: content.length,
      created_at: new Date().toISOString(),
      path: `/virtual/test/${filename}`
    };
  },

  send_email: async ({ to, subject, body: _body }: SendEmailArgs): Promise<SendEmailResult> => {
    // Simulate email sending
    await Promise.resolve();
    return {
      success: true,
      message_id: `msg_${Date.now()}`,
      to,
      subject,
      sent_at: new Date().toISOString(),
      status: "queued"
    };
  }
};
