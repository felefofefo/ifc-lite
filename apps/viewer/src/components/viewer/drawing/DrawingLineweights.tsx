/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { DrawingScale } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useViewerStore } from '@/store';
import { drawingProjectId } from '@/lib/drawing/drawing-project';
import { drawingLineweightScales, isCustomScale, LINEWEIGHT_PRESETS, lineweightTableKey, lineweightsAtScale, readLineweightTable, type LineweightTable } from '@/lib/drawing/lineweight-table';

export function useDrawingLineweights() {
  const projectId = useViewerStore(drawingProjectId);
  const [edited, setEdited] = useState<{ projectId: string | undefined; table: LineweightTable }>();
  const saved = useMemo(() => {
    if (!projectId) return {};
    try {
      return readLineweightTable(localStorage.getItem(lineweightTableKey(projectId)));
    } catch (error) {
      console.warn('Could not load drawing lineweights', error);
      return {};
    }
  }, [projectId]);

  function save(table: LineweightTable) {
    if (projectId) localStorage.setItem(lineweightTableKey(projectId), JSON.stringify(table));
    setEdited({ projectId, table });
  }

  return { projectId, table: edited && edited.projectId === projectId ? edited.table : saved, save };
}

interface Props {
  scale: number;
  compact?: boolean;
  onScaleChange: (scale: DrawingScale) => void;
  settings: ReturnType<typeof useDrawingLineweights>;
}

export function DrawingLineweights({ scale, compact, onScaleChange, settings }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [added, setAdded] = useState<number[]>([]);
  const [denominator, setDenominator] = useState('');
  const [publicationScale, setPublicationScale] = useState<number | null>(null);
  const scales = drawingLineweightScales(settings.table, scale, added);
  const factor = Number(denominator.trim().replace(',', '.'));
  const canAdd = isCustomScale(factor) && !scales.some((entry) => entry.factor === factor);
  function addScale() {
    if (!canAdd) return;
    setAdded((current) => [...current, factor]);
    setDenominator('');
    setPublicationScale(factor);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      setSaveError(false);
      if (next) {
        setAdded([]);
        setDenominator('');
        setPublicationScale(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-xs' : 'sm'}
          className={compact ? undefined : 'h-7 px-2 text-xs'} aria-label={t('drawingUnderlay.lineweights.button')}>
          {compact ? <SlidersHorizontal className="h-3.5 w-3.5" /> : t('drawingUnderlay.lineweights.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('drawingUnderlay.lineweights.title')}</DialogTitle>
          <DialogDescription>
            {t('drawingUnderlay.lineweights.description')}
          </DialogDescription>
        </DialogHeader>
        <form key={`${settings.projectId ?? 'session'}:${scale}`} className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const table = Object.fromEntries(scales.map(({ factor }) => [
            factor,
            Object.fromEntries(LINEWEIGHT_PRESETS.map((preset) => [preset, Number(data.get(`${factor}-${preset}`))])),
          ])) as LineweightTable;
          const selectedScale = scales.find(({ factor }) => factor === (publicationScale ?? scale));
          try {
            settings.save({ ...settings.table, ...table });
          } catch (error) {
            console.warn('Could not save drawing lineweights', error);
            setSaveError(true);
            return;
          }
          if (selectedScale && selectedScale.factor !== scale) onScaleChange(selectedScale);
          setOpen(false);
        }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span>{t('drawingUnderlay.lineweights.publicationScale')}</span>
              <Select value={String(publicationScale ?? scale)} onValueChange={(value) => setPublicationScale(Number(value))}>
                <SelectTrigger aria-label={t('drawingUnderlay.lineweights.publicationScale')} className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{scales.map(({ name, factor }) => <SelectItem key={factor} value={String(factor)}>{name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="text-xs text-muted-foreground">1:</span>
              <Input value={denominator} onChange={(event) => setDenominator(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addScale(); } }}
                aria-label={t('drawingUnderlay.lineweights.denominator')} type="text" inputMode="decimal" className="h-8 w-20" />
              <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={addScale}>
                <Plus className="h-3.5 w-3.5" />{t('drawingUnderlay.lineweights.addScale')}
              </Button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('drawingUnderlay.lineweights.scale')}</th>
                {LINEWEIGHT_PRESETS.map((preset) => <th scope="col" className="capitalize" key={preset}>{t(`drawingUnderlay.lineweights.preset.${preset}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {scales.map(({ name, factor }) => {
                const row = lineweightsAtScale(settings.table, factor);
                return <tr key={factor}>
                  <th scope="row" className="text-left font-normal">{name}</th>
                  {LINEWEIGHT_PRESETS.map((preset) => <td key={preset} className="p-1">
                    <Input aria-label={t('drawingUnderlay.lineweights.field', { scale: name, preset: t(`drawingUnderlay.lineweights.preset.${preset}`) })} className="h-7 min-w-14"
                      name={`${factor}-${preset}`} type="number" min={0.05} max={2.11} step={0.01}
                      required defaultValue={row[preset]} />
                  </td>)}
                </tr>;
              })}
            </tbody>
          </table>
          {saveError && <p role="alert" className="text-sm text-destructive">{t('drawingUnderlay.lineweights.saveError')}</p>}
          <DialogFooter><Button type="submit">{t('drawingUnderlay.lineweights.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
