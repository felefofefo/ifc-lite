/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React from 'react';
import { FileText, Layers, Palette, ScanLine, Settings2, SwatchBook, Tag, ChevronRight, PanelRightOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { DrawingMaterials } from './DrawingMaterials';
import { DrawingLineweights } from './DrawingLineweights';
import { ViewScaleSelect } from './ViewIdentityFields';
import { useViewTemplates } from '@/hooks/useDrawingTemplateRules';
import { DrawingViewOptions, DrawingViewTemplates } from './DrawingViewTemplates';
import { DrawingPatterns } from './DrawingPatterns';
import { DrawingProjectionSettings } from './DrawingProjectionSettings';
import { DrawingSettingSwitch } from './DrawingSettingSwitch';
import { constructionProjectionEnabled, overheadProjectionEnabled } from '@/lib/drawing/construction-projection';
import { supportsDrawingProjection } from '@/lib/drawing/view-placement';
import { setDrawingProjectionDisplay, setDrawingPublicationScale, setViewSurfacePatterns, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { DrawingMarkerStyles } from './DrawingMarkerStyles';
import { DrawingAnnotationStyles } from './DrawingAnnotationStyles';
import { DrawingDimensionStyles } from './DrawingDimensionStyles';
import { ViewVisibilitySettings } from './ViewVisibilitySettings';
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
  { id: 'display', icon: Settings2, labelKey: 'section2d.inspector.viewSettings' },
  { id: 'sheet', icon: FileText, labelKey: 'section2d.drawers.sheet' },
  { id: 'underlays', icon: Layers, labelKey: 'section2d.drawers.underlays' },
  { id: 'annotations', icon: Tag, labelKey: 'section2d.drawers.annotations' },
  { id: 'patterns', icon: SwatchBook, labelKey: 'section2d.inspector.graphicStandards' },
  { id: 'scan', icon: ScanLine, labelKey: 'section2d.drawers.scan' },
];

export interface DrawingInspectorProps {
  vm: DrawingViewModel;
  layers: ReturnType<typeof useDrawingLayers>;
  /** The Drawing panel's own measured width; drives the overlay fallback. */
  panelWidth: number;
  view3D?: boolean;
}

export function DrawingInspector({ vm, layers, panelWidth, view3D }: DrawingInspectorProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { templates } = useViewTemplates();
  const editing = useSavedSectionCuts(s => !!s.templateEdit);
  const locked = !editing && templates.some(template => template.id === vm.savedView?.graphics?.presetId);
  const width = useViewerStore((s) => s.drawingInspectorWidth);
  const setWidth = useViewerStore((s) => s.setDrawingInspectorWidth);
  function handleResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const move = (pointer: PointerEvent) => setWidth(width - (pointer.clientX - start));
    button.addEventListener('pointermove', move);
    button.addEventListener('lostpointercapture', () => button.removeEventListener('pointermove', move), { once: true });
  }

  const { sectionPlane, displayOptions } = vm;
  const symbolicAvailable = sectionPlane.axis === 'down' && !sectionPlane.custom;
  const projectionAvailable = supportsDrawingProjection(sectionPlane);
  const showProjection = constructionProjectionEnabled(displayOptions.showConstructionProjection, sectionPlane);
  const showSurfacePatterns = displayOptions.showSurfacePatterns3D ?? false;
  const tabs = TABS.filter(({ id }) => !view3D || id === 'display' || id === 'patterns');
  const tab = tabs.find(({ id }) => id === vm.openDrawer)?.id ?? 'display';
  const overlay = panelWidth > 0 && panelWidth < DRAWING_INSPECTOR_OVERLAY_BELOW;

  const body = (
    <Tabs value={tab} onValueChange={(v) => vm.toggleDrawer(v as DrawingDrawer)} className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <Select value={tab} onValueChange={(value) => vm.toggleDrawer(value as DrawingDrawer)}>
          <SelectTrigger aria-label={t('section2d.inspector.sections')} className="h-8 w-full [&>svg]:text-foreground [&>svg]:opacity-100 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {tabs.map(({ id, icon: Icon, labelKey }) => (
              <SelectItem key={id} value={id}>
                <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 shrink-0" />{t(labelKey)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {overlay && <Button type="button" variant="ghost" size="icon-xs" onClick={vm.closeDrawer}
          aria-label={t('section2d.inspector.close')}><X className="size-4" /></Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TabsContent value="display" className="m-0 h-full overflow-auto">
          <div className="border-b px-3 py-2"><DrawingViewTemplates /></div>
          <ViewSettingsSection label={t('section2d.projection.settings')} defaultOpen>
            <fieldset disabled={locked} className="space-y-1 px-3 pb-3">
              <ViewScaleSelect value={vm.publicationScale} table={vm.lineweightSettings.table} onChange={setDrawingPublicationScale} />
              {view3D ? (
                <DrawingSettingSwitch label={t('section2d.patterns.surface3d')}
                  checked={showSurfacePatterns} onCheckedChange={setViewSurfacePatterns} />
              ) : <>
                {symbolicAvailable && (
                  <DrawingSettingSwitch label={t('section2d.display.symbolic')} title={t('section2d.symbolic.planOverlay')}
                    checked={displayOptions.useSymbolicRepresentations} onCheckedChange={useSymbolicRepresentations => setDrawingProjectionDisplay({ useSymbolicRepresentations })} />
                )}
                {projectionAvailable && (
                  <DrawingSettingSwitch label={t('section2d.display.projection')}
                    checked={showProjection} onCheckedChange={vm.toggleConstructionProjection} />
                )}
                {symbolicAvailable && (
                  <DrawingSettingSwitch label={t('section2d.display.overheadProjection')}
                    checked={overheadProjectionEnabled(displayOptions.showOverheadProjection, displayOptions.showConstructionProjection, sectionPlane)}
                    onCheckedChange={vm.toggleOverheadProjection} />
                )}
                <DrawingSettingSwitch label={t('section2d.display.overlay3d')} title={t('section2d.overlay.toggleTitle')}
                  checked={displayOptions.show3DOverlay} onCheckedChange={show3DOverlay => setDrawingProjectionDisplay({ show3DOverlay })} />
              </>}
              {(view3D || projectionAvailable) && <div className="border-t pt-2"><DrawingProjectionSettings hiddenLinesOnly={view3D} /></div>}
            </fieldset>
          </ViewSettingsSection>
          <ViewSettingsSection label={t('section2d.inspector.filters')}>
            <fieldset disabled={locked}><ViewVisibilitySettings /></fieldset>
          </ViewSettingsSection>
          <DrawingViewOptions vm={vm} locked={locked} />
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
        <TabsContent value="annotations" className="m-0 h-full overflow-auto">
          <DrawingDimensionStyles settings={vm.dimensionSettings} unitOverrides={vm.unitDisplayOverrides} lineweights={vm.lineweights}
            selection={vm.dimensionEditing.selectedDimension ? {
              typeId: vm.dimensionEditing.selectedDimension.dimension?.styleId, assign: vm.dimensionEditing.assignType,
            } : undefined}
            labelEdit={vm.selectedAnnotation2D?.dimensionLabel && vm.dimensionEditing.selectedDimension ? {
              id: vm.dimensionEditing.selectedDimension.id,
              angle: vm.dimensionEditing.selectedDimension.dimension?.textAngle ?? 0,
              hasOffset: Boolean(vm.dimensionEditing.selectedDimension.dimension?.textOffset),
              rotate: angle => vm.dimensionEditing.updateLabel({ textAngle: angle }),
              resetPosition: () => vm.dimensionEditing.updateLabel({ textOffset: undefined }),
            } : undefined} />
          {!view3D && <><DrawingMarkerStyles kind="section" lineweights={vm.lineweights} /><DrawingMarkerStyles kind="elevation" lineweights={vm.lineweights} /><DrawingAnnotationStyles /></>}
        </TabsContent>
        <TabsContent value="patterns" className="m-0 h-full overflow-auto text-xs">
          <DrawingMaterials settings={vm.materialSettings} sidebar />
          <DrawingLineweights key={vm.lineweightSettings.projectId ?? 'session'} scale={vm.publicationScale}
            settings={vm.lineweightSettings} sidebar onScaleChange={scale => { if (!locked) setDrawingPublicationScale(scale); }} />
          <ViewSettingsSection label={t('section2d.patterns.title')}>
            <div className="px-3 pb-3 pt-1"><DrawingPatterns /></div>
          </ViewSettingsSection>
        </TabsContent>
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

  if (overlay && !vm.openDrawer) return (
    <Button type="button" size="icon-xs" variant="outline" className="absolute right-2 top-2 z-20"
      onClick={() => vm.toggleDrawer('display')} aria-label={t('section2d.inspector.viewSettings')}
      title={t('section2d.inspector.viewSettings')}><PanelRightOpen className="size-4" /></Button>
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
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-ew-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20"
        onPointerDown={handleResizeStart}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setWidth(width + (event.key === 'ArrowLeft' ? 16 : -16));
        }}
      />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}


function ViewSettingsSection({ label, defaultOpen, children }: {
  label: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return <Collapsible defaultOpen={defaultOpen} className="border-b">
    <CollapsibleTrigger asChild>
      <Button type="button" variant="ghost" size="sm"
        className="group w-full justify-between rounded-none px-3 text-xs font-medium">
        {label}<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-foreground group-data-[state=open]:rotate-90" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>{children}</CollapsibleContent>
  </Collapsible>;
}
