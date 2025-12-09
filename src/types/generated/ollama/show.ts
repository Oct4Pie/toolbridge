export interface ShowResponse {
    license:      string;
    modelfile:    string;
    parameters:   string;
    template:     string;
    details:      Details;
    model_info:   ModelInfo;
    tensors:      Tensor[];
    capabilities: string[];
    modified_at:  string;
}

export interface Details {
    parent_model?:      string | undefined;
    format:             string;
    family:             string;
    families:           string[];
    parameter_size:     string;
    quantization_level: string;
}

export interface ModelInfo {
    "general.architecture":                   string;
    "general.basename":                       string;
    "general.file_type":                      number;
    "general.license":                        string;
    "general.parameter_count":                number;
    "general.quantization_version":           number;
    "general.size_label":                     string;
    "general.type":                           string;
    "qwen3.attention.head_count":             number;
    "qwen3.attention.head_count_kv":          number;
    "qwen3.attention.key_length":             number;
    "qwen3.attention.layer_norm_rms_epsilon": number;
    "qwen3.attention.value_length":           number;
    "qwen3.block_count":                      number;
    "qwen3.context_length":                   number;
    "qwen3.embedding_length":                 number;
    "qwen3.feed_forward_length":              number;
    "qwen3.rope.freq_base":                   number;
    "tokenizer.ggml.add_bos_token":           boolean;
    "tokenizer.ggml.bos_token_id":            number;
    "tokenizer.ggml.eos_token_id":            number;
    "tokenizer.ggml.merges":                  null;
    "tokenizer.ggml.model":                   string;
    "tokenizer.ggml.padding_token_id":        number;
    "tokenizer.ggml.pre":                     string;
    "tokenizer.ggml.token_type":              null;
    "tokenizer.ggml.tokens":                  null;
}

export interface Tensor {
    name:  string;
    type:  Type;
    shape: number[];
}

export enum Type {
    F16 = "F16",
    F32 = "F32",
    Q4K = "Q4_K",
    Q6K = "Q6_K",
}
