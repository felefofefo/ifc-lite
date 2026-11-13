/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { packPatPatterns } from '@ifc-lite/renderer';
import { useMemo } from 'react';
import { create } from 'zustand';
import { drawingProjectId } from '@/lib/drawing/drawing-project';
import { useViewerStore } from '@/store';
import type { ImportedPattern } from '@/lib/drawing/pattern-library';

const EMPTY_PATTERNS: ImportedPattern[] = [];
const edits = create<{ entries: Map<string | undefined, ImportedPattern[]> }>(() => ({ entries: new Map() }));
const key = (project: string) => `ifc-lite:drawing-patterns:v1:${project}`;

export function useDrawingPatterns() {
  const project = useViewerStore(drawingProjectId);
  const edited = edits(s => s.entries.get(project));
  const loaded = useMemo<ImportedPattern[]>(() => {
    if (!project) return EMPTY_PATTERNS;
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key(project)) ?? '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }, [project]);
  return {
    patterns: edited ?? loaded,
    save(patterns: ImportedPattern[]) {
      if (project) localStorage.setItem(key(project), JSON.stringify(patterns));
      edits.setState(s => ({ entries: new Map(s.entries).set(project, patterns) }));
    },
  };
}

export function usePatPatterns3D() {
  const { patterns } = useDrawingPatterns();
  return useMemo(() => packPatPatterns(patterns), [patterns]);
}
