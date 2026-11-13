/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { captureViewVisibility } from '@/lib/drawing/view-visibility';
import { DEFAULT_VIEW_MARKERS } from '@/lib/drawing/view-markers';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { loadSavedFilters } from '@/lib/search/saved-filters';
import { savedViewKind, updateViewSettings, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export function ViewVisibilitySettings({ annotations = false }: { annotations?: boolean }) {
  const { t } = useTranslation();
  const cut = useSavedSectionCuts(s => s.cuts.find(c => c.id === s.activeCutId));
  const ifcAnnotations = useViewerStore(s => s.drawing2DDisplayOptions.showIfcAnnotations);
  const [failed, setFailed] = useState(false);
  const runtime = useDrawingRuntime();
  const presets = annotations ? [] : loadSavedFilters();
  const markers = cut?.markers ?? DEFAULT_VIEW_MARKERS;
  function save(patch: Parameters<typeof updateViewSettings>[1]) {
    if (!cut) return;
    try { updateViewSettings(cut.id, patch); setFailed(false); } catch { setFailed(true); }
  }
  return <div className="h-full space-y-3 overflow-y-auto p-3 text-xs">
    {annotations && <label className="flex items-center gap-2">
      <input type="checkbox" checked={ifcAnnotations} onChange={e => {
        const showIfcAnnotations = e.target.checked;
        if (cut?.display) save({ display: { ...cut.display, showIfcAnnotations } });
        useViewerStore.getState().updateDrawing2DDisplayOptions({ showIfcAnnotations });
      }} />{t('section2d.display.ifcAnnotations')}
    </label>}
    {!cut && <p className="text-muted-foreground">{t('section2d.viewSettings.selectSaved')}</p>}
    {annotations && cut && savedViewKind(cut) === 'plan' && (['section', 'elevation'] as const).map(kind =>
      <label key={kind} className="flex items-center gap-2">
        <input type="checkbox" checked={markers[kind]} onChange={e => save({ markers: { ...markers, [kind]: e.target.checked } })} />
        {t(kind === 'section' ? 'section2d.viewSettings.showSections' : 'section2d.viewSettings.showElevations')}
      </label>)}
    {!annotations && cut && <>
      <p className="text-muted-foreground">{t('section2d.viewSettings.visibilityHelp')}</p>
      <Button variant="outline" size="sm" onClick={() => save({ visibility: captureViewVisibility(useViewerStore.getState()) })}>
        {t('section2d.viewSettings.capture')}
      </Button>
      {savedViewKind(cut) !== '3d' && <>
        <Select value={cut.filter?.preset.name ?? ''} onValueChange={value => {
          const preset = presets.find(p => p.name === value);
          save({ filter: preset ? { preset, mode: cut.filter?.mode ?? 'hide' } : undefined });
        }}>
          <SelectTrigger aria-label={t('section2d.viewSettings.filter')}><SelectValue placeholder={t('section2d.viewSettings.filter')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__no_drawing_filter__">{t('section2d.viewSettings.noFilter')}</SelectItem>
            {cut.filter && !presets.some(p => p.name === cut.filter?.preset.name) &&
              <SelectItem value={cut.filter.preset.name}>{cut.filter.preset.name}</SelectItem>}
            {presets.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {cut.filter && <Select value={cut.filter.mode} onValueChange={mode => {
          if (cut.filter) save({ filter: { ...cut.filter, mode: mode === 'show' ? 'show' : 'hide' } });
        }}>
          <SelectTrigger aria-label={t('section2d.viewSettings.filterMode')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hide">{t('section2d.viewSettings.hideMatches')}</SelectItem>
            <SelectItem value="show">{t('section2d.viewSettings.showMatches')}</SelectItem>
          </SelectContent>
        </Select>}
      </>}
    </>}
    {!annotations && runtime.viewFilterFailed && <p role="alert" className="text-destructive">{t('section2d.viewSettings.filterFailed')}</p>}
    {failed && <p role="alert" className="text-destructive">{t('section2d.views.saveError')}</p>}
  </div>;
}
