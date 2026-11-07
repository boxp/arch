// 層単独描画: 指定meshだけ描く(他は描画skip)。rest と指定パラメータで撮る。
import { open } from './lib.mjs';
const [,, model, tag, only, params] = process.argv;
const { b, p } = await open(model);
await p.evaluate(({ only, params }) => { const pr = window.__rigPreview.player; pr.stop(); pr.play(null); pr.expression(null); pr.lookAt(0,0); pr.behaviors(0);
  for (const r of pr.parameterRanges()) pr.setParameter(r.id, r.default); for (const [k, v] of Object.entries(JSON.parse(params || '{}'))) pr.setParameter(k, v);
  pr.resetSimulation(); for (let i = 0; i < 400; i++) pr.update(1/60);
  if (only) { const keep = new Set(only.split(',').map(id => pr.meshIds.indexOf(id))); const o = pr.drawMesh.bind(pr); pr.drawMesh = (m, ...a) => { const idx = typeof m === 'number' ? m : pr.meshes.indexOf(m); if (keep.has(idx)) o(m, ...a) } }
  pr.draw(); window.__ov.getContext('2d').clearRect(0,0,1e4,1e4) }, { only, params });
await p.screenshot({ path: `L-${tag}.png`, clip: { x: 0, y: 0, width: 760, height: 726 } }); await b.close(); console.log('ok');
