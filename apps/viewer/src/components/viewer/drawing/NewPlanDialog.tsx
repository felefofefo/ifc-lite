/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { buildStoreyWorkplane, isWorkplane } from '@/lib/commands/modeling/workplane';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { planCutPosition } from '@/lib/drawing/view-placement';
import { collectStoreys, PLAN_CUT_HEIGHT_M } from '@/lib/section/section-distance';
import { useViewerStore } from '@/store';
import { isViewCodeAvailable, nextViewCode } from '@/lib/drawing/view-markers';
import { createDrawingView, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

const storeyKey = (storey: { modelId: string; expressId: number }) => JSON.stringify([storey.modelId, storey.expressId]);

export function NewPlanDialog({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const models = useViewerStore(s => s.models);
  const legacy = useViewerStore(s => s.ifcDataStore);
  const runtime = useDrawingRuntime();
  const storeys = useMemo(() => collectStoreys(models, legacy, false), [models, legacy]);
  const [level, setLevel] = useState(storeys[0] ? storeyKey(storeys[0]) : 'absolute');
  const [name, setName] = useState('');
  const cuts = useSavedSectionCuts(s => s.cuts);
  const [code, setCode] = useState(() => nextViewCode('plan', cuts));
  const validCode = isViewCodeAvailable(code, cuts);
  const [offset, setOffset] = useState(String(PLAN_CUT_HEIGHT_M));
  const [absolute, setAbsolute] = useState('');
  const [error, setError] = useState(false);
  const selected = storeys.find(storey => storeyKey(storey) === level);
  const value = (level === 'absolute' ? absolute : offset).trim().replace(',', '.');
  const height = value ? Number(value) : NaN;
  const label = t(level === 'absolute' ? 'section2d.create.absoluteHeight' : 'section2d.create.offset');

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('section2d.create.plan')}</DialogTitle></DialogHeader>
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        if (!validCode || !Number.isFinite(height) || (level !== 'absolute' && !selected)) return;
        const state = useViewerStore.getState();
        const sourceShift = runtime.sourceCoordinateInfo?.originShift?.y ?? 0;
        let elevation = height - sourceShift;
        if (selected?.modelId === 'legacy') elevation += selected.elevation;
        else if (selected) {
          const workplane = buildStoreyWorkplane(state, selected.modelId, selected.expressId, height);
          if (!isWorkplane(workplane)) { setError(true); return; }
          elevation = workplane.plane.origin[1];
        }
        const position = planCutPosition(elevation, runtime.geometryResult?.coordinateInfo.shiftedBounds ?? null);
        if (position === null) { setError(true); return; }
        try {
          createDrawingView(name.trim() || selected?.name || t('section2d.views.type.plan'), 'plan', { axis: 'down', position }, elevation, code);
          close();
        } catch { setError(true); }
      }}>
        <Input value={name} aria-label={t('section2d.views.name')} placeholder={selected?.name || t('section2d.views.type.plan')}
          onChange={event => setName(event.target.value)} />
        <label className="block space-y-1 text-sm">{t('section2d.views.code')}
          <Input value={code} maxLength={24} onChange={e => setCode(e.target.value)} />
        </label>
        {!validCode && <p className="text-sm text-destructive">{t('section2d.views.codeConflict')}</p>}
        <Select value={level} onValueChange={next => { setLevel(next); setError(false); }}>
          <SelectTrigger aria-label={t('section2d.create.level')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="absolute">{t('section2d.create.absolute')}</SelectItem>
            {storeys.map(storey => <SelectItem key={storeyKey(storey)} value={storeyKey(storey)}>
              {storey.name}{models.size > 1 ? ` · ${models.get(storey.modelId)?.name ?? storey.modelId}` : ''}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <label className="block space-y-1 text-sm">
          <span>{label}</span>
          <Input required inputMode="decimal" value={level === 'absolute' ? absolute : offset}
            onChange={event => { (level === 'absolute' ? setAbsolute : setOffset)(event.target.value); setError(false); }} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{t('section2d.create.planError')}</p>}
        <DialogFooter><Button type="submit" disabled={!validCode || !Number.isFinite(height)}>{t('section2d.views.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
