import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, BuildInfo, ModelCatalog, ProviderConfig, Workspace } from "@pi-work/protocol";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command.js";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.js";
import { Icon } from "../components/ui/icon.js";
import type { IconName } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Switch } from "../components/ui/switch.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { PiMark } from "../components/pi-mark.js";
import type { MessageKey } from "../i18n.js";
import type { SettingsSection } from "../store.js";
import { BrowserPage } from "./browser-page.js";
import {
  extensionCatalog,
  isCatalogExtensionInstalled,
  normalizeExtensionSource,
  type ExtensionCatalogCategory,
  type ExtensionCatalogItem,
} from "./extension-catalog.js";

type T = (key: MessageKey) => string;

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
  onProvidersChanged(): Promise<unknown>;
  onModelsRefresh(): Promise<unknown>;
  onRestartOnboarding(): Promise<unknown>;
  consoleOpen?: boolean;
  consolePanel?: ReactNode;
  onOpenConsole?(command?: string | null): void;
  onToggleConsole?(): void;
}) {
  const consoleOpen = props.consoleOpen ?? false;
  const groups: Array<{
    label: MessageKey;
    sections: Array<{ id: SettingsSection; icon: IconName }>;
  }> = [
    {
      label: "settingsGroupGeneral",
      sections: [
        { id: "general", icon: "settings" },
        { id: "appearance", icon: "eye" },
      ],
    },
    {
      label: "settingsGroupWorkspace",
      sections: [
        { id: "modelsCredentials", icon: "wand" },
        { id: "workFolders", icon: "workspace" },
        { id: "permissions", icon: "lock" },
      ],
    },
    {
      label: "settingsGroupTools",
      sections: [
        { id: "extensions", icon: "skills" },
        { id: "browser", icon: "browser" },
        { id: "shortcuts", icon: "command" },
      ],
    },
    {
      label: "settingsGroupInfo",
      sections: [
        { id: "about", icon: "info" },
      ],
    },
  ];
  const sectionTitle = props.t(props.section);
  return (
    <section className={`settings-shell${consoleOpen ? " pi-console-open" : ""}`} aria-label={props.t("settings")}>
      <header className="settings-titlebar">
        <Button variant="ghost" className="settings-back" onClick={props.onClose}>
          <Icon name="back" />
          <span>{props.t("backToWorkspace")}</span>
        </Button>
        <div className="settings-titlebar-identity">
          <strong>{props.t("appName")}</strong>
          <span>{props.t("settings")}</span>
        </div>
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
          <div className="settings-nav-intro">
            <span>{props.t("appName")}</span>
            <strong>{props.t("settings")}</strong>
          </div>
          {groups.map((group) => (
            <section className="settings-nav-group" key={group.label}>
              <header>{props.t(group.label)}</header>
              {group.sections.map(({ id, icon }) => (
                <Button
                  variant="ghost"
                  className={props.section === id ? "selected" : ""}
                  key={id}
                  aria-current={props.section === id ? "page" : undefined}
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
          {props.section === "browser" ? <BrowserPage t={props.t} /> : (
            <div className="settings-content-inner">
              <header className="settings-page-heading">
                <span>{props.t("appName")}</span>
                <h1>{sectionTitle}</h1>
              </header>
              {props.section === "general" ? <GeneralSettings {...props} /> : null}
              {props.section === "modelsCredentials" ? <ModelSettings {...props} /> : null}
              {props.section === "workFolders" ? <FolderSettings {...props} /> : null}
              {props.section === "permissions" ? <PermissionSettings {...props} /> : null}
              {props.section === "appearance" ? <AppearanceSettings {...props} /> : null}
              {props.section === "extensions" ? <ExtensionSettings language={props.settings.language} t={props.t} onOpenConsole={(command) => props.onOpenConsole?.(command)} /> : null}
              {props.section === "shortcuts" ? <ShortcutSettings t={props.t} /> : null}
              {props.section === "about" ? <AboutSettings buildInfo={props.buildInfo} t={props.t} /> : null}
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
  onProvidersChanged(): Promise<unknown>;
  onModelsRefresh(): Promise<unknown>;
  onRestartOnboarding(): Promise<unknown>;
};

function SettingsSectionBlock(props: { className?: string; title: string; detail?: string; children: ReactNode }) {
  return <section className={`settings-section${props.className ? ` ${props.className}` : ""}`}><header><h2>{props.title}</h2>{props.detail ? <p>{props.detail}</p> : null}</header><div>{props.children}</div></section>;
}

function GeneralSettings(props: BaseProps) {
  return <>
    <SettingsSectionBlock title={props.t("general")}>
      <FieldGroup>
        <Field className="horizontal-field"><FieldLabel>{props.t("language")}</FieldLabel><Select value={props.settings.language} onValueChange={(value) => void props.onUpdate({ language: value as AppSettings["language"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectGroup></SelectContent></Select></Field>
      </FieldGroup>
    </SettingsSectionBlock>
    <SettingsSectionBlock title={props.t("onboardingTitle")} detail={props.t("onboardingAppearanceDetail")}>
      <Button variant="outline" onClick={() => void props.onRestartOnboarding()}>{props.t("restartOnboarding")}</Button>
    </SettingsSectionBlock>
  </>;
}

function ModelSettings(props: BaseProps) {
  const [providerId, setProviderId] = useState("");
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [removeProvider, setRemoveProvider] = useState<string | null>(null);
  const [modelsRefreshed, setModelsRefreshed] = useState(false);
  const refreshFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerOptions = useMemo(() => Array.from(new Map((props.models?.models ?? []).map((model) => [model.providerId, model.providerName])).entries()), [props.models]);
  const providerNames = useMemo(() => new Map(providerOptions), [providerOptions]);
  const modelOptions = (props.models?.models ?? []).filter((model) => props.providers.some((provider) => provider.providerId === model.providerId));
  const defaultModelKey = props.settings.providerId && props.settings.modelId ? `${props.settings.providerId}/${props.settings.modelId}` : "";
  const providerModels = useMemo(() => new Map(
    props.providers.map((provider) => [
      provider.providerId,
      (props.models?.models ?? [])
        .filter((model) => model.providerId === provider.providerId)
        .sort((left, right) => left.modelName.localeCompare(right.modelName)),
    ]),
  ), [props.models, props.providers]);
  const save = useMutation({
    mutationFn: () => window.piWork.provider.save({ providerId, apiKey }),
    onSuccess: async () => {
      setApiKey("");
      await props.onProvidersChanged();
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
  useEffect(() => () => {
    if (refreshFeedbackTimer.current !== null) clearTimeout(refreshFeedbackTimer.current);
  }, []);
  async function remove() {
    if (removeProvider === null) return;
    await window.piWork.provider.remove(removeProvider);
    if (props.settings.providerId === removeProvider) await props.onUpdate({ providerId: null, modelId: null });
    setRemoveProvider(null);
    await props.onProvidersChanged();
  }
  return <>
    <SettingsSectionBlock title={props.t("modelsCredentials")} detail={props.t("credentialDetail")}>
      <div className="model-connection-form">
        <div className="model-connection-copy">
          <span>{props.t("addProvider")}</span>
          <p>{props.t("addProviderDetail")}</p>
        </div>
        <FieldGroup className="credential-form">
          <Field><FieldLabel>{props.t("provider")}</FieldLabel><Popover open={providerMenuOpen} onOpenChange={setProviderMenuOpen}><PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={providerMenuOpen} className="provider-combobox-trigger"><span>{providerId ? (providerNames.get(providerId) ?? providerId) : props.t("provider")}</span><Icon name="chevron-down" size={14} /></Button></PopoverTrigger><PopoverContent className="provider-combobox-content"><Command><CommandInput autoFocus placeholder={props.t("searchProviders")} /><CommandList><CommandEmpty>{props.t("noProvidersFound")}</CommandEmpty><CommandGroup>{providerOptions.map(([id, name]) => <CommandItem key={id} value={id} keywords={[name, id]} onSelect={() => { setProviderId(id); setProviderMenuOpen(false); }}><span>{name}</span>{providerId === id ? <Icon name="check" size={14} className="ml-auto" /> : null}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></Field>
          <Field><FieldLabel>{props.t("apiKey")}</FieldLabel><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
          <Button disabled={!providerId || !apiKey || save.isPending} onClick={() => save.mutate()}><Icon name="plus" />{save.isPending ? props.t("saving") : props.t("addProvider")}</Button>
        </FieldGroup>
      </div>
      <section className="connected-providers" aria-label={props.t("connectedProviders")}>
        <header>
          <div>
            <h3>{props.t("connectedProviders")}</h3>
            <p>{props.t("connectedProvidersDetail")}</p>
          </div>
          <div className="connected-provider-actions">
            <Button
              variant="outline"
              size="sm"
              className={`model-refresh-button${refreshModels.isPending ? " is-refreshing" : modelsRefreshed ? " is-complete" : ""}`}
              disabled={refreshModels.isPending}
              onClick={() => {
                if (refreshFeedbackTimer.current !== null) {
                  clearTimeout(refreshFeedbackTimer.current);
                  refreshFeedbackTimer.current = null;
                }
                setModelsRefreshed(false);
                refreshModels.mutate();
              }}
            >
              <Icon
                name={modelsRefreshed ? "check" : "refresh"}
                className={refreshModels.isPending ? "is-spinning" : undefined}
              />
              <span
                key={refreshModels.isPending ? "refreshing" : modelsRefreshed ? "complete" : "idle"}
                className="model-refresh-label"
                aria-live="polite"
              >
                {props.t(refreshModels.isPending ? "refreshingModels" : modelsRefreshed ? "modelsRefreshed" : "refreshModels")}
              </span>
            </Button>
            <Badge>{props.providers.length}</Badge>
          </div>
        </header>
        <div className="credential-list">
          {props.providers.map((provider) => {
            const availableModels = providerModels.get(provider.providerId) ?? [];
            const providerName = providerNames.get(provider.providerId) ?? provider.providerId;
            return (
              <article className="credential-provider" key={provider.providerId}>
                <div className="credential-provider-identity">
                  <span className="credential-provider-status"><Icon name="check-circle" size={14} /></span>
                  <span><strong>{providerName}</strong><small>{props.t("credentialStored")}</small></span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRemoveProvider(provider.providerId)}>{props.t("removeCredential")}</Button>
                <details className="provider-models">
                  <summary>
                    <span>{props.t("providerModels")}</span>
                    <small>{availableModels.length}</small>
                    <Icon name="chevron-down" size={14} />
                  </summary>
                  <div>
                    {availableModels.length > 0
                      ? availableModels.map((model) => <code key={model.modelId} title={model.modelId}>{model.modelName}</code>)
                      : <p>{props.t("noProviderModels")}</p>}
                  </div>
                </details>
              </article>
            );
          })}
          {props.providers.length === 0 ? <p className="credential-empty-state">{props.t("noCredentials")}</p> : null}
        </div>
      </section>
    </SettingsSectionBlock>
    <SettingsSectionBlock title={props.t("defaultModel")} detail={props.t("defaultModelDetail")}>
      <Select value={defaultModelKey} onValueChange={(value) => {
        const model = modelOptions.find((candidate) => `${candidate.providerId}/${candidate.modelId}` === value);
        if (model) void props.onUpdate({ providerId: model.providerId, modelId: model.modelId, thinkingLevel: model.thinkingLevels.includes(props.settings.thinkingLevel) ? props.settings.thinkingLevel : (model.thinkingLevels[0] ?? "off") });
      }}><SelectTrigger><SelectValue placeholder={props.t("noModel")} /></SelectTrigger><SelectContent><SelectGroup>{modelOptions.map((model) => <SelectItem key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>{model.providerName} · {model.modelName}</SelectItem>)}</SelectGroup></SelectContent></Select>
    </SettingsSectionBlock>
    <AlertDialog open={removeProvider !== null} onOpenChange={(open) => { if (!open) setRemoveProvider(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.t("removeCredential")}</AlertDialogTitle><AlertDialogDescription>{removeProvider}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function FolderSettings(props: BaseProps) {
  const folders = props.workspaces.filter(({ kind }) => kind === "folder");
  return <SettingsSectionBlock title={props.t("workFolders")} detail={props.t("folderAccessDetail")}>
    <div className="folder-settings-list">{folders.map((workspace) => <div key={workspace.id}><Icon name="workspace" /><span><strong>{workspace.name}</strong><code>{workspace.rootPath}</code></span><Badge>{props.t("authorized")}</Badge></div>)}{folders.length === 0 ? <p>{props.t("noItems")}</p> : null}</div>
    <Button variant="outline" onClick={() => void props.onAddWorkspace()}><Icon name="folder-plus" />{props.t("addWorkFolder")}</Button>
  </SettingsSectionBlock>;
}

function PermissionSettings(props: BaseProps) {
  return <SettingsSectionBlock title={props.t("permissions")} detail={props.t("permissionDetail")}>
    <Alert className="permission-default"><Icon name="lock" /><AlertDescription><strong>{props.t("askEveryTime")}</strong><span>{props.t("permissionDefaultDetail")}</span></AlertDescription></Alert>
    <Alert className="risk-alert"><AlertDescription>{props.t("automaticRisk")}</AlertDescription></Alert>
  </SettingsSectionBlock>;
}

function AppearanceSettings(props: BaseProps) {
  return <SettingsSectionBlock title={props.t("appearance")}>
    <FieldGroup>
      <Field className="horizontal-field"><FieldLabel>{props.t("theme")}</FieldLabel><Select value={props.settings.theme} onValueChange={(value) => void props.onUpdate({ theme: value as AppSettings["theme"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="system">{props.t("systemTheme")}</SelectItem><SelectItem value="light">{props.t("light")}</SelectItem><SelectItem value="dark">{props.t("dark")}</SelectItem></SelectGroup></SelectContent></Select></Field>
      <label className="switch-row setting-switch"><span><strong>{props.t("focusMode")}</strong><small>{props.t("focusModeDetail")}</small></span><Switch checked={props.settings.focusMode} onCheckedChange={(focusMode) => void props.onUpdate({ focusMode })} /></label>
      <label className="switch-row setting-switch"><span><strong>{props.t("compactMode")}</strong><small>{props.t("compactModeDetail")}</small></span><Switch checked={props.settings.compactMode} onCheckedChange={(compactMode) => void props.onUpdate({ compactMode })} /></label>
    </FieldGroup>
  </SettingsSectionBlock>;
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
    <SettingsSectionBlock className="extension-store-section" title={t("extensions")} detail={t("extensionStoreDetail")}>
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
      {selectedExtension ? <DialogContent className="extension-store-drawer">
        <DialogHeader>
          <div className="extension-drawer-heading">
            <ExtensionIcon extension={selectedExtension} />
            <div><small>{t(`extensionCategory${capitalize(selectedExtension.category)}` as MessageKey)}</small><DialogTitle>{selectedExtension.name[language]}</DialogTitle></div>
          </div>
          <DialogDescription>{selectedExtension.description[language]}</DialogDescription>
        </DialogHeader>
        <dl className="extension-drawer-meta">
          <div><dt>{t("package")}</dt><dd><code>{selectedExtension.packageName}</code></dd></div>
          <div><dt>{t("author")}</dt><dd>{selectedExtension.author}</dd></div>
          <div><dt>{t("installSource")}</dt><dd><code>{selectedExtension.source}</code></dd></div>
        </dl>
        <div className="extension-security-note"><Icon name="alert" /><p>{t("extensionSecurityNote")}</p></div>
        <DialogFooter className="extension-drawer-actions">
          <Button variant="link" onClick={() => void window.piWork.system.openExternal(selectedExtension.officialUrl)}><Icon name="external" />{t("viewOnPiDirectory")}</Button>
          <Button variant="outline" onClick={() => {
            const command = selectedExtension.id.includes("newapi") ? "/newapi-provider-add " : null;
            setSelectedExtension(null);
            onOpenConsole(command);
          }}><Icon name="terminal" />{t("setUpInPiConsole")}</Button>
          {isInstalled(selectedExtension)
            ? <Button variant="destructive" disabled={remove.isPending} onClick={() => {
              const installedSource = installedSourceFor(selectedExtension);
              if (installedSource) requestRemove(installedSource);
            }}>{remove.isPending ? <><Spinner />{t("uninstallingExtension")}</> : <><Icon name="trash" size={14} />{t("removeExtension")}</>}</Button>
            : <Button disabled={install.isPending} onClick={() => requestInstall(selectedExtension)}>{isInstalling(selectedExtension.source) ? <><Spinner />{t("installingExtension")}</> : t("installExtension")}</Button>}
          <DialogClose asChild><Button variant="ghost">{t("close")}</Button></DialogClose>
        </DialogFooter>
      </DialogContent> : null}
    </Dialog>

    <AlertDialog open={pendingInstall !== null} onOpenChange={(open) => !open && setPendingInstall(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("installExtensionConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("installExtensionConfirmDetail")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button disabled={install.isPending} onClick={() => pendingInstall && install.mutate(pendingInstall.source)}>{install.isPending ? <><Spinner />{t("installingExtension")}</> : t("installExtension")}</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={pendingRemove !== null} onOpenChange={(open) => !open && setPendingRemove(null)}>
      <AlertDialogContent>
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
  return <SettingsSectionBlock title={t("shortcuts")} detail={t("keyboardNavigation")}><div className="shortcut-list"><span>{t("openSearch")}<kbd>⌘ K</kbd></span><span>{t("newTask")}<kbd>⌘ N</kbd></span><span>{t("toggleSidebar")}<kbd>⌘ B</kbd></span><span>{t("inspectorShortcut")}<kbd>⌘ I</kbd></span></div></SettingsSectionBlock>;
}

function AboutSettings({ buildInfo, t }: { buildInfo: BuildInfo; t: T }) {
  const [copied, setCopied] = useState<string | null>(null);
  const rows: Array<{ key: "version" | "branch" | "commit"; value: string | null }> = [
    { key: "version", value: buildInfo.version },
    { key: "branch", value: buildInfo.branch },
    { key: "commit", value: buildInfo.commit },
  ];
  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1_500);
    });
  };
  return (
    <SettingsSectionBlock title={t("about")} detail={t("buildInformationDetail")}>
      <div className="about-heading">
        <PiMark className="about-mark" />
        <span><strong>{t("appName")}</strong><small>{t("aboutDetail")}</small></span>
      </div>
      <dl className="build-info-list">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{t(row.key)}</dt>
            <dd title={row.value ?? undefined}>{row.value ?? t("unavailable")}</dd>
            <Button
              variant="ghost"
              size="sm"
              disabled={row.value === null}
              onClick={() => row.value && copy(row.key, row.value)}
            >
              <Icon name={copied === row.key ? "check" : "copy"} />
              {copied === row.key ? t("copied") : t("copy")}
            </Button>
          </div>
        ))}
      </dl>
    </SettingsSectionBlock>
  );
}
