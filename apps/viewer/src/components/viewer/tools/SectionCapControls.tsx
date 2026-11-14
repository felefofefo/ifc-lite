/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Display controls for the drawing's section overlay. */
import { useCallback } from 'react';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { useSectionFill } from './useSectionFill';
import { HudToggle } from '../../viewport-ui/hud/HudToggle';

export function SectionCapControls(): React.JSX.Element {
  const { t } = useTranslation();
  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  const fill = useSectionFill();
  const setShowOutlines = useViewerStore((s) => s.setSectionShowOutlines);

  const onToggleOutlines = useCallback(() => setShowOutlines(!sectionPlane.showOutlines), [setShowOutlines, sectionPlane.showOutlines]);

  if (!fill.available) {
    return <p data-section-cap-controls className="text-xs text-muted-foreground">{t('sectionCap.requiresDrawingOverlay')}</p>;
  }

  return (
    <div className="space-y-2" data-section-cap-controls>
      {/* Display toggles — surfaces and lines independently. */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{t('sectionCap.display')}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <HudToggle pressed={fill.on} onPressedChange={fill.toggle}
            title={t(sectionPlane.showCap ? 'sectionCap.hideSurfaces' : 'sectionCap.showSurfaces')}>
            {t('sectionCap.surfaces')}
          </HudToggle>
          <HudToggle pressed={sectionPlane.showOutlines} onPressedChange={onToggleOutlines}
            title={t(sectionPlane.showOutlines ? 'sectionCap.hideLines' : 'sectionCap.showLines')}>
            {t('sectionCap.lines')}
          </HudToggle>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('sectionCap.followsDrawing')}</p>
    </div>
  );
}

export default SectionCapControls;
