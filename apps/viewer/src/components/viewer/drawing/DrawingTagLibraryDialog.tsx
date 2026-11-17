/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Folder, FolderPlus, Pencil, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useViewerStore } from '@/store';
import { useDrawingTypeRows } from '@/hooks/useDrawingTemplateRules';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { drawingTagClass, removeTagFolder, SYMBOL_USES, symbolFitsView, symbolUse, TAG_CLASSES, type SymbolUse, type TagClass, type TagLibrary, type TagTemplate } from '@/lib/drawing/drawing-tag-library';
import { MAX_TAG_SVG_SIZE, readTagSvg, renderTagSvg, tagSvgFields } from '@/lib/drawing/drawing-tag-svg';
import { saveDrawingTagLibrary, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

const ALL = 'all';
const ROOT = 'root';
const USE_LABEL = {
  ifc: 'section2d.symbols.ifc', free: 'section2d.symbols.free',
  section: 'section2d.symbols.section', elevation: 'section2d.symbols.elevation',
  level: 'section2d.symbols.level', grid: 'section2d.symbols.grid',
  slope: 'section2d.symbols.slope', spotElevation: 'section2d.symbols.spotElevation',
} as const;
// ISO 129-1:2018 §7.10: open arrowhead on vertical views, crossed lines in plan.
const STANDARD_SYMBOLS: Record<SymbolUse, string> = {
  ifc: '<path d="M4 1h23v6H4z" fill="white" stroke="#202124" stroke-width=".18"/><text x="5" y="4.9">{{Name}}</text>',
  free: '<path d="M4 1.5 6.5 4 4 6.5 1.5 4Z" fill="white" stroke="#202124" stroke-width=".18"/>',
  section: '<g id="marker-direction" fill="none" stroke="#202124" stroke-width=".35"><path d="M4 6V2m-1.5 1.5L4 2l1.5 1.5"/></g><text x="8" y="4.9">{{ViewCode}}</text>',
  elevation: '<g id="marker-direction" fill="none" stroke="#202124" stroke-width=".18"><path d="M4 1.5 5.5 4h-3z"/></g><text x="8" y="4.9">{{ViewCode}}</text>',
  level: '<path d="M1.5 4H6.5M2.5 2.5 4 4l1.5-1.5M4 4V2h23" fill="none" stroke="#202124" stroke-width=".15"/><text x="5" y="1.7" font-size="2">{{Elevation}}</text>',
  grid: '<circle cx="4" cy="4" r="3.2" fill="white" stroke="#202124" stroke-width=".18"/><text x="4" y="4.9" text-anchor="middle">{{Grid}}</text>',
  slope: '<path d="M1 6l7-4v4z" fill="none" stroke="#202124" stroke-width=".18"/><text x="9" y="5">{{Slope}}</text>',
  spotElevation: '<path d="m2.5 2.5 3 3m-3 0 3-3M4 4h23" fill="none" stroke="#202124" stroke-width=".18"/><text x="7" y="3.5">{{Elevation}}</text>',
};
const newId = () => globalThis.crypto?.randomUUID?.() ?? 'tag-' + Date.now() + '-' + Math.random();

export function DrawingTagLibraryDialog({ canInsert, close, insert }: {
  canInsert: boolean;
  close: () => void;
  insert: (id: string) => void;
}) {
  const { t } = useTranslation();
  const library = useSavedSectionCuts(s => s.tagLibrary);
  const projectId = useSavedSectionCuts(s => s.projectId);
  const cuts = useSavedSectionCuts(s => s.cuts);
  const [folder, setFolder] = useState(ALL);
  const [ifcClass, setIfcClass] = useState(ALL);
  const drawing = useViewerStore(s => s.drawing2D);
  const axis = useViewerStore(s => s.sectionPlane.axis);
  const modelClasses = useDrawingTypeRows();
  const classes = useMemo(() => {
    const list = new Set<string>(TAG_CLASSES);
    for (const name of modelClasses.keys()) {
      const type = drawingTagClass(name);
      if (type) list.add(type);
    }
    for (const template of library.templates) for (const type of template.classes) list.add(type);
    for (const geometry of [drawing?.lines, drawing?.cutPolygons, drawing?.projectionPolygons]) {
      for (const item of geometry ?? []) {
        const type = drawingTagClass(item.ifcType);
        if (type) list.add(type);
      }
    }
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [drawing, library.templates, modelClasses]);
  const [selected, setSelected] = useState<string>();
  const [editingFolder, setEditingFolder] = useState<string>();
  const [folderName, setFolderName] = useState('');
  const [failed, setFailed] = useState<'svg' | 'storage'>();
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replace = useRef<string | undefined>(undefined);
  const currentFolder = library.folders.find(item => item.id === folder);
  const shown = library.templates.filter(item =>
    (folder === ALL || (item.folderId ?? ROOT) === folder) &&
    (ifcClass === ALL || (symbolUse(item) === 'ifc' && item.classes.some(type => type === ifcClass))));
  const template = shown.find(item => item.id === selected) ?? shown[0];
  const use = template ? symbolUse(template) : undefined;
  const isMarker = use === 'section' || use === 'elevation';
  const inUse = !!template && (library.markerStyles?.some(style => style.symbolId === template.id || style.startSymbolId === template.id) ||
    cuts.some(view => view.markerSymbolId === template.id || view.elementTags?.some(tag => tag.templateId === template.id)));
  const source = template?.svg;
  const preview = useMemo(() => {
    if (!source) return undefined;
    try {
      const fields = tagSvgFields(source);
      const examples = new Map(fields.map(field => [field, field.split('.').at(-1) ?? field]));
      if (use === 'grid') examples.set('Grid', 'A');
      if (use === 'level' || use === 'spotElevation') examples.set('Elevation', '+3.200 m');
      if (use === 'slope') examples.set('Slope', '12.5%');
      return { fields, href: renderTagSvg(source, examples).href };
    } catch {
      return undefined;
    }
  }, [source, use]);

  function save(update: (latest: TagLibrary) => TagLibrary): boolean {
    if (!projectId) return false;
    try {
      saveDrawingTagLibrary(projectId, update(useSavedSectionCuts.getState().tagLibrary));
      setFailed(undefined);
      return true;
    } catch {
      setFailed('storage');
      return false;
    }
  }

  function patchTemplate(id: string, patch: Partial<Pick<TagTemplate, 'name' | 'classes' | 'folderId' | 'svg'>>) {
    return save(latest => ({
      ...latest, templates: latest.templates.map(item => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function saveFolder() {
    const name = folderName.trim();
    if (!name || !editingFolder) return;
    const id = editingFolder === ROOT ? newId() : editingFolder;
    if (save(latest => ({
      ...latest, folders: editingFolder === ROOT ? [...latest.folders, { id, name }]
        : latest.folders.map(item => item.id === id ? { id, name } : item),
    }))) {
      setFolder(id);
      setEditingFolder(undefined);
    }
  }

  async function replaceSvg(file: File, id: string) {
    setLoading(true);
    try {
      if (file.size > MAX_TAG_SVG_SIZE) throw new Error('SVG is too large');
      const source = await file.text();
      const current = useSavedSectionCuts.getState();
      if (current.projectId !== projectId) return;
      const existing = current.tagLibrary.templates.find(item => item.id === id);
      if (!existing) return;
      const svg = readTagSvg(source, symbolUse(existing) === 'ifc');
      patchTemplate(id, { svg });
    } catch {
      setFailed('svg');
    } finally {
      setLoading(false);
    }
  }

  function addStandardSymbol(use: SymbolUse) {
    const width = use === 'grid' || use === 'free' ? 8 : 28;
    const id = newId();
    const symbol: TagTemplate = {
      id, use, name: t(USE_LABEL[use]), folderId: currentFolder?.id,
      classes: use === 'ifc' ? (classes.includes(ifcClass) ? [ifcClass] : classes) : [],
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="8mm" viewBox="0 0 ${width} 8">
        <circle id="tag-anchor" cx="4" cy="4" r="1"/>
        <g font-family="Arial" font-size="2.5" fill="#202124">${STANDARD_SYMBOLS[use]}</g>
      </svg>`,
    };
    if (save(latest => ({ ...latest, templates: [...latest.templates, symbol] }))) {
      setIfcClass(ALL);
      setSelected(id);
    }
  }

  function filePicker(id: string) {
    replace.current = id;
    fileInput.current?.click();
  }

  function toggleClass(item: TagTemplate, type: TagClass) {
    const next = item.classes.includes(type) ? item.classes.filter(value => value !== type) : [...item.classes, type];
    if (next.length) patchTemplate(item.id, { classes: next });
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{t('section2d.tagLibrary.title')}</DialogTitle>
          <DialogDescription>{t('section2d.tagLibrary.description')}</DialogDescription>
        </DialogHeader>
        <input ref={fileInput} type="file" accept=".svg,image/svg+xml" hidden onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file && replace.current) void replaceSvg(file, replace.current);
        }} />
        <div className="grid min-w-0 gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-2 rounded-md border p-2" aria-label={t('section2d.tagLibrary.folders')}>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold">{t('section2d.tagLibrary.folders')}</span>
              <Button type="button" variant="ghost" size="icon-xs" disabled={!projectId}
                aria-label={t('section2d.tagLibrary.newFolder')} title={t('section2d.tagLibrary.newFolder')}
                onClick={() => { setEditingFolder(ROOT); setFolderName(''); }}><FolderPlus className="size-4" /></Button>
            </div>
            {editingFolder && <form className="space-y-1" onSubmit={event => { event.preventDefault(); saveFolder(); }}>
              <Input aria-label={t('section2d.tagLibrary.folderName')} value={folderName} maxLength={80}
                onChange={event => setFolderName(event.currentTarget.value)} className="h-8 text-xs" />
              <div className="flex flex-wrap gap-1">
                <Button type="submit" size="sm" disabled={!folderName.trim()}>{t('section2d.views.save')}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingFolder(undefined)}>{t('section2d.create.cancel')}</Button>
              </div>
            </form>}
            <div className="max-h-40 space-y-0.5 overflow-auto md:max-h-72">
              {[{ id: ALL, name: t('section2d.tagLibrary.allTemplates') },
                { id: ROOT, name: t('section2d.tagLibrary.noFolder') }, ...library.folders].map(entry => (
                <Button type="button" variant="toggle" size="sm" key={entry.id} aria-pressed={folder === entry.id}
                  className="w-full justify-start" title={entry.name} onClick={() => setFolder(entry.id)}>
                  <Folder className="size-3.5 shrink-0" /><span className="truncate">{entry.name}</span>
                </Button>
              ))}
            </div>
            {currentFolder && <div className="flex gap-1 border-t pt-1">
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('section2d.tagLibrary.renameFolder')}
                title={t('section2d.tagLibrary.renameFolder')} onClick={() => {
                  setEditingFolder(currentFolder.id); setFolderName(currentFolder.name);
                }}><Pencil className="size-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('section2d.tagLibrary.deleteFolder')}
                title={t('section2d.tagLibrary.deleteFolder')} onClick={() => {
                  if (save(latest => removeTagFolder(latest, currentFolder.id))) {
                    setFolder(ROOT); setEditingFolder(undefined);
                  }
                }}><Trash2 className="size-3.5" /></Button>
            </div>}
          </aside>

          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select value={ifcClass} onValueChange={setIfcClass}>
                <SelectTrigger className="h-8 w-40 text-xs" aria-label={t('section2d.tagLibrary.classFilter')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('section2d.tagLibrary.allClasses')}</SelectItem>
                  {classes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline" disabled={!projectId || loading}>
                    {t('section2d.symbols.addStandard')} <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SYMBOL_USES.map(kind => (
                    <DropdownMenuItem key={kind} onSelect={() => addStandardSymbol(kind)}>
                      {t(USE_LABEL[kind])}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {!projectId && <p className="text-xs text-muted-foreground">{t('section2d.tagLibrary.openProject')}</p>}
            {failed && <p role="alert" className="text-xs text-destructive">
              {t(failed === 'svg' ? 'section2d.tags.invalidSvg' : 'section2d.tagLibrary.saveFailed')}
            </p>}
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="max-h-72 min-w-0 space-y-0.5 overflow-auto rounded-md border p-1">
                {shown.length ? shown.map(item => (
                  <Button type="button" variant="toggle" size="sm" key={item.id} aria-pressed={item.id === template?.id}
                    className="w-full justify-start" title={item.name} onClick={() => setSelected(item.id)}>
                    <Tag className="size-3.5 shrink-0" /><span className="truncate">{item.name}</span>
                  </Button>
                )) : <p className="p-3 text-xs text-muted-foreground">{t('section2d.tagLibrary.empty')}</p>}
              </div>
              {template && <div key={template.id} className="min-w-0 space-y-3 rounded-md border p-3 text-xs">
                {preview && <div className="flex h-24 items-center justify-center rounded-sm border bg-white p-2">
                  <img alt={template.name} src={preview.href} className="max-h-full max-w-full" />
                </div>}
                <label className="grid gap-1">
                  <span className="font-medium">{t('section2d.tagLibrary.name')}</span>
                  <Input className="h-8 text-xs" defaultValue={template.name} maxLength={120}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                    onBlur={event => {
                      const name = event.currentTarget.value.trim();
                      if (!name || (name !== template.name && !patchTemplate(template.id, { name }))) {
                        event.currentTarget.value = template.name;
                      }
                    }} />
                </label>
                <Select value={template.folderId ?? ROOT} onValueChange={id => patchTemplate(template.id, { folderId: id === ROOT ? undefined : id })}>
                  <SelectTrigger className="h-8 text-xs" aria-label={t('section2d.tagLibrary.folderName')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT}>{t('section2d.tagLibrary.noFolder')}</SelectItem>
                    {library.folders.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {use && <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('section2d.symbols.use')}</span>
                  <span className="font-medium">{t(USE_LABEL[use])}</span>
                </div>}
                {use === 'ifc' && <TagClassPicker classes={classes} checked={template.classes}
                  toggle={type => toggleClass(template, type)} />}
                {use && !isMarker && use !== 'ifc' && use !== 'free' && (
                  <p className="text-muted-foreground">{t(`section2d.symbols.help.${use}`)}</p>
                )}
                {isMarker && <p className="text-muted-foreground">{t('section2d.symbols.markerFields')}</p>}
                {!!preview?.fields.length && <p className="break-all text-muted-foreground">{preview.fields.join(' · ')}</p>}
                <div className="flex flex-wrap items-center gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => filePicker(template.id)}>
                    {t('section2d.tagLibrary.replaceSvg')}
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={inUse}
                    aria-label={t('section2d.tagLibrary.deleteTemplate')} onClick={() => {
                      const current = useSavedSectionCuts.getState();
                      if (current.tagLibrary.markerStyles?.some(style => style.symbolId === template.id || style.startSymbolId === template.id) ||
                        current.cuts.some(view => view.markerSymbolId === template.id ||
                          view.elementTags?.some(tag => tag.templateId === template.id))) return;
                      if (save(latest => ({ ...latest, templates: latest.templates.filter(item => item.id !== template.id) }))) setSelected(undefined);
                    }}><Trash2 className="size-3.5" /></Button>
                  {inUse && <span className="text-muted-foreground">{t('section2d.markerStyles.inUse')}</span>}
                </div>
              </div>}
            </div>
          </section>
        </div>
        <DialogFooter>
          {!isMarker && !canInsert && <p className="mr-auto self-center text-xs text-muted-foreground">{t('section2d.tags.saveView')}</p>}
          <Button type="button" variant="outline" onClick={close}>{t('section2d.tags.close')}</Button>
          {canInsert && use && !symbolFitsView(use, axis) &&
            <p className="mr-auto self-center text-xs text-muted-foreground">{t('section2d.symbols.incompatibleView')}</p>}
          {!isMarker && <Button type="button" disabled={!canInsert || !template || !preview || loading || !use || !symbolFitsView(use, axis)}
            onClick={() => { if (template) insert(template.id); }}>{t('section2d.tagLibrary.insert')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagClassPicker({ classes, checked, toggle }: {
  classes: readonly TagClass[]; checked: readonly TagClass[]; toggle: (type: TagClass) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const visible = classes.filter(type => type.toLowerCase().includes(query.trim().toLowerCase()));
  return <Popover onOpenChange={open => { if (!open) setQuery(''); }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="sm" className="w-full justify-between">
        {t('section2d.tagLibrary.compatibleClasses')} ({checked.length}) <ChevronDown className="size-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-2">
      <Input value={query} className="mb-1 h-8 text-xs" onChange={event => setQuery(event.currentTarget.value)}
        aria-label={t('section2d.tagLibrary.searchClasses')} placeholder={t('section2d.tagLibrary.searchClasses')} />
      <div className="max-h-48 overflow-y-auto text-xs">
        {visible.map(type => <label key={type} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
          <input type="checkbox" className="accent-primary" checked={checked.includes(type)}
            disabled={checked.length === 1 && checked.includes(type)} onChange={() => toggle(type)} />
          {type}
        </label>)}
        {!visible.length && <p className="p-2 text-muted-foreground">{t('section2d.tagLibrary.noClasses')}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
