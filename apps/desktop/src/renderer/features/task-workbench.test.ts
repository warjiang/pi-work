import { describe, expect, it } from "vitest";
import { reduceLiveProcess } from "./task-workbench.js";

const t = (key: string) => key;
const empty = { thoughts: [], tools: [], notice: null };

describe("live Pi process reducer", () => {
  it("aggregates thinking separately from assistant text and completes it on end", () => {
    const started = reduceLiveProcess(empty, "thinking", { phase: "start", contentIndex: 2 }, t);
    const streaming = reduceLiveProcess(started, "thinking", { phase: "delta", contentIndex: 2, delta: "Inspect " }, t);
    const completed = reduceLiveProcess(streaming, "thinking", { phase: "end", contentIndex: 2, content: "Inspect files." }, t);

    expect(completed.thoughts).toEqual([{ contentIndex: 2, content: "Inspect files.", complete: true }]);
  });

  it("does not create a thinking block when no thinking events arrive", () => {
    const next = reduceLiveProcess(empty, "text_delta", { delta: "Answer" }, t);
    expect(next.thoughts).toEqual([]);
  });

  it("updates a native tool lifecycle in one stable row", () => {
    const started = reduceLiveProcess(empty, "tool_call", { toolCallId: "call-1", toolName: "read" }, t);
    const updated = reduceLiveProcess(started, "tool_update", { toolCallId: "call-1", toolName: "read", output: "halfway" }, t);
    const completed = reduceLiveProcess(updated, "tool_result", { toolCallId: "call-1", toolName: "read", result: "done", isError: false }, t);

    expect(completed.tools).toEqual([{
      toolCallId: "call-1",
      toolName: "read",
      detail: "done",
      complete: true,
      failed: false,
    }]);
  });
});
