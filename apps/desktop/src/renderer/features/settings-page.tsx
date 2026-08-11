import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, ModelCatalog, ProviderConfig, Workspace } from "@pi-work/protocol";
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
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.js";
import { Icon } from "../components/ui/icon.js";
import type { IconName } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Switch } from "../components/ui/switch.js";
import type { MessageKey } from "../i18n.js";
import { PageHeader } from "./workspace-pages.js";

type T = (key: MessageKey) => string;
type SettingsSection = "general" | "modelsCredentials" | "workFolders" | "permissions" | "appearance" | "extensions" | "shortcuts";

export function SettingsPage(props: {
  settings: AppSettings;
  workspaces: Workspace[];
  providers: ProviderConfig[];
  models: ModelCatalog | undefined;
  t: T;
  onUpdate(value: Partial<AppSettings>): Promise<unknown>;
  onAddWorkspace(): Promise<Workspace | null>;
  onProvidersChanged(): Promise<unknown>;
  onRestartOnboarding(): Promise<unknown>;
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const sections: Array<{ id: SettingsSection; icon: IconName }> = [
    { id: "general", icon: "settings" },
    { id: "modelsCredentials", icon: "wand" },
    { id: "workFolders", icon: "workspace" },
    { id: "permissions", icon: "lock" },
    { id: "appearance", icon: "eye" },
    { id: "extensions", icon: "skills" },
    { id: "shortcuts", icon: "command" },
  ];
  return (
    <section className="page settings-page">
      <PageHeader eyebrow={props.t("appName")} title={props.t("settings")} />
      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map(({ id, icon }) => <Button variant="ghost" className={section === id ? "selected" : ""} key={id} onClick={() => setSection(id)}><Icon name={icon} /><span>{props.t(id)}</span></Button>)}
        </nav>
        <div className="settings-content">
          {section === "general" ? <GeneralSettings {...props} /> : null}
          {section === "modelsCredentials" ? <ModelSettings {...props} /> : null}
          {section === "workFolders" ? <FolderSettings {...props} /> : null}
          {section === "permissions" ? <PermissionSettings {...props} /> : null}
          {section === "appearance" ? <AppearanceSettings {...props} /> : null}
          {section === "extensions" ? <ExtensionSettings t={props.t} /> : null}
          {section === "shortcuts" ? <ShortcutSettings t={props.t} /> : null}
        </div>
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
  onRestartOnboarding(): Promise<unknown>;
};

function SettingsSectionBlock(props: { title: string; detail?: string; children: ReactNode }) {
  return <section className="settings-section"><header><h2>{props.title}</h2>{props.detail ? <p>{props.detail}</p> : null}</header><div>{props.children}</div></section>;
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
  const [apiKey, setApiKey] = useState("");
  const [removeProvider, setRemoveProvider] = useState<string | null>(null);
  const providerOptions = useMemo(() => Array.from(new Map((props.models?.models ?? []).map((model) => [model.providerId, model.providerName])).entries()), [props.models]);
  const modelOptions = (props.models?.models ?? []).filter((model) => props.providers.some((provider) => provider.providerId === model.providerId));
  const defaultModelKey = props.settings.providerId && props.settings.modelId ? `${props.settings.providerId}/${props.settings.modelId}` : "";
  const save = useMutation({
    mutationFn: () => window.piWork.provider.save({ providerId, apiKey }),
    onSuccess: async () => {
      setApiKey("");
      await props.onProvidersChanged();
    },
  });
  async function remove() {
    if (removeProvider === null) return;
    await window.piWork.provider.remove(removeProvider);
    if (props.settings.providerId === removeProvider) await props.onUpdate({ providerId: null, modelId: null });
    setRemoveProvider(null);
    await props.onProvidersChanged();
  }
  return <>
    <SettingsSectionBlock title={props.t("modelsCredentials")} detail={props.t("credentialDetail")}>
      <FieldGroup className="credential-form">
        <Field><FieldLabel>{props.t("provider")}</FieldLabel><Select value={providerId} onValueChange={setProviderId}><SelectTrigger><SelectValue placeholder={props.t("provider")} /></SelectTrigger><SelectContent><SelectGroup>{providerOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel>{props.t("apiKey")}</FieldLabel><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
        <Button disabled={!providerId || !apiKey || save.isPending} onClick={() => save.mutate()}>{save.isPending ? props.t("saving") : props.t("save")}</Button>
      </FieldGroup>
      <div className="credential-list">
        {props.providers.map((provider) => <div key={provider.providerId}><span><Icon name="check-circle" /><strong>{provider.providerId}</strong><small>{props.t("credentialStored")}</small></span><Button variant="ghost" size="sm" onClick={() => setRemoveProvider(provider.providerId)}>{props.t("removeCredential")}</Button></div>)}
        {props.providers.length === 0 ? <p>{props.t("noCredentials")}</p> : null}
      </div>
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

function ExtensionSettings({ t }: { t: T }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["extensions"], queryFn: () => window.piWork.extension.list() });
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["extensions"] });
  const install = useMutation({
    mutationFn: (value: string) => window.piWork.extension.install(value),
    onSuccess: async () => { setSource(""); setError(null); await refresh(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const remove = useMutation({ mutationFn: (value: string) => window.piWork.extension.remove(value), onSuccess: refresh, onError: (cause: Error) => setError(cause.message) });
  return <SettingsSectionBlock title={t("extensions")} detail={t("extensionDetail")}>
    <div className="extension-install"><Input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t("extensionSource")} /><Button disabled={!source.trim() || install.isPending} onClick={() => install.mutate(source.trim())}>{t("installExtension")}</Button><Button variant="outline" onClick={() => void window.piWork.extension.chooseLocal("file").then((path) => path && setSource(path))}>{t("chooseFile")}</Button><Button variant="outline" onClick={() => void window.piWork.extension.chooseLocal("directory").then((path) => path && setSource(path))}>{t("chooseDirectory")}</Button></div>
    {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="extension-list">{query.data?.map((extension) => <div key={extension.source}><Icon name="skills" /><span><strong>{extension.source}</strong><code>{extension.installedPath ?? t("installedExtension")}</code></span><Button variant="ghost" size="sm" onClick={() => remove.mutate(extension.source)}>{t("removeExtension")}</Button></div>)}{query.data?.length === 0 ? <p>{t("noItems")}</p> : null}</div>
  </SettingsSectionBlock>;
}

function ShortcutSettings({ t }: { t: T }) {
  return <SettingsSectionBlock title={t("shortcuts")} detail={t("keyboardNavigation")}><div className="shortcut-list"><span>{t("openSearch")}<kbd>⌘ K</kbd></span><span>{t("newTask")}<kbd>⌘ N</kbd></span><span>{t("toggleSidebar")}<kbd>⌘ B</kbd></span><span>{t("inspectorShortcut")}<kbd>⌘ I</kbd></span></div></SettingsSectionBlock>;
}
