/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useRef, useState, type ChangeEvent } from 'react';
import { ChevronRight, Copy, Download, Pencil, Plus, ListChecks, Trash2, Upload } from 'lucide-react';
import type { GraphicStyle } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { useTranslation } from '@/i18n';
import { drawingAnnotationVisible, updateViewSettings, applyDrawingTemplate, assignDrawingTemplateViews, SAVED_VIEW_KINDS, savedViewKind, beginDrawingTemplateEdit, cancelDrawingTemplateEdit, captureDrawingTemplate, clearDeletedDrawingViewTemplate, saveDrawingViewRows, selectActiveSavedView, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { useDrawingTypeRows, useViewTemplates } from '@/hooks/useDrawingTemplateRules';
import { decodeViewTemplates, encodeViewTemplates, reusableViewRules, TEMPLATE_PREFIX, VIEW_TEMPLATE_GROUPS, viewTemplateGroups, type TemplateRow, type ViewTemplate, type ViewTemplateGroup } from '@/lib/drawing/view-templates';
import { loadSavedFilters, saveFilter } from '@/lib/search/saved-filters';
import { downloadFile } from '@/lib/export/download';
import { type AnnotationStyleKind, type AnnotationStyleSelection } from '@/lib/drawing/annotation-types';
import type { LineweightRow } from '@/lib/drawing/lineweight-table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DrawingRulePaintControls } from './DrawingHatchSelect';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DrawingSettingsPanel } from '../DrawingSettingsPanel';
import { DrawingSettingSwitch } from './DrawingSettingSwitch';
import type { DrawingViewModel } from './useDrawingViewModel';
import { symbolUse, SYMBOL_USES } from '@/lib/drawing/drawing-tag-library';
import { DrawingPenControls } from './DrawingPenControls';

const GROUP_LABEL = {
  projection: 'section2d.projection.settings',
  filters: 'section2d.inspector.filters',
  graphics: 'section2d.inspector.graphics',
  annotations: 'section2d.drawers.annotations',
} as const;

export function DrawingViewTemplates() {
  const { t } = useTranslation();
  const { templates, save } = useViewTemplates();
  const view = useSavedSectionCuts(selectActiveSavedView);
  const views = useSavedSectionCuts(state => state.cuts);
  const folders = useSavedSectionCuts(state => state.folders);
  const [assignmentQuery, setAssignmentQuery] = useState('');
  const query = assignmentQuery.trim().toLocaleLowerCase();
  const visibleViews = views.filter(view => `${view.code ?? ''} ${view.name} ${folders.find(folder => folder.id === view.folderId)?.name ?? ''}`
    .toLocaleLowerCase().includes(query));

  function checkViews(viewIds: string[], checked: boolean) {
    setAssignments(current => {
      if (!current) return current;
      const ids = new Set(current.ids);
      for (const id of viewIds) {
        if (checked) ids.add(id);
        else ids.delete(id);
      }
      return { ...current, ids };
    });
  }

  const active = templates.find(template => template.id === view?.graphics?.presetId);
  const editing = useSavedSectionCuts(s => !!s.templateEdit);
  const [capturedId, setCapturedId] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ViewTemplate>();
  const [pendingDeletion, setPendingDeletion] = useState<ViewTemplate>();
  const [failed, setFailed] = useState(false);
  const [assignments, setAssignments] = useState<{ templateId: string; ids: Set<string> }>();
  const assignmentTemplate = templates.find(template => template.id === assignments?.templateId);
  const selectedTemplate = templates.find(template => template.id === draft?.id);

  function openAssignments() {
    if (!selectedTemplate) return;
    setAssignmentQuery('');
    setAssignments({ templateId: selectedTemplate.id,
      ids: new Set(views.filter(view => view.graphics?.presetId === selectedTemplate.id).map(view => view.id)) });
  }

  function attempt(action: () => void) {
    try { action(); setFailed(false); }
    catch (error) { console.warn('Could not change drawing templates', error); setFailed(true); }
  }

  function capture(): ViewTemplate | undefined {
    if (!view) return;
    const snapshot = captureDrawingTemplate(view);
    const rules = new Map(view.graphics?.rows === undefined ? active?.rules?.map(rule => [rule.id, rule]) : []);
    snapshot.rules?.forEach(rule => rules.set(rule.id, rule));
    return {
      ...snapshot, id: TEMPLATE_PREFIX + crypto.randomUUID(), name: '',
      groups: [...VIEW_TEMPLATE_GROUPS], rows: structuredClone(view.graphics?.rows ?? active?.rows ?? []),
      rules: [...rules.values()],
    };
  }

  function saveDraft() {
    if (!draft || !draft.name.trim()) return;
    const groups = viewTemplateGroups(draft);
    if (!groups.length) return;
    attempt(() => {
      const updated: ViewTemplate = {
        id: draft.id, name: draft.name.trim(), groups: [...groups],
        rows: draft.rows,
        rules: draft.rules ? reusableViewRules(draft.rules) : undefined,
        projection: draft.projection ?? (groups.includes('projection') && view ? captureDrawingTemplate(view).projection : undefined),
        annotations: draft.annotations ?? (groups.includes('annotations') && view ? captureDrawingTemplate(view).annotations : undefined),
        filters: draft.filters ?? (groups.includes('filters') && view ? captureDrawingTemplate(view).filters : undefined),
      };
      const previous = templates.find(item => item.id === updated.id);
      const settings = (item: ViewTemplate) => JSON.stringify([viewTemplateGroups(item), item.rows, item.rules, item.projection, item.filters, item.annotations]);
      updated.revision = previous && settings(previous) === settings(updated) ? previous.revision : crypto.randomUUID();
      save(previous ? templates.map(item => item.id === updated.id ? updated : item) : [...templates, updated]);
      setDraft(structuredClone(updated));
      if (view && (capturedId === updated.id || active?.id === updated.id)) applyDrawingTemplate(updated, active);
      setCapturedId(undefined);
      toast.success(t('section2d.templateManager.saved', { name: updated.name }));
    });
  }

  async function importTemplates(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Template file too large.');
      const imported = decodeViewTemplates(await file.text());
      const merged = new Map(templates.map(template => [template.id, template]));
      imported.templates.forEach(template => merged.set(template.id, template));
      const installed = new Set(loadSavedFilters().map(filter => filter.name.toLowerCase()));
      for (const filter of imported.filters) {
        if (installed.has(filter.name.toLowerCase())) continue;
        if (!saveFilter(filter.name, filter.groups, filter.capturedScope).persisted) throw new Error('Could not save filter.');
      }
      save([...merged.values()]);
      setFailed(false);
    } catch (error) {
      console.warn('Could not import drawing templates', error);
      setFailed(true);
    }
  }

  function saveTemplateSettings() {
    if (!view || !active || !editing) return;
    attempt(() => {
      const snapshot = captureDrawingTemplate(view);
      const updated: ViewTemplate = {
        ...active, ...snapshot, rows: structuredClone(view.graphics?.rows ?? active.rows),
        rules: reusableViewRules(snapshot.rules ?? []), revision: crypto.randomUUID(),
      };
      save(templates.map(item => item.id === updated.id ? updated : item));
      cancelDrawingTemplateEdit();
      applyDrawingTemplate(updated, active);
      toast.success(t('section2d.templateManager.saved', { name: updated.name }));
    });
  }

  return <div className="space-y-1">
    <p className="text-xs font-medium">{t('drawingUnderlay.template.title')}</p>
    <div className="flex gap-1">
      <Select value={active?.id ?? 'none'} disabled={!view || editing}
        onValueChange={value => attempt(() => applyDrawingTemplate(templates.find(item => item.id === value), active))}>
        <SelectTrigger className="h-8 min-w-0 flex-1 text-xs [&>svg]:opacity-100" aria-label={t('drawingUnderlay.template.title')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('drawingUnderlay.template.none')}</SelectItem>
          {templates.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" disabled={editing} onClick={() => {
        const selected = active ?? templates[0];
        setDraft(selected && structuredClone(selected));
        setOpen(true);
      }}>{t('section2d.templateManager.manage')}</Button>
      {active && !editing && <Button type="button" size="icon" variant="outline" className="size-8 shrink-0"
        aria-label={t('section2d.templateManager.editSettings')} title={t('section2d.templateManager.editSettings')}
        onClick={() => attempt(() => beginDrawingTemplateEdit(active))}><Pencil className="size-4" /></Button>}
    </div>
    {editing && <div className="space-y-2 rounded-md border border-primary/40 p-2">
      <p className="text-xs font-medium">{t('section2d.templateManager.editing', { name: active?.name ?? '' })}</p>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" onClick={saveTemplateSettings}>{t('section2d.templateManager.saveSettings')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => attempt(cancelDrawingTemplateEdit)}>{t('section2d.create.cancel')}</Button>
      </div>
    </div>}
    {!active && <p className="text-xs text-muted-foreground">{t('drawingUnderlay.template.local')}</p>}
    {failed && !open && <p role="alert" className="text-xs text-destructive">{t('drawingUnderlay.template.error')}</p>}
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) { setAssignments(undefined); setDraft(undefined); setCapturedId(undefined); setPendingDeletion(undefined); setFailed(false); } }}>
      <DialogContent scrollBody className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('drawingUnderlay.template.title')}</DialogTitle>
          <DialogDescription>{t('section2d.templateManager.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {assignments && assignmentTemplate ? <>
            <h3 className="text-sm font-medium">{t('section2d.templateManager.assignedViews', { name: assignmentTemplate.name })}</h3>
            <Input type="search" value={assignmentQuery} onChange={event => setAssignmentQuery(event.target.value)}
              placeholder={t('section2d.views.search')} aria-label={t('section2d.views.search')} />
            <div className="max-h-[50vh] space-y-3 overflow-auto rounded-md border p-3">
              {!visibleViews.length && <p className="text-xs text-muted-foreground">{t(views.length ? 'section2d.views.noResults' : 'section2d.views.empty')}</p>}
              {SAVED_VIEW_KINDS.map(kind => {
                const group = visibleViews.filter(view => savedViewKind(view) === kind);
                if (!group.length) return null;
                function renderView(view: typeof group[number]) {
                  const other = templates.find(template => template.id === view.graphics?.presetId && template.id !== assignmentTemplate?.id);
                  return <label key={view.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" className="accent-primary" checked={assignments?.ids.has(view.id)}
                      onChange={event => checkViews([view.id], event.currentTarget.checked)} />
                    <span className="min-w-0 flex-1 truncate" title={view.name}>{view.code ? `${view.code} · ${view.name}` : view.name}</span>
                    {other && <span className="max-w-[40%] truncate text-xs text-muted-foreground" title={other.name}>{other.name}</span>}
                  </label>;
                }
                return <fieldset className="space-y-1" key={kind}>
                  <legend className="text-xs font-medium text-muted-foreground">{t(`section2d.views.group.${kind}`)}</legend>
                  {group.filter(view => !view.folderId).map(renderView)}
                  {folders.filter(folder => folder.kind === kind && group.some(view => view.folderId === folder.id)).map(folder => {
                    const ids = views.filter(view => view.folderId === folder.id).map(view => view.id);
                    const count = ids.filter(id => assignments.ids.has(id)).length;
                    return <div key={folder.id} className="rounded-md border">
                      <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-muted">
                        <input type="checkbox" className="accent-primary" checked={count === ids.length}
                          ref={node => { if (node) node.indeterminate = count > 0 && count < ids.length; }}
                          onChange={event => checkViews(ids, event.currentTarget.checked)} />
                        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                        <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}/{ids.length}</span>
                      </label>
                      <div className="pl-5">{group.filter(view => view.folderId === folder.id).map(renderView)}</div>
                    </div>;
                  })}
                </fieldset>;
              })}
            </div>
            <div className="flex justify-end gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setAssignments(undefined)}>{t('section2d.create.cancel')}</Button>
              <Button type="button" size="sm" disabled={!views.length} onClick={() => attempt(() => {
                assignDrawingTemplateViews(assignmentTemplate, assignments.ids, templates);
                setAssignments(undefined);
                toast.success(t('section2d.templateManager.assignmentsSaved'));
              })}>{t('section2d.views.save')}</Button>
            </div>
          </> : <>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="outline" disabled={!view} onClick={() => { const next = capture(); setDraft(next); setCapturedId(next?.id); setPendingDeletion(undefined); }}>
              <Plus className="size-4" />{t('section2d.templateManager.capture')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />{t('drawingUnderlay.template.import')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => downloadFile(encodeViewTemplates(templates, loadSavedFilters()), 'ifc-lite-view-templates.json', 'application/json')}>
              <Download className="size-4" />{t('drawingUnderlay.template.export')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!selectedTemplate} onClick={openAssignments}>
              <ListChecks className="size-4" />{t('section2d.templateManager.assignViews')}
            </Button>
            <input type="file" hidden ref={fileRef} accept=".json" onChange={importTemplates} />
          </div>
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ul className="max-h-72 divide-y overflow-auto rounded-md border">
              {templates.map(template => <li key={template.id} className="flex items-center gap-1 p-1">
                <Button type="button" size="sm" variant="toggle" aria-pressed={draft?.id === template.id}
                  title={template.name} className="min-w-0 flex-1 justify-start px-2 text-xs"
                  onClick={() => { setDraft(structuredClone(template)); setPendingDeletion(undefined); }}>
                  <span className="truncate">{template.name}</span>
                </Button>
                <Button type="button" size="icon-xs" variant="ghost" aria-label={t('drawingUnderlay.template.duplicate')}
                  title={t('drawingUnderlay.template.duplicate')} onClick={() => {
                    setPendingDeletion(undefined);
                    setDraft({ ...structuredClone(template), id: TEMPLATE_PREFIX + crypto.randomUUID(),
                      name: t('drawingUnderlay.template.copyName', { name: template.name }).slice(0, 80) });
                  }}><Copy className="size-4" /></Button>
                <Button type="button" size="icon-xs" variant="ghost" aria-label={t('drawingUnderlay.template.delete')}
                  title={t('drawingUnderlay.template.delete')} onClick={() => { setPendingDeletion(template); setDraft(undefined); }}>
                  <Trash2 className="size-4" />
                </Button>
              </li>)}
              {!templates.length && <li className="p-3 text-xs text-muted-foreground">{t('section2d.templateManager.empty')}</li>}
            </ul>
            <div className="min-w-0">
          {draft && <div className="space-y-2 rounded-md border p-3">
            <label className="grid gap-1 text-sm">{t('drawingUnderlay.template.name')}
              <Input maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} />
            </label>
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">{t('section2d.templateManager.groups')}</legend>
              {VIEW_TEMPLATE_GROUPS.map(group => <label key={group} className="flex items-center gap-2">
                <input type="checkbox" className="accent-primary" checked={viewTemplateGroups(draft).includes(group)}
                  disabled={!view && (group === 'projection' ? !draft.projection : group === 'filters' ? !draft.filters : group === 'annotations' ? !draft.annotations : false)}
                  onChange={event => {
                    const groups: ViewTemplateGroup[] = viewTemplateGroups(draft).filter(item => item !== group);
                    if (event.currentTarget.checked) groups.push(group);
                    setDraft({ ...draft, groups });
                  }} />
                {t(GROUP_LABEL[group])}
              </label>)}
            </fieldset>
            <div className="flex justify-end gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(undefined)}>{t('section2d.create.cancel')}</Button>
              <Button type="button" size="sm" disabled={!draft.name.trim() || !viewTemplateGroups(draft).length} onClick={saveDraft}>
                {t('section2d.views.save')}
              </Button>
            </div>
          </div>}
          {pendingDeletion && <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>{t('drawingUnderlay.template.deleteDescription', { name: pendingDeletion.name })}</p>
            <div className="flex justify-end gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setPendingDeletion(undefined)}>{t('section2d.create.cancel')}</Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => attempt(() => {
                save(templates.filter(item => item.id !== pendingDeletion.id));
                try { clearDeletedDrawingViewTemplate(pendingDeletion.id); }
                catch (error) { save(templates); throw error; }
                setPendingDeletion(undefined);
                const next = templates.find(item => item.id !== pendingDeletion.id);
                setDraft(next && structuredClone(next));
              })}>{t('drawingUnderlay.template.delete')}</Button>
            </div>
          </div>}
          {!draft && !pendingDeletion && <p className="p-3 text-xs text-muted-foreground">{t('section2d.templateManager.select')}</p>}
            </div>
          </div>
          </>}
          {failed && <p role="alert" className="text-xs text-destructive">{t('drawingUnderlay.template.error')}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  </div>;
}

