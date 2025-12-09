import type {
    FinishReason,
    Logprobs,
    ReasoningDetail,
    Usage as BaseUsage,
    ToolCall as CompletionToolCall,
    CompletionTokensDetails as CompletionTokensDetailsBase,
    PromptTokensDetails as PromptTokensDetailsBase,
    CostDetails as CostDetailsBase
} from "./chat-completion.js";

export interface ChatCompletionStreamChunk {
    id: string;
    provider?: string;
    model: string;
    object: string;
    created: number;
    choices: Choice[];
    usage?: Usage;
    [key: string]: unknown;
}

export interface Choice {
    index: number;
    delta: Delta;
    finish_reason?: FinishReason;
    native_finish_reason?: string | null;
    logprobs?: Logprobs | null;
    [key: string]: unknown;
}

export interface Delta {
    role?: string;
    content?: string | null;
    tool_calls?: StreamToolCall[];
    refusal?: string | null;
    reasoning?: string | null;
    reasoning_details?: ReasoningDetail[];
    [key: string]: unknown;
}

export interface StreamToolCall {
    index?: number;
    id?: string;
    type?: "function" | string;
    function?: StreamToolFunction;
    [key: string]: unknown;
}

export interface StreamToolFunction {
    name?: string;
    arguments?: string | Record<string, unknown>;
    [key: string]: unknown;
}

export type Usage = BaseUsage;
export type CompletionTokensDetails = CompletionTokensDetailsBase;
export type PromptTokensDetails = PromptTokensDetailsBase;
export type CostDetails = CostDetailsBase;
export type ToolCall = CompletionToolCall;
