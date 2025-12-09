export interface ModelsListResponse {
    data: Datum[];
}

export interface Datum {
    id:                   string;
    canonical_slug:       string;
    hugging_face_id:      null | string;
    name:                 string;
    created:              number;
    description:          string;
    context_length:       number;
    architecture:         Architecture;
    pricing:              Pricing;
    top_provider:         TopProvider;
    per_request_limits:   null;
    supported_parameters: SupportedParameter[];
    default_parameters:   DefaultParameters | null;
}

export interface Architecture {
    modality:          Modality;
    input_modalities:  PutModality[];
    output_modalities: PutModality[];
    tokenizer:         Tokenizer;
    instruct_type:     null | string;
}

export enum PutModality {
    Audio = "audio",
    File = "file",
    Image = "image",
    Text = "text",
    Video = "video",
}

export enum Modality {
    TextImageText = "text+image->text",
    TextImageTextImage = "text+image->text+image",
    TextText = "text->text",
}

export enum Tokenizer {
    Claude = "Claude",
    Cohere = "Cohere",
    DeepSeek = "DeepSeek",
    GPT = "GPT",
    Gemini = "Gemini",
    Grok = "Grok",
    Llama2 = "Llama2",
    Llama3 = "Llama3",
    Llama4 = "Llama4",
    Mistral = "Mistral",
    Nova = "Nova",
    Other = "Other",
    Qwen = "Qwen",
    Qwen3 = "Qwen3",
    Router = "Router",
}

export interface DefaultParameters {
    temperature?:       number | null;
    top_p?:             number | null;
    frequency_penalty?: null;
}

export interface Pricing {
    prompt:              string;
    completion:          string;
    request?:            string;
    image?:              string;
    web_search?:         string;
    internal_reasoning?: string;
    input_cache_read?:   string;
    audio?:              string;
    input_cache_write?:  string;
}

export enum SupportedParameter {
    FrequencyPenalty = "frequency_penalty",
    IncludeReasoning = "include_reasoning",
    LogitBias = "logit_bias",
    Logprobs = "logprobs",
    MaxTokens = "max_tokens",
    MinP = "min_p",
    PresencePenalty = "presence_penalty",
    Reasoning = "reasoning",
    RepetitionPenalty = "repetition_penalty",
    ResponseFormat = "response_format",
    Seed = "seed",
    Stop = "stop",
    StructuredOutputs = "structured_outputs",
    Temperature = "temperature",
    ToolChoice = "tool_choice",
    Tools = "tools",
    TopA = "top_a",
    TopK = "top_k",
    TopLogprobs = "top_logprobs",
    TopP = "top_p",
    WebSearchOptions = "web_search_options",
}

export interface TopProvider {
    context_length:        number | null;
    max_completion_tokens: number | null;
    is_moderated:          boolean;
}
