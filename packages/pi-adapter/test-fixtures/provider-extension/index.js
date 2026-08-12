export default function fixtureProvider(pi) {
  const models = [
    {
      id: "fixture-model",
      name: "Fixture Model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024
    }
  ];

  pi.registerProvider("pi-work-fixture", {
    name: "Pi Work Fixture",
    baseUrl: "https://example.invalid/v1",
    apiKey: "$PI_WORK_FIXTURE_API_KEY",
    api: "openai-completions",
    async refreshModels(context) {
      return context.stored?.models ?? models;
    },
    models
  });
}
