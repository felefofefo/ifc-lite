/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useMemo, useRef } from 'react';
import { continueLinearDimension, editLinearDimensionChain, type DimensionChainMode, type DimensionSegment } from '@/lib/drawing/dimension-line';
import { hitDimensionLabel, type DimensionLabelHit } from '@/lib/drawing/dimension-style';
import { dimensionViewKey, measurementsInView } from '@/lib/drawing/dimension-view';
import { useViewerStore } from '@/store';
import type { DrawnSectionPlane, Measure2DResult } from '@/store/slices/drawing2DSlice';

export function useViewDimensions(
  drawnPlane: DrawnSectionPlane, livePlaneId: string, savedViewId: string | undefined,
  savedPlaneId: string | undefined, defaultStyleId: string,
) {
  const dimensionLabelHits = useRef<DimensionLabelHit[]>([]);
  const measurements = useViewerStore(state => state.measure2DResults);
  const selection = useViewerStore(state => state.selectedAnnotation2D);
  const clearAnnotations = useViewerStore(state => state.clearAllAnnotations2D);
  const viewKey = dimensionViewKey(drawnPlane, livePlaneId, savedViewId, savedPlaneId);

  // The canvas, selection tools, and SVG exporter consume the same scoped measurements.
  const measure2DResults = useMemo(() => measurementsInView(measurements, viewKey), [measurements, viewKey]);
  const selectedAnnotation2D = selection?.type === 'measure' &&
    !measure2DResults.some(result => result.id === selection.id) ? null : selection;

  const selectedDimension = selectedAnnotation2D?.type === 'measure'
    ? measure2DResults.find(result => result.id === selectedAnnotation2D.id && result.dimension) : undefined;
  const pickDimensionLabel = useCallback((x: number, y: number) => {
    const hit = [...dimensionLabelHits.current].reverse().find(candidate => hitDimensionLabel(candidate, { x, y }));
    return hit && measure2DResults.some(result => result.id === hit.id) ? hit.id : undefined;
  }, [measure2DResults]);
  const assignType = (styleId: string) => {
    const chainId = selectedDimension?.dimension?.chainId;
    if (!chainId) return;
    useViewerStore.setState(state => ({ measure2DResults: state.measure2DResults.map(result =>
      result.dimension?.chainId === chainId && result.dimension.viewKey === viewKey
        ? { ...result, dimension: { ...result.dimension, styleId } } : result) }));
  };
  const updateLabel = (patch: Pick<NonNullable<Measure2DResult['dimension']>, 'textAngle' | 'textOffset'>) => {
    if (!selectedDimension) return;
    useViewerStore.setState(state => ({ measure2DResults: state.measure2DResults.map(result =>
      result.id === selectedDimension.id && result.dimension && result.dimension.viewKey === viewKey
        ? { ...result, dimension: { ...result.dimension, ...patch } } : result) }));
  };
  const textOffset = selectedDimension?.dimension?.textOffset;
  const hasLabelOffset = !!textOffset && Math.hypot(textOffset.x, textOffset.y) > 1e-8;
  const resetLabelPosition = () => {
    if (hasLabelOffset) updateLabel({ textOffset: undefined });
  };
  const clearAllAnnotations2D = useCallback(() => clearAnnotations(viewKey), [clearAnnotations, viewKey]);
  const placeDimension = useCallback((segments: DimensionSegment[]) => {
    if (!viewKey) return;
    const chainId = globalThis.crypto?.randomUUID?.() ?? `dimension-${Date.now()}-${Math.random()}`;
    const results = segments.map(({ anchors, shape, ...segment }, index) => ({
      ...segment, id: `${chainId}-${index}`, dimension: { anchors, shape, chainId, viewKey, styleId: defaultStyleId },
    }));
    useViewerStore.setState(state => ({ measure2DResults: [...state.measure2DResults, ...results] }));
    useViewerStore.getState().setAnnotation2DActiveTool('none');
  }, [viewKey, defaultStyleId]);

  const continueChain = (chainId: string, point: { x: number; y: number }) => {
    if (!viewKey) return false;
    let appended = false;
    useViewerStore.setState(state => {
      const chain = state.measure2DResults.filter(item => item.dimension?.chainId === chainId
        && item.dimension.viewKey === viewKey);
      const data = chain[0]?.dimension;
      const segment = continueLinearDimension(chain, point);
      if (!data || !segment) return state;
      const id = globalThis.crypto?.randomUUID?.() ?? `dimension-${Date.now()}-${Math.random()}`;
      const { anchors, ...geometry } = segment;
      const result: Measure2DResult = { ...geometry, id, drawOrder: chain[0]?.drawOrder,
        dimension: { anchors, chainId, viewKey, styleId: data.styleId } };
      appended = true;
      return { measure2DResults: [...state.measure2DResults, result] };
    });
    return appended;
  };
  const editChain = (chainId: string, point: { x: number; y: number },
    mode: Exclude<DimensionChainMode, 'continue'>, tolerance: number) => {
    if (!viewKey) return false;
    let edited = false;
    useViewerStore.setState(state => {
      const chain = state.measure2DResults.filter(item => item.dimension?.chainId === chainId
        && item.dimension.viewKey === viewKey);
      const plan = editLinearDimensionChain(chain, point, mode, tolerance);
      if (!plan) return state;
      const removed = new Set(plan.removedIds);
      const original = chain.find(item => removed.has(item.id));
      const data = original?.dimension;
      if (!data) return state;
      const replacements: Measure2DResult[] = plan.segments.map(({ anchors, ...geometry }) => ({
        ...geometry, id: globalThis.crypto?.randomUUID?.() ?? `dimension-${Date.now()}-${Math.random()}`,
        drawOrder: original?.drawOrder,
        dimension: { anchors, chainId, viewKey, styleId: data.styleId },
      }));
      const next: Measure2DResult[] = [];
      let inserted = false;
      for (const item of state.measure2DResults) {
        if (item.dimension?.chainId === chainId && item.dimension.viewKey === viewKey && removed.has(item.id)) {
          if (!inserted) { next.push(...replacements); inserted = true; }
        } else next.push(item);
      }
      if (!inserted) return state;
      edited = true;
      return { measure2DResults: next };
    });
    return edited;
  };
  return { viewKey, measure2DResults, selectedAnnotation2D, clearAllAnnotations2D, continueChain, editChain,
    placeDimension, dimensionLabelHits, pickDimensionLabel,
    selectedDimension, assignType, updateLabel, hasLabelOffset, resetLabelPosition };
}
