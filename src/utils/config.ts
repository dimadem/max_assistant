import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { Config, Layer } from "effect";

export const model = OpenAiLanguageModel.model("gpt-5.2-2025-12-11");

const OpenAi = OpenAiClient.layerConfig({
	apiKey: Config.redacted("API_KEY"),
});

export const OpenAiWithHttp = Layer.provide(OpenAi, FetchHttpClient.layer);
