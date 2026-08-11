import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Icon } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import type { MessageKey } from "../i18n.js";

type T = (key: MessageKey) => string;

export function BrowserPage({ t }: { t: T }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("https://example.com");
  const [state, setState] = useState({ url: "", title: "", canGoBack: false, canGoForward: false, loading: false });
  useEffect(() => {
    const removeState = window.piWork.browser.onState((next) => {
      setState(next);
      if (next.url) setAddress(next.url);
    });
    const host = hostRef.current;
    if (host === null) return removeState;
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
    void window.piWork.browser.open(address);
    return () => {
      observer.disconnect();
      removeState();
      void window.piWork.browser.close();
    };
  }, []);
  return (
    <section className="browser-page">
      <Alert className="browser-privacy"><Icon name="lock" /><AlertDescription>{t("browserPrivacy")}</AlertDescription></Alert>
      <header className="browser-toolbar">
        <Button variant="ghost" size="icon" aria-label={t("back")} disabled={!state.canGoBack} onClick={() => void window.piWork.browser.back()}><Icon name="back" /></Button>
        <Button variant="ghost" size="icon" aria-label={t("forward")} disabled={!state.canGoForward} onClick={() => void window.piWork.browser.forward()}><Icon name="forward" /></Button>
        <Button variant="ghost" size="icon" aria-label={t("reload")} onClick={() => void window.piWork.browser.reload()}><Icon name={state.loading ? "close" : "refresh"} /></Button>
        <form onSubmit={(event) => { event.preventDefault(); void window.piWork.browser.navigate(address); }}>
          <Icon name="lock" size={14} />
          <Input aria-label={t("address")} value={address} onChange={(event) => setAddress(event.target.value)} />
        </form>
        <Button variant="ghost" size="icon" aria-label={t("openExternal")} onClick={() => void window.piWork.browser.openExternal()}><Icon name="external" /></Button>
      </header>
      <div className="browser-titlebar"><span>{state.loading ? t("loading") : state.title || t("browser")}</span></div>
      <div className="browser-host" ref={hostRef} aria-label={state.title || t("browser")} />
    </section>
  );
}
