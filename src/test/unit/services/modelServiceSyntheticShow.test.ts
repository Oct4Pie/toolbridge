import { expect } from "chai";

import { modelFormatter } from "../../../services/model/ModelFormatter.js";

import type { OllamaModelInfo, UniversalModel } from "../../../translation/types/models.js";

describe("ModelService synthetic Ollama show payload", () => {
  // Test the formatter's createOllamaModelInfo method
  const service = {
    createOllamaModelInfo(model: UniversalModel): OllamaModelInfo {
      return modelFormatter.createOllamaModelInfo(model);
    },
  };

  it("should mirror core Ollama fields when upstream metadata includes license", () => {
    const universalModel: UniversalModel = {
      id: "gpt-4o-mini",
      name: "gpt-4o-mini",
      description: "OpenAI test model",
      contextLength: 128000,
      size: 3_200_000_000,
      quantization: "Q4_K_M",
      family: "qwen3",
      capabilities: {
        chat: true,
        completion: true,
        embedding: false,
        vision: true,
        tools: true,
        functionCalling: true,
      },
      pricing: {
        promptTokens: 5,
        completionTokens: 15,
      },
      metadata: {
        created: 1_700_000_000,
        owned_by: "openai",
        license: "apache-2.0",
        modified_at: "2024-01-01T00:00:00.000Z",
      },
    };

    const response = service.createOllamaModelInfo(universalModel);

    expect(response.license).to.include("Apache License");
    expect(response.modelfile).to.include('TEMPLATE """');
    expect(response.parameters).to.include("temperature");
    expect(response.template).to.include("<|im_start|>");
    expect(response.details.families).to.include("qwen3");
    expect(response.capabilities).to.include("completion");
    expect(response.model_info).to.have.property("general.architecture", "qwen3");
    expect(response.model_info).to.have.property("toolbridge.backend_mode");
    expect(response.tensors).to.be.an("array").that.is.empty;
    expect(response.modified_at).to.equal("2024-01-01T00:00:00.000Z");
  });

  it("should fall back to synthetic license and metadata when license is missing", () => {
    const universalModel: UniversalModel = {
      id: "mystery-model",
      name: "mystery-model",
      capabilities: {
        chat: true,
        completion: true,
        embedding: false,
        vision: false,
        tools: false,
        functionCalling: false,
      },
      metadata: {},
    };

    const response = service.createOllamaModelInfo(universalModel);

    expect(response.license).to.include("Apache License");
    expect(response.model_info).to.have.property("general.architecture");
    expect(response.model_info).to.have.property("general.license", "unknown");
    expect(response.capabilities).to.include("chat");
    expect(response.details.families).to.include(response.details.family);
  });
});
