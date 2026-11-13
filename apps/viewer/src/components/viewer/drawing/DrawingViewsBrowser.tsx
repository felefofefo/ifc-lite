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
import { useViewerStore } from '@/store';
import {
  applySavedSectionCut, canSaveDrawingView, duplicateSavedSectionCut, removeSavedSectionCut,
  renameSavedSectionCut, SAVED_VIEW_KINDS, saveCurrentSectionCut, savedViewKind, updateSavedSectionCut,
  useSavedSectionCuts, type SavedViewKind,
} from '@/store/savedSectionCutsStore';

export function DrawingViewsBrowser({ overlay, close }: { overlay: boolean; close: () => void }) {
  const { t } = useTranslation();
  const { promptDialog, confirmDialog } = useDialogs();
  const cuts = useSavedSectionCuts((s) => s.cuts);
  const active = useSavedSectionCuts((s) => s.activeCutId);
  const viewScale = useViewerStore((s) => s.drawing2DDisplayOptions.scale);
  const axis = useViewerStore((s) => s.sectionPlane.axis);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SavedViewKind>();
  const [scaleDraft, setScaleDraft] = useState<{ view: string | null; value: string }>();
  const [failed, setFailed] = useState(false);
  const visible = cuts.filter(({ name }) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedKind = kind ?? (axis === 'down' ? 'plan' : 'section');
  const canSave = useViewerStore((s) => canSaveDrawingView(s, selectedKind));
  const activeView = cuts.find((cut) => cut.id === active);
  const activeIs3D = activeView?.kind === '3d';
  const scaleText = scaleDraft?.view === active ? scaleDraft.value : String(activeIs3D ? activeView.publicationScale ?? viewScale : viewScale);
  const scale = Number(scaleText.trim().replace(',', '.'));
  const validScale = Number.isFinite(scale) && scale > 0;
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
      className={`flex w-64 min-w-0 flex-col border-r bg-background ${overlay ? 'absolute inset-y-0 left-0 z-20 max-w-full shadow-lg' : 'shrink-0'}`}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <h2 className="text-xs font-medium">{t('section2d.views.title')}</h2>
        <Button size="icon-xs" variant="ghost" aria-label={t('section2d.views.close')} onClick={close}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="space-y-2 p-2">
        <Input type="search" value={query} className="h-7 text-xs" onChange={(event) => setQuery(event.target.value)}
          placeholder={t('section2d.views.search')} aria-label={t('section2d.views.search')} />
        <div className="flex gap-1.5">
          <Select value={selectedKind} onValueChange={(value) => setKind(value as SavedViewKind)}>
            <SelectTrigger className="h-7 min-w-0 text-xs" aria-label={t('section2d.views.type')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SAVED_VIEW_KINDS.map((entry) => <SelectItem key={entry} value={entry}>{t(`section2d.views.type.${entry}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" variant="outline" disabled={!canSave || (selectedKind === '3d' && !validScale)} onClick={async () => {
            const name = (await promptDialog({ description: t('section2d.views.name'), defaultValue: '' }))?.trim();
            if (name && canSaveDrawingView(useViewerStore.getState(), selectedKind)) edit(() => { saveCurrentSectionCut(name, selectedKind, scale); setQuery(''); });
          }}><Plus className="h-3.5 w-3.5" />{t('section2d.views.save')}</Button>
        </div>
        {(selectedKind === '3d' || activeIs3D) && <label className="flex items-center gap-2 text-xs">
          {t('section2d.views.scale')}
          <Input className="h-7" value={scaleText} inputMode="decimal" aria-invalid={!validScale}
            onChange={(event) => setScaleDraft({ view: active, value: event.target.value })} />
        </label>}
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
              <div key={cut.id} className={`rounded-md border p-1 ${active === cut.id ? 'border-primary/50 bg-accent' : 'border-transparent hover:bg-muted'}`}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-xs"
                  aria-current={active === cut.id ? 'true' : undefined} onClick={() => edit(() => { setScaleDraft(undefined); applySavedSectionCut(cut.id); })}>
                  <span className="truncate" title={cut.name}>{cut.name}</span>
                  {cut.publicationScale && <span className="shrink-0 tabular-nums text-muted-foreground">
                    {`1:${formatScaleFactorLabel(cut.publicationScale)}`}
                  </span>}
                </button>
                <div className="flex justify-end gap-0.5">
                  {active === cut.id && <Button size="icon-xs" variant="ghost" disabled={!canUpdate || (activeIs3D && !validScale)} title={t('section2d.views.update')}
                    aria-label={t('section2d.views.update')} onClick={() => edit(() => updateSavedSectionCut(cut.id, scale))}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>}
                  <Button size="icon-xs" variant="ghost" title={t('section2d.views.duplicate')} aria-label={t('section2d.views.duplicate')} onClick={async () => {
                    const name = (await promptDialog({ description: t('section2d.views.name'), defaultValue: t('section2d.views.copyName', { name: cut.name }) }))?.trim();
                    if (name) edit(() => {
                      const id = duplicateSavedSectionCut(cut.id, name);
                      setScaleDraft(undefined);
                      if (id) applySavedSectionCut(id);
                      setQuery('');
                    });
                  }}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-xs" variant="ghost" title={t('section2d.savedCuts.renameTitle')} aria-label={t('section2d.savedCuts.renameTitle')} onClick={async () => {
                    const name = (await promptDialog({ description: t('section2d.savedCuts.renamePrompt'), defaultValue: cut.name }))?.trim();
                    if (name) edit(() => renameSavedSectionCut(cut.id, name));
                  }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-xs" variant="ghost" title={t('section2d.savedCuts.deleteTitle')} aria-label={t('section2d.savedCuts.deleteTitle')} onClick={async () => {
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
