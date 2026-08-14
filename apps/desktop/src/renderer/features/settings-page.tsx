import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gsap } from "gsap";
import type {
  AppSettings,
  BuildInfo,
  ModelCatalog,
  ProviderConfig,
  Workspace,
} from "@pi-work/protocol";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command.js";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field.js";
import { Icon } from "@/components/ui/icon.js";
import type { IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Spinner } from "@/components/ui/spinner.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { PiMark } from "@/components/pi-mark.js";
import type { MessageKey } from "@/i18n.js";
import type { SettingsSection } from "@/store.js";
import { BrowserPage } from "./browser-page.js";
import { McpSettingsPage, SkillsPage } from "./workspace-pages.js";
import {
  extensionCatalog,
  isCatalogExtensionInstalled,
  normalizeExtensionSource,
  type ExtensionCatalogCategory,
  type ExtensionCatalogItem,
} from "./extension-catalog.js";

gsap.registerPlugin(useGSAP);

type T = (key: MessageKey) => string;

export const settingsNavigationGroups = [
  {
    label: "settingsGroupGeneral",
    sections: [
      { id: "general", icon: "sliders" },
    ],
  },
  {
    label: "settingsGroupWorkspace",
    sections: [
      { id: "modelsCredentials", icon: "models" },
    ],
  },
  {
    label: "settingsGroupTools",
    sections: [
      { id: "skills", icon: "skills" },
      { id: "mcp", icon: "source" },
      { id: "extensions", icon: "extensions" },
      { id: "browser", icon: "browser" },
    ],
  },
  {
    label: "settingsGroupInfo",
    sections: [
      { id: "about", icon: "info" },
    ],
  },
] as const satisfies ReadonlyArray<{
  label: MessageKey;
  sections: ReadonlyArray<{ id: SettingsSection; icon: IconName }>;
}>;

export function SettingsPage(props: {
  section: SettingsSection;
  settings: AppSettings;
  buildInfo: BuildInfo;
  workspaces: Workspace[];
  providers: ProviderConfig[];
  models: ModelCatalog | undefined;
  t: T;
  onSectionChange(section: SettingsSection): void;
  onClose(): void;
  onUpdate(value: Partial<AppSettings>): Promise<unknown>;
  onAddWorkspace(): Promise<Workspace | null>;
  onAddWorkspaceDirectory(workspaceId: string): Promise<Workspace | null>;
  onProvidersChanged(): Promise<unknown>;
  onModelsRefresh(): Promise<unknown>;
  onRestartOnboarding(): Promise<unknown>;
  consoleOpen?: boolean;
  consolePanel?: ReactNode;
  onOpenConsole?(command?: string | null): void;
  onToggleConsole?(): void;
}) {
  const consoleOpen = props.consoleOpen ?? false;
  const activeSection = props.section === "appearance" || props.section === "shortcuts" ? "general" : props.section;
  const sectionTitle = props.t(activeSection);
  return (
    <section className={`settings-shell${consoleOpen ? " pi-console-open" : ""}`} aria-label={props.t("settings")}>
      <header className="settings-titlebar">
        <Button variant="ghost" className="settings-back" onClick={props.onClose}>
          <Icon name="back" />
          <span>{props.t("backToWorkspace")}</span>
        </Button>
        <div className="settings-titlebar-actions">
          <Button
            variant="ghost"
            size="icon"
            className={`topbar-console-trigger${consoleOpen ? " is-active" : ""}`}
            aria-label={props.t("piConsole")}
            aria-pressed={consoleOpen}
            onClick={props.onToggleConsole}
          >
            <Icon name="terminal" />
          </Button>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={props.t("settings")}>
          {settingsNavigationGroups.map((group) => (
            <section className="settings-nav-group" key={group.label}>
              <header>{props.t(group.label)}</header>
              {group.sections.map(({ id, icon }) => (
                <Button
                  type="button"
                  variant="ghost"
                  className={activeSection === id ? "selected" : ""}
                  key={id}
                  aria-current={activeSection === id ? "page" : undefined}
                  onClick={() => props.onSectionChange(id)}
                >
                  <Icon name={icon} />
                  <span>{props.t(id)}</span>
                </Button>
              ))}
            </section>
          ))}
        </nav>
        <main className={`settings-content ${props.section === "browser" ? "browser-settings-content" : ""}`}>
          {props.section === "browser" ? (
            <div className="settings-content-inner settings-content-inner--browser">
              <BrowserPage t={props.t} />
            </div>
          ) : (
            <div className={`settings-content-inner settings-content-inner--${activeSection}`}>
              <header className="settings-page-heading">
                <h1>{sectionTitle}</h1>
                {activeSection === "mcp" ? <p>{props.t("mcpSettingsDetail")}</p> : null}
              </header>
              {activeSection === "general" ? <GeneralSettings {...props} /> : null}
              {activeSection === "modelsCredentials" ? <ModelSettings {...props} /> : null}
              {activeSection === "workFolders" ? <FolderSettings {...props} /> : null}
              {activeSection === "permissions" ? <PermissionSettings {...props} /> : null}
              {activeSection === "skills" ? <SkillsPage embedded t={props.t} /> : null}
              {activeSection === "mcp" ? <McpSettingsPage t={props.t} /> : null}
              {activeSection === "extensions" ? <ExtensionSettings language={props.settings.language} t={props.t} onOpenConsole={(command) => props.onOpenConsole?.(command)} /> : null}
              {activeSection === "about" ? <AboutSettings buildInfo={props.buildInfo} t={props.t} /> : null}
            </div>
          )}
        </main>
        {props.consolePanel}
      </div>
    </section>
  );
}

type BaseProps = {
  settings: AppSettings;
  workspaces: Workspace[];
  providers: ProviderConfig[];
  models: ModelCatalog | undefined;
  t: T;
  onUpdate(value: Partial<AppSettings>): Promise<unknown>;
  onAddWorkspace(): Promise<Workspace | null>;
  onAddWorkspaceDirectory(workspaceId: string): Promise<Workspace | null>;
  onProvidersChanged(): Promise<unknown>;
  onModelsRefresh(): Promise<unknown>;
  onRestartOnboarding(): Promise<unknown>;
};

