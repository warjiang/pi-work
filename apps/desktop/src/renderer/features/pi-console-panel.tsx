import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { gsap } from "gsap";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import type { MessageKey } from "@/i18n.js";

type T = (key: MessageKey) => string;

export function PiConsolePanel({
  commandRequest,
  cwd,
  height,
  open,
  t,
  onClose,
  onClosed,
  onResize,
}: {
  commandRequest: { id: number; value: string } | null;
  cwd?: string;
  height: number;
  open: boolean;
  t: T;
  onClose(): void;
  onClosed(): void;
  onResize(height: number, commit: boolean): void;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLElement>(null);
  const resizeState = useRef<{ pointerId: number; startY: number; startHeight: number; latestHeight: number } | null>(null);
  const [terminalElement, setTerminalElement] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const receivedProcessDataRef = useRef(false);
  const commandRequestRef = useRef(commandRequest);
  const handledCommandIdRef = useRef<number | null>(null);
  const translationRef = useRef(t);
  const openRef = useRef(open);
  const onClosedRef = useRef(onClosed);
  const [status, setStatus] = useState<"starting" | "connected" | "stopped" | "error">("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  translationRef.current = t;
  commandRequestRef.current = commandRequest;
  openRef.current = open;
  onClosedRef.current = onClosed;

  const writePendingCommand = () => {
    const request = commandRequestRef.current;
    if (request === null || handledCommandIdRef.current === request.id) return;
    handledCommandIdRef.current = request.id;
    void window.piWork.piConsole.write(`${request.value}\r`);
  };

  const closePanel = () => {
    onClose();
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["extensions"] }),
      queryClient.invalidateQueries({ queryKey: ["models"] }),
      queryClient.invalidateQueries({ queryKey: ["providers"] }),
    ]);
  };

  const finishResize = (pointerId: number) => {
    const state = resizeState.current;
    if (state === null || state.pointerId !== pointerId) return;
    resizeState.current = null;
    onResize(state.latestHeight, true);
    requestAnimationFrame(() => terminalRef.current?.focus());
  };

  useEffect(() => {
    if (terminalElement === null) return;
    setStatus("starting");
    setErrorMessage(null);

    try {
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1,
        letterSpacing: 0,
        customGlyphs: true,
        theme: { background: "#111214", foreground: "#e7e7e9", cursor: "#f2f2f2", selectionBackground: "#ffffff2b" },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(terminalElement);
      terminal.writeln(`\x1b[90m${translationRef.current("piConsoleDescription")}\x1b[0m`);
      terminalRef.current = terminal;
      receivedProcessDataRef.current = false;
      let resizeFrame: number | null = null;
      let resizeTimer: number | null = null;
      let lastSize = { cols: 0, rows: 0 };
      const fitTerminal = () => {
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
          const dimensions = fit.proposeDimensions();
          if (dimensions === undefined) return;
          const nextSize = {
            cols: dimensions.cols,
            rows: Math.max(1, dimensions.rows - 1),
          };
          if (nextSize.cols === lastSize.cols && nextSize.rows === lastSize.rows) return;
          terminal.resize(nextSize.cols, nextSize.rows);
          if (wasAtBottom) terminal.scrollToBottom();
          lastSize = nextSize;
          void window.piWork.piConsole.resize(lastSize);
        });
      };
      const scheduleResize = (immediate = false) => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        if (immediate) {
          resizeTimer = null;
          fitTerminal();
          return;
        }
        resizeTimer = window.setTimeout(() => {
          resizeTimer = null;
          fitTerminal();
        }, 80);
      };
      const observer = new ResizeObserver(() => scheduleResize());
      observer.observe(terminalElement);
      const unsubscribe = window.piWork.piConsole.onEvent((event) => {
        if (event.type === "data") {
          receivedProcessDataRef.current = true;
          terminal.write(event.data);
        }
        if (event.type === "started") {
          setStatus("connected");
          scheduleResize(true);
          writePendingCommand();
        }
        if (event.type === "exit") {
          setStatus("stopped");
          terminal.write("\x1b[?2026l");
          terminal.writeln(`\r\n\x1b[90m${translationRef.current("consoleStopped")}\x1b[0m`);
        }
        if (event.type === "error") {
          setStatus("error");
          setErrorMessage(event.message);
          terminal.write("\x1b[?2026l");
          terminal.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
        }
      });
      const dataDisposable = terminal.onData((data) => void window.piWork.piConsole.write(data));
      void window.piWork.piConsole.start(cwd === undefined ? {} : { cwd }).then((result) => {
        if (result.started) {
          setStatus("connected");
          if (result.reused && result.output) terminal.write(result.output);
          writePendingCommand();
        } else {
          setStatus("error");
          setErrorMessage(result.message);
        }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus("error");
        setErrorMessage(message);
        terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      });
      const recoverState = () => {
        void window.piWork.piConsole.snapshot().then((snapshot) => {
          if (terminalRef.current !== terminal) return;
          if (!receivedProcessDataRef.current && snapshot.output) {
            terminal.reset();
            terminal.write(snapshot.output);
            receivedProcessDataRef.current = true;
          }
          if (!snapshot.running) setStatus("stopped");
        }).catch(() => {
          // Live events remain the primary path; snapshot recovery is best effort.
        });
      };
      const recoveryTimers = [
        window.setTimeout(recoverState, 250),
        window.setTimeout(recoverState, 1_500),
      ];
      scheduleResize(true);
      requestAnimationFrame(() => terminal.focus());

      return () => {
        for (const timer of recoveryTimers) window.clearTimeout(timer);
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        observer.disconnect();
        dataDisposable.dispose();
        unsubscribe();
        terminal.dispose();
        terminalRef.current = null;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("error");
      setErrorMessage(message);
    }
  }, [terminalElement]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => terminalRef.current?.focus());
  }, [open]);

  useGSAP(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.killTweensOf(panel);

    if (open) {
      gsap.to(panel, {
        autoAlpha: 1,
        y: 0,
        duration: reduceMotion ? 0 : 0.26,
        ease: "power3.out",
        overwrite: "auto",
      });
      return;
    }

    gsap.to(panel, {
      autoAlpha: 0,
      y: 14,
      duration: reduceMotion ? 0 : 0.2,
      ease: "power2.in",
      overwrite: "auto",
      onComplete: () => {
        if (!openRef.current) onClosedRef.current();
      },
    });
  }, {
    scope: panelRef,
    dependencies: [open],
  });

  useEffect(() => {
    if (status === "connected") writePendingCommand();
  }, [commandRequest, status]);

  return (
    <section
      ref={panelRef}
      className={`pi-console-panel ${open ? "is-open" : "is-closing"}`}
      aria-label={t("piConsole")}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div
        className="pi-console-resize-handle"
        role="separator"
        aria-label={t("resizeTerminal")}
        aria-orientation="horizontal"
        aria-valuemin={180}
        aria-valuemax={Math.max(180, window.innerHeight - 180)}
        aria-valuenow={height}
        tabIndex={0}
        onDoubleClick={() => onResize(window.innerHeight * 0.38, true)}
        onKeyDown={(event) => {
          let nextHeight = height;
          if (event.key === "ArrowUp") nextHeight += 16;
          else if (event.key === "ArrowDown") nextHeight -= 16;
          else if (event.key === "PageUp") nextHeight += 64;
          else if (event.key === "PageDown") nextHeight -= 64;
          else if (event.key === "Home") nextHeight = 180;
          else if (event.key === "End") nextHeight = window.innerHeight - 180;
          else return;
          event.preventDefault();
          onResize(nextHeight, true);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          resizeState.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: height,
            latestHeight: height,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const state = resizeState.current;
          if (state === null || state.pointerId !== event.pointerId) return;
          const nextHeight = state.startHeight + state.startY - event.clientY;
          state.latestHeight = nextHeight;
          onResize(nextHeight, false);
        }}
        onPointerUp={(event) => finishResize(event.pointerId)}
        onPointerCancel={(event) => finishResize(event.pointerId)}
        onLostPointerCapture={(event) => finishResize(event.pointerId)}
      />
      <header className="pi-console-panel-header">
        <div className="pi-console-tab">
          <Icon name="terminal" size={14} />
          <strong>{t("piConsole")}</strong>
          <span className={`pi-console-indicator pi-console-indicator--${status}`} aria-hidden="true" />
        </div>
        <div className="pi-console-panel-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("restartConsole")}
            onClick={() => {
              terminalRef.current?.reset();
              receivedProcessDataRef.current = false;
              setStatus("starting");
              setErrorMessage(null);
              void window.piWork.piConsole.restart(cwd === undefined ? {} : { cwd }).then((result) => {
                if (result.started) {
                  setStatus("connected");
                  requestAnimationFrame(() => terminalRef.current?.focus());
                } else {
                  setStatus("error");
                  setErrorMessage(result.message);
                }
              });
            }}
          >
            <Icon name="refresh" size={14} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("close")} onClick={closePanel}>
            <Icon name="close" size={14} />
          </Button>
        </div>
      </header>
      <div className="pi-console-terminal" ref={setTerminalElement} onPointerDown={() => terminalRef.current?.focus()}>
        {status !== "connected" ? <div className={`pi-console-status pi-console-status--${status}`}>
          {status === "starting" ? t("piConsoleDescription") : errorMessage ?? t("consoleStopped")}
        </div> : null}
      </div>
    </section>
  );
}
