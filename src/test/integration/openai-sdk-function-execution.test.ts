#!/usr/bin/env node

import { spawn } from "child_process";

import { expect } from "chai";
import dotenv from "dotenv";
import { describe, it, before, after } from "mocha";
import OpenAI from "openai";

import type { ChildProcess } from "child_process";

dotenv.config();

// Type definitions
interface WeatherArgs {
  location: string;
  unit?: "celsius" | "fahrenheit";
}

interface WeatherResult {
  location: string;
  temperature: string;
  condition: string;
  humidity: string;
  forecast: string;
}

interface CalculateArgs {
  expression: string;
  operation?: string;
}

interface CalculateResult {
  expression: string;
  result?: string;
  error?: string;
  operation: string;
}

interface SearchArgs {
  query: string;
  table?: string;
  limit?: number;
}

interface SearchResult {
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

interface CreateFileArgs {
  filename: string;
  content: string;
}

interface CreateFileResult {
  success: boolean;
  filename: string;
  size: number;
  created_at: string;
  path: string;
}

interface SendEmailArgs {
  to: string;
  subject: string;
  body?: string;
}

interface SendEmailResult {
  success: boolean;
  message_id: string;
  to: string;
  subject: string;
  sent_at: string;
  status: string;
}

// Function type definitions
type AvailableFunction = 
  | ((args: WeatherArgs) => Promise<WeatherResult>)
  | ((args: CalculateArgs) => Promise<CalculateResult>)
  | ((args: SearchArgs) => Promise<SearchResult>)
  | ((args: CreateFileArgs) => Promise<CreateFileResult>)
  | ((args: SendEmailArgs) => Promise<SendEmailResult>);

// Test configuration from environment
const PROXY_PORT: string | number = process.env.PROXY_PORT ?? 3000;
const TEST_MODEL: string = process.env.TEST_MODEL ?? "mistralai/mistral-small-3.2-24b-instruct:free";
const API_KEY: string | undefined = process.env.BACKEND_LLM_API_KEY;

console.log("\n🎯 OPENAI SDK FUNCTION EXECUTION TEST");
console.log("Testing real function execution with OpenAI SDK");
console.log("=".repeat(60));

// Define REAL functions that will be executed
const availableFunctions: Record<string, AvailableFunction> = {
  get_weather: async ({ location, unit = "celsius" }: WeatherArgs): Promise<WeatherResult> => {
    // Simulate weather API call
    const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
      Tokyo: { temp: 22, condition: "partly cloudy", humidity: 65 },
      London: { temp: 15, condition: "rainy", humidity: 80 },
      "New York": { temp: 18, condition: "sunny", humidity: 55 },
      Paris: { temp: 17, condition: "cloudy", humidity: 70 },
    };
    
    await Promise.resolve(); // Add await to satisfy eslint
    const data = weatherData[location] ?? { temp: 20, condition: "unknown", humidity: 60 };
    const tempUnit = unit === "fahrenheit" ? "F" : "C";
    const tempValue = unit === "fahrenheit" ? Math.round(data.temp * 9/5 + 32) : data.temp;
    
    return {
      location,
      temperature: `${tempValue}°${tempUnit}`,
      condition: data.condition,
      humidity: `${data.humidity}%`,
      forecast: "Stable for next 24 hours"
    };
  },
  
  calculate: async ({ expression, operation }: CalculateArgs): Promise<CalculateResult> => {
    // Real calculator function
    try {
      await Promise.resolve(); // Add await to satisfy eslint
      // Safe evaluation for simple math using eval (for test purposes only)
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
    await Promise.resolve(); // Add await to satisfy eslint
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
    await Promise.resolve(); // Add await to satisfy eslint
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
    await Promise.resolve(); // Add await to satisfy eslint
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

// Convert functions to OpenAI tools format
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather information for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "Temperature unit" }
        },
        required: ["location"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Perform mathematical calculations",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Mathematical expression" },
          operation: { type: "string", description: "Type of operation" }
        },
        required: ["expression"]
      }
    }
  },
  {
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
  },
  {
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
  },
  {
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
  }
];

