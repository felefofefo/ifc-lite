/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Drawing panel's inspector column (#5495): Overrides / Sheet / Underlays
 * / Scan as tabs BESIDE the canvas, replacing `DrawingSettingsPanel`,
 * `SheetSetupPanel`, `DxfUnderlayPanel` and `ScanSectionPanel`'s own
 * `w-72 border-l` drawers (and their own close-button headers — the active
 * tab now carries that). One persisted store field decides which tab is
 * open (`useDrawingViewModel`'s `openDrawer`/`toggleDrawer`/`closeDrawer`,
 * backed by `drawingInspectorSlice`); toggling the already-open tab in the
 * toolbar collapses the column.
 *
 * Resizable (drag the left edge) and collapsible; both persist. Below
 * `DRAWING_INSPECTOR_OVERLAY_BELOW` the Drawing panel itself is too narrow
 * for a beside column to leave a usable canvas — a floating Drawing window
 * or the mobile layout — so the inspector overlays the canvas as a sheet
 * instead; that is the one place this component covers the canvas, and only
 * there.
 */

import React, { useCallback, useRef } from 'react';
import { Eye, FileText, Layers, Palette, ScanLine, SwatchBook, Tag } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { DrawingPatterns } from './DrawingPatterns';
import { ViewVisibilitySettings } from './ViewVisibilitySettings';
import { DrawingSettingsPanel } from '../DrawingSettingsPanel';
import { DrawingUnderlaysPanel } from './DrawingUnderlaysPanel';
import { ScanSectionPanel } from '../ScanSectionPanel';
import { SheetSetupPanel } from '../SheetSetupPanel';
import type { DrawingDrawer, DrawingViewModel } from './useDrawingViewModel';
import type { useDrawingLayers } from './useDrawingLayers';

/** Below this the toolbar has already collapsed to icons (its own 'narrow'
 *  tier starts at 640px) and a column at even its MIN_WIDTH (240px) would
 *  leave the canvas too thin to read — a floating Drawing window or the
 *  mobile layout, not the normal docked case. The inspector overlays the
 *  canvas instead of squeezing it (#5495). */
export const DRAWING_INSPECTOR_OVERLAY_BELOW = 720;

const TABS: ReadonlyArray<{ id: DrawingDrawer; icon: typeof Palette; labelKey: TranslationKey }> = [
  { id: 'overrides', icon: Palette, labelKey: 'section2d.drawers.overrides' },
  { id: 'sheet', icon: FileText, labelKey: 'section2d.drawers.sheet' },
  { id: 'underlays', icon: Layers, labelKey: 'section2d.drawers.underlays' },
  { id: 'visibility', icon: Eye, labelKey: 'section2d.drawers.visibility' },
  { id: 'annotations', icon: Tag, labelKey: 'section2d.drawers.annotations' },
  { id: 'patterns', icon: SwatchBook, labelKey: 'section2d.patterns.title' },
  { id: 'scan', icon: ScanLine, labelKey: 'section2d.drawers.scan' },
];

export interface DrawingInspectorProps {
  vm: DrawingViewModel;
  layers: ReturnType<typeof useDrawingLayers>;
  /** The Drawing panel's own measured width; drives the overlay fallback. */
  panelWidth: number;
}

export function DrawingInspector({ vm, layers, panelWidth }: DrawingInspectorProps): React.ReactElement | null {
  const { t } = useTranslation();
  const tab = vm.openDrawer;
  const width = useViewerStore((s) => s.drawingInspectorWidth);
  const setWidth = useViewerStore((s) => s.setDrawingInspectorWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    const move = (ev: PointerEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      // The handle sits on the column's LEFT edge: dragging left (negative dx) widens it.
      setWidth(drag.startWidth - (ev.clientX - drag.startX));
    };
    const up = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [width, setWidth]);

  if (!tab) return null;

  const overlay = panelWidth > 0 && panelWidth < DRAWING_INSPECTOR_OVERLAY_BELOW;

  const body = (
    <Tabs value={tab} onValueChange={(v) => vm.toggleDrawer(v as DrawingDrawer)} className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b p-2">
        <Select value={tab} onValueChange={(value) => vm.toggleDrawer(value as DrawingDrawer)}>
          <SelectTrigger aria-label={t('section2d.inspector.sections')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TABS.map(({ id, icon: Icon, labelKey }) => (
              <SelectItem key={id} value={id}>
                <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 shrink-0" />{t(labelKey)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TabsContent value="overrides" className="m-0 h-full">
          <DrawingSettingsPanel lineweights={vm.lineweights} />
        </TabsContent>
        <TabsContent value="sheet" className="m-0 h-full">
          <SheetSetupPanel onOpenTitleBlockEditor={() => vm.setTitleBlockEditorVisible(true)} />
        </TabsContent>
        <TabsContent value="underlays" className="m-0 h-full">
          <DrawingUnderlaysPanel
            onCenterOnModel={layers.handleCenterDxfUnderlay}
            planViewActive={vm.sectionPlane.axis === 'down' && vm.sectionPlane.custom === undefined}
            sectionPlane={vm.drawing?.config.plane}
            georeferenceAvailable={layers.dxfGeoreferenceAvailable}
          />
        </TabsContent>
        <TabsContent value="visibility" className="m-0 h-full"><ViewVisibilitySettings /></TabsContent>
        <TabsContent value="annotations" className="m-0 h-full"><ViewVisibilitySettings annotations /></TabsContent>
        <TabsContent value="patterns" className="m-0 h-full overflow-auto p-3 text-xs"><DrawingPatterns /></TabsContent>
        <TabsContent value="scan" className="m-0 h-full">
          <ScanSectionPanel
            hasPointCloud={layers.scanSectionLayer.hasPointCloud}
            totalInBand={layers.scanSectionLayer.totalInBand}
            renderedCount={layers.scanSectionLayer.renderedCount}
            outline={layers.scanSectionLayer.outline}
            outlineFailed={layers.scanSectionLayer.outlineFailed}
          />
        </TabsContent>
      </div>
    </Tabs>
  );

  if (overlay) {
    // The narrow fallback: no room beside the canvas, so the inspector takes
    // the whole canvas area as a sheet instead of squeezing it unusable.
    return (
      <div className="panel-container absolute inset-0 z-20 flex flex-col bg-background">
        {body}
      </div>
    );
  }

  return (
    <div
      className="panel-container relative flex shrink-0 border-l bg-background"
      style={{ width }}
      data-drawing-inspector
    >
      <button
        type="button"
        aria-label={t('section2d.inspector.resizeLabel')}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-ew-resize touch-none"
        onPointerDown={handleResizeStart}
      />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}
