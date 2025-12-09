export type FinishReason =
    | "stop"
    | "length"
    | "tool_calls"
    | "function_call"
    | "content_filter"
    | string
    | null;

export interface ChatCompletionResponse {
    id: string;
    provider: string;
    model: string;
    object: string;
    created: number;
    choices: Choice[];
    system_fingerprint?: string | null;
    usage?: Usage;
    [key: string]: unknown;
}

export interface Choice {
    index: number;
    message: Message;
    finish_reason: FinishReason;
    native_finish_reason?: string | null;
    logprobs?: Logprobs | null;
    [key: string]: unknown;
}

export interface Message {
    role: string;
    content: string | null;
    refusal?: string | null;
    reasoning?: string | null;
    reasoning_details?: ReasoningDetail[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    [key: string]: unknown;
}

export interface ReasoningDetail {
    type: string;
    text: string;
    format: string;
    index: number;
    [key: string]: unknown;
}

export interface ToolCall {
    function: Function;
    id?: string;
    index?: number;
    type?: string;
    [key: string]: unknown;
}

export interface Function {
    arguments: string;
    name: string;
    [key: string]: unknown;
}

export interface Usage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: PromptTokensDetails | null;
    completion_tokens_details?: CompletionTokensDetails | null;
    cost?: number;
    is_byok?: boolean;
    cost_details?: CostDetails | null;
    [key: string]: unknown;
}

export interface PromptTokensDetails {
    cached_tokens?: number;
    audio_tokens?: number;
    video_tokens?: number;
    [key: string]: number | undefined;
}

export interface CompletionTokensDetails {
    reasoning_tokens?: number;
    image_tokens?: number;
    audio_tokens?: number;
    [key: string]: number | undefined;
}

export interface CostDetails {
    upstream_inference_cost?: number | null;
    upstream_inference_prompt_cost?: number | null;
    upstream_inference_completions_cost?: number | null;
    [key: string]: number | null | undefined;
}

export type Logprobs = unknown;
