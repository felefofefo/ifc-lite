/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useRef, useState, type ChangeEvent } from 'react';
import { Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import type { GraphicStyle } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { clearDeletedDrawingViewTemplate, setDrawingViewTemplate } from '@/store/savedSectionCutsStore';
import { useViewerStore } from '@/store';
import { useDrawingTypeRows, useViewTemplates } from '@/hooks/useDrawingTemplateRules';
import { decodeViewTemplates, encodeViewTemplates, TEMPLATE_PREFIX, type ViewTemplate } from '@/lib/drawing/view-templates';
import { loadSavedFilters, saveFilter } from '@/lib/search/saved-filters';
import { downloadFile } from '@/lib/export/download';
import type { LineweightRow } from '@/lib/drawing/lineweight-table';
import { DrawingRulePaintControls } from './DrawingHatchSelect';
import { DrawingPenControls } from './DrawingPenControls';

export function DrawingViewTemplates({ lineweights }: { lineweights: LineweightRow }) {
  const { t } = useTranslation();
  const { templates, save } = useViewTemplates();
  const active = useViewerStore(s => s.activePresetId);
  const activeTemplate = templates.find(template => template.id === active);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<ViewTemplate | 'new'>();
  const [pendingDeletion, setPendingDeletion] = useState<ViewTemplate>();
  const [failed, setFailed] = useState(false);

  async function importTemplates(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
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

  function applyTemplate(id: string | null) {
    try {
      setDrawingViewTemplate(id);
      setFailed(false);
    } catch (error) {
      console.warn('Could not apply drawing template', error);
      setFailed(true);
    }
  }

  function duplicateTemplate(template: ViewTemplate) {
    const suffixLength = t('drawingUnderlay.template.copyName', { name: '' }).length;
    setEditor({
      id: `${TEMPLATE_PREFIX}${crypto.randomUUID()}`,
      name: t('drawingUnderlay.template.copyName', { name: template.name.slice(0, Math.max(0, 80 - suffixLength)) }),
      rows: structuredClone(template.rows),
    });
  }

  function deleteTemplate() {
    if (!pendingDeletion) return;
    try {
      save(templates.filter(template => template.id !== pendingDeletion.id));
      try {
        clearDeletedDrawingViewTemplate(pendingDeletion.id);
      } catch (error) {
        save(templates);
        throw error;
      }
      setFailed(false);
    } catch (error) {
      console.warn('Could not delete drawing template', error);
      setFailed(true);
    }
    setPendingDeletion(undefined);
  }

  const editorTitle = editor === 'new' ? 'drawingUnderlay.template.new'
    : templates.some(template => template.id === editor?.id) ? 'drawingUnderlay.template.edit' : 'drawingUnderlay.template.duplicate';
  return <>
    <Dialog open={editor !== undefined} onOpenChange={open => { if (!open) setEditor(undefined); }}>
      <div className="flex items-center gap-1">
        <Select value={activeTemplate?.id ?? 'none'} onValueChange={value => applyTemplate(value === 'none' ? null : value)}>
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={t('drawingUnderlay.template.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('drawingUnderlay.template.none')}</SelectItem>
            {templates.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0"
          aria-label={t('drawingUnderlay.template.new')} title={t('drawingUnderlay.template.new')} onClick={() => setEditor('new')}>
          <Plus className="size-4" />
        </Button>
        {activeTemplate && <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0"
          aria-label={t('drawingUnderlay.template.edit')} title={t('drawingUnderlay.template.edit')} onClick={() => setEditor(activeTemplate)}>
          <Pencil className="size-4" />
        </Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={t('drawingUnderlay.template.actions')}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>{t('drawingUnderlay.template.import')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => downloadFile(encodeViewTemplates(templates, loadSavedFilters()), 'ifc-lite-view-templates.json', 'application/json')}>
              {t('drawingUnderlay.template.export')}
            </DropdownMenuItem>
            {activeTemplate && <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => duplicateTemplate(activeTemplate)}>
                <Copy className="size-4" />{t('drawingUnderlay.template.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPendingDeletion(activeTemplate)} className="text-destructive">
                <Trash2 className="size-4" />{t('drawingUnderlay.template.delete')}
              </DropdownMenuItem>
            </>}
            {active !== null && <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => applyTemplate(null)}>{t('drawingUnderlay.template.detach')}</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
        <input type="file" hidden ref={fileRef} accept=".json" onChange={importTemplates} />
      </div>
      {failed && <p role="alert" className="mt-2 text-xs text-destructive">{t('drawingUnderlay.template.error')}</p>}
      <DialogContent scrollBody aria-describedby={undefined} className="gap-3 p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader><DialogTitle>{t(editorTitle)}</DialogTitle></DialogHeader>
        {editor !== undefined && <TemplateEditor template={editor === 'new' ? undefined : editor} lineweights={lineweights} onClose={() => setEditor(undefined)} />}
      </DialogContent>
    </Dialog>
    <Dialog open={pendingDeletion !== undefined} onOpenChange={open => { if (!open) setPendingDeletion(undefined); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('drawingUnderlay.template.delete')}</DialogTitle>
          <DialogDescription>{t('drawingUnderlay.template.deleteDescription', { name: pendingDeletion?.name ?? '' })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" variant="outline" autoFocus onClick={() => setPendingDeletion(undefined)}>{t('section2d.create.cancel')}</Button>
          <Button size="sm" variant="destructive" onClick={deleteTemplate}>{t('drawingUnderlay.template.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function TemplateEditor({ template, lineweights, onClose }: {
  template?: ViewTemplate; lineweights: LineweightRow; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { templates, save } = useViewTemplates();
  const classes = useDrawingTypeRows();
  const [name, setName] = useState(template?.name ?? '');
  const [rows, setRows] = useState(template?.rows ?? []);
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
  function saveAndApply() {
    try {
      const updated = {
        id: template?.id ?? `${TEMPLATE_PREFIX}${crypto.randomUUID()}`,
        name: name.trim(),
        rows,
      };
      save(templates.some(existing => existing.id === updated.id)
        ? templates.map(existing => existing.id === updated.id ? updated : existing)
        : [...templates, updated]);
      setDrawingViewTemplate(updated.id);
      onClose();
    } catch (error) {
      console.warn('Could not save drawing template', error);
      setFailed(true);
    }
  }

  return <>
    <DialogBody className="space-y-3 p-1 text-sm">
      <Input className="h-8" aria-label={t('drawingUnderlay.template.name')} placeholder={t('drawingUnderlay.template.name')}
        value={name} onChange={e => setName(e.target.value)} maxLength={80} />
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
                    <SelectTrigger className="h-7 px-2 text-xs" aria-label={`${ifcClass} ${t('drawingUnderlay.template.type')}`}>
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
              <SelectTrigger className="h-7 w-auto text-xs" aria-label={t('drawingUnderlay.template.visibility')}><SelectValue /></SelectTrigger>
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
      {failed && <p role="alert" className="text-destructive">{t('drawingUnderlay.template.error')}</p>}
    </DialogBody>
    <DialogFooter className="gap-2 border-t pt-3 sm:space-x-0">
      <Button size="sm" variant="outline" onClick={onClose}>{t('section2d.create.cancel')}</Button>
      <Button size="sm" disabled={!name.trim()} onClick={saveAndApply}>{t('drawingUnderlay.template.apply')}</Button>
    </DialogFooter>
  </>;
}
