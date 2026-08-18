import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
  type TriggerFn,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMPOSITION_END_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COPY_COMMAND,
  CUT_COMMAND,
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type PasteCommandType,
  type SerializedLexicalNode,
  type Spread,
  TextNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { JSX, MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils.js";
import {
  knownPlatformById,
  knownPlatformLinkMatches,
  platformLinkSegments,
  PlatformLinkCard,
  type KnownPlatform,
  type KnownPlatformLink,
} from "./platform-link.js";
import { Icon } from "./ui/icon.js";

const externalUpdateTag = "composer:external";

export type ComposerEditorHandle = {
  focus(): void;
};

export type ComposerSlashCommand = {
  id: string;
  command: `/${string}`;
  label: string;
  description: string;
  keywords: readonly string[];
  insertText: string;
  onSelect?(): void;
};

export type ComposerEditorProps = {
  value: string;
  onChange(value: string): void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  slashCommands?: readonly ComposerSlashCommand[];
  onSubmitShortcut?(): void;
  onEscape?(): void;
  onImagePaste?(file: File): void;
};

export type SerializedPlatformLinkNode = Spread<{
  type: "platform-link";
  version: 1;
  url: string;
  platformId: KnownPlatform["id"];
}, SerializedLexicalNode>;

function PlatformLinkDecorator({ link, nodeKey }: { link: KnownPlatformLink; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  return (
    <span
      className={cn("composer-platform-link-node", selected && "is-selected")}
      tabIndex={-1}
      role="button"
      aria-label={`${link.platform.name}: ${link.url}`}
      data-lexical-node-key={nodeKey}
      onMouseDown={(event) => {
        event.preventDefault();
        if (!event.shiftKey) clearSelection();
        setSelected(true);
        editor.focus();
      }}
    >
      <PlatformLinkCard link={link} appearance="editor" />
    </span>
  );
}

export class PlatformLinkNode extends DecoratorNode<JSX.Element> {
  __url: string;
  __platformId: KnownPlatform["id"];

  static getType(): string {
    return "platform-link";
  }

  static clone(node: PlatformLinkNode): PlatformLinkNode {
    return new PlatformLinkNode(node.__url, node.__platformId, node.__key);
  }

  static importJSON(serializedNode: SerializedPlatformLinkNode): PlatformLinkNode {
    return new PlatformLinkNode(serializedNode.url, serializedNode.platformId);
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  constructor(url: string, platformId: KnownPlatform["id"], key?: NodeKey) {
    super(key);
    this.__url = url;
    this.__platformId = platformId;
  }

  exportJSON(): SerializedPlatformLinkNode {
    return {
      ...super.exportJSON(),
      type: "platform-link",
      version: 1,
      url: this.__url,
      platformId: this.__platformId,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.__url;
    return { element };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("span");
    element.className = "composer-platform-link-decorator";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  getTextContent(): string {
    return this.__url;
  }

  isInline(): true {
    return true;
  }

  isIsolated(): true {
    return true;
  }

  decorate(): JSX.Element {
    const platform = knownPlatformById(this.__platformId);
    if (platform === undefined) return <span>{this.__url}</span>;
    return (
      <PlatformLinkDecorator
        link={{ url: this.__url, platform }}
        nodeKey={this.__key}
      />
    );
  }
}

export function $createPlatformLinkNode(link: KnownPlatformLink): PlatformLinkNode {
  return new PlatformLinkNode(link.url, link.platform.id);
}

export function $isPlatformLinkNode(node: LexicalNode | null | undefined): node is PlatformLinkNode {
  return node instanceof PlatformLinkNode;
}

function appendPlainText(parent: ReturnType<typeof $createParagraphNode>, value: string, tokenize: boolean) {
  const segments = tokenize ? platformLinkSegments(value) : [{ type: "text" as const, value }];
  for (const segment of segments) {
    if (segment.type === "link") {
      parent.append($createPlatformLinkNode(segment.value));
      continue;
    }
    const lines = segment.value.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) parent.append($createLineBreakNode());
      if (line !== "") parent.append($createTextNode(line));
    });
  }
}

export function $replaceEditorPlainText(value: string, tokenize = true) {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  appendPlainText(paragraph, value, tokenize);
  root.append(paragraph);
}

function selectionInsideMatch(nodeKey: NodeKey, start: number, end: number): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return (
    (selection.anchor.key === nodeKey && selection.anchor.offset > start && selection.anchor.offset <= end)
    || (selection.focus.key === nodeKey && selection.focus.offset > start && selection.focus.offset <= end)
  );
}

function tokenizeTextNode(node: TextNode, force: boolean): boolean {
  const text = node.getTextContent();
  const matches = knownPlatformLinkMatches(text).filter(({ start, end }) => (
    force || !selectionInsideMatch(node.getKey(), start, end)
  ));
  if (matches.length === 0) return false;

  const boundaries = [...new Set(matches.flatMap(({ start, end }) => [start, end])
    .filter((offset) => offset > 0 && offset < text.length))]
    .sort((left, right) => left - right);
  const parts = boundaries.length > 0 ? node.splitText(...boundaries) : [node];
  let offset = 0;
  for (const part of parts) {
    const length = part.getTextContentSize();
    const match = matches.find(({ start, end }) => start === offset && end === offset + length);
    if (match !== undefined) {
      part.replace($createPlatformLinkNode(match));
    }
    offset += length;
  }
  return true;
}

function $tokenizePlatformLinks(force: boolean) {
  const textNodes = $getRoot().getAllTextNodes();
  for (const node of textNodes) tokenizeTextNode(node, force);
}

function PlatformLinkPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerNodeTransform(
    TextNode,
    (node) => {
      if (!editor.isComposing()) tokenizeTextNode(node, false);
    },
  ), [editor]);

  useEffect(() => mergeRegister(
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (editor.isComposing()) return false;
        editor.update(() => $tokenizePlatformLinks(false));
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      BLUR_COMMAND,
      () => {
        if (editor.isComposing()) return false;
        editor.update(() => $tokenizePlatformLinks(true));
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      COMPOSITION_END_COMMAND,
      () => {
        queueMicrotask(() => editor.update(() => $tokenizePlatformLinks(false)));
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      COPY_COMMAND,
      (event) => copyOrCutSelectedPlatformLinks(event, false),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      CUT_COMMAND,
      (event) => copyOrCutSelectedPlatformLinks(event, true),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => removeSelectedOrAdjacentPlatformLink(event, "backward"),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => removeSelectedOrAdjacentPlatformLink(event, "forward"),
      COMMAND_PRIORITY_HIGH,
    ),
  ), [editor]);

  return null;
}