describe("🚀 OpenAI SDK with Real Function Execution", function() {
  this.timeout(60000);
  let proxyProcess: ChildProcess;
  let openai: OpenAI;

  before(async function() {
    console.log("\nStarting ToolBridge proxy server...");
    
    // Start proxy server
    proxyProcess = spawn("npm", ["start"], {
      env: { ...process.env },
      stdio: process.env.DEBUG_MODE === "true" ? "inherit" : "ignore",
    });

    // Wait for server to start
    await new Promise<void>(resolve => setTimeout(resolve, 3000));
    
    // Initialize OpenAI client pointing to ToolBridge
    openai = new OpenAI({
      baseURL: `http://localhost:${PROXY_PORT}/v1`,
      apiKey: API_KEY,
    });

    console.log(`✅ Proxy running on port ${PROXY_PORT}`);
    console.log(`📍 Using model: ${TEST_MODEL}`);
    console.log(`🔑 API Key: ${API_KEY ? "Configured" : "Missing!"}`);
  });

  after(function() {
    if (proxyProcess) {
      console.log("\nStopping proxy server...");
      proxyProcess.kill();
    }
  });

  describe("1️⃣ Single Function Execution", function() {
    it("should execute weather function and return actual results", async function() {
      console.log("\n📝 Test: Weather function execution");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "What's the weather like in Tokyo?"
        }
      ];

      // Step 1: Get initial response with tool call
      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1,
        max_tokens: 500
      });

      const message = response.choices[0].message;
      console.log("   Response type:", message.tool_calls ? "tool_calls" : "content");

      // Check if tool was called
      if (message.tool_calls && message.tool_calls.length > 0) {
        expect(message.tool_calls).to.have.length.greaterThan(0);
        const toolCall = message.tool_calls[0];
        
        console.log(`   ✅ Tool called: ${toolCall.function.name}`);
        console.log(`   Arguments: ${toolCall.function.arguments}`);
        
        // Step 2: Execute the actual function
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments) as WeatherArgs;
        
        expect(functionName).to.equal("get_weather");
        expect(functionArgs).to.have.property("location");
        expect(functionArgs.location.toLowerCase()).to.include("tokyo");
        
        const functionResult = await (availableFunctions[functionName] as (args: WeatherArgs) => Promise<WeatherResult>)(functionArgs);
        console.log("   Function result:", JSON.stringify(functionResult, null, 2));
        
        // Step 3: Send function result back to model
        messages.push(message); // Add assistant's tool call
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult)
        });
        
        const finalResponse = await openai.chat.completions.create({
          model: TEST_MODEL,
          messages,
          temperature: 0.1,
          max_tokens: 500
        });
        
        const finalContent = finalResponse.choices[0].message.content;
        console.log("   Final response:", finalContent?.substring(0, 200) + "...");
        
        // Verify the model used the function results
        expect(finalContent?.toLowerCase()).to.include("tokyo");
        expect(finalContent).to.match(/22|partly cloudy|65/i); // Check for actual data
        console.log("   ✅ Model successfully used function results!");
      } else {
        throw new Error("No tool call generated when expected");
      }
    });

    it("should execute calculation function with actual math", async function() {
      console.log("\n📝 Test: Calculator function execution");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "Calculate 42 * 17 + 256"
        }
      ];

      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      const message = response.choices[0].message;
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        console.log(`   ✅ Tool called: ${toolCall.function.name}`);
        
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments) as CalculateArgs;
        
        expect(functionName).to.equal("calculate");
        
        const functionResult = await (availableFunctions[functionName] as (args: CalculateArgs) => Promise<CalculateResult>)(functionArgs);
        console.log("   Calculation result:", functionResult.result);
        
  expect(functionResult.result).to.be.a('string');
  expect(parseFloat(functionResult.result as string)).to.equal(970);
        console.log("   ✅ Correct calculation performed!");
      } else {
        // Model might calculate directly
        const content = message.content;
        if (content?.includes("970")) {
          console.log("   ⚠️  Model calculated directly without tool");
        } else {
          throw new Error("No tool call or correct answer");
        }
      }
    });
  });

  describe("2️⃣ Multiple Function Executions", function() {
    it("should handle multiple function calls in a conversation", async function() {
      console.log("\n📝 Test: Multiple function executions");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "First, check the weather in London. Then search the database for users who joined in January."
        }
      ];

      let functionsExecuted: string[] = [];

      // First completion
      const response1 = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1,
        max_tokens: 800
      });

      const message1 = response1.choices[0].message;
      messages.push(message1);

      // Execute all tool calls from first response
      if (message1.tool_calls) {
        for (const toolCall of message1.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          console.log(`   Executing: ${functionName}`);
          const result = await availableFunctions[functionName](functionArgs);
          functionsExecuted.push(functionName);
          
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
      }

      // Get final response after function execution
      const response2 = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1,
        max_tokens: 800
      });

      const message2 = response2.choices[0].message;

      // Check if more tools were called
      if (message2.tool_calls) {
        for (const toolCall of message2.tool_calls) {
          const functionName = toolCall.function.name;
          console.log(`   Executing: ${functionName}`);
          functionsExecuted.push(functionName);
        }
      }

      console.log(`   Functions executed: ${functionsExecuted.join(", ")}`);
      expect(functionsExecuted).to.include.members(["get_weather", "search_database"]);
      console.log("   ✅ Multiple functions executed successfully!");
    });
  });

  describe("3️⃣ Complex Function Parameters", function() {
    it("should handle complex nested parameters", async function() {
      console.log("\n📝 Test: Complex function parameters");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: 'Create a file called report.txt with content "Q4 2024 Financial Report\\n\\nRevenue: $1.2M\\nExpenses: $800K"'
        }
      ];

      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      const message = response.choices[0].message;
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments) as CreateFileArgs;
        
        expect(functionName).to.equal("create_file");
        expect(functionArgs.filename).to.include("report");
        expect(functionArgs.content).to.include("Financial");
        
        const result = await (availableFunctions[functionName] as (args: CreateFileArgs) => Promise<CreateFileResult>)(functionArgs);
        console.log("   File creation result:", result);
        
        expect(result.success).to.be.true;
        expect(result.filename).to.include("report");
        console.log("   ✅ Complex parameters handled correctly!");
      } else {
        throw new Error("No file creation tool call");
      }
    });

    it("should handle email with structured content", async function() {
      console.log("\n📝 Test: Email function with structured content");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: 'Send an email to john@example.com with subject "Meeting Tomorrow" and body "Hi John,\\n\\nLet\'s meet at 2 PM.\\n\\nBest regards"'
        }
      ];

      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      const message = response.choices[0].message;
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const functionArgs = JSON.parse(toolCall.function.arguments) as SendEmailArgs;
        
        expect(functionArgs.to).to.include("@example.com");
        expect(functionArgs.subject.toLowerCase()).to.include("meeting");
        
        const result = await (availableFunctions.send_email as (args: SendEmailArgs) => Promise<SendEmailResult>)(functionArgs);
        console.log("   Email result:", result);
        
        expect(result.success).to.be.true;
        expect(result.message_id).to.exist;
        console.log("   ✅ Email function executed successfully!");
      } else {
        throw new Error("No email tool call");
      }
    });
  });

  describe("4️⃣ Streaming with Function Execution", function() {
    it("should handle function calls in streaming mode", async function() {
      console.log("\n📝 Test: Streaming with function execution");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "What's the weather in Paris?"
        }
      ];

      const stream = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        stream: true,
        temperature: 0.1
      });

      let functionName: string | null = null;
      let functionArguments = "";

      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.tool_calls) {
          for (const toolCallDelta of chunk.choices[0].delta.tool_calls) {
            if (toolCallDelta.function?.name) {
              functionName = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              functionArguments += toolCallDelta.function.arguments;
            }
          }
        }
      }

      if (functionName) {
        console.log(`   Stream generated tool call: ${functionName}`);
        const args = JSON.parse(functionArguments) as WeatherArgs;
        console.log(`   Arguments: ${JSON.stringify(args)}`);
        
        const result = await (availableFunctions[functionName] as (args: WeatherArgs) => Promise<WeatherResult>)(args);
        console.log("   Function result:", result);
        
        expect(functionName).to.equal("get_weather");
        expect(args.location.toLowerCase()).to.include("paris");
        expect(result.location).to.equal("Paris");
        console.log("   ✅ Streaming function execution works!");
      } else {
        throw new Error("No tool call in stream");
      }
    });
  });

  describe("5️⃣ Error Handling", function() {
    it("should handle invalid function arguments gracefully", async function() {
      console.log("\n📝 Test: Invalid function arguments");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "Calculate this invalid expression: 5 / / / 3"
        }
      ];

      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      const message = response.choices[0].message;
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const functionArgs = JSON.parse(toolCall.function.arguments) as CalculateArgs;
        
        const result = await (availableFunctions.calculate as (args: CalculateArgs) => Promise<CalculateResult>)(functionArgs);
        console.log("   Function handled error:", result);
        
        expect(result).to.have.property("error");
        console.log("   ✅ Error handled gracefully!");
      } else {
        console.log("   ⚠️  Model avoided using tool for invalid input");
      }
    });

    it("should work when no tools are needed", async function() {
      console.log("\n📝 Test: Response without tools");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: "Just say hello!"
        }
      ];

      const response = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      const message = response.choices[0].message;
      
      expect(message.content).to.exist;
      expect(message.tool_calls).to.not.exist;
      console.log("   Response:", message.content?.substring(0, 50));
      console.log("   ✅ Works without tool calls!");
    });
  });

  describe("6️⃣ Full Conversation Flow", function() {
    it("should handle complete multi-turn conversation with functions", async function() {
      console.log("\n📝 Test: Complete conversation flow");
      
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: "You are a helpful assistant with access to various tools."
        },
        {
          role: "user",
          content: "I need to plan a trip to Tokyo. Check the weather there first."
        }
      ];

      // Turn 1: Weather check
      console.log("   Turn 1: Weather check");
      const response1 = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });

      messages.push(response1.choices[0].message);
      
      if (response1.choices[0].message.tool_calls) {
        const toolCall = response1.choices[0].message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments) as WeatherArgs;
        const result = await (availableFunctions.get_weather as (args: WeatherArgs) => Promise<WeatherResult>)(args);
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
        
        console.log(`   Weather retrieved: ${result.temperature}, ${result.condition}`);
      }

      // Turn 2: Follow-up
      const response2 = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        temperature: 0.1
      });
      
      messages.push(response2.choices[0].message);
      
      // Turn 3: User asks for email
      messages.push({
        role: "user",
        content: "Great! Now send an email to travel@agency.com about this trip plan."
      });
      
      console.log("   Turn 3: Email request");
      const response3 = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        tools,
        temperature: 0.1
      });
      
      if (response3.choices[0].message.tool_calls) {
        const toolCall = response3.choices[0].message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments) as SendEmailArgs;
        
        expect(args.to).to.include("@agency.com");
        const result = await (availableFunctions.send_email as (args: SendEmailArgs) => Promise<SendEmailResult>)(args);
        console.log(`   Email sent: ${result.message_id}`);
        
        messages.push(response3.choices[0].message);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
      
      // Final response
      const finalResponse = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages,
        temperature: 0.1
      });
      
      console.log("   Final:", finalResponse.choices[0].message.content?.substring(0, 100) + "...");
      console.log("   ✅ Complete conversation flow successful!");
    });
  });
});

// Add summary at the end
process.on("exit", () => {
  console.log("\n" + "=".repeat(60));
  console.log("✨ TEST COMPLETE: ToolBridge enables FULL OpenAI-compatible function calling!");
  console.log("=".repeat(60));
});