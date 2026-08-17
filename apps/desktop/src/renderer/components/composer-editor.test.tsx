// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  $getRoot,
  $nodesOfType,
  createEditor,
} from "lexical";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  $replaceEditorPlainText,
  ComposerEditor,
  type ComposerEditorHandle,
  PlatformLinkNode,
} from "./composer-editor.js";

const githubUrl = "https://github.com/apache/ossie?tab=readme-ov-file";

afterEach(() => cleanup());

beforeAll(() => {
  const rect = () => ({
    bottom: 20,
    height: 20,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: rect,
  });
  Object.defineProperty(Text.prototype, "getBoundingClientRect", {
    configurable: true,
    value: rect,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: () => undefined,
  });
});

function editorText(element: HTMLElement): string {
  return element.textContent ?? "";
}

describe("ComposerEditor plain-text projection", () => {
  it("round-trips newlines, whitespace, and platform URLs through one text projection", () => {
    const editor = createEditor({
      namespace: "composer-editor-test",
      nodes: [PlatformLinkNode],
      onError(error) {
        throw error;
      },
    });
    const value = `  调研 ${githubUrl}\n第二行  `;

    editor.update(() => $replaceEditorPlainText(value), { discrete: true });

    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe(value);
      const links = $nodesOfType(PlatformLinkNode);
      expect(links).toHaveLength(1);
      expect(links[0]?.getTextContent()).toBe(githubUrl);
      expect(links[0]?.exportJSON()).toMatchObject({
        type: "platform-link",
        version: 1,
        platformId: "github",
        url: githubUrl,
      });
    });
  });

  it("keeps unsupported URLs as ordinary text nodes", () => {
    const editor = createEditor({
      namespace: "composer-editor-unsupported-test",
      nodes: [PlatformLinkNode],
      onError(error) {
        throw error;
      },
    });

    editor.update(() => $replaceEditorPlainText("https://example.com/reference"), { discrete: true });

    editor.getEditorState().read(() => {
      expect($nodesOfType(PlatformLinkNode)).toHaveLength(0);
      expect($getRoot().getTextContent()).toBe("https://example.com/reference");
    });
  });
});

