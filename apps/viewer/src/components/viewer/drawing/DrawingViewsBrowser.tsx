/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState } from 'react';
import { formatScaleFactorLabel } from '@ifc-lite/drawing-2d';
import { Copy, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/i18n';
import { toast } from '@/components/ui/toast';
import { ViewIdentityDialog } from './ViewIdentityFields';
import { drawingLineweightScales, type LineweightTable } from '@/lib/drawing/lineweight-table';
import { nextViewCode } from '@/lib/drawing/view-markers';
import { NewPlanDialog } from './NewPlanDialog';
import type { VerticalViewKind } from './PlaceVerticalView';
import { useViewerStore } from '@/store';
import {
  applySavedSectionCut, canSaveDrawingView, duplicateSavedSectionCut, removeSavedSectionCut,
  renameSavedSectionCut, SAVED_VIEW_KINDS, saveCurrentSectionCut, savedViewKind, setDrawingPublicationScale, updateSavedSectionCut,
  useSavedSectionCuts, type SavedViewKind,
} from '@/store/savedSectionCutsStore';

const ROW_ACTION = 'cursor-pointer text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-inset hover:ring-border active:bg-primary/15 active:text-primary disabled:cursor-default';

export function DrawingViewsBrowser({ overlay, close, canCreatePlan, canTrace, trace, publicationScale, lineweightTable }: {
  publicationScale: number; lineweightTable: LineweightTable;
  overlay: boolean; close: () => void; canCreatePlan: boolean; canTrace: boolean; trace: (kind: VerticalViewKind) => void;
}) {
  const { t } = useTranslation();
  const { promptDialog, confirmDialog } = useDialogs();
  const cuts = useSavedSectionCuts((s) => s.cuts);
  const active = useSavedSectionCuts((s) => s.activeCutId);
  const axis = useViewerStore((s) => s.sectionPlane.axis);
  const [query, setQuery] = useState('');
  const [newPlan, setNewPlan] = useState(false);
  const [kind, setKind] = useState<SavedViewKind>();
  const [identity, setIdentity] = useState<{ name: string; code: string; id?: string; save: (name: string, code: string) => void }>();
  const [failed, setFailed] = useState(false);
  const visible = cuts.filter(({ name, code }) => `${code ?? ''} ${name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedKind = kind ?? (axis === 'down' ? 'plan' : 'section');
  const canSave = useViewerStore((s) => canSaveDrawingView(s, selectedKind));
  const activeView = cuts.find((cut) => cut.id === active);
  const scales = drawingLineweightScales(lineweightTable, publicationScale, []);
  const canUpdate = useViewerStore((s) => !!activeView && canSaveDrawingView(s, savedViewKind(activeView)));

  function edit(action: () => void) {
    try {
      action();
      setFailed(false);
    } catch (error) {
      console.warn('Could not update drawing views', error);
      setFailed(true);
    }
  }

  return (
    <aside aria-label={t('section2d.views.title')}
      className={`flex w-64 min-w-0 flex-col border-r bg-background ${overlay ? 'absolute inset-y-0 left-0 z-30 max-w-full shadow-lg' : 'shrink-0'}`}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <h2 className="text-xs font-medium">{t('section2d.views.title')}</h2>
        <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.close')} onClick={close}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {identity && <ViewIdentityDialog {...identity} close={() => setIdentity(undefined)} />}
      <div className="space-y-2 p-2">
        <Button size="sm" variant="outline" className="w-full" disabled={!canCreatePlan}
          onClick={() => setNewPlan(true)}>{t('section2d.create.plan')}</Button>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="outline" disabled={!canTrace}
            onClick={() => trace('section')}>{t('section2d.create.section')}</Button>
          <Button size="sm" variant="outline" disabled={!canTrace}
            onClick={() => trace('elevation')}>{t('section2d.create.elevation')}</Button>
        </div>
        {!canTrace && <p className="text-xs text-muted-foreground">{t('section2d.create.openPlan')}</p>}
        {newPlan && <NewPlanDialog close={() => { setNewPlan(false); setQuery(''); }} />}
        <Input type="search" value={query} className="h-7 text-xs" onChange={(event) => setQuery(event.target.value)}
          placeholder={t('section2d.views.search')} aria-label={t('section2d.views.search')} />
        <div className="flex gap-1.5">
          <Select value={selectedKind} onValueChange={(value) => setKind(value as SavedViewKind)}>
            <SelectTrigger className="h-7 min-w-0 text-xs" aria-label={t('section2d.views.type')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SAVED_VIEW_KINDS.map((entry) => <SelectItem key={entry} value={entry}>{t(`section2d.views.type.${entry}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" variant="outline" disabled={!canSave} onClick={() => setIdentity({ name: '', code: nextViewCode(selectedKind, cuts), save: (name, code) => {
            saveCurrentSectionCut(name, selectedKind, publicationScale, code);
            setQuery('');
          } })}><Plus className="h-3.5 w-3.5" />{t('section2d.views.save')}</Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>{t('drawingUnderlay.lineweights.publicationScale')}</span>
          <Select value={String(publicationScale)} onValueChange={value => {
            const scale = scales.find(entry => String(entry.factor) === value);
            if (scale) edit(() => setDrawingPublicationScale(scale));
          }}>
            <SelectTrigger className="h-7 w-24" aria-label={t('drawingUnderlay.lineweights.publicationScale')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {scales.map(({ factor, name }) => <SelectItem key={factor} value={String(factor)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {failed && <p role="alert" className="text-xs text-destructive">{t('section2d.views.saveError')}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!visible.length && <p className="px-1 py-2 text-xs text-muted-foreground">{t(cuts.length ? 'section2d.views.noResults' : 'section2d.views.empty')}</p>}
        {SAVED_VIEW_KINDS.map((entry) => {
          const group = visible.filter((cut) => savedViewKind(cut) === entry);
          if (!group.length) return null;
          return <section key={entry} className="space-y-0.5">
            <h3 className="px-1 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{t(`section2d.views.group.${entry}`)}</h3>
            {group.map((cut) => (
              <div key={cut.id} className={`flex min-h-10 items-stretch rounded-md border ${active === cut.id ? 'border-primary/50 bg-accent' : 'border-transparent hover:bg-muted'}`}>
                <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs active:bg-primary/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
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
                  <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} title={t('section2d.views.duplicate')} aria-label={t('section2d.views.duplicate')} onClick={async () => {
                    const name = (await promptDialog({ description: t('section2d.views.name'), defaultValue: t('section2d.views.copyName', { name: cut.name }) }))?.trim();
                    if (name) edit(() => {
                      const id = duplicateSavedSectionCut(cut.id, name);
                      if (id) applySavedSectionCut(id);
                      setQuery('');
                    });
                  }}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} title={t('section2d.savedCuts.renameTitle')} aria-label={t('section2d.savedCuts.renameTitle')} onClick={() => setIdentity({ name: cut.name, code: cut.code ?? nextViewCode(entry, cuts), id: cut.id,
                    save: (name, code) => renameSavedSectionCut(cut.id, name, code) })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" className={ROW_ACTION} title={t('section2d.savedCuts.deleteTitle')} aria-label={t('section2d.savedCuts.deleteTitle')} onClick={async () => {
                    if (await confirmDialog({ description: t('section2d.views.delete', { name: cut.name }), destructive: true })) edit(() => removeSavedSectionCut(cut.id));
                  }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </section>;
        })}
      </div>
    </aside>
  );
}
