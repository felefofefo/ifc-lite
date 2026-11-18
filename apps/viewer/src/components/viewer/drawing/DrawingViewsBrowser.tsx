/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, type DragEvent, type PointerEvent } from 'react';
import { formatScaleFactorLabel } from '@ifc-lite/drawing-2d';
import { ChevronDown, ChevronRight, Copy, Folder, FolderPlus, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/i18n';
import { toast } from '@/components/ui/toast';
import { RenameViewIdentityDialog, ViewIdentityDialog } from './ViewIdentityFields';
import { type LineweightTable } from '@/lib/drawing/lineweight-table';
import { nextViewCode } from '@/lib/drawing/view-markers';
import { NewPlanDialog } from './NewPlanDialog';
import type { VerticalViewKind } from './PlaceVerticalView';
import { useViewerStore } from '@/store';
import {
  applySavedSectionCut, canSaveDrawingView, duplicateSavedSectionCut, removeSavedSectionCut,
  SAVED_VIEW_KINDS, currentDrawingViewKind, saveCurrentSectionCut, savedViewKind, updateSavedSectionCut,
  moveSavedView, removeViewFolder, saveViewFolder, useSavedSectionCuts, type SavedViewFolder, type SavedSectionCut, type SavedViewKind,
} from '@/store/savedSectionCutsStore';

const ROW_ACTION = 'cursor-pointer text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-inset hover:ring-border active:bg-primary/15 active:text-primary disabled:cursor-default';

export function DrawingViewsBrowser({ overlay, panelWidth, width, setWidth, close, canCreatePlan, canTrace, trace, publicationScale, lineweightTable }: {
  panelWidth: number; width: number; setWidth: (width: number) => void;
  publicationScale: number; lineweightTable: LineweightTable;
  overlay: boolean; close: () => void; canCreatePlan: boolean; canTrace: boolean; trace: (kind: VerticalViewKind) => void;
}) {
  const { t } = useTranslation();
  const { promptDialog, confirmDialog } = useDialogs();
  const cuts = useSavedSectionCuts((s) => s.cuts);
  const folders = useSavedSectionCuts(s => s.folders);
  const active = useSavedSectionCuts((s) => s.activeCutId);
  const currentKind = useViewerStore(currentDrawingViewKind);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rightPanelWidth = useViewerStore(s => s.drawingInspectorWidth);
  const available = panelWidth && panelWidth >= 720 ? panelWidth - rightPanelWidth - 260 : panelWidth;
  const maxWidth = Math.max(260, Math.min(560, available || 560));
  const displayedWidth = Math.min(width, maxWidth);
  function setGroupOpen(id: string, open: boolean) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function resize(event: PointerEvent<HTMLButtonElement>) {
    if (overlay || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const button = event.currentTarget;
    const start = event.clientX;
    function move(pointer: globalThis.PointerEvent) {
      setWidth(Math.max(260, Math.min(maxWidth, displayedWidth + pointer.clientX - start)));
    }
    button.addEventListener('pointermove', move);
    button.addEventListener('lostpointercapture', () => button.removeEventListener('pointermove', move), { once: true });
  }
  const [query, setQuery] = useState('');
  const searching = !!query.trim();
  const [newPlan, setNewPlan] = useState(false);
  const [identity, setIdentity] = useState<string | { name: string; code: string; save: (name: string, code: string, scale?: number) => void }>();
  const [folderDraft, setFolderDraft] = useState<Omit<SavedViewFolder, 'id'> & { id?: string }>();
  const [folderError, setFolderError] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = cuts.filter(({ name, code }) => `${code ?? ''} ${name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const canSave3d = useViewerStore(s => canSaveDrawingView(s, '3d'));
  const canSaveCurrent = useViewerStore(s => !!currentKind && canSaveDrawingView(s, currentKind));
  const activeView = cuts.find((cut) => cut.id === active);
  function saveAs(kind: SavedViewKind) {
    setIdentity({ name: '', code: nextViewCode(kind, cuts), save: (name, code, scale) => {
      saveCurrentSectionCut(name, kind, scale ?? publicationScale, code);
      setQuery('');
    } });
  }
  const templateEditing = useSavedSectionCuts(s => !!s.templateEdit);
  const canUpdate = useViewerStore((s) => !templateEditing && !!activeView && canSaveDrawingView(s, savedViewKind(activeView)));

  function edit(action: () => void) {
    try {
      action();
      setFailed(false);
    } catch (error) {
      console.warn('Could not update drawing views', error);
      setFailed(true);
    }
  }

  async function duplicate(cut: typeof cuts[number], withAnnotations: boolean) {
    const name = (await promptDialog({
      description: t('section2d.views.name'), defaultValue: t('section2d.views.copyName', { name: cut.name }),
    }))?.trim();
    if (!name) return;
    edit(() => {
      const id = duplicateSavedSectionCut(cut.id, name, withAnnotations);
      if (id) applySavedSectionCut(id);
      setQuery('');
    });
  }

  function editFolder(kind: SavedViewKind, folder?: SavedViewFolder) {
    setFolderError(false);
    setFolderDraft(folder ?? { kind, name: '', prefix: '' });
  }

  function drop(kind: SavedViewKind, folderId?: string, beforeId?: string) {
    if (query.trim()) return {};
    const mime = 'application/x-ifc-lite-saved-view';
    return {
      onDragOver(event: DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes(mime)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        const id = event.dataTransfer.getData(mime);
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        edit(() => moveSavedView(id, kind, folderId, beforeId));
      },
    };
  }

  function renderView(cut: SavedSectionCut) {
    return (
      <div key={cut.id} {...drop(savedViewKind(cut), cut.folderId, cut.id)} className={`flex min-h-10 items-stretch rounded-md border ${active === cut.id ? 'border-primary/50 bg-accent' : 'border-transparent hover:bg-muted'}`}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs active:bg-primary/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          draggable={!query.trim()} onDragStart={event => {
            event.dataTransfer.setData('application/x-ifc-lite-saved-view', cut.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          aria-current={active === cut.id ? 'true' : undefined} onClick={() => edit(() => applySavedSectionCut(cut.id))}>
          <span className="truncate" title={cut.name}>{cut.code ? `${cut.code} · ${cut.name}` : cut.name}</span>
          {cut.publicationScale && <span className="shrink-0 tabular-nums text-muted-foreground">
            {`1:${formatScaleFactorLabel(cut.publicationScale)}`}
          </span>}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 pr-1">
          {active === cut.id && <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} disabled={!canUpdate} title={t('section2d.views.update')}
            aria-label={t('section2d.views.update')} onClick={() => edit(() => {
              updateSavedSectionCut(cut.id, publicationScale);
              toast.success(t('section2d.views.updated', { name: cut.name }));
            })}>
            <Save className="h-3.5 w-3.5" />
          </Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION}
                title={t('section2d.views.duplicate')} aria-label={t('section2d.views.duplicate')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void duplicate(cut, false)}>{t('section2d.views.duplicateSimple')}</DropdownMenuItem>
              {savedViewKind(cut) !== '3d' && <DropdownMenuItem onSelect={() => void duplicate(cut, true)}>
                {t('section2d.views.duplicateWithAnnotations')}
              </DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} title={t('section2d.savedCuts.renameTitle')} aria-label={t('section2d.savedCuts.renameTitle')} onClick={() => setIdentity(cut.id)}><Pencil className="h-3.5 w-3.5" /></Button>
          {folders.some(folder => folder.kind === savedViewKind(cut)) && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" className={ROW_ACTION} aria-label={t('section2d.views.move')}>
                <Folder className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {cut.folderId && <DropdownMenuItem onSelect={() => edit(() => moveSavedView(cut.id, savedViewKind(cut)))}>
                {t('section2d.views.outsideFolders')}
              </DropdownMenuItem>}
              {folders.filter(folder => folder.kind === savedViewKind(cut) && folder.id !== cut.folderId).map(folder =>
                <DropdownMenuItem key={folder.id} onSelect={() => edit(() => moveSavedView(cut.id, folder.kind, folder.id))}>
                  {folder.name}
                </DropdownMenuItem>)}
              {cut.folderId && <DropdownMenuItem onSelect={() => {
                const peers = cuts.filter(view => view.folderId === cut.folderId);
                const previous = peers[peers.findIndex(view => view.id === cut.id) - 1];
                if (previous) edit(() => moveSavedView(cut.id, savedViewKind(cut), cut.folderId, previous.id));
              }}>{t('section2d.views.moveUp')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>}
          <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} title={t('section2d.savedCuts.deleteTitle')} aria-label={t('section2d.savedCuts.deleteTitle')} onClick={async () => {
            if (await confirmDialog({ description: t('section2d.views.delete', { name: cut.name }), destructive: true })) edit(() => removeSavedSectionCut(cut.id));
          }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    );
  }

  return (
    <aside aria-label={t('section2d.views.title')}
      style={{ width: displayedWidth }}
      className={`flex min-w-0 flex-col border-r bg-background ${overlay ? 'absolute inset-y-0 left-0 z-30 max-w-full shadow-lg' : 'relative shrink-0'}`}>
      {!overlay && <button type="button" aria-label={t('section2d.views.resize')}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-ew-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20"
        onPointerDown={resize} onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setWidth(Math.max(260, Math.min(maxWidth, displayedWidth + (event.key === 'ArrowRight' ? 16 : -16))));
        }} />}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <h2 className="text-xs font-medium">{t('section2d.views.title')}</h2>
        <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.close')} onClick={close}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {folderDraft && <Dialog open onOpenChange={open => { if (!open) setFolderDraft(undefined); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t(folderDraft.id ? 'section2d.views.folderEdit' : 'section2d.views.folderNew')}</DialogTitle>
            <DialogDescription>{t('section2d.views.folderPrefixHelp')}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={event => {
            event.preventDefault();
            try {
              saveViewFolder(folderDraft.kind, folderDraft.name, folderDraft.prefix, folderDraft.id);
              setFolderDraft(undefined);
            } catch { setFolderError(true); }
          }}>
            <label className="grid gap-1 text-sm">{t('section2d.views.folderName')}
              <Input required maxLength={80} value={folderDraft.name} onChange={event => setFolderDraft({ ...folderDraft, name: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">{t('section2d.views.folderPrefix')}
              <Input maxLength={24} value={folderDraft.prefix} onChange={event => setFolderDraft({ ...folderDraft, prefix: event.target.value })} />
            </label>
            {folderError && <p className="text-xs text-destructive" role="alert">{t('section2d.views.folderInvalid')}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFolderDraft(undefined)}>{t('section2d.create.cancel')}</Button>
              <Button type="submit">{t('section2d.views.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
      {typeof identity === 'string'
        ? <RenameViewIdentityDialog id={identity} close={() => setIdentity(undefined)} />
        : identity && <ViewIdentityDialog {...identity} scale={{ value: publicationScale, table: lineweightTable }} close={() => setIdentity(undefined)} />}
      <div className="space-y-2 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="w-full justify-between">
              <Plus className="size-3.5" />{t('section2d.views.new')}<ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!canCreatePlan} onSelect={() => setNewPlan(true)}>{t('section2d.views.type.plan')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canTrace} onSelect={() => trace('section')}>{t('section2d.views.type.section')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canTrace} onSelect={() => trace('elevation')}>{t('section2d.views.type.elevation')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!canSave3d} onSelect={() => saveAs('3d')}>{t('section2d.views.type.3d')}</DropdownMenuItem>
            {currentKind && <><DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canSaveCurrent} onSelect={() => saveAs(currentKind)}>{t('section2d.views.saveCurrent')}</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
        {newPlan && <NewPlanDialog publicationScale={publicationScale} lineweightTable={lineweightTable}
          close={() => { setNewPlan(false); setQuery(''); }} />}
        <Input type="search" value={query} className="h-7 text-xs" onChange={(event) => setQuery(event.target.value)}
          placeholder={t('section2d.views.search')} aria-label={t('section2d.views.search')} />
        {failed && <p role="alert" className="text-xs text-destructive">{t('section2d.views.saveError')}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!visible.length && <p className="px-1 py-2 text-xs text-muted-foreground">{t(cuts.length ? 'section2d.views.noResults' : 'section2d.views.empty')}</p>}
        {SAVED_VIEW_KINDS.map((entry) => {
          const group = visible.filter((cut) => savedViewKind(cut) === entry);
          if (query.trim() && !group.length) return null;
          return <Collapsible key={entry} open={searching || !collapsed.has(entry)} onOpenChange={open => setGroupOpen(entry, open)} className="space-y-0.5">
            <div className="flex items-center justify-between px-1 pt-2">
              <h3 className="min-w-0 flex-1"><CollapsibleTrigger disabled={searching} className="group flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs font-medium hover:bg-muted">
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 group-data-[state=open]:rotate-90" />
                {t(`section2d.views.group.${entry}`)}
              </CollapsibleTrigger></h3>
              <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.folderNew')} title={t('section2d.views.folderNew')}
                onClick={() => editFolder(entry)}><FolderPlus className="size-3.5" /></Button>
            </div>
            <CollapsibleContent className="space-y-1 pl-2">
            <div {...drop(entry)} className="min-h-5 rounded border border-transparent">
              {group.filter(cut => !cut.folderId).map(renderView)}
              {!query.trim() && folders.some(folder => folder.kind === entry) &&
                <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('section2d.views.outsideFolders')}</div>}
            </div>
            {folders.filter(folder => folder.kind === entry && (!query.trim() || group.some(cut => cut.folderId === folder.id))).map(folder =>
              <Collapsible key={folder.id} {...drop(entry, folder.id)} open={searching || !collapsed.has(folder.id)} onOpenChange={open => setGroupOpen(folder.id, open)} className="rounded-md border">
                <div className="flex items-center gap-1 px-2 py-1 text-xs">
                  <CollapsibleTrigger disabled={searching} className="group flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left hover:bg-muted">
                    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 group-data-[state=open]:rotate-90" />
                    <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={folder.name}>{folder.name}</span>
                  </CollapsibleTrigger>
                  {folder.prefix && <span className="text-muted-foreground">{folder.prefix}</span>}
                  <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.folderEdit')} title={t('section2d.views.folderEdit')}
                    onClick={() => editFolder(entry, folder)}><Pencil className="size-3.5" /></Button>
                  <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.folderDelete')} title={t('section2d.views.folderDelete')}
                    onClick={async () => {
                      if (await confirmDialog({ description: t('section2d.views.folderDeleteConfirm', { name: folder.name }) }))
                        edit(() => removeViewFolder(folder.id));
                    }}><Trash2 className="size-3.5" /></Button>
                </div>
                <CollapsibleContent className="min-h-5 pl-2">{group.filter(cut => cut.folderId === folder.id).map(renderView)}</CollapsibleContent>
              </Collapsible>)}
            </CollapsibleContent>
          </Collapsible>;
        })}
      </div>
    </aside>
  );
}
