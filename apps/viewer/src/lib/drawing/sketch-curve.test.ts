import { it } from 'node:test';
import assert from 'node:assert/strict';
import { sketchCurve, sketchPath, storedPath, curveMeasurements, pathDisplayPoints, curveSvgPath, constrainSketchPoint } from './sketch-input.js';
import { pathMetrics } from './path-geometry.js';
const o={x:0,y:0}, a={x:2,y:0}, b={x:0,y:2}, c={x:-2,y:0};
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
it('circle is stored as two exact semicircles without a measured area',()=>{
 const p=sketchCurve('circle',[o],a)!; assert.equal(p.points.length,2); assert.deepEqual(p.pathBulges,[1,1]); assert.equal(p.area,0); close(p.perimeter,4*Math.PI); close(curveMeasurements(p)!.radius,2);
});
it('three-point arc has correct length and sweep',()=>{ const p=sketchCurve('arc',[a,b],c)!; assert.equal(p.pathClosed,false); close(p.perimeter,2*Math.PI); close(curveMeasurements(p)!.sweep,180); });
it('rejects collinear arc and zero-radius circle',()=>{ assert.equal(sketchCurve('arc',[a,o],c),null); assert.equal(sketchCurve('circle',[o],o),null); });
it('translation preserves exact bulges and radius',()=>{ const p=sketchCurve('circle',[o],a)!; const moved={...p,points:p.points.map(q=>({x:q.x+10,y:q.y-3}))}; close(pathMetrics(storedPath(moved))!.length,p.perimeter); close(curveMeasurements(moved)!.radius,2); });
it('samples are derived and do not mutate authored vertices',()=>{const p=sketchCurve('circle',[o],a)!; assert.ok(pathDisplayPoints(p).length>20); assert.equal(p.points.length,2);});
it('SVG preserves native circular arcs and flips sweep under reflection',()=>{ const p=sketchCurve('circle',[o],a)!; const normal=curveSvgPath(p,q=>q)!; const flipped=curveSvgPath(p,q=>({x:q.x,y:-q.y}))!; assert.equal((normal.match(/ A/g)||[]).length,2); assert.match(normal,/A2 2 0 0 1/); assert.match(flipped,/A2 2 0 0 0/); });
it('malformed bulge arrays are rejected',()=>{assert.equal(sketchPath([a,c],true,[1]),null);assert.equal(sketchPath([a,c],false,[1,1]),null);assert.equal(sketchPath([a,c],true,[NaN,1]),null);});
it('circle radius uses the shared numeric lock',()=>{ const r=constrainSketchPoint('circle',o,{x:1,y:0},null,{first:'2,5',second:''})!; close(Math.hypot(r.point.x,r.point.y),2.5); });
