export interface ChatResponse {
    model:                string;
    created_at:           string;
    message:              Message;
    done:                 boolean;
    done_reason:          string;
    total_duration:       number;
    load_duration:        number;
    prompt_eval_count:    number;
    prompt_eval_duration: number;
    eval_count:           number;
    eval_duration:        number;
}

export interface Message {
    role:        string;
    content:     string;
    thinking:    string;
    tool_calls?: ToolCall[];
}

export interface ToolCall {
    id:       string;
    function: Function;
}

export interface Function {
    index:     number;
    name:      string;
    arguments: Record<string, unknown>;
}

export type Arguments = Record<string, unknown>;