export function DrawingViewOptions({ vm, locked }: { vm: DrawingViewModel; locked?: boolean }) {
  const { t } = useTranslation();
  const { templates } = useViewTemplates();
  const view = useSavedSectionCuts(selectActiveSavedView);
  const [open, setOpen] = useState(false);
  const assigned = templates.find(item => item.id === view?.graphics?.presetId);
  const groups = assigned ? viewTemplateGroups(assigned) : [];
  const graphicsLocked = !!locked && groups.includes('graphics');
  const annotationsLocked = !!locked && groups.includes('annotations');
  const hasAnnotations = !!view && savedViewKind(view) !== '3d';
  const legacy = view?.graphics?.rows === undefined ? templates.find(item => item.id === view?.graphics?.presetId) : undefined;
  const rows = view?.graphics?.rows ?? legacy?.rows ?? [];
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="ghost" size="sm" disabled={!view || (graphicsLocked && (!hasAnnotations || annotationsLocked))}
        className="w-full justify-between rounded-none border-b px-3 text-xs font-medium">
        {t('section2d.viewOptions.title')}<ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      </Button>
    </DialogTrigger>
    <DialogContent scrollBody aria-describedby={undefined} className="sm:max-w-3xl">
      <DialogHeader><DialogTitle>{t('section2d.viewOptions.title')}</DialogTitle></DialogHeader>
      {open && view && <ClassOptions key={view.id} initialRows={rows} inheritedRules={legacy?.rules} lineweights={vm.lineweights} vm={vm} graphicsLocked={graphicsLocked} annotationsLocked={annotationsLocked} hasAnnotations={hasAnnotations} onClose={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>;
}

function ClassOptions({ initialRows, inheritedRules, lineweights, vm, graphicsLocked, annotationsLocked, hasAnnotations, onClose }: {
  graphicsLocked: boolean; annotationsLocked: boolean; hasAnnotations: boolean;
  initialRows: TemplateRow[]; vm: DrawingViewModel; inheritedRules?: ViewTemplate['rules']; lineweights: LineweightRow; onClose: () => void;
}) {
  const { t } = useTranslation();
  const classes = useDrawingTypeRows();
  const [tab, setTab] = useState(graphicsLocked ? 'annotations' : 'classes');
  const [rows, setRows] = useState(initialRows);
  const [selectedRow, setRow] = useState<{ ifcClass: string; typeName?: string }>();
  const classNames = [...new Set([...classes.keys(), ...rows.map(r => r.ifcClass)])].sort();
  const row = selectedRow && classNames.includes(selectedRow.ifcClass)
    ? selectedRow
    : classNames[0] ? { ifcClass: classNames[0] } : undefined;
  const [failed, setFailed] = useState(false);
  const sameRow = (candidate: typeof row) => candidate?.ifcClass === row?.ifcClass && candidate?.typeName === row?.typeName;
  const style = rows.find(sameRow)?.style ?? {};
  function edit(style: GraphicStyle) {
    if (!row) return;
    setRows(current => [...current.filter(candidate => !sameRow(candidate)), { ...row, style }]);
  }
  function saveOptions() {
    try { saveDrawingViewRows(rows, inheritedRules); onClose(); }
    catch (error) { console.warn('Could not save view options', error); setFailed(true); }
  }

  return <>
    <DialogBody className="space-y-3 p-1 text-sm">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="classes" disabled={graphicsLocked}>{t('section2d.viewOptions.classes')}</TabsTrigger>
          <TabsTrigger value="rules" disabled={graphicsLocked}>{t('drawingUnderlay.settings.customRulesHeading')}</TabsTrigger>
          {hasAnnotations && <TabsTrigger value="annotations" disabled={annotationsLocked}>{t('section2d.drawers.annotations')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="classes">
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="max-h-48 min-w-0 overflow-auto rounded-md border md:max-h-[min(55dvh,36rem)]">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr><th className="p-2">{t('drawingUnderlay.settings.ifcClassLabel')}</th><th className="p-2">{t('drawingUnderlay.template.type')}</th></tr>
            </thead>
            <tbody>{classNames.map(ifcClass => {
              const selected = row?.ifcClass === ifcClass;
              const types = [...new Set([
                ...(classes.get(ifcClass)?.keys() ?? []),
                ...rows.flatMap(candidate => candidate.ifcClass === ifcClass && candidate.typeName ? [candidate.typeName] : []),
              ])].sort();
              return <tr key={ifcClass} className={selected ? 'border-t bg-accent' : 'border-t'}>
                <td>
                  <Button size="sm" variant="ghost" className="w-full justify-start px-2 text-xs" title={ifcClass}
                    aria-pressed={selected && !row?.typeName} onClick={() => setRow({ ifcClass })}>
                    <span className="truncate">{ifcClass}</span>
                  </Button>
                </td>
                <td className="p-1">
                  <Select value={selected && row?.typeName ? `type:${row.typeName}` : 'all'} disabled={types.length === 0}
                    onValueChange={value => setRow({ ifcClass, typeName: value === 'all' ? undefined : value.slice(5) })}>
                    <SelectTrigger className="[&>svg]:text-foreground [&>svg]:opacity-100 h-7 px-2 text-xs" aria-label={`${ifcClass} ${t('drawingUnderlay.template.type')}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-w-[75vw]">
                      <SelectItem value="all">{t('drawingUnderlay.template.allTypes')}</SelectItem>
                      {types.map(type => <SelectItem value={`type:${type}`} key={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {row && <div className="min-w-0 space-y-3 rounded-md border p-3 md:max-h-[min(55dvh,36rem)] md:overflow-y-auto">
          <h3 className="break-words font-medium">{row.ifcClass}{row.typeName && <span className="ml-2 text-xs font-normal text-muted-foreground">{row.typeName}</span>}</h3>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>{t('drawingUnderlay.template.visibility')}</span>
            <Select value={String(style.visible)} onValueChange={value => edit({ ...style, visible: value === 'undefined' ? undefined : value === 'true' })}>
              <SelectTrigger className="[&>svg]:text-foreground [&>svg]:opacity-100 h-7 w-auto text-xs" aria-label={t('drawingUnderlay.template.visibility')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="undefined">{t('drawingUnderlay.pen.inherit')}</SelectItem>
                <SelectItem value="true">{t('drawingUnderlay.template.show')}</SelectItem>
                <SelectItem value="false">{t('drawingUnderlay.template.hide')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DrawingPenControls style={style} lineweights={lineweights} onChange={edit} />
          <DrawingRulePaintControls style={style} onChange={edit} />
          <Button size="sm" variant="ghost" disabled={!rows.some(sameRow)} onClick={() => setRows(current => current.filter(candidate => !sameRow(candidate)))}>{t('drawingUnderlay.template.reset')}</Button>
        </div>}
      </div>
        </TabsContent>
        <TabsContent value="rules"><DrawingSettingsPanel lineweights={lineweights} /></TabsContent>
        <TabsContent value="annotations"><AnnotationOptions vm={vm} /></TabsContent>
      </Tabs>
      {failed && <p role="alert" className="text-destructive">{t('drawingUnderlay.template.error')}</p>}
    </DialogBody>
    <DialogFooter className="gap-2 border-t pt-3 sm:space-x-0">
      <Button size="sm" variant="outline" onClick={onClose}>
        {t(tab === 'classes' ? 'section2d.create.cancel' : 'section2d.tags.close')}
      </Button>
      {tab === 'classes' && <Button size="sm" onClick={saveOptions}>{t('section2d.views.save')}</Button>}
    </DialogFooter>
  </>;
}

function AnnotationOptions({ vm }: { vm: DrawingViewModel }) {
  const { t } = useTranslation();
  const view = useSavedSectionCuts(selectActiveSavedView);
  const cuts = useSavedSectionCuts(state => state.cuts);
  const grids = useSavedSectionCuts(state => state.grids);
  const library = useSavedSectionCuts(state => state.tagLibrary);
  const [failed, setFailed] = useState(false);
  if (!view) return null;
  const usedTemplates = library.templates.filter(template => view.elementTags?.some(tag => tag.templateId === template.id));
  const options = view.annotationOptions ?? { visibility: { ...view.markers } };
  function save(next: typeof options) {
    if (!view) return;
    try {
      updateViewSettings(view.id, { annotationOptions: next });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  function row(group: string, label: string, styleId?: string) {
    const key = styleId ? `${group}:${styleId}` : group;
    return <DrawingSettingSwitch key={key} label={label}
      checked={group === 'roomBoundaries' ? options.visibility.roomBoundaries === true
        : styleId ? options.visibility[key] !== false : drawingAnnotationVisible(view, group)}
      onCheckedChange={checked => save({ ...options, visibility: { ...options.visibility, [key]: checked } })} />;
  }
  function group(key: string, label: string, styles: readonly { id: string; name: string }[] = [],
    selection?: AnnotationStyleSelection, used: readonly { id: string; name: string }[] = styles) {
    if (!selection && !used.length) return <div key={key} className="px-3">{row(key, label)}</div>;
    const selectedId = selection && options.styleIds?.[selection];
    return <Collapsible key={key} className="border-b px-3">
      <div className="flex items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label={label} className="group">
            <ChevronRight className="size-3.5 group-data-[state=open]:rotate-90" />
          </Button>
        </CollapsibleTrigger>
        <div className="min-w-0 flex-1">{row(key, label)}</div>
      </div>
      <CollapsibleContent className="space-y-1 pb-2 pl-7">
        {selection && <div className="grid gap-1 pb-1">
          <label htmlFor={`view-annotation-${selection}`}>{t('section2d.annotationStyles.viewType')}</label>
          <Select value={selectedId || 'original'} onValueChange={id => {
            const styleIds = { ...options.styleIds };
            const overrides = { ...options.styles };
            if (id === 'original') {
              delete styleIds[selection];
              delete overrides[selection as AnnotationStyleKind];
            } else {
              styleIds[selection] = id;
              const definition = library.annotationStyles?.find(item => item.kind === selection && item.id === id);
              if (definition) overrides[definition.kind] = definition.style;
            }
            save({ ...options, styleIds, styles: overrides });
          }}>
            <SelectTrigger id={`view-annotation-${selection}`} className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="original">{t('section2d.annotationStyles.originalType')}</SelectItem>
              {selectedId && !styles.some(style => style.id === selectedId) &&
                <SelectItem value={selectedId} disabled>{t('section2d.annotationStyles.unavailableType')}</SelectItem>}
              {styles.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>}
        {(selectedId ? styles.filter(style => style.id === selectedId) : used).map(style => row(key, style.name, style.id))}
      </CollapsibleContent>
    </Collapsible>;
  }
  const dimensions = vm.dimensionSettings.library.types;
  return <div className="space-y-1 py-2 text-xs">
    {savedViewKind(view) === 'plan' && <div className="border-b px-3">{row('roomBoundaries', t('section2d.viewOptions.roomBoundaries'))}</div>}
    {group('dimensions', t('section2d.dimensionStyle.title'), dimensions, 'dimensions',
      dimensions.filter(style => vm.measure2DResults.some(item => item.dimension?.styleId === style.id)))}
    {savedViewKind(view) === 'plan' && (['section', 'elevation'] as const).map(kind => {
      const styles = library.markerStyles?.filter(style => style.kind === kind) ?? [];
      return group(kind, t(`section2d.annotationKind.${kind}`), styles, kind,
        styles.filter(style => cuts.some(cut => cut.markerTrace && cut.markerStyleId === style.id)));
    })}
    {SYMBOL_USES.filter(kind => kind !== 'section' && kind !== 'elevation').map(kind => {
      const original = kind === 'grid' ? library.templates.filter(template => symbolUse(template) === kind && grids.some(grid => grid.templateId === template.id))
        : usedTemplates.filter(template => symbolUse(template) === kind);
      if (kind === 'ifc' || kind === 'free') return group(`symbol:${kind}`, t(`section2d.annotationKind.${kind}`), original);
      const styles = library.annotationStyles?.filter(style => style.kind === kind) ?? [];
      const used = styles.filter(style => kind === 'grid' ? grids.some(grid => grid.appearanceId === style.id)
        : view.elementTags?.some(tag => tag.appearanceId === style.id));
      return group(`symbol:${kind}`, t(`section2d.annotationKind.${kind}`), styles, kind, [...used, ...original]);
    })}
    {([['area', vm.polygonArea2DResults], ['text', vm.textAnnotations2D], ['cloud', vm.cloudAnnotations2D]] as const).map(([kind, items]) => {
      const styles = library.annotationStyles?.filter(style => style.kind === kind) ?? [];
      return group(kind, t(`section2d.annotationKind.${kind}`), styles, kind,
        styles.filter(style => items.some(item => item.appearanceId === style.id)));
    })}
    {group('ifcAnnotations', t('section2d.annotationKind.ifcAnnotations'))}
    {failed && <p className="px-3 text-destructive" role="alert">{t('section2d.views.saveError')}</p>}
  </div>;
}
