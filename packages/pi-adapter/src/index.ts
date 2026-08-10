import * as piSdk from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { Plan, Task } from "@pi-work/protocol";

export type PiRuntimeHealth = {
  piSdkAvailable: boolean;
  exportedSymbols: number;
};

export class PiAdapter {
  health(): PiRuntimeHealth {
    return {
      piSdkAvailable: true,
      exportedSymbols: Object.keys(piSdk).length,
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
