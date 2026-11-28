/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcFromBulge, circlePath, isSimpleBoundary, pathEdges, pathFromPolygon,
  pathMetrics, pointOnEdge, rectanglePath, samplePath, threePointArcPath, translatePath,
  type DrawingPath, type PathPoint,
} from './path-geometry.js';

const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const nearPoint = (a: PathPoint, b: PathPoint, tolerance = 1e-8) => { near(a.x, b.x, tolerance); near(a.y, b.y, tolerance); };
const p = (x: number, y: number) => ({ x, y });
const unit = (a: number) => p(Math.cos(a), Math.sin(a));
const metrics = (path: DrawingPath) => { const result = pathMetrics(path); assert.ok(result); return result; };

describe('drawing path geometry', () => {
  it('adapts legacy polygons without retaining mutable point references', () => {
    const source = [p(0,0), p(5,0), p(5,3), p(0,3)];
    const path = pathFromPolygon(source);
    assert.equal(path.closed, true); assert.notEqual(path.vertices[0], source[0]);
    const m = metrics(path); near(m.area, 15); near(m.length, 16); nearPoint(m.centroid!, p(2.5,1.5));
    assert.ok(isSimpleBoundary(path));
  });
  it('keeps winding signed while area and centroid stay invariant', () => {
    const a = pathFromPolygon([p(0,0),p(4,0),p(0,3)]);
    const b = pathFromPolygon([...a.vertices].reverse());
    const ma = metrics(a), mb = metrics(b);
    near(ma.signedArea, -mb.signedArea); near(ma.area, mb.area); nearPoint(ma.centroid!,mb.centroid!);
  });
  it('measures open paths without inventing closing edges or area', () => {
    const path = { closed: false, vertices: [p(0,0),p(3,0),p(3,4)] };
    assert.deepEqual(metrics(path), { length: 7, area: 0, signedArea: 0, centroid: null });
    assert.equal(isSimpleBoundary(path), false);
  });
  it('represents a circle with two exact semicircles', () => {
    const path = circlePath(p(3,-2),2)!;
    assert.equal(path.vertices.length,2);
    const m = metrics(path); near(m.area,4*Math.PI); near(m.length,4*Math.PI);
    nearPoint(m.centroid!,p(3,-2)); assert.ok(isSimpleBoundary(path));
  });
  it('measures a semicircle and the exact circular segment centroid', () => {
    const path = { closed: true, vertices: [{...p(0,0),bulge:1},p(2,0)] };
    const m = metrics(path); near(m.area,Math.PI/2); near(m.length,Math.PI+2);
    nearPoint(m.centroid!,p(1,-4/(3*Math.PI))); assert.ok(isSimpleBoundary(path));
  });
  it('measures a quarter-circle sector with exact area and centroid', () => {
    const path = { closed: true, vertices: [p(0,0),{...p(1,0),bulge:Math.tan(Math.PI/8)},p(0,1)] };
    const m = metrics(path); near(m.area,Math.PI/4); near(m.length,2+Math.PI/2);
    nearPoint(m.centroid!,p(4/(3*Math.PI),4/(3*Math.PI))); assert.ok(isSimpleBoundary(path));
  });
  it('supports negative bulges and major arcs', () => {
    const a = unit(0), b = unit(-Math.PI/2);
    const arc = arcFromBulge(a,b,Math.tan(3*Math.PI/8))!;
    nearPoint(arc.center,p(0,0)); near(arc.radius,1); near(arc.sweep,3*Math.PI/2);
    const rev = arcFromBulge(b,a,-Math.tan(3*Math.PI/8))!;
    nearPoint(rev.center,p(0,0)); near(rev.sweep,-arc.sweep);
  });
  it('reconstructs minor and major arcs through a picked third point in either direction', () => {
    for (const sweep of [0.2, Math.PI/2, Math.PI, 3*Math.PI/2, -0.2, -Math.PI, -3*Math.PI/2]) {
      const a = unit(0.7), b = unit(0.7 + sweep*0.3), c = unit(0.7+sweep);
      const path = threePointArcPath(a,b,c)!;
      const edge = pathEdges(path)![0];
      near(edge.arc!.sweep,sweep); nearPoint(edge.arc!.center,p(0,0)); nearPoint(pointOnEdge(edge,0.3),b);
    }
  });
  it('does not create degenerate three-point arcs or rectangles', () => {
    assert.equal(threePointArcPath(p(0,0),p(1,0),p(2,0)),null);
    assert.equal(threePointArcPath(p(0,0),p(0,0),p(2,0)),null);
    assert.equal(rectanglePath(p(0,0),p(0,2)),null);
    assert.equal(circlePath(p(0,0),0),null);
  });
  it('maintains exact metrics when translated far from the origin', () => {
    const original = circlePath(p(0,0),2)!;
    const moved = translatePath(original,p(1e8,-1e8))!;
    near(metrics(moved).area,metrics(original).area);
    nearPoint(metrics(moved).centroid!,p(1e8,-1e8));
    assert.deepEqual(original.vertices,[{x:2,y:0,bulge:1},{x:-2,y:0,bulge:1}]);
  });
  it('has a stable small-arc area and centroid', () => {
    const path = {closed:true,vertices:[{...p(0,0),bulge:1e-5},p(2,0)]};
    const m = metrics(path);
    near(m.area, 4e-5/3,1e-12); near(m.centroid!.x,1); near(m.centroid!.y,-4e-6,1e-10);
  });
  it('tessellates within the given chord error and does not change exact geometry', () => {
    const path = circlePath(p(0,0),2)!;
    for (const tolerance of [0.1,0.01,0.001]) {
      const points = samplePath(path,tolerance)!;
      assert.notDeepEqual(points[0],points[points.length-1]);
      for (let i=0;i<points.length;i++) {
        const a=points[i],b=points[(i+1)%points.length];
        const error=2-Math.hypot((a.x+b.x)/2,(a.y+b.y)/2);
        assert.ok(error<=tolerance+1e-10);
      }
      near(metrics(path).area,4*Math.PI);
    }
    assert.equal(samplePath(path,1e-20),null); assert.equal(samplePath(path,0),null);
  });
  it('samples open paths including their actual endpoints', () => {
    const path = threePointArcPath(p(1,0),p(0,1),p(-1,0))!;
    const points = samplePath(path,0.01)!;
    assert.deepEqual(points[0],p(1,0)); assert.deepEqual(points.at(-1),p(-1,0));
  });
  it('rejects invalid numbers, invalid closing bulges and collapsed edges', () => {
    for (const path of [
      {closed:false,vertices:[p(0,0),p(Infinity,0)]},
      {closed:false,vertices:[{...p(0,0),bulge:NaN},p(1,0)]},
      {closed:false,vertices:[p(0,0),{...p(1,0),bulge:1}]},
      {closed:true,vertices:[p(0,0),p(0,0),p(1,0)]},
    ]) assert.equal(pathEdges(path),null);
  });
  it('accepts a concave straight boundary', () => {
    const path = pathFromPolygon([p(0,0),p(3,0),p(3,1),p(1,1),p(1,2),p(0,2)]);
    assert.ok(isSimpleBoundary(path)); near(metrics(path).area,4);
  });
  it('rejects crossing straight boundaries with nonzero area', () => {
    const path = pathFromPolygon([p(0,0),p(-1,2),p(4,4),p(0,4)]);
    assert.ok(metrics(path).area>0); assert.equal(isSimpleBoundary(path),false);
  });
  it('rejects nonadjacent touching vertices and adjacent backtracking', () => {
    assert.equal(isSimpleBoundary(pathFromPolygon([p(0,0),p(4,0),p(4,4),p(2,0),p(0,4)])),false);
    assert.equal(isSimpleBoundary(pathFromPolygon([p(0,0),p(4,0),p(2,0),p(2,2),p(0,2)])),false);
  });
  it('detects an arc crossed by a nonadjacent segment', () => {
    const path={closed:true,vertices:[{...p(0,0),bulge:1},p(4,0),p(4,-3),p(2,-1),p(0,-3)]};
    assert.equal(isSimpleBoundary(path),false);
  });
  it('detects tangent contact with a nonadjacent arc', () => {
    const path={closed:true,vertices:[{...p(0,0),bulge:1},p(4,0),p(4,-2),p(0,-2)]};
    assert.equal(isSimpleBoundary(path),false);
  });
  it('rejects coincident arcs which overlap their own interiors', () => {
    const path={closed:true,vertices:[{...p(0,0),bulge:1},{...p(2,0),bulge:-1}]};
    assert.equal(isSimpleBoundary(path),false);
  });
  it('accepts rounded boundaries with adjacent tangent line and arc', () => {
    const path={closed:true,vertices:[p(0,0),p(3,0),p(3,2),{...p(1,2),bulge:Math.tan(Math.PI/8)},p(0,1)]};
    assert.ok(isSimpleBoundary(path)); near(metrics(path).area,5+Math.PI/4);
  });
});
