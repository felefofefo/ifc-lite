/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useLayoutEffect, useRef, useState } from 'react';
import { strToU8, zip, type Zippable } from 'fflate';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { applySavedSectionCut, savedViewKind, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { getDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import { uniqueArtifactBase } from '@/lib/export/artifact-naming';
import { toast } from '@/components/ui/toast';

type DxfBuilder = () => { dxf: string } | undefined;
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

let batchRunning = false;

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 120_000;
  do {
    const result = read();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('Timed out while updating the saved drawing.');
}

export function useSavedViewBatch(sourceDrawing: Drawing2D | null, buildDXF: DxfBuilder) {
  const { t } = useTranslation();
  const available = useSavedSectionCuts(s => s.cuts.some(cut => savedViewKind(cut) !== '3d'));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string }>();
  const committed = useRef<{ sourceDrawing: Drawing2D | null; buildDXF: DxfBuilder } | undefined>(undefined);
  useLayoutEffect(() => {
    committed.current = { sourceDrawing, buildDXF };
    return () => { committed.current = undefined; };
  }, [sourceDrawing, buildDXF]);

  async function run(exportDxf: boolean) {
    const project = useSavedSectionCuts.getState();
    const views = project.cuts.filter(cut => savedViewKind(cut) !== '3d');
    if (batchRunning || !views.length) return;
    batchRunning = true;
    setBusy(true);
    let count = 0;
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    const folder = `Views-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archive: Zippable = {};
    const usedPaths = new Set<string>();
    const folders = new Map<string, FileSystemDirectoryHandle>();
    const checkProject = () => {
      if (!committed.current || useSavedSectionCuts.getState().projectId !== project.projectId) {
        throw new Error('The drawing project changed during the batch.');
      }
    };

    try {
      const location = exportDxf && picker ? await picker.call(window, { mode: 'readwrite' }) : undefined;
      checkProject();
      const output = location ? await location.getDirectoryHandle(folder, { create: true }) : undefined;
      const state = useViewerStore.getState();
      const original = {
        sectionPlane: state.sectionPlane, inactiveSectionPlanes: state.inactiveSectionPlanes,
        sectionUndo: state.sectionUndo, sectionPickMode: state.sectionPickMode,
        sectionPickPreview: state.sectionPickPreview, sectionPickTarget: state.sectionPickTarget,
        sectionZoom: state.sectionZoom, activeTool: state.activeTool, sceneState: state.sceneState,
        hiddenEntities: state.hiddenEntities, isolatedEntities: state.isolatedEntities,
        classFilter: state.classFilter, ghostExceptEntities: state.ghostExceptEntities, typeVisibility: state.typeVisibility,
        activePresetId: state.activePresetId, overridesEnabled: state.overridesEnabled, customOverrideRules: state.customOverrideRules,
        drawing2DDisplayOptions: state.drawing2DDisplayOptions, activeSheet: state.activeSheet,
        drawing2D: state.drawing2D, drawing2DPlane: state.drawing2DPlane, drawing2DStatus: state.drawing2DStatus,
        drawing2DError: state.drawing2DError, drawing2DProgress: state.drawing2DProgress, drawing2DPhase: state.drawing2DPhase,
      };
      try {
        for (const view of views) {
          checkProject();
          setProgress({ current: count + 1, total: views.length, name: view.name });
          // Older views can omit graphics or display settings; inherit from
          // the user's starting view instead of leaking the previous batch item.
          useViewerStore.setState({
            hiddenEntities: original.hiddenEntities, isolatedEntities: original.isolatedEntities,
            classFilter: original.classFilter, ghostExceptEntities: original.ghostExceptEntities, typeVisibility: original.typeVisibility,
            activePresetId: original.activePresetId, overridesEnabled: original.overridesEnabled, customOverrideRules: original.customOverrideRules,
            drawing2DDisplayOptions: original.drawing2DDisplayOptions, activeSheet: original.activeSheet,
          });
          applySavedSectionCut(view.id, false);
          const before = useViewerStore.getState().drawing2D;
          const section = useViewerStore.getState().sectionPlane;
          const runtime = await waitFor(() => {
            checkProject();
            if (useSavedSectionCuts.getState().activeCutId !== view.id || useViewerStore.getState().sectionPlane !== section) {
              throw new Error('The active view changed during the batch.');
            }
            const current = getDrawingRuntime();
            if (current.viewId !== view.id || current.viewPlane !== section || current.viewRulesPending) return;
            if (current.viewFilterFailed) throw new Error('Could not evaluate the saved view filter.');
            return current;
          });
          await runtime.generateDrawing();
          const drawing = await waitFor(() => {
            checkProject();
            const live = useViewerStore.getState();
            if (useSavedSectionCuts.getState().activeCutId !== view.id || live.sectionPlane !== section) {
              throw new Error('The active view changed during the batch.');
            }
            if (live.drawing2DStatus === 'error' || live.drawing2DStatus === 'idle') {
              throw new Error(live.drawing2DError ?? 'The saved view produced no drawing.');
            }
            return live.drawing2DStatus === 'ready' && live.drawing2D && live.drawing2D !== before
              && committed.current?.sourceDrawing === live.drawing2D ? committed.current : undefined;
          });
          if (exportDxf) {
            const dxf = drawing.buildDXF()?.dxf;
            if (!dxf) throw new Error('Could not build DXF for the saved view.');
            const kind = savedViewKind(view);
            const group = sanitizeFilename(t(`section2d.views.group.${kind}`), { fallback: kind });
            const stem = sanitizeFilename(`${view.code ? view.code + ' - ' : ''}${view.name}`, { fallback: kind });
            const safeStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;
            const path = `${group}/${safeStem}`;
            const base = uniqueArtifactBase(path.toLowerCase(), 'dxf', usedPaths);
            const name = `${safeStem}${base.slice(path.length)}.dxf`;
            if (output) {
              const directory = folders.get(group) ?? await output.getDirectoryHandle(group, { create: true });
              folders.set(group, directory);
              const file = await directory.getFileHandle(name, { create: true });
              const writer = await file.createWritable();
              try {
                await writer.write(dxf);
                await writer.close();
              } catch (error) {
                await writer.abort().catch(() => {});
                throw error;
              }
            } else {
              archive[`${folder}/${group}/${name}`] = strToU8(dxf);
            }
          }
          count++;
        }
      } finally {
        if (useSavedSectionCuts.getState().projectId === project.projectId) {
          useSavedSectionCuts.setState({ activeCutId: project.activeCutId });
          useViewerStore.setState(original);
        }
      }
      if (exportDxf && !output) {
        const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(archive, (error, data) => error ? reject(error) : resolve(data)));
        downloadFile(bytes, `${folder}.zip`, 'application/zip');
      }
      toast.success(t(exportDxf ? output ? 'section2d.export.batchExported' : 'section2d.export.batchZip' : 'section2d.export.batchRefreshed',
        { count, folder }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && count === 0) return;
      console.warn('Saved drawing batch failed', error);
      const exported = picker ? count : 0;
      toast.error(exportDxf ? t('section2d.export.batchFailed', { count: exported }) : t('section2d.export.batchRefreshFailed', { count }));
    } finally {
      batchRunning = false;
      setBusy(false);
      setProgress(undefined);
    }
  }

  return { available, busy, progress, run };
}
