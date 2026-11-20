'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../核心/engine.js'),G=require('../刀具/tool-model.js'),basic=require('../实验/基础圆柱.js'),top=require('../../陀螺/workpiece.js');
const topCode=fs.readFileSync(path.join(__dirname,'../../陀螺/程序/陀螺_完整程序.txt'),'utf8');
let topPlan;
const compile=(s,experiment,extra={})=>E.compile(s,{...experiment.stock,...extra,experiment});
test('only one shared engine/tool library and no platform implementation in top experiment',()=>{
  const main=path.resolve(__dirname,'..'),topDir=path.resolve(__dirname,'../../陀螺');
  const js=[];function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else if(p.endsWith('.js'))js.push(path.relative(topDir,p));}}walk(topDir);
  assert.deepEqual(js,['workpiece.js']);assert.ok(fs.existsSync(path.join(main,'核心/engine.js')));assert.ok(fs.existsSync(path.join(main,'刀具/tool-model.js')));
});
test('shared kernel and tool geometry contain no top-specific rules',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../核心/engine.js'),'utf8')+fs.readFileSync(path.join(__dirname,'../刀具/tool-model.js'),'utf8');
  assert.ok(!code.includes('陀螺'));assert.ok(!code.includes('function targetRadius'));assert.ok(!code.includes('Z<-16'));assert.ok(!code.includes('12.649110'));
});
for(const [name,source]of Object.entries(basic.generate().examples))test('basic example '+name,()=>{
  const p=compile(source,basic);assert.equal(p.ok,name!=='unsafe',JSON.stringify(p.errors));if(name==='unsafe')assert.equal(p.errors[0].code,'G00碰料');
});
test('full top experiment uses a flat left-reference T2 and passes sweep checks',()=>{
  topPlan=compile(topCode,top);assert.equal(topPlan.ok,true,JSON.stringify(topPlan.errors));assert.ok(topPlan.moves.length>90);assert.equal(topPlan.config.t2Nose,0);assert.equal(topPlan.config.t2Reference,2);
});
test('the same shared engine applies area restrictions only for the selected experiment',()=>{
  const s='G18 G90 G710 DIAMON\nG97\nG95\nT1 D1\nS550 M3\nG00 X36 Z-20\nG01 X30 Z-22 F.3\nG00 X46\nG00 Z10\nM5\nM30';
  assert.equal(compile(s,basic).ok,true);const p=compile(s,top);assert.equal(p.ok,false);assert.equal(p.errors[0].code,'刀具区域限制');
});
test('target material belongs to the workpiece and tool library performs generic sweeps',()=>{
  const c=E.configuration({...top.stock,experiment:top}),s=E.stock(c),m=G.model(2,c),p={z:-20,r:0};
  assert.ok(G.cut(s,p,m,c,{tool:2,start:p,end:p},null).overcut);
  const cb=E.configuration({...basic.stock,experiment:basic});assert.equal(G.cut(E.stock(cb),p,G.model(2,cb),cb,{tool:2,start:p,end:p},null).overcut,null);
});
test('R13 nominal endpoints retain diameter25.3 and a 76.661556-degree arc',()=>{
  const a=E.arc({z:0,r:0},{z:-10,r:12.65},13,true);assert.ok(Math.abs(Math.abs(a.sweep)*180/Math.PI-76.6615560424)<1e-7);assert.equal(top.targetRadius(-25),4);
});
test('shared T3 is 4mm wide and fixed at350rpm by default',()=>{
  const m=G.model(3,E.defaults);assert.equal(m.insert.length,5);assert.equal(m.width,4);assert.equal(E.toolConfig(3,E.defaults).minS,350);assert.equal(E.toolConfig(3,E.defaults).maxS,350);
});
test('T2 plunges directly to depth;0.2 is finishing allowance, not rough stroke limit',()=>{
  const source='G18 G90 G710 DIAMON\nG97\nG95\nT2 D1\nS400 M3\nG00 X32 Z-25\nG01 X8.2 F.08\nG00 X46\nG00 Z10\nM5\nM30';
  const p=compile(source,basic);assert.equal(p.ok,true,JSON.stringify(p.errors));assert.equal(E.toolConfig(2,p.config).maxDepth,null);assert.equal(E.toolConfig(2,p.config).finishAllowanceDiameter,.2);
  assert.equal(p.moves.filter(m=>m.mode===1).length,1);assert.ok(p.moves.find(m=>m.mode===1).depth>20);
  for(const [oldWord,newWord,code]of [['S400','S500','刀具转速不符'],['F.08','F.1','刀具进给超限']])assert.equal(compile(source.replace(oldWord,newWord),basic).errors[0].code,code);
  const overcut=compile(source.replace('X8.2','X8').replace('Z-25','Z-19'),top);assert.equal(overcut.ok,false);assert.equal(overcut.errors[0].code,'刀具轮廓干涉');
});
test('holder collisions work without any workpiece-specific callback',()=>{
  const c=E.configuration({...basic.stock,t2Projection:4}),s=E.stock(c),m=G.model(2,c),p={z:-23.5,r:5};for(let i=0;i<s.n;i++){const z=-s.length+(i+.5)*s.dz;if(z>=p.z+m.insertBounds.minZ&&z<=p.z+m.insertBounds.maxZ)s.radii[i]=4;}assert.equal(G.insertCollision(s,p,m,c),null);assert.ok(G.bodyCollision(s,p,m,c));
});
test('top final stem, cutoff and animation remain correct',()=>{
  const p=topPlan||compile(topCode,top),at=z=>p.finalStock.radii[Math.floor((z+p.config.length)/p.finalStock.dz)];assert.ok(Math.abs(at(-25)-4)<.05);assert.ok(at(-32)<.01);assert.ok(Math.abs(at(-13)-14)<.05);
  const sim=E.simulation(p);E.advance(sim,p.duration+1);assert.equal(sim.done,true);assert.ok(Math.abs(sim.position.r*2-46)<1e-9);
});
test('flat T2 spans +3mm from its left cutting corner',()=>{
  const m=G.model(2,E.defaults);assert.equal(m.reference,'最左侧刃尖');assert.equal(m.insert.length,4);assert.equal(m.insertBounds.minZ,0);assert.equal(m.insertBounds.maxZ,3);
  for(const z of [0,.5,1.5,2.5,3])assert.equal(G.slice(m.insert,z).lo,0);
});
test('one continuous T2 finish follows one rough contour and feeds directly into part-off',()=>{
  const p=topPlan||compile(topCode,top),rows=topCode.split('\n'),a=rows.findIndex(s=>s.includes('; T2精加工')),b=rows.findIndex(s=>s.includes('; T2切断'));
  const cut=p.moves.filter(m=>m.line>a+1&&m.line<b+1&&m.mode!==0);
  assert.equal(cut.length,5);assert.deepEqual(cut.map(m=>m.mode),[1,3,1,2,1]);assert.ok(cut.every(m=>m.feed===.08&&m.depth<=.200001));
  assert.deepEqual(cut.map(m=>[m.end.z,m.end.r*2]),[[-18,28],[-19,26],[-19,12],[-21,8],[-34,8]]);
  const i=p.moves.indexOf(cut[0]),j=p.moves.indexOf(cut.at(-1));assert.ok(p.moves.slice(i,j+1).every(m=>m.mode!==0));
  assert.deepEqual([p.moves[j+1].mode,p.moves[j+1].end.z,p.moves[j+1].end.r],[1,-34,0]);
});
test('flat T2 cuts off at left-edge Z-34 and X0',()=>{
  const p=topPlan||compile(topCode,top),last=p.moves.filter(m=>m.tool===2&&m.mode===1).at(-1);assert.equal(last.end.z,-34);assert.equal(last.end.r,0);
});
test('six full-depth T2 plunges form coarse stairs before the separate rough contour',()=>{
  const data=top.generate(E),p=compile(data.rough,top);assert.equal(p.ok,true,JSON.stringify(p.errors));
  const moves=p.moves.filter(m=>m.tool===2),cuts=moves.filter(m=>m.mode!==0);
  assert.deepEqual(cuts.map(m=>[m.end.z,m.end.r*2]),[[-19,12.2],[-22,8.2],[-25,8.2],[-28,8.2],[-31,8.2],[-34,8.2]]);
  for(const m of cuts){assert.equal(m.mode,1);assert.equal(m.start.z,m.end.z);const i=moves.indexOf(m);assert.equal(moves[i+1].mode,0);assert.equal(moves[i+1].end.r,18);assert.equal(moves[i+1].end.z,m.end.z);}
  assert.ok(cuts[0].depth>10);
  for(const m of moves)if(Math.abs(m.end.z-m.start.z)>1e-9){assert.equal(m.mode,0);assert.ok(Math.min(m.start.r,m.end.r)>=18);}
  const at=z=>p.finalStock.radii[Math.floor((z+p.config.length)/p.finalStock.dz)];assert.equal(at(-25),4.1);assert.equal(at(-17),6.1);
  const q=compile(data.roughContour,top);assert.equal(q.ok,true,JSON.stringify(q.errors));
  for(let i=0;i<q.finalStock.n;i++){const z=-q.config.length+(i+.5)*q.finalStock.dz;if(z>-30&&z<-18.1)assert.ok(Math.abs(q.finalStock.radii[i]-top.targetRadius(z)-.1)<1e-8);}
});
test('top source stays close to N1000 with readable literal toolpaths',()=>{
  const ns=[...topCode.matchAll(/^N(\d+) /gm)].map(m=>Number(m[1]));assert.ok(ns.length>=90&&ns.length<=120);assert.equal(ns.at(-1),ns.length*10);assert.ok(topCode.length<7500);assert.ok(!/REPEAT|TRUNC|R[1-5]=/.test(topCode));
});
const Flow=require('../核心/program-flow.js');
test('REPEAT P counts additional traversals and preserves source rows',()=>{
  const blocks=Flow.expand('R1=1\nLOOP: R1=R1+1\nG00 X=R1\nREPEAT LOOP P=2\nM30');
  assert.deepEqual(blocks.map(b=>b.text),['G00 X2','G00 X3','G00 X4','M30']);assert.deepEqual(blocks.map(b=>b.line),[3,3,3,5]);
  const math=Flow.expand('R2=SQRT(9)+MAXVAL(2,3)*2-MINVAL(4,1)+ABS(-2)\nG00 X=R2 Z=(R2-1)/2\nM30');assert.equal(math[0].text,'G00 X10 Z4.5');
  assert.equal(Flow.expand('R1=TRUNC(-2.9)+TRUNC(3.8)\nG00 X=R1\nM30')[0].text,'G00 X1');
});
test('invalid R arithmetic, control flow and excessive expansion are refused',()=>{
  for(const s of ['R1=1/0','R1=SQRT(-1)','R1=R2+1','R1=globalThis.process.exit()','REPEAT MISSING P=2','REPEAT L P=2\nL: R1=1','L: R1=1\nL: R2=1','L: G00 X40\nREPEAT L P=10001','L: G00 X40\nG00 Z2\nREPEAT L P=10000','A: R1=1\nB: R2=2\nREPEAT B P=2\nREPEAT A P=2','M30\nR1=2'])assert.throws(()=>Flow.expand(s));
});
test('expanded unsafe cuts are rejected at their original source row',()=>{
  const code='G18 G90 G710 DIAMON\nG97\nG95\nT1 D1\nS550 M3\nG00 X36 Z-25\nR1=30\nCUT: R1=R1-6\nG01 X=R1 F0.3\nREPEAT CUT P=2\nM30';
  const p=compile(code,basic);assert.equal(p.ok,false);assert.equal(p.errors[0].line,9);assert.equal(p.errors[0].code,'吃刀量超限');assert.deepEqual(p.moves,[]);
});

