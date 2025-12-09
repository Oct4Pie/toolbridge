export interface TagsResponse {
    models: Model[];
}

export interface Model {
    name:        string;
    model:       string;
    modified_at: string;
    size:        number;
    digest:      string;
    details:     Details;
}

export interface Details {
    parent_model?:      string | undefined;
    format:             string;
    family:             string;
    families:           string[];
    parameter_size:     string;
    quantization_level: string;
}
