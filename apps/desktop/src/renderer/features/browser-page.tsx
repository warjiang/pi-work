import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { FieldLabel } from "@/components/ui/field.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import type { MessageKey } from "@/i18n.js";

type T = (key: MessageKey) => string;

export function BrowserPage({ t }: { t: T }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState({ url: "", title: "", canGoBack: false, canGoForward: false, loading: false });
  useEffect(() => {
    const removeState = window.piWork.browser.onState((next) => {
      setState(next);
      if (next.url) setAddress(next.url);
    });
    return () => {
      removeState();
      void window.piWork.browser.close();
    };
  }, []);
  useEffect(() => {
    if (!opened) return;
    const host = hostRef.current;
    if (host === null) return;
    const updateBounds = () => {
      const bounds = host.getBoundingClientRect();
      void window.piWork.browser.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(host);
    updateBounds();
    return () => {
      observer.disconnect();
    };
  }, [opened]);
  const open = () => {
    if (!address.trim()) return;
    setError(null);
    setOpened(true);
    void window.piWork.browser.open(address).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t("invalidUrl"));
      setOpened(false);
      void window.piWork.browser.close();
    });
  };
  const navigate = () => {
    setError(null);
    void window.piWork.browser.navigate(address).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t("invalidUrl"));
    });
  };
  return (
    <section className="browser-page">
      <Alert className="browser-privacy"><Icon name="lock" /><AlertDescription>{t("browserPrivacy")}</AlertDescription></Alert>
      {opened ? (
        <>
          <header className="browser-toolbar">
            <Button variant="ghost" size="icon" aria-label={t("back")} disabled={!state.canGoBack} onClick={() => void window.piWork.browser.back()}><Icon name="back" /></Button>
            <Button variant="ghost" size="icon" aria-label={t("forward")} disabled={!state.canGoForward} onClick={() => void window.piWork.browser.forward()}><Icon name="forward" /></Button>
            <Button variant="ghost" size="icon" aria-label={t("reload")} onClick={() => void window.piWork.browser.reload()}><Icon name={state.loading ? "close" : "refresh"} /></Button>
            <form onSubmit={(event) => { event.preventDefault(); navigate(); }}>
              <Icon name="lock" size={14} />
              <Input aria-label={t("address")} value={address} onChange={(event) => setAddress(event.target.value)} />
            </form>
            <Button variant="ghost" size="icon" aria-label={t("openExternal")} onClick={() => void window.piWork.browser.openExternal()}><Icon name="external" /></Button>
          </header>
          {error ? <p className="browser-error">{error}</p> : null}
          <div className="browser-titlebar"><span>{state.loading ? t("loading") : state.title || t("browser")}</span></div>
          <div className="browser-host" ref={hostRef} aria-label={state.title || t("browser")} />
        </>
      ) : (
        <div className="browser-launch">
          <div className="browser-launch-copy">
            <span className="browser-launch-icon"><Icon name="browser" /></span>
            <h2>{t("browser")}</h2>
            <p>{t("browserLaunchDetail")}</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); open(); }}>
            <FieldLabel>{t("address")}</FieldLabel>
            <div>
              <Input
                autoFocus
                value={address}
                placeholder="https://example.com"
                onChange={(event) => setAddress(event.target.value)}
              />
              <Button type="submit" disabled={!address.trim()}>{t("openBrowser")}</Button>
            </div>
          </form>
          {error ? <p className="browser-error">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