function SettingsSectionBlock(props: { className?: string; title: string; detail?: string; showTitle?: boolean; children: ReactNode }) {
  const showHeader = props.showTitle !== false || props.detail;
  return <section className={`settings-section${props.className ? ` ${props.className}` : ""}`}>{showHeader ? <header>{props.showTitle !== false ? <h2>{props.title}</h2> : null}{props.detail ? <p>{props.detail}</p> : null}</header> : null}<div>{props.children}</div></section>;
}

function SettingsSubsection(props: { className?: string; title?: string; detail?: string; children: ReactNode }) {
  return <section className={`settings-subsection${props.className ? ` ${props.className}` : ""}`}>{props.title || props.detail ? <header>{props.title ? <h2>{props.title}</h2> : null}{props.detail ? <p>{props.detail}</p> : null}</header> : null}{props.children}</section>;
}

function GeneralSettings(props: BaseProps & { buildInfo: BuildInfo }) {
  return <SettingsSectionBlock className="settings-general" title={props.t("general")} showTitle={false}>
    <div className="settings-general-layout">
      <section className="settings-general-preferences">
        <div className="settings-language-row">
          <div>
            <strong>{props.t("language")}</strong>
            <small>English · 简体中文</small>
          </div>
          <div className="settings-choice-group" role="group" aria-label={props.t("language")}>
            <Button type="button" variant="ghost" size="sm" className={props.settings.language === "en" ? "is-selected" : ""} aria-pressed={props.settings.language === "en"} onClick={() => void props.onUpdate({ language: "en" })}>English</Button>
            <Button type="button" variant="ghost" size="sm" className={props.settings.language === "zh-CN" ? "is-selected" : ""} aria-pressed={props.settings.language === "zh-CN"} onClick={() => void props.onUpdate({ language: "zh-CN" })}>简体中文</Button>
          </div>
        </div>
        <AppearanceSettings {...props} />
      </section>
      <aside className="settings-general-utilities">
        <SettingsSubsection className="settings-utility-onboarding" title={props.t("onboardingTitle")} detail={props.t("onboardingAppearanceDetail")}>
          <Button variant="outline" size="sm" onClick={() => void props.onRestartOnboarding()}>{props.t("restartOnboarding")}</Button>
        </SettingsSubsection>
        <ShortcutSettings t={props.t} />
      </aside>
    </div>
  </SettingsSectionBlock>;
}

