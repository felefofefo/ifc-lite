/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useState } from 'react';
import { setDrawingProjectionDisplay } from '@/store/savedSectionCutsStore';
import { DistantElementsSettings } from './DistantElementsSettings';
import { Settings2 } from 'lucide-react';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { alternativesForUnitType } from '@/lib/units/alternatives';
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '@/components/ui/popover';
import { IconButton } from '@/components/ui/icon-button';
import { isManualProjectionDepth } from '@/lib/drawing/projection-depth';

export function DrawingProjectionSettings({ available, hiddenLinesOnly = false }: { available: boolean; hiddenLinesOnly?: boolean }) {
  const { t } = useTranslation();
  const axis = useViewerStore(s => s.sectionPlane.axis);
  const distant = useViewerStore(s => s.drawing2DDisplayOptions.distantElements);
  const hidden = useViewerStore(s => s.drawing2DDisplayOptions.showHiddenLines);
  const depth = useViewerStore(s => s.drawing2DDisplayOptions.constructionProjectionDepth);
  const update = useViewerStore(s => s.updateDrawing2DDisplayOptions);
  const unitId = useViewerStore(s => s.unitDisplayOverrides.LENGTHUNIT);
  const unit = alternativesForUnitType('LENGTHUNIT').find(u => u.id === unitId)
    ?? { symbol: 'm', scale: 1 };
  const [text, setText] = useState('');
  useEffect(() => setText(depth == null ? '' : String(depth / unit.scale)), [depth, unit.scale]);
  const invalid = !text.trim() || !isManualProjectionDepth(Number(text) * unit.scale);
  const label = t('section2d.projection.settings');
  return <Popover>
    <PopoverTrigger asChild>
      <IconButton variant="ghost" size="icon-xs" className="h-6 w-6 text-muted-foreground" label={label} disabled={!available}>
        <Settings2 className="h-3.5 w-3.5" />
      </IconButton>
    </PopoverTrigger>
    <PopoverPortal><PopoverContent className="space-y-3 text-xs" aria-label={label}>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label={t('section2d.projection.hiddenLines')} checked={hidden} onChange={e => setDrawingProjectionDisplay({ showHiddenLines: e.target.checked })} />{t('section2d.projection.hiddenLines')}</label>
      {!hiddenLinesOnly && <>
        <p className="font-medium">{t('section2d.projection.depth')}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" aria-label={t('section2d.projection.auto')} checked={depth == null}
            onChange={e => update({ constructionProjectionDepth: e.target.checked ? null : 3 })} />
          {t('section2d.projection.auto')}
        </label>
        {depth != null && <label className="block space-y-1">
          <span>{t('section2d.projection.distance', { unit: unit.symbol })}</span>
          <input type="number" min="0" step="any" value={text} aria-invalid={invalid}
            aria-label={t('section2d.projection.distance', { unit: unit.symbol })}
            className="w-full rounded border bg-background p-2 aria-[invalid=true]:border-destructive"
            onChange={e => {
              const value = e.target.value;
              setText(value);
              const metres = Number(value) * unit.scale;
              if (value.trim() && isManualProjectionDepth(metres)) update({ constructionProjectionDepth: metres });
            }} />
          {invalid && <output>{t('section2d.projection.invalid')}</output>}
        </label>}
        {axis !== 'down' && <DistantElementsSettings value={distant} onChange={distantElements => setDrawingProjectionDisplay({ distantElements })} />}
        <p className="text-muted-foreground">{t('section2d.projection.help')}</p>
      </>}
    </PopoverContent></PopoverPortal>
  </Popover>;
}
