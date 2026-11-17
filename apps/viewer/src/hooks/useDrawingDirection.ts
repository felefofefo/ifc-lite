/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { snapDrawingAngle } from '@/lib/drawing/dimension-line';

export type AngularSnap = 'off' | '15' | '90';

export function useDrawingDirection(phase: object | string | null, angularSnap: AngularSnap) {
  const currentAngle = useRef<number | null>(null);
  const lockedAngle = useRef<number | null>(null);

  useEffect(() => {
    currentAngle.current = null;
    lockedAngle.current = null;
    if (!phase) return;

    function keydown(event: KeyboardEvent) {
      if (event.key === 'Shift' && !event.repeat && lockedAngle.current === null) {
        lockedAngle.current = currentAngle.current;
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === 'Shift' && !event.shiftKey) lockedAngle.current = null;
    }
    function blur() {
      currentAngle.current = null;
      lockedAngle.current = null;
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, [phase]);

  function resolve(
    anchor: Point2D | null, point: Point2D, reference: Point2D | null, shift: boolean, baseAngle = 0,
  ): Point2D | null {
    if (!shift) lockedAngle.current = null;
    if (!anchor) return reference;

    const origin = anchor;
    const angle = lockedAngle.current ?? (shift ? currentAngle.current : null);
    if (shift) lockedAngle.current = angle;
    const increment = angularSnap === 'off' ? 0 : Number(angularSnap);
    function constrain(candidate: Point2D): Point2D {
      if (angle !== null) {
        const x = Math.cos(angle), y = Math.sin(angle);
        const distance = Math.max(0, (candidate.x - origin.x) * x + (candidate.y - origin.y) * y);
        return { x: origin.x + x * distance, y: origin.y + y * distance };
      }
      return increment ? snapDrawingAngle(origin, candidate, increment === 90 ? 0 : baseAngle, increment) : candidate;
    }

    const constrainedReference = reference && constrain(reference);
    const useReference = reference && constrainedReference && Math.hypot(
      constrainedReference.x - reference.x, constrainedReference.y - reference.y,
    ) <= 1e-8;
    const resolved = useReference ? reference : increment || angle !== null ? constrain(point) : null;
    const preview = resolved ?? point;
    if (Math.hypot(preview.x - anchor.x, preview.y - anchor.y) > 1e-8) {
      currentAngle.current = Math.atan2(preview.y - anchor.y, preview.x - anchor.x);
      if (shift && angle === null) lockedAngle.current = currentAngle.current;
    }
    return resolved;
  }

  function getLockedAxis(): Point2D | undefined {
    const angle = lockedAngle.current;
    return angle === null ? undefined : { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function resetDirection(angle: number | null = null) {
    currentAngle.current = angle;
    lockedAngle.current = null;
  }

  return { resolve, getLockedAxis, resetDirection };
}