function ModelSettings(props: BaseProps) {
  const [providerId, setProviderId] = useState("");
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(() => (
    props.providers.some((provider) => provider.providerId === props.settings.providerId)
      ? props.settings.providerId
      : (props.providers[0]?.providerId ?? null)
  ));
  const [apiKey, setApiKey] = useState("");
  const [removeProvider, setRemoveProvider] = useState<string | null>(null);
  const [modelsRefreshed, setModelsRefreshed] = useState(false);
  const [credentialSaved, setCredentialSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelToggleError, setModelToggleError] = useState<string | null>(null);
  const [modelTogglePending, setModelTogglePending] = useState<string | null>(null);
  const [selectedTestKeys, setSelectedTestKeys] = useState<Set<string>>(() => new Set());
  const [modelTestError, setModelTestError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const refreshFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const refreshGlyphRef = useRef<HTMLSpanElement>(null);
  const refreshCheckRef = useRef<HTMLSpanElement>(null);
  const refreshLabelRef = useRef<HTMLSpanElement>(null);
  const refreshTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const providerOptions = useMemo(() => Array.from(new Map((props.models?.models ?? []).map((model) => [model.providerId, model.providerName])).entries()), [props.models]);
  const providerNames = useMemo(() => new Map(providerOptions), [providerOptions]);
  const defaultModelKey = props.settings.providerId && props.settings.modelId ? `${props.settings.providerId}/${props.settings.modelId}` : "";
  const disabledModelKeys = useMemo(() => new Set(props.settings.disabledModelKeys ?? []), [props.settings.disabledModelKeys]);
  const providerModels = useMemo(() => new Map(
    props.providers.map((provider) => [
      provider.providerId,
      (props.models?.models ?? [])
        .filter((model) => model.providerId === provider.providerId),
    ]),
  ), [props.models, props.providers]);
  const selectedProviderModels = selectedProviderId ? (providerModels.get(selectedProviderId) ?? []) : [];
  const selectedProviderEnabledModels = selectedProviderModels.filter((model) => !disabledModelKeys.has(`${model.providerId}/${model.modelId}`));
  const selectedProviderTestModels = selectedProviderModels.filter((model) => selectedTestKeys.has(`${model.providerId}/${model.modelId}`));
  const allProviderModelsSelected = selectedProviderModels.length > 0 && selectedProviderTestModels.length === selectedProviderModels.length;
  const testModels = useMutation({
    mutationFn: (models: Array<{ providerId: string; modelId: string }>) => window.piWork.model.test({ models }),
    onSuccess: async () => {
      setModelTestError(null);
      setSelectedTestKeys(new Set());
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (cause: Error) => setModelTestError(cause.message),
  });
  const save = useMutation({
    mutationFn: () => window.piWork.provider.save({ providerId, apiKey }),
    onSuccess: async () => {
      setApiKey("");
      setProviderId("");
      setAddProviderOpen(false);
      setSaveError(null);
      if (saveFeedbackTimer.current !== null) clearTimeout(saveFeedbackTimer.current);
      setCredentialSaved(true);
      saveFeedbackTimer.current = setTimeout(() => {
        setCredentialSaved(false);
        saveFeedbackTimer.current = null;
      }, 2400);
      await props.onProvidersChanged();
    },
    onError: (cause: Error) => {
      setCredentialSaved(false);
      setSaveError(cause.message);
    },
  });
  const refreshModels = useMutation({
    mutationFn: props.onModelsRefresh,
    onSuccess: () => {
      if (refreshFeedbackTimer.current !== null) clearTimeout(refreshFeedbackTimer.current);
      setModelsRefreshed(true);
      refreshFeedbackTimer.current = setTimeout(() => {
        setModelsRefreshed(false);
        refreshFeedbackTimer.current = null;
      }, 1400);
    },
    onError: () => setModelsRefreshed(false),
  });
  useGSAP(() => {
    const button = refreshButtonRef.current;
    const refreshGlyph = refreshGlyphRef.current;
    const checkGlyph = refreshCheckRef.current;
    const label = refreshLabelRef.current;
    if (!button || !refreshGlyph || !checkGlyph || !label) return;

    refreshTimelineRef.current?.kill();
    gsap.killTweensOf([button, refreshGlyph, checkGlyph, label]);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      gsap.set(button, { clearProps: "transform" });
      gsap.set(label, { clearProps: "transform,opacity,visibility" });
      gsap.set(refreshGlyph, { autoAlpha: modelsRefreshed ? 0 : 1, rotation: 0, scale: 1 });
      gsap.set(checkGlyph, { autoAlpha: modelsRefreshed ? 1 : 0, rotation: 0, scale: 1 });
      return;
    }

    if (refreshModels.isPending) {
      const currentRotation = Number(gsap.getProperty(refreshGlyph, "rotation")) || 0;
      const spin = gsap.timeline({ repeat: -1 })
        .to(refreshGlyph, { rotation: currentRotation + 360, duration: 1.35, ease: "none" });
      refreshTimelineRef.current = gsap.timeline({ defaults: { ease: "power2.out" } })
        .addLabel("press")
        .to(button, { scale: 0.985, duration: 0.1 }, "press")
        .to(button, { scale: 1, duration: 0.24 }, ">")
        .set(checkGlyph, { autoAlpha: 0, scale: 0.65 }, "press")
        .set(refreshGlyph, { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%" }, "press")
        .set(label, { autoAlpha: 1, y: 0 }, "press")
        .addLabel("spin", "press+=0.05")
        .add(spin, "spin");
      return;
    }

    if (modelsRefreshed) {
      const currentRotation = Number(gsap.getProperty(refreshGlyph, "rotation")) || 0;
      const nextFullTurn = Math.ceil((currentRotation + 1) / 360) * 360;
      const settleDuration = gsap.utils.clamp(0.16, 0.72, ((nextFullTurn - currentRotation) / 360) * 1.35);
      refreshTimelineRef.current = gsap.timeline({ defaults: { ease: "power2.out" } })
        .addLabel("settle")
        .set(label, { autoAlpha: 1, y: 0 }, "settle")
        .to(refreshGlyph, { rotation: nextFullTurn, duration: settleDuration, ease: "power1.out" }, "settle")
        .addLabel("complete", ">-0.04")
        .to(refreshGlyph, { autoAlpha: 0, scale: 0.72, duration: 0.16 }, "complete")
        .fromTo(checkGlyph, { autoAlpha: 0, scale: 0.55, rotation: -18 }, {
          autoAlpha: 1,
          scale: 1,
          rotation: 0,
          duration: 0.38,
          ease: "back.out(2.2)",
        }, "complete+=0.04")
        .fromTo(button, { scale: 0.98 }, { scale: 1, duration: 0.32, ease: "back.out(1.8)" }, "complete");
      return;
    }

    const checkVisible = Number(gsap.getProperty(checkGlyph, "opacity")) > 0.1;
    if (!checkVisible) {
      gsap.set(button, { scale: 1 });
      gsap.set(refreshGlyph, { autoAlpha: 1, rotation: 0, scale: 1 });
      gsap.set(checkGlyph, { autoAlpha: 0, rotation: 0, scale: 0.65 });
      gsap.set(label, { autoAlpha: 1, y: 0 });
      return;
    }

    refreshTimelineRef.current = gsap.timeline({ defaults: { ease: "power2.out" } })
      .addLabel("reset")
      .to(checkGlyph, { autoAlpha: 0, scale: 0.65, duration: 0.14 }, "reset")
      .set(refreshGlyph, { rotation: 0 }, "reset")
      .to(refreshGlyph, { autoAlpha: 1, scale: 1, duration: 0.2 }, "reset+=0.08")
      .fromTo(label, { autoAlpha: 0, y: 2 }, { autoAlpha: 1, y: 0, duration: 0.18 }, "reset+=0.06");
  }, {
    scope: refreshButtonRef,
    dependencies: [refreshModels.isPending, modelsRefreshed],
  });
  const handleRefreshModels = () => {
    if (refreshFeedbackTimer.current !== null) {
      clearTimeout(refreshFeedbackTimer.current);
      refreshFeedbackTimer.current = null;
    }
    setModelsRefreshed(false);
    refreshModels.mutate();
  };
  useEffect(() => () => {
    if (refreshFeedbackTimer.current !== null) clearTimeout(refreshFeedbackTimer.current);
    if (saveFeedbackTimer.current !== null) clearTimeout(saveFeedbackTimer.current);
  }, []);
  useEffect(() => {
    if (selectedProviderId !== null && props.providers.some((provider) => provider.providerId === selectedProviderId)) return;
    setSelectedProviderId(props.settings.providerId && props.providers.some((provider) => provider.providerId === props.settings.providerId)
      ? props.settings.providerId
      : (props.providers[0]?.providerId ?? null));
  }, [props.providers, props.settings.providerId, selectedProviderId]);
  function selectModel(providerId: string, modelId: string) {
    if (disabledModelKeys.has(`${providerId}/${modelId}`)) return;
    const model = (props.models?.models ?? []).find((candidate) => candidate.providerId === providerId && candidate.modelId === modelId);
    if (!model) return;
    void props.onUpdate({
      providerId: model.providerId,
      modelId: model.modelId,
      thinkingLevel: model.thinkingLevels.includes(props.settings.thinkingLevel) ? props.settings.thinkingLevel : (model.thinkingLevels[0] ?? "off"),
    });
  }
  async function toggleModel(model: ModelCatalog["models"][number], enabled: boolean) {
    const key = `${model.providerId}/${model.modelId}`;
    const nextDisabled = new Set(disabledModelKeys);
    if (enabled) nextDisabled.delete(key);
    else nextDisabled.add(key);

    const update: Partial<AppSettings> = { disabledModelKeys: [...nextDisabled] };
    if (!enabled && key === defaultModelKey) {
      const fallback = props.providers.flatMap(({ providerId }) => (
        (props.models?.models ?? []).filter((candidate) => (
          candidate.providerId === providerId
          && !nextDisabled.has(`${candidate.providerId}/${candidate.modelId}`)
        ))
      )).find(Boolean);
      update.providerId = fallback?.providerId ?? null;
      update.modelId = fallback?.modelId ?? null;
      update.thinkingLevel = fallback?.thinkingLevels.includes(props.settings.thinkingLevel)
        ? props.settings.thinkingLevel
        : (fallback?.thinkingLevels[0] ?? "off");
    }
    setModelToggleError(null);
    setModelTogglePending(key);
    try {
      await props.onUpdate(update);
    } catch (cause) {
      setModelToggleError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModelTogglePending(null);
    }
  }
  function toggleTestSelection(key: string) {
    setSelectedTestKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAllTestSelection() {
    setSelectedTestKeys((current) => {
      const next = new Set(current);
      if (allProviderModelsSelected) {
        selectedProviderModels.forEach((model) => next.delete(`${model.providerId}/${model.modelId}`));
      } else {
        selectedProviderModels.forEach((model) => next.add(`${model.providerId}/${model.modelId}`));
      }
      return next;
    });
  }
  function clearTestSelection() {
    setSelectedTestKeys((current) => {
      const next = new Set(current);
      selectedProviderModels.forEach((model) => next.delete(`${model.providerId}/${model.modelId}`));
      return next;
    });
  }
  function runModelTests(models: Array<{ providerId: string; modelId: string }>) {
    if (models.length === 0 || testModels.isPending) return;
    setModelTestError(null);
    testModels.mutate(models);
  }
  async function remove() {
    if (removeProvider === null) return;
    await window.piWork.provider.remove(removeProvider);
    if (props.settings.providerId === removeProvider) await props.onUpdate({ providerId: null, modelId: null });
    setRemoveProvider(null);
    await props.onProvidersChanged();
  }
  return <>
    <SettingsSectionBlock className="model-settings" title={props.t("modelsCredentials")} detail={props.t("credentialDetail")} showTitle={false}>
      <section className="model-default-section">
        <div className="model-current-control">
          <div>
            <strong>{props.t("defaultModel")}</strong>
            <small>{props.t("defaultModelDetail")}</small>
          </div>
          <span className="model-current-value">{defaultModelKey ? modelOptionsLabel(props.models, props.settings.providerId, props.settings.modelId) : props.t("noModel")}</span>
        </div>
      </section>
      <section className="connected-providers" aria-label={props.t("connectedProviders")}>
        <header>
          <div>
            <h3>{props.t("connectedProviders")}</h3>
            <p>{props.t("connectedProvidersDetail")}</p>
          </div>
          <div className="connected-provider-actions">
            <Button
              ref={refreshButtonRef}
              variant="outline"
              size="sm"
              className={`model-refresh-button${refreshModels.isPending ? " is-refreshing" : modelsRefreshed ? " is-complete" : ""}`}
              disabled={refreshModels.isPending}
              onClick={handleRefreshModels}
            >
              <span className="model-refresh-icon" aria-hidden="true">
                <span ref={refreshGlyphRef} className="model-refresh-glyph"><Icon name="refresh" /></span>
                <span ref={refreshCheckRef} className="model-refresh-check"><Icon name="check" /></span>
              </span>
              <span
                ref={refreshLabelRef}
                className="model-refresh-label"
                aria-live="polite"
              >
                {props.t(refreshModels.isPending ? "refreshingModels" : modelsRefreshed ? "modelsRefreshed" : "refreshModels")}
              </span>
            </Button>
            <Button type="button" variant={addProviderOpen ? "secondary" : "outline"} size="sm" className="model-add-trigger" aria-expanded={addProviderOpen} onClick={() => {
              setAddProviderOpen((open) => !open);
              setSaveError(null);
            }}><Icon name={addProviderOpen ? "close" : "plus"} />{addProviderOpen ? props.t("cancel") : props.t("addProvider")}</Button>
          </div>
        </header>
        {addProviderOpen ? <section className="model-add-panel" aria-label={props.t("addProvider")}>
          <div className="model-add-panel-heading">
            <strong>{props.t("addProvider")}</strong>
            <small>{props.t("addProviderDetail")}</small>
          </div>
          <FieldGroup className="credential-form">
            <Field><FieldLabel>{props.t("provider")}</FieldLabel><Popover open={providerMenuOpen} onOpenChange={setProviderMenuOpen}><PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={providerMenuOpen} className="provider-combobox-trigger"><span>{providerId ? providerDisplayName(providerNames.get(providerId) ?? providerId) : props.t("provider")}</span><Icon name="chevron-down" size={14} /></Button></PopoverTrigger><PopoverContent className="provider-combobox-content"><Command><CommandInput autoFocus placeholder={props.t("searchProviders")} /><CommandList><CommandEmpty>{props.t("noProvidersFound")}</CommandEmpty><CommandGroup>{providerOptions.map(([id, name]) => <CommandItem key={id} value={id} keywords={[name, id]} onSelect={() => { setProviderId(id); setProviderMenuOpen(false); }}><span>{providerDisplayName(name)}</span>{providerId === id ? <Icon name="check" size={14} className="ml-auto" /> : null}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></Field>
            <Field><FieldLabel>{props.t("apiKey")}</FieldLabel><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
            <Button disabled={!providerId || !apiKey || save.isPending} onClick={() => save.mutate()}><Icon name="plus" />{save.isPending ? props.t("saving") : props.t("addProvider")}</Button>
            {saveError !== null ? <Alert className="form-error credential-form-notice"><AlertDescription>{saveError}</AlertDescription></Alert> : null}
            <p className="credential-saved" role="status" aria-live="polite">{credentialSaved ? <><Icon name="check" size={14} />{props.t("credentialSaved")}</> : null}</p>
          </FieldGroup>
        </section> : null}
        {props.providers.length === 0 ? <p className="credential-empty-state">{props.t("noCredentials")}</p> : (
          <div className="model-workspace">
            <aside className="model-provider-nav" aria-label={props.t("connectedProviders")}>
              {props.providers.map((provider) => {
                const availableModels = providerModels.get(provider.providerId) ?? [];
                const providerName = providerDisplayName(providerNames.get(provider.providerId) ?? provider.providerId);
                const enabledModels = availableModels.filter((model) => !disabledModelKeys.has(`${model.providerId}/${model.modelId}`));
                return <Button
                  type="button"
                  variant="ghost"
                  key={provider.providerId}
                  className={selectedProviderId === provider.providerId ? "selected" : ""}
                  aria-pressed={selectedProviderId === provider.providerId}
                  onClick={() => {
                    setSelectedProviderId(provider.providerId);
                    setSelectedTestKeys(new Set());
                  }}
                >
                  <span className="credential-provider-status"><Icon name="check-circle" size={14} /></span>
                  <span><strong>{providerName}</strong><small>{enabledModels.length}/{availableModels.length} {props.t("enabled").toLocaleLowerCase()}</small></span>
                </Button>;
              })}
            </aside>
            {selectedProviderId ? <section className="model-provider-detail">
              <header>
                <div>
                  <strong>{providerDisplayName(providerNames.get(selectedProviderId) ?? selectedProviderId)}</strong>
                  <small>{props.t("credentialStored")}</small>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRemoveProvider(selectedProviderId)}>{props.t("removeCredential")}</Button>
              </header>
              <div className={`model-test-toolbar${selectedProviderTestModels.length > 0 ? " has-selection" : ""}`}>
                <div className="model-test-selection-summary" aria-live="polite">
                  {selectedProviderTestModels.length > 0 ? <strong>{selectedProviderTestModels.length}</strong> : <Icon name="check-circle" size={14} />}
                  <span>{props.t(selectedProviderTestModels.length > 0 ? "modelsSelectedForTest" : "selectModelsForTest")}</span>
                  {selectedProviderTestModels.length > 0 ? <Button type="button" variant="ghost" size="sm" onClick={clearTestSelection}>{props.t("clearSelection")}</Button> : null}
                </div>
                <div className="model-test-actions">
                  <Button
                    variant={selectedProviderTestModels.length > 0 ? "default" : "outline"}
                    size="sm"
                    disabled={selectedProviderTestModels.length === 0 || testModels.isPending}
                    onClick={() => runModelTests(selectedProviderTestModels)}
                  >
                    <Icon name={testModels.isPending ? "refresh" : "play"} className={testModels.isPending ? "is-spinning" : undefined} />
                    {props.t(testModels.isPending ? "testingModels" : "testSelectedModels")}
                    {selectedProviderTestModels.length > 0 && !testModels.isPending ? <span className="model-test-button-count">{selectedProviderTestModels.length}</span> : null}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={selectedProviderEnabledModels.length === 0 || testModels.isPending}
                    onClick={() => runModelTests(selectedProviderEnabledModels)}
                  >
                    {props.t("testEnabledModels")}
                  </Button>
                </div>
              </div>
              <div className="model-list-heading">
                <span>
                  <button
                    type="button"
                    className={`model-test-checkbox${allProviderModelsSelected ? " is-checked" : ""}`}
                    aria-label={props.t("selectAllModels")}
                    aria-pressed={allProviderModelsSelected}
                    disabled={selectedProviderModels.length === 0 || testModels.isPending}
                    onClick={toggleAllTestSelection}
                  >
                    {allProviderModelsSelected ? <Icon name="check" size={14} /> : null}
                  </button>
                  {props.t("model")}
                </span>
                <span>{props.t("result")}</span>
                <span>{props.t("defaultModel")}</span>
                <span><em>{props.t("enabled")}</em></span>
              </div>
              <div className="model-option-list">
                {selectedProviderModels.length > 0
                  ? selectedProviderModels.map((model) => {
                    const isDefault = defaultModelKey === `${model.providerId}/${model.modelId}`;
                    const key = `${model.providerId}/${model.modelId}`;
                    const isDisabled = disabledModelKeys.has(key);
                    const testResult = props.settings.modelTestResults[key];
                    const isSelectedForTest = selectedTestKeys.has(key);
                    const isTesting = testModels.isPending && (testModels.variables ?? []).some((candidate) => `${candidate.providerId}/${candidate.modelId}` === key);
                    return <div key={model.modelId} className={`model-option${isDefault ? " is-default" : ""}${isDisabled ? " is-disabled" : ""}${isSelectedForTest ? " is-selected-for-test" : ""}`}>
                      <button
                        type="button"
                        className="model-option-selection"
                        aria-pressed={isSelectedForTest}
                        disabled={testModels.isPending}
                        onClick={() => toggleTestSelection(key)}
                      >
                        <span className={`model-test-checkbox${isSelectedForTest ? " is-checked" : ""}`}>
                          {isSelectedForTest ? <Icon name="check" size={14} /> : null}
                        </span>
                        <span className="model-option-info">
                          <code title={model.modelId}>{model.modelName}</code>
                        </span>
                      </button>
                      <span className={`model-test-result${isTesting ? " is-testing" : testResult ? (testResult.success ? " is-success" : " is-failed") : ""}`} title={testResult?.message}>
                        <i />
                        {isTesting ? props.t("testingModels") : testResult ? modelTestResultLabel(testResult, props.settings.language, props.t) : "—"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`model-default-action${isDefault ? " is-default" : ""}`}
                        disabled={isDefault || isDisabled}
                        aria-pressed={isDefault}
                        aria-label={isDefault ? props.t("defaultModel") : `${props.t("setDefaultModel")}: ${model.modelName}`}
                        onClick={() => selectModel(model.providerId, model.modelId)}
                      >
                        {isDefault ? props.t("defaultModel") : props.t("setDefaultModel")}
                      </Button>
                      <Switch
                        checked={!isDisabled}
                        disabled={modelTogglePending !== null}
                        aria-label={`${props.t(isDisabled ? "disabled" : "enabled")}: ${model.modelName}`}
                        onCheckedChange={(enabled) => void toggleModel(model, enabled)}
                      />
                    </div>;
                  })
                  : <p>{props.t("noProviderModels")}</p>}
              </div>
              {modelToggleError ? <Alert className="model-toggle-error"><AlertDescription>{modelToggleError}</AlertDescription></Alert> : null}
              {modelTestError ? <Alert className="model-toggle-error"><AlertDescription>{modelTestError}</AlertDescription></Alert> : null}
            </section> : null}
          </div>
        )}
      </section>
    </SettingsSectionBlock>
    <AlertDialog open={removeProvider !== null} onOpenChange={(open) => { if (!open) setRemoveProvider(null); }}><AlertDialogContent className="settings-confirm-dialog"><AlertDialogHeader><AlertDialogTitle>{props.t("removeCredential")}</AlertDialogTitle><AlertDialogDescription>{removeProvider}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function modelOptionsLabel(models: ModelCatalog | undefined, providerId: string | null, modelId: string | null): string {
  const model = models?.models.find((candidate) => candidate.providerId === providerId && candidate.modelId === modelId);
  return model ? `${providerDisplayName(model.providerName)} · ${model.modelName}` : "";
}

function providerDisplayName(name: string): string {
  const match = name.match(/^NewAPI\s*\(([^()]+)\)\s*$/i);
  return match?.[1]?.trim() || name;
}

function modelTestResultLabel(
  result: AppSettings["modelTestResults"][string],
  language: AppSettings["language"],
  t: T,
): string {
  const locale = language === "zh-CN" ? "zh-CN" : "en-US";
  const testedAt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(result.testedAt));
  return `${t(result.success ? "modelTestPassed" : "modelTestFailed")} · ${testedAt}`;
}

function FolderSettings(props: BaseProps) {
  const folders = props.workspaces.filter(({ kind }) => kind === "folder");
  return <SettingsSectionBlock className="settings-folders" title={props.t("workFolders")} detail={props.t("folderAccessDetail")} showTitle={false}>
    <div className="folder-settings-list">{folders.map((workspace) => <div key={workspace.id}><Icon name="workspace" /><span><strong>{workspace.name}</strong>{workspace.directories.map((directory) => <code key={directory}>{directory}</code>)}</span><Button variant="ghost" size="sm" onClick={() => void props.onAddWorkspaceDirectory(workspace.id)}><Icon name="folder-plus" size={14} />{props.t("addDirectory")}</Button><Badge>{workspace.directories.length}</Badge></div>)}{folders.length === 0 ? <p>{props.t("noItems")}</p> : null}</div>
    <div className="settings-section-footer">
      <Button variant="outline" size="sm" onClick={() => void props.onAddWorkspace()}><Icon name="folder-plus" />{props.t("addWorkFolder")}</Button>
    </div>
  </SettingsSectionBlock>;
}

function PermissionSettings(props: BaseProps) {
  return <SettingsSectionBlock className="settings-permissions" title={props.t("permissions")} detail={props.t("permissionDetail")} showTitle={false}>
    <Alert className="permission-default"><Icon name="lock" /><AlertDescription><strong>{props.t("askEveryTime")}</strong><span>{props.t("permissionDefaultDetail")}</span></AlertDescription></Alert>
    <Alert className="risk-alert"><AlertDescription>{props.t("automaticRisk")}</AlertDescription></Alert>
  </SettingsSectionBlock>;
}

function AppearanceSettings(props: BaseProps) {
  return <SettingsSubsection title={props.t("appearance")}>
    <div className="settings-theme-row">
      <div><strong>{props.t("theme")}</strong></div>
      <div className="settings-theme-picker" role="group" aria-label={props.t("theme")}>
        {([
          ["system", props.t("systemTheme"), "system"],
          ["light", props.t("light"), "light"],
          ["dark", props.t("dark"), "dark"],
        ] as const).map(([value, label, preview]) => (
          <Button
            type="button"
            variant="ghost"
            className={`settings-theme-choice${props.settings.theme === value ? " is-selected" : ""}`}
            key={value}
            aria-pressed={props.settings.theme === value}
            onClick={() => void props.onUpdate({ theme: value })}
          >
            <span className={`settings-theme-preview is-${preview}`} aria-hidden="true"><i /><i /></span>
            <span>{label}</span>
          </Button>
        ))}
      </div>
    </div>
    <div className="settings-toggle-list">
      <label className="switch-row setting-switch"><span><strong>{props.t("focusMode")}</strong><small>{props.t("focusModeDetail")}</small></span><Switch checked={props.settings.focusMode} onCheckedChange={(focusMode) => void props.onUpdate({ focusMode })} /></label>
      <label className="switch-row setting-switch"><span><strong>{props.t("compactMode")}</strong><small>{props.t("compactModeDetail")}</small></span><Switch checked={props.settings.compactMode} onCheckedChange={(compactMode) => void props.onUpdate({ compactMode })} /></label>
    </div>
  </SettingsSubsection>;
}

function ExtensionSettings({
  language,
  t,
  onOpenConsole,
}: {
  language: AppSettings["language"];
  t: T;
  onOpenConsole(command?: string | null): void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["extensions"], queryFn: () => window.piWork.extension.list() });
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"explore" | "installed">("explore");
  const [category, setCategory] = useState<ExtensionCatalogCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedExtension, setSelectedExtension] = useState<ExtensionCatalogItem | null>(null);
  const [manualInstallOpen, setManualInstallOpen] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<ExtensionCatalogItem | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["extensions"] }),
    queryClient.invalidateQueries({ queryKey: ["models"] }),
  ]);
  const install = useMutation({
    mutationFn: (value: string) => window.piWork.extension.install(value),
    onSuccess: async () => {
      setSource("");
      setError(null);
      setManualInstallOpen(false);
      setPendingInstall(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const remove = useMutation({
    mutationFn: (value: string) => window.piWork.extension.remove(value),
    onSuccess: async () => {
      setError(null);
      setPendingRemove(null);
      setSelectedExtension(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const installedSources = query.data?.map((extension) => extension.source) ?? [];
  const visibleExtensions = useMemo(() => {
    const value = search.trim().toLocaleLowerCase();
    return extensionCatalog.filter((extension) => {
      if (category !== "all" && extension.category !== category) return false;
      if (!value) return true;
      return [
        extension.packageName,
        extension.author,
        extension.name[language],
        extension.summary[language],
        extension.description[language],
      ].join(" ").toLocaleLowerCase().includes(value);
    });
  }, [category, language, search]);
  const catalogBySource = useMemo(() => new Map(
    extensionCatalog.map((extension) => [normalizeExtensionSource(extension.source), extension]),
  ), []);
  const requestInstall = (extension: ExtensionCatalogItem) => {
    setError(null);
    setPendingInstall(extension);
  };
  const requestRemove = (extensionSource: string) => {
    setError(null);
    setPendingRemove(extensionSource);
  };
  const isInstalled = (extension: ExtensionCatalogItem) => isCatalogExtensionInstalled(extension.source, installedSources);
  const installedSourceFor = (extension: ExtensionCatalogItem) => installedSources.find(
    (installedSource) => normalizeExtensionSource(installedSource) === normalizeExtensionSource(extension.source),
  );
  const isInstalling = (extensionSource: string) => install.isPending
    && normalizeExtensionSource(install.variables ?? "") === normalizeExtensionSource(extensionSource);

  return <>
    <SettingsSectionBlock className="extension-store-section" title={t("extensions")} detail={t("extensionStoreDetail")} showTitle={false}>
      <div className="extension-store">
        <div className="extension-store-toolbar">
          <div className="extension-store-tabs" role="tablist" aria-label={t("extensions")}>
            <Button variant="ghost" className={view === "explore" ? "selected" : ""} onClick={() => setView("explore")} role="tab" aria-selected={view === "explore"}>{t("exploreExtensions")}</Button>
            <Button variant="ghost" className={view === "installed" ? "selected" : ""} onClick={() => setView("installed")} role="tab" aria-selected={view === "installed"}>{t("installedExtensions")}{query.data ? <span>{query.data.length}</span> : null}</Button>
          </div>
          <div className="extension-store-actions">
            {view === "explore" ? <>
            <label className="extension-store-search">
              <Icon name="search" />
              <span className="sr-only">{t("searchExtensions")}</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchExtensions")} />
            </label>
            <Button variant="outline" className="extension-manual-install-trigger" onClick={() => {
              setError(null);
              setManualInstallOpen(true);
            }}>
              <Icon name="plus" />
              {t("manualExtensionInstall")}
            </Button>
            </> : null}
          </div>
        </div>

        {view === "explore" ? <>
          <div className="extension-category-filter" aria-label={t("extensionCategories")}>
            {(["all", "automation", "development", "integration", "productivity"] as const).map((value) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className={category === value ? "selected" : ""}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {t(value === "all" ? "allExtensions" : `extensionCategory${capitalize(value)}` as MessageKey)}
              </Button>
            ))}
          </div>
          {visibleExtensions.length === 0 ? <div className="extension-store-empty"><Icon name="search" /><strong>{t("noExtensionsFound")}</strong><p>{t("noExtensionsFoundDetail")}</p></div> : (
            <div className="extension-card-grid">
              {visibleExtensions.map((extension) => {
                const installed = isInstalled(extension);
                const installing = isInstalling(extension.source);
                return <article className="extension-card" key={extension.id}>
                  <button className="extension-card-main" onClick={() => setSelectedExtension(extension)}>
                    <ExtensionIcon extension={extension} />
                    <span className="extension-card-copy">
                      <span className="extension-card-heading"><strong>{extension.name[language]}</strong><small>{t(`extensionCategory${capitalize(extension.category)}` as MessageKey)}</small></span>
                      <span>{extension.summary[language]}</span>
                    </span>
                  </button>
                  <div className="extension-card-footer">
                    <code>{extension.packageName}</code>
                    {installed
                      ? <Button variant="secondary" size="sm" onClick={() => setSelectedExtension(extension)}><Icon name="check" />{t("installed")}</Button>
                      : <Button size="sm" disabled={install.isPending} onClick={() => requestInstall(extension)}>{installing ? <><Spinner />{t("installingExtension")}</> : t("install")}</Button>}
                  </div>
                </article>;
              })}
            </div>
          )}
        </> : (
          <div className="extension-list extension-store-installed">
            {query.isPending ? <ExtensionListSkeleton /> : null}
            {query.data?.map((extension) => {
              const catalogExtension = catalogBySource.get(normalizeExtensionSource(extension.source));
              const removing = remove.isPending && remove.variables === extension.source;
              return <div className="extension-installed-row" key={extension.source}>
                {catalogExtension ? <ExtensionIcon extension={catalogExtension} compact /> : <span className="extension-installed-icon extension-installed-icon--source"><Icon name="source" /></span>}
                <button className="extension-installed-main" onClick={() => catalogExtension && setSelectedExtension(catalogExtension)} disabled={!catalogExtension}>
                  <strong>{catalogExtension?.name[language] ?? extension.source}</strong>
                  <code>{catalogExtension?.packageName ?? extension.installedPath ?? t("installedExtension")}</code>
                </button>
                <Button variant="ghost" className="extension-uninstall" size="sm" disabled={remove.isPending} onClick={() => requestRemove(extension.source)}>{removing ? <Spinner /> : <Icon name="trash" size={14} />}{removing ? t("uninstallingExtension") : t("removeExtension")}</Button>
              </div>;
            })}
            {query.data?.length === 0 ? <div className="extension-store-empty"><Icon name="skills" /><strong>{t("noInstalledExtensions")}</strong><p>{t("noInstalledExtensionsDetail")}</p><Button variant="outline" size="sm" onClick={() => setView("explore")}>{t("exploreExtensions")}</Button></div> : null}
          </div>
        )}
        {!manualInstallOpen && error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </div>
    </SettingsSectionBlock>

    <Dialog open={manualInstallOpen} onOpenChange={setManualInstallOpen}>
      <DialogContent className="extension-manual-install-dialog">
        <DialogHeader>
          <DialogTitle>{t("manualExtensionInstall")}</DialogTitle>
          <DialogDescription>{t("manualExtensionInstallDetail")}</DialogDescription>
        </DialogHeader>
        <form
          className="extension-install"
          onSubmit={(event) => {
            event.preventDefault();
            if (source.trim() && !install.isPending) install.mutate(source.trim());
          }}
        >
          <Field>
            <FieldLabel>{t("installSource")}</FieldLabel>
            <Input autoFocus value={source} onChange={(event) => setSource(event.target.value)} placeholder={t("extensionSource")} />
          </Field>
          <div className="extension-install-choices">
            <Button type="button" variant="outline" onClick={() => void window.piWork.extension.chooseLocal("file").then((path) => path && setSource(path))}>
              {t("chooseFile")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void window.piWork.extension.chooseLocal("directory").then((path) => path && setSource(path))}>
              {t("chooseDirectory")}
            </Button>
          </div>
          {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <DialogFooter className="extension-manual-install-actions">
            <DialogClose asChild><Button type="button" variant="ghost" disabled={install.isPending}>{t("cancel")}</Button></DialogClose>
            <Button type="submit" disabled={!source.trim() || install.isPending}>
              {install.isPending ? <><Spinner />{t("installingExtension")}</> : t("installExtension")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={selectedExtension !== null} onOpenChange={(open) => !open && setSelectedExtension(null)}>
      {selectedExtension ? <DialogContent className="extension-detail-dialog">
        <div className="extension-detail-body">
          <DialogHeader>
            <div className="extension-detail-topline">
              <div className="extension-detail-heading">
                <ExtensionIcon extension={selectedExtension} />
                <div><small>{t(`extensionCategory${capitalize(selectedExtension.category)}` as MessageKey)}</small><DialogTitle>{selectedExtension.name[language]}</DialogTitle></div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="extension-directory-link"
                aria-label={t("viewOnPiDirectory")}
                title={t("viewOnPiDirectory")}
                onClick={() => void window.piWork.system.openExternal(selectedExtension.officialUrl)}
              >
                <Icon name="external" />
              </Button>
            </div>
            <DialogDescription>{selectedExtension.description[language]}</DialogDescription>
          </DialogHeader>
          <dl className="extension-detail-meta">
            <div><dt>{t("package")}</dt><dd><code>{selectedExtension.packageName}</code></dd></div>
            <div><dt>{t("author")}</dt><dd>{selectedExtension.author}</dd></div>
            <div><dt>{t("installSource")}</dt><dd><code>{selectedExtension.source}</code></dd></div>
          </dl>
          <div className="extension-security-note"><Icon name="alert" /><p>{t("extensionSecurityNote")}</p></div>
        </div>
        <DialogFooter className="extension-detail-actions">
          <div className="extension-detail-primary-actions">
            <Button variant="outline" size="sm" onClick={() => {
              const command = selectedExtension.id.includes("newapi") ? "/newapi-provider-add " : null;
              setSelectedExtension(null);
              onOpenConsole(command);
            }}><Icon name="terminal" />{t("setUpInPiConsole")}</Button>
            {isInstalled(selectedExtension)
              ? <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => {
                const installedSource = installedSourceFor(selectedExtension);
                if (installedSource) requestRemove(installedSource);
              }}>{remove.isPending ? <><Spinner />{t("uninstallingExtension")}</> : <><Icon name="trash" size={14} />{t("removeExtension")}</>}</Button>
              : <Button size="sm" disabled={install.isPending} onClick={() => requestInstall(selectedExtension)}>{isInstalling(selectedExtension.source) ? <><Spinner />{t("installingExtension")}</> : t("installExtension")}</Button>}
          </div>
        </DialogFooter>
      </DialogContent> : null}
    </Dialog>

    <AlertDialog open={pendingInstall !== null} onOpenChange={(open) => !open && setPendingInstall(null)}>
      <AlertDialogContent className="settings-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("installExtensionConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("installExtensionConfirmDetail")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="default"
            disabled={install.isPending}
            onClick={() => pendingInstall && install.mutate(pendingInstall.source)}
          >
            {install.isPending ? <><Spinner />{t("installingExtension")}</> : t("installExtension")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={pendingRemove !== null} onOpenChange={(open) => !open && setPendingRemove(null)}>
      <AlertDialogContent className="settings-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeExtensionConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("removeExtensionConfirmDetail")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isPending} onClick={() => pendingRemove && remove.mutate(pendingRemove)}>
            {remove.isPending ? <><Spinner />{t("uninstallingExtension")}</> : <><Icon name="trash" size={14} />{t("removeExtension")}</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

  </>;
}

function ExtensionIcon({ compact = false, extension }: { compact?: boolean; extension: ExtensionCatalogItem }) {
  return <span className={`extension-card-icon extension-card-icon--${extension.category}${compact ? " extension-installed-icon" : ""}`}>
    <Icon name={extensionIconName(extension)} />
  </span>;
}

function extensionIconName(extension: ExtensionCatalogItem): IconName {
  const icons: Partial<Record<string, IconName>> = {
    "pi-mcp-adapter": "source",
    "pi-web-access": "browser",
    "pi-subagents": "wand",
    "pi-lens": "eye",
    "pi-crew": "workspace",
    "pi-ssh-remote": "terminal",
    "rpiv-ask-user-question": "info",
    "rpiv-todo": "list-todo",
    piolium: "lock",
  };
  const categoryIcons: Record<ExtensionCatalogCategory, IconName> = {
    automation: "wand",
    development: "terminal",
    integration: "source",
    productivity: "list-todo",
  };
  return icons[extension.id] ?? categoryIcons[extension.category];
}

function ExtensionListSkeleton() {
  return <div className="extension-list-skeleton" aria-label="Loading extensions"><span /><span /><span /></div>;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function ShortcutSettings({ t }: { t: T }) {
  return <SettingsSubsection className="settings-utility-shortcuts" title={t("shortcuts")} detail={t("keyboardNavigation")}><div className="shortcut-list"><span>{t("openSearch")}<kbd>⌘ K</kbd></span><span>{t("newTask")}<kbd>⌘ N</kbd></span><span>{t("toggleSidebar")}<kbd>⌘ B</kbd></span><span>{t("inspectorShortcut")}<kbd>⌘ I</kbd></span></div></SettingsSubsection>;
}

function AboutSettings({ buildInfo, t }: { buildInfo: BuildInfo; t: T }) {
  const rows: Array<{ key: "version" | "branch" | "commit"; value: string | null }> = [
    { key: "version", value: buildInfo.version },
    { key: "branch", value: buildInfo.branch },
    { key: "commit", value: buildInfo.commit },
  ];
  return (
    <SettingsSectionBlock className="settings-about" title={t("about")} detail={t("buildInformationDetail")} showTitle={false}>
      <div className="about-heading">
        <PiMark className="about-mark" />
        <span><strong>{t("appName")}</strong><small>{t("aboutDetail")}</small></span>
      </div>
      <dl className="build-info-list">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{t(row.key)}</dt>
            <dd title={row.value ?? undefined}>{row.value ?? t("unavailable")}</dd>
          </div>
        ))}
      </dl>
    </SettingsSectionBlock>
  );
}
