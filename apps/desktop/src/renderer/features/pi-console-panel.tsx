import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "../components/ui/button.js";
import { Icon } from "../components/ui/icon.js";
import type { MessageKey } from "../i18n.js";

type T = (key: MessageKey) => string;

export function PiConsolePanel({
  commandRequest,
  open,
  t,
  onClose,
}: {
  commandRequest: { id: number; value: string } | null;
  open: boolean;
  t: T;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [terminalElement, setTerminalElement] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const receivedProcessDataRef = useRef(false);
  const commandRequestRef = useRef(commandRequest);
  const handledCommandIdRef = useRef<number | null>(null);
  const translationRef = useRef(t);
  const [status, setStatus] = useState<"starting" | "connected" | "stopped" | "error">("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  translationRef.current = t;
  commandRequestRef.current = commandRequest;

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
        theme: { background: "#111214", foreground: "#e7e7e9", cursor: "#f2f2f2", selectionBackground: "#ffffff2b" },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(terminalElement);
      terminal.writeln(`\x1b[90m${translationRef.current("piConsoleDescription")}\x1b[0m`);
      terminalRef.current = terminal;
      receivedProcessDataRef.current = false;
      let resizeFrame: number | null = null;
      let lastSize = { cols: 0, rows: 0 };
      const resize = () => {
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          fit.fit();
          if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) return;
          lastSize = { cols: terminal.cols, rows: terminal.rows };
          void window.piWork.piConsole.resize(lastSize);
        });
      };
      const observer = new ResizeObserver(resize);
      observer.observe(terminalElement);
      const unsubscribe = window.piWork.piConsole.onEvent((event) => {
        if (event.type === "data") {
          receivedProcessDataRef.current = true;
          terminal.write(event.data);
        }
        if (event.type === "started") {
          setStatus("connected");
          resize();
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
      void window.piWork.piConsole.start().then((result) => {
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
      requestAnimationFrame(resize);
      requestAnimationFrame(() => terminal.focus());

      return () => {
        for (const timer of recoveryTimers) window.clearTimeout(timer);
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

  useEffect(() => {
    if (status === "connected") writePendingCommand();
  }, [commandRequest, status]);

  return (
    <section
      className={`pi-console-panel ${open ? "is-open" : "is-closing"}`}
      aria-label={t("piConsole")}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
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
              void window.piWork.piConsole.restart().then((result) => {
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