test('left handle remains diameter8 with a square end and no chamfer moves',()=>{
  const p=topPlan||compile(topCode,top);assert.equal(p.ok,true);
  for(const z of [-30,-30.5,-30.98,-31])assert.equal(top.targetRadius(z),4);
  assert.ok(!topCode.includes('G01 Z-33'));assert.ok(!topCode.includes('G01 X6 Z-34'));
  for(let i=0;i<p.finalStock.n;i++){const z=-p.config.length+(i+.5)*p.finalStock.dz;if(z>-31&&z<-30)assert.ok(Math.abs(p.finalStock.radii[i]-4)<1e-8);}
  const sim=E.simulation(p);E.advance(sim,p.duration+1);assert.ok(sim.done);
  for(let i=0;i<sim.stock.n;i++)assert.ok(Math.abs(sim.stock.radii[i]-p.finalStock.radii[i])<.026);
});
test('an unintended handle chamfer is rejected as gouging the specified diameter8',()=>{
  const bad=topCode.replace('; T2切断：','G01 Z-33\nG01 X6 Z-34\n; T2切断：'),p=compile(bad,top);assert.equal(p.ok,false);assert.equal(p.errors[0].code,'刀具轮廓干涉');
});

test('T1 and T4 OD contact overlaps the rear corner by0.2mm before retracting',()=>{
  const data=top.generate(E);
  for(const [source,tool,radius]of [[data.t1,1,14.12],[data.front,4,14]]){
    const p=compile(source,top);assert.equal(p.ok,true,JSON.stringify(p.errors));
    const m=p.moves.filter(m=>m.tool===tool&&m.mode!==0).at(-1),nose=G.model(tool,p.config).nose;
    assert.ok(Math.abs(m.end.z+nose.z+16.2)<1e-6);
    for(let i=0;i<p.finalStock.n;i++){const z=-p.config.length+(i+.5)*p.finalStock.dz;if(z>-16.1&&z<-14.4)assert.ok(p.finalStock.radii[i]<=radius+.001,'剩余外径凸起 Z='+z);}
  }
});
test('finished handoff has no residual stock spike in the OD or rear R1',()=>{
  const p=topPlan||compile(topCode,top);
  for(let i=0;i<p.finalStock.n;i++){
    const z=-p.config.length+(i+.5)*p.finalStock.dz;
    if(z>-15&&z<-14.4)assert.ok(p.finalStock.radii[i]*2<=28.001,'外圆残尖 Z='+z);
    if(z>-16&&z<-15)assert.ok(2*(p.finalStock.radii[i]-top.targetRadius(z))<.05,'圆角残尖 Z='+z);
  }
});
test('OD overlap does not permit T1 or T4 to plunge into the handle or travel past the overlap',()=>{
  for(const [tool,rpm,feed]of [[1,550,.3],[4,700,.1]]){
    const header='G18 G90 G710 DIAMON\nG97\nG95\nT'+tool+' D1\nS'+rpm+' M3\n';
    const radial=compile(header+'G00 X36 Z-16.5\nG01 X20 F'+feed+'\nM30',top);assert.equal(radial.ok,false);assert.equal(radial.errors[0].code,'刀具区域限制');
    const axial=compile(header+'G00 X36 Z-18\nG01 Z-19 F'+feed+'\nM30',top);assert.equal(axial.ok,false);assert.equal(axial.errors[0].code,'刀具区域限制');
  }
});