describe("ComposerEditor interactions", () => {
  it("pastes HTML as plain text and immediately creates an atomic platform link", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerEditor value="" onChange={onChange} />);
    const textbox = screen.getByRole("textbox");
    const clipboardData = {
      files: [],
      getData: (type: string) => type === "text/plain" ? `调研 ${githubUrl}` : "<b>ignored</b>",
    };

    await user.click(textbox);
    fireEvent.paste(textbox, { clipboardData });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(`调研 ${githubUrl}`));
    expect(screen.getByRole("button", { name: `GitHub: ${githubUrl}` })).toBeTruthy();
    expect(editorText(textbox)).toContain("调研");
    expect(editorText(textbox)).not.toContain("<b>");
  });

  it("does not import HTML when the clipboard has no plain-text representation", () => {
    const onChange = vi.fn();
    render(<ComposerEditor value="" onChange={onChange} />);
    const textbox = screen.getByRole("textbox");

    fireEvent.paste(textbox, {
      clipboardData: {
        files: [],
        getData: (type: string) => type === "text/html" ? "<b>styled</b>" : "",
      },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(editorText(textbox)).toBe("");
  });

  it("sends pasted images through the attachment callback before text handling", () => {
    const onChange = vi.fn();
    const onImagePaste = vi.fn();
    const image = new File(["image"], "pasted.png", { type: "image/png" });
    render(
      <ComposerEditor
        value=""
        onChange={onChange}
        onImagePaste={onImagePaste}
      />,
    );

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        files: [image],
        getData: () => "ignored text",
      },
    });

    expect(onImagePaste).toHaveBeenCalledWith(image);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes a selected platform link as one atomic node", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerEditor value={`before ${githubUrl} after`} onChange={onChange} />);
    const textbox = screen.getByRole("textbox");
    const link = screen.getByRole("button", { name: `GitHub: ${githubUrl}` });

    await user.click(link);
    fireEvent.keyDown(textbox, { key: "Backspace" });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("before  after"));
    expect(screen.queryByRole("button", { name: `GitHub: ${githubUrl}` })).toBeNull();
  });

  it("copies and cuts the original URL, then restores the atomic node through undo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const setData = vi.fn();
    render(<ComposerEditor value={githubUrl} onChange={onChange} />);
    const textbox = screen.getByRole("textbox");
    const link = screen.getByRole("button", { name: `GitHub: ${githubUrl}` });
    const clipboardData = {
      files: [],
      getData: () => "",
      setData,
    };

    await user.click(link);
    fireEvent.copy(textbox, { clipboardData });
    expect(setData).toHaveBeenCalledWith("text/plain", githubUrl);

    fireEvent.cut(textbox, { clipboardData });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(""));
    expect(screen.queryByRole("button", { name: `GitHub: ${githubUrl}` })).toBeNull();

    fireEvent.keyDown(textbox, { key: "z", ctrlKey: true });
    expect(await screen.findByRole("button", { name: `GitHub: ${githubUrl}` })).toBeTruthy();
  });

  it("does not submit while composing and supports Cmd/Ctrl+Enter otherwise", () => {
    const onSubmitShortcut = vi.fn();
    render(
      <ComposerEditor
        value="内容"
        onChange={() => undefined}
        onSubmitShortcut={onSubmitShortcut}
      />,
    );
    const textbox = screen.getByRole("textbox");

    fireEvent.keyDown(textbox, { key: "Enter", metaKey: true, isComposing: true });
    expect(onSubmitShortcut).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox, { key: "Enter", ctrlKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it("keeps regular Enter available for multiline text", async () => {
    const onChange = vi.fn();
    render(
      <ComposerEditor
        value="first"
        onChange={onChange}
        autoFocus
      />,
    );
    const textbox = screen.getByRole("textbox");

    await waitFor(() => expect(document.activeElement).toBe(textbox));
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => {
      const value = onChange.mock.lastCall?.[0] as string | undefined;
      expect(value).toContain("\n");
      expect(value?.replace("\n", "")).toBe("first");
    });
  });

  it("opens slash commands only at the absolute message start and inserts command text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerEditor
        value=""
        onChange={onChange}
        autoFocus
        slashCommands={[
          {
            id: "goal",
            command: "/goal",
            label: "Goal",
            description: "Set the goal",
            keywords: ["objective"],
            insertText: "/goal ",
          },
          {
            id: "plan",
            command: "/plan",
            label: "Plan",
            description: "Create a plan",
            keywords: ["planning"],
            insertText: "/plan ",
          },
        ]}
      />,
    );
    const textbox = screen.getByRole("textbox");

    await waitFor(() => expect(document.activeElement).toBe(textbox));
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [],
        getData: (type: string) => type === "text/plain" ? "/go" : "",
      },
    });
    expect(await screen.findByRole("option", { name: /goal/i })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /plan/i })).toBeNull();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("/goal "));
    expect(editorText(textbox)).toBe("/goal ");
  });

  it("does not open slash commands after preceding message text", async () => {
    render(
      <ComposerEditor
        value=""
        onChange={() => undefined}
        autoFocus
        slashCommands={[
          {
            id: "goal",
            command: "/goal",
            label: "Goal",
            description: "Set the goal",
            keywords: ["objective"],
            insertText: "/goal ",
          },
        ]}
      />,
    );
    const textbox = screen.getByRole("textbox");

    await waitFor(() => expect(document.activeElement).toBe(textbox));
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [],
        getData: (type: string) => type === "text/plain" ? "prefix /go" : "",
      },
    });

    expect(screen.queryByRole("option", { name: /goal/i })).toBeNull();
  });

  it("does not emit onChange loops for external replacement and supports imperative focus", async () => {
    const onChange = vi.fn();
    const ref = createRef<ComposerEditorHandle>();
    const view = render(
      <ComposerEditor
        ref={ref}
        value="first"
        onChange={onChange}
      />,
    );

    view.rerender(
      <ComposerEditor
        ref={ref}
        value="second"
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(editorText(screen.getByRole("textbox"))).toBe("second"));
    expect(onChange).not.toHaveBeenCalled();

    act(() => ref.current?.focus());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox")));
  });
});
