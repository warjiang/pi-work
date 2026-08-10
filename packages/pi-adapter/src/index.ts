import { randomUUID } from "node:crypto";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Plan, Task } from "@pi-work/protocol";
import { z } from "zod";

export type PiRuntimeHealth = {
  piSdkAvailable: boolean;
  exportedSymbols: number;
};

export type PiProviderCredential = {
  providerId: string;
  modelId: string;
  apiKey: string;
};

const generatedPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().min(1),
  })).min(1).max(20),
  sources: z.array(z.string().min(1)).max(100),
});

export class PiAdapter {
  health(): PiRuntimeHealth {
    return {
      piSdkAvailable: true,
      exportedSymbols: 4,
    };
  }

  async createPlan(
    task: Pick<Task, "id" | "title" | "goal">,
    provider: PiProviderCredential | null,
  ): Promise<Plan> {
    if (provider === null) {
      return this.createPlanningFallback(task);
    }

    const credentials = new InMemoryCredentialStore();
    const modelRuntime = await ModelRuntime.create({ credentials });
    await modelRuntime.setRuntimeApiKey(provider.providerId, provider.apiKey);
    const modelResolution = resolveCliModel({
      cliModel: `${provider.providerId}/${provider.modelId}`,
      modelRuntime,
    });
    if (modelResolution.error !== undefined) {
      throw new Error(modelResolution.error);
    }
    if (modelResolution.model === undefined) {
      throw new Error(`Pi could not resolve ${provider.providerId}/${provider.modelId}.`);
    }

    const textDeltas: string[] = [];
    const { session } = await createAgentSession({
      model: modelResolution.model,
      modelRuntime,
      sessionManager: SessionManager.inMemory(),
      tools: [],
    });
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        textDeltas.push(event.assistantMessageEvent.delta);
      }
    });

    try {
      await session.prompt([
        "Create a read-only execution plan for this Pi Work task.",
        "Return JSON only, with keys summary, steps, and sources.",
        "Each step needs title and detail. Do not call tools or write files.",
        `Task title: ${task.title}`,
        `Task goal: ${task.goal}`,
      ].join("\n"));
    } finally {
      unsubscribe();
      session.dispose();
    }

    const generated = generatedPlanSchema.parse(JSON.parse(extractJson(textDeltas.join(""))));
    return {
      taskId: task.id,
      summary: generated.summary,
      steps: generated.steps.map((step) => ({
        id: randomUUID(),
        title: step.title,
        detail: step.detail,
      })),
      sources: generated.sources,
    };
  }

  createPlanningFallback(task: Pick<Task, "id" | "title" | "goal">): Plan {
    return {
      taskId: task.id,
      summary: `Prepare approved research deliverables for ${task.title}.`,
      steps: [
        {
          id: randomUUID(),
          title: "Review authorized sources",
          detail: "Read only files inside the selected workspace and record cited source paths.",
        },
        {
          id: randomUUID(),
          title: "Draft the decision brief",
          detail: `Create a staged Markdown brief addressing: ${task.goal}`,
        },
        {
          id: randomUUID(),
          title: "Review before publication",
          detail: "Present staged artifacts for user review before publishing to the workspace output folder.",
        },
      ],
      sources: [],
    };
  }
}

function extractJson(response: string): string {
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Pi did not return a JSON plan.");
  }
  return response.slice(start, end + 1);
}