function copyOrCutSelectedPlatformLinks(
  event: ClipboardEvent | KeyboardEvent | null,
  cut: boolean,
): boolean {
  const selection = $getSelection();
  if (
    !$isNodeSelection(selection)
    || event === null
    || !("clipboardData" in event)
    || event.clipboardData === null
  ) {
    return false;
  }
  const nodes = selection.getNodes();
  if (nodes.length === 0 || !nodes.every($isPlatformLinkNode)) return false;
  event.preventDefault();
  event.clipboardData.setData("text/plain", selection.getTextContent());
  if (cut) nodes.forEach((node) => node.remove());
  return true;
}

function $adjacentNodeAtSelection(direction: "backward" | "forward"): LexicalNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  if (anchor.type === "text") {
    if (direction === "backward" && anchor.offset === 0) return node.getPreviousSibling();
    if (direction === "forward" && anchor.offset === node.getTextContentSize()) return node.getNextSibling();
    return null;
  }
  if (!$isElementNode(node)) return null;
  return direction === "backward"
    ? node.getChildAtIndex(anchor.offset - 1)
    : node.getChildAtIndex(anchor.offset);
}

function removeSelectedOrAdjacentPlatformLink(
  event: KeyboardEvent | null,
  direction: "backward" | "forward",
): boolean {
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    const links = selection.getNodes().filter($isPlatformLinkNode);
    if (links.length === 0) return false;
    event?.preventDefault();
    links.forEach((node) => node.remove());
    return true;
  }
  const adjacent = $adjacentNodeAtSelection(direction);
  if (!$isPlatformLinkNode(adjacent)) return false;
  event?.preventDefault();
  adjacent.remove();
  return true;
}

function ExternalValuePlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const current = editor.getEditorState().read(() => $getRoot().getTextContent());
    if (current === value) return;
    editor.update(() => {
      $replaceEditorPlainText(value);
    }, { tag: externalUpdateTag });
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, value]);

  return null;
}

function EditorBridgePlugin({ editorRef }: { editorRef: MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  return null;
}

function ComposerKeyboardPlugin({
  onSubmitShortcut,
  onEscape,
}: {
  onSubmitShortcut: (() => void) | undefined;
  onEscape: (() => void) | undefined;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => mergeRegister(
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (
          event === null
          || (!event.metaKey && !event.ctrlKey)
          || event.isComposing
          || editor.isComposing()
        ) return false;
        event.preventDefault();
        onSubmitShortcut?.();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (onEscape === undefined) return false;
        event.preventDefault();
        onEscape();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
  ), [editor, onEscape, onSubmitShortcut]);

  return null;
}

function pasteData(event: PasteCommandType): DataTransfer | null {
  if ("clipboardData" in event && event.clipboardData !== null) return event.clipboardData;
  if ("dataTransfer" in event && event.dataTransfer !== null) return event.dataTransfer;
  return null;
}

function PastePlugin({ onImagePaste }: { onImagePaste: ((file: File) => void) | undefined }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      const clipboardData = pasteData(event);
      const image = clipboardData === null
        ? undefined
        : Array.from(clipboardData.files).find((file) => file.type.startsWith("image/"));
      if (image !== undefined && onImagePaste !== undefined) {
        event.preventDefault();
        onImagePaste(image);
        return true;
      }
      if (clipboardData === null) return false;
      const text = clipboardData?.getData("text/plain");
      event.preventDefault();
      if (text === undefined || text === "") return true;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return true;
      selection.insertRawText(text);
      if (!editor.isComposing()) $tokenizePlatformLinks(true);
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  ), [editor, onImagePaste]);

  return null;
}

