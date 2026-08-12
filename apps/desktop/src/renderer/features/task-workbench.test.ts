import { describe, expect, it } from "vitest";
import {
  activeTurnIndex,
  activeTurnDuringScroll,
  conversationTurns,
  isNearBottom,
  reduceLiveProcess,
  summarizeProcessValue,
  toolFromActivity,
  toolPreview,
  turnHoverDistance,
  visibleAssistantContent,
} from "./task-workbench.js";

const t = (key: string) => key;
const empty = { thoughts: [], tools: [], notice: null };

describe("live Pi process reducer", () => {
  it("hides internal attached-file manifests from assistant content", () => {
    expect(visibleAssistantContent(
      "Attached files:\n- /Users/me/clipboard-attachments/a.png\n\nI reviewed the image.",
    )).toBe("I reviewed the image.");
  });

  it("keeps regular assistant content untouched", () => {
    expect(visibleAssistantContent("I reviewed the image.")).toBe("I reviewed the image.");
  });

  it("only follows the message stream while the scroller remains near its end", () => {
    expect(isNearBottom({ scrollHeight: 1_000, scrollTop: 560, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 400 })).toBe(false);
  });

  it("builds one navigation indicator for every user turn", () => {
    expect(conversationTurns([
      {
        id: "00000000-0000-4000-8000-000000000001",
        taskId: "00000000-0000-4000-8000-000000000000",
        role: "user",
        content: "First question",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        taskId: "00000000-0000-4000-8000-000000000000",
        role: "assistant",
        content: "First answer",
        createdAt: "2026-08-12T00:00:01.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        taskId: "00000000-0000-4000-8000-000000000000",
        role: "user",
        content: "  Follow-up question  ",
        createdAt: "2026-08-12T00:00:02.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        taskId: "00000000-0000-4000-8000-000000000000",
        role: "assistant",
        content: "Draft answer",
        createdAt: "2026-08-12T00:00:03.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        taskId: "00000000-0000-4000-8000-000000000000",
        role: "assistant",
        content: "Final answer",
        createdAt: "2026-08-12T00:00:04.000Z",
      },
    ])).toEqual([
      {
        messageId: "00000000-0000-4000-8000-000000000001",
        targetId: "turn-00000000-0000-4000-8000-000000000001",
        question: "First question",
        answer: "First answer",
      },
      {
        messageId: "00000000-0000-4000-8000-000000000003",
        targetId: "turn-00000000-0000-4000-8000-000000000003",
        question: "Follow-up question",
        answer: "Final answer",
      },
    ]);
  });

  it("selects the latest turn above the reading threshold", () => {
    expect(activeTurnIndex([120, 340, 680], 400)).toBe(1);
    expect(activeTurnIndex([120, 340, 680], 80)).toBe(0);
    expect(activeTurnIndex([], 400)).toBe(-1);
  });

  it("keeps the target active while smooth scrolling past intermediate turns", () => {
    expect(activeTurnDuringScroll("turn-2", "turn-4")).toBe("turn-4");
    expect(activeTurnDuringScroll("turn-4", null)).toBe("turn-4");
  });

  it("expands the hovered turn and nearby indicators by distance", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => turnHoverDistance(index, 3)))
      .toEqual([3, 2, 1, 0, 1, 2, 3]);
    expect(turnHoverDistance(0, 4)).toBeNull();
    expect(turnHoverDistance(0, -1)).toBeNull();
  });

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
      arguments: {},
      detail: "done",
      output: "done",
      complete: true,
      failed: false,
    }]);
  });

  it("turns structured tool progress into readable copy", () => {
    expect(summarizeProcessValue({
      content: [{ type: "text", text: "Searching 3/3: NVIDIA stock price today" }],
      details: { phase: "search", progress: 0.666666 },
    })).toBe("Searching 3/3: NVIDIA stock price today");
  });

  it("does not expose unparseable structured tool payloads as JSON", () => {
    expect(summarizeProcessValue({ phase: "search", progress: 0.666666 })).toBe("");
  });

  it("keeps tool arguments for a compact preview and expandable details", () => {
    const started = reduceLiveProcess(empty, "tool_call", {
      toolCallId: "call-1",
      toolName: "web_search",
      arguments: { query: "NVIDIA stock price today" },
    }, t);

    expect(started.tools[0]?.arguments).toEqual({ query: "NVIDIA stock price today" });
    expect(toolPreview(started.tools[0]?.arguments ?? {})).toBe("NVIDIA stock price today");
  });

  it("accepts tool calls created before arguments were available", () => {
    expect(toolPreview(undefined)).toBe("");
  });

  it("rebuilds persisted tool results after switching sessions", () => {
    expect(toolFromActivity({
      id: "activity-1",
      title: "web_search",
      detail: "Found NVIDIA stock data",
      metadata: {
        toolCallId: "call-1",
        toolName: "web_search",
        arguments: { query: "NVIDIA stock price today" },
        result: { content: [{ type: "text", text: "Found NVIDIA stock data" }] },
        isError: false,
      },
    })).toMatchObject({
      toolCallId: "call-1",
      toolName: "web_search",
      arguments: { query: "NVIDIA stock price today" },
      detail: "Found NVIDIA stock data",
      complete: true,
      failed: false,
    });
  });
});
