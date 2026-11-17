/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useState } from 'react';
import { setDrawingProjectionDisplay } from '@/store/savedSectionCutsStore';
import { DrawingSettingSwitch } from './DrawingSettingSwitch';
import { DistantElementsSettings } from './DistantElementsSettings';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { alternativesForUnitType } from '@/lib/units/alternatives';
import { Input } from '@/components/ui/input';
import { isManualProjectionDepth } from '@/lib/drawing/projection-depth';

export function DrawingProjectionSettings({ hiddenLinesOnly = false }: { hiddenLinesOnly?: boolean }) {
  const { t } = useTranslation();
  const axis = useViewerStore(s => s.sectionPlane.axis);
  const distant = useViewerStore(s => s.drawing2DDisplayOptions.distantElements);
  const hidden = useViewerStore(s => s.drawing2DDisplayOptions.showHiddenLines);
  const depth = useViewerStore(s => s.drawing2DDisplayOptions.constructionProjectionDepth);
  const unitId = useViewerStore(s => s.unitDisplayOverrides.LENGTHUNIT);
  const unit = alternativesForUnitType('LENGTHUNIT').find(u => u.id === unitId)
    ?? { symbol: 'm', scale: 1 };
  const [text, setText] = useState('');
  useEffect(() => setText(depth == null ? '' : String(depth / unit.scale)), [depth, unit.scale]);
  const invalid = !text.trim() || !isManualProjectionDepth(Number(text) * unit.scale);
  return <section className="space-y-3 text-xs" aria-label={t('section2d.projection.settings')}>
      <DrawingSettingSwitch label={t(hiddenLinesOnly ? 'section2d.projection.exportHiddenLines' : 'section2d.projection.hiddenLines')}
        checked={hidden} onCheckedChange={showHiddenLines => setDrawingProjectionDisplay({ showHiddenLines })} />
      {!hiddenLinesOnly && <>
        <DrawingSettingSwitch label={t('section2d.projection.auto')} checked={depth == null}
          onCheckedChange={auto => setDrawingProjectionDisplay({ constructionProjectionDepth: auto ? null : 3 })} />
        {depth != null && <label className="block space-y-1">
          <span>{t('section2d.projection.distance', { unit: unit.symbol })}</span>
          <Input type="number" min="0" step="any" value={text} aria-invalid={invalid}
            aria-label={t('section2d.projection.distance', { unit: unit.symbol })}
            className="h-8 w-full aria-[invalid=true]:border-destructive"
            onChange={e => {
              const value = e.target.value;
              setText(value);
              const metres = Number(value) * unit.scale;
              if (value.trim() && isManualProjectionDepth(metres)) setDrawingProjectionDisplay({ constructionProjectionDepth: metres });
            }} />
          {invalid && <output>{t('section2d.projection.invalid')}</output>}
        </label>}
        {axis !== 'down' && <DistantElementsSettings value={distant} onChange={distantElements => setDrawingProjectionDisplay({ distantElements })} />}
        <p className="text-muted-foreground">{t('section2d.projection.help')}</p>
      </>}
  </section>;
}