class SlashCommandOption extends MenuOption {
  command: ComposerSlashCommand;

  constructor(command: ComposerSlashCommand) {
    super(command.id);
    this.command = command;
  }
}

function slashTrigger(text: string): MenuTextMatch | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.anchor.type !== "text") return null;
  const anchorNode = selection.anchor.getNode();
  if ($getRoot().getFirstDescendant()?.getKey() !== anchorNode.getKey()) return null;
  const match = /^\/([^\s/]*)$/.exec(text);
  if (match === null) return null;
  return {
    leadOffset: 0,
    matchingString: match[1] ?? "",
    replaceableString: match[0],
  };
}

function SlashCommandPlugin({ commands }: { commands: readonly ComposerSlashCommand[] }) {
  const [query, setQuery] = useState<string | null>(null);
  const triggerFn = useCallback<TriggerFn>((text) => slashTrigger(text), []);
  const options = useMemo(() => {
    if (query === null) return [];
    const normalized = query.toLocaleLowerCase();
    return commands
      .filter(({ command, label, keywords }) => (
        command.slice(1).toLocaleLowerCase().includes(normalized)
        || label.toLocaleLowerCase().includes(normalized)
        || keywords.some((keyword) => keyword.toLocaleLowerCase().includes(normalized))
      ))
      .map((command) => new SlashCommandOption(command));
  }, [commands, query]);

  if (commands.length === 0) return null;

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={setQuery}
      triggerFn={triggerFn}
      onSelectOption={(option, textNodeContainingQuery, closeMenu) => {
        if (textNodeContainingQuery === null) return;
        textNodeContainingQuery.replace($createTextNode(option.command.insertText));
        closeMenu();
        option.command.onSelect?.();
      }}
      menuRenderFn={(anchorElementRef, {
        selectedIndex,
        selectOptionAndCleanUp,
        setHighlightedIndex,
      }) => {
        const anchor = anchorElementRef.current;
        if (anchor === null || options.length === 0) return null;
        return createPortal(
          <div className="composer-typeahead-menu" role="listbox" aria-label="Commands">
            {options.map((option, index) => (
              <button
                key={option.key}
                ref={(element) => option.setRefElement(element)}
                id={`typeahead-item-${index}`}
                type="button"
                role="option"
                aria-selected={selectedIndex === index}
                className={cn("composer-typeahead-option", selectedIndex === index && "is-selected")}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOptionAndCleanUp(option)}
              >
                <span className="composer-typeahead-icon"><Icon name="command" /></span>
                <span className="composer-typeahead-copy">
                  <strong>
                    <span>{option.command.command}</span>
                    <span>{option.command.label}</span>
                  </strong>
                  <small>{option.command.description}</small>
                </span>
              </button>
            ))}
          </div>,
          anchor,
        );
      }}
    />
  );
}

function EditorChangePlugin({ onChange }: Pick<ComposerEditorProps, "onChange">) {
  const handleChange = useCallback((editorState: EditorState, _editor: LexicalEditor, tags: Set<string>) => {
    if (tags.has(externalUpdateTag)) return;
    const value = editorState.read(() => $getRoot().getTextContent());
    onChange(value);
  }, [onChange]);

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor({
    value,
    onChange,
    className,
    placeholder,
    ariaLabel,
    autoFocus = false,
    slashCommands = [],
    onSubmitShortcut,
    onEscape,
    onImagePaste,
  }, forwardedRef) {
    const editorRef = useRef<LexicalEditor | null>(null);
    useImperativeHandle(forwardedRef, () => ({
      focus() {
        const editor = editorRef.current;
        editor?.getRootElement()?.focus();
        editor?.focus(undefined, { defaultSelection: "rootEnd" });
      },
    }), []);

    const initialConfig = useMemo(() => ({
      namespace: "PiWorkComposer",
      nodes: [PlatformLinkNode],
      onError(error: Error) {
        throw error;
      },
      editorState: () => $replaceEditorPlainText(value),
      theme: {
        paragraph: "composer-editor-paragraph",
      },
    }), []);

    const contentEditable = placeholder === undefined ? (
      <ContentEditable
        className="composer-editor-content"
        aria-label={ariaLabel}
        spellCheck
      />
    ) : (
      <ContentEditable
        className="composer-editor-content"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        placeholder={<div className="composer-editor-placeholder">{placeholder}</div>}
        spellCheck
      />
    );

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <div className={cn("composer-editor", className)}>
          <PlainTextPlugin
            contentEditable={contentEditable}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          {autoFocus ? <AutoFocusPlugin defaultSelection="rootEnd" /> : null}
          <EditorBridgePlugin editorRef={editorRef} />
          <EditorChangePlugin onChange={onChange} />
          <ExternalValuePlugin value={value} />
          <PlatformLinkPlugin />
          <SlashCommandPlugin commands={slashCommands} />
          <ComposerKeyboardPlugin onSubmitShortcut={onSubmitShortcut} onEscape={onEscape} />
          <PastePlugin onImagePaste={onImagePaste} />
        </div>
      </LexicalComposer>
    );
  },
);
