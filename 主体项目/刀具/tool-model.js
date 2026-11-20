(function(root){
  'use strict';
  const PI=Math.PI, rad=d=>d*PI/180, cache=new Map();
  const defaults={t1Nose:.5,t1Angle:86,t1Relief:4,t1Reach:8,t1Projection:8,t1HolderWidth:12,
    t4Nose:.5,t4Angle:35,t4Relief:4,t4Reach:8,t4Projection:8,t4HolderWidth:12,
    t2Width:3,t2Nose:0,t2Projection:18,t2HolderWidth:12,t2SideCut:1,t2Reference:2,
    t3Width:4,t3Angle:60,t3Projection:12,t3HolderWidth:10,
    protectPart:1,geometryTolerance:.035};
  function parameters(c){return {...defaults,...c};}
  function validate(c){
    for(const t of [1,4]){
      const k='t'+t;
      if(c[k+'Nose']<.05||c[k+'Nose']>1.5)throw Error('刀尖半径需在0.05–1.5 mm。');
      if(c[k+'Angle']<20||c[k+'Angle']>90||c[k+'Relief']<1||c[k+'Relief']>8||c[k+'Angle']+c[k+'Relief']>95)throw Error('刀尖角或副偏角超出模型范围。');
      if(c[k+'Reach']<3||c[k+'Reach']>20||c[k+'Projection']<3||c[k+'Projection']>40||c[k+'HolderWidth']<3||c[k+'HolderWidth']>25)throw Error('外圆刀伸出或刀杆宽度超出范围。');
    }
    if(c.t2Width<1||c.t2Width>6||c.t2Nose<0||c.t2Nose>=c.t2Width/2)throw Error('槽刀宽度需1–6 mm，刃角半径需非负且小于半刀宽；R0为平底刀。');
    if(c.t2Projection<4||c.t2Projection>40||c.t2HolderWidth<c.t2Width||c.t2HolderWidth>25)throw Error('槽刀伸出或刀杆宽度无效。');
    if(![0,1,2].includes(c.t2Reference)||![0,1].includes(c.t2SideCut)||![0,1].includes(c.protectPart))throw Error('刀具模式无效。');
    if(c.geometryTolerance<.005||c.geometryTolerance>.1)throw Error('几何容差需在0.005–0.1 mm。');
    if(c.t3Width<1||c.t3Width>8||c.t3Angle<30||c.t3Angle>90||c.t3Projection<6||c.t3Projection>40||c.t3HolderWidth<c.t3Width||c.t3HolderWidth>25)throw Error('T3刃宽、尖角或刀杆尺寸无效。');
  }
  function wedge(t,c){
    const k='t'+t,R=c[k+'Nose'],beta=rad(c[k+'Relief']),alpha=beta+rad(c[k+'Angle']);
    const a=(alpha+beta)/2, d=R/Math.sin((alpha-beta)/2);
    const nose={z:d*Math.cos(a),r:d*Math.sin(a),radius:R};
    const upper={z:nose.z-R*Math.sin(alpha),r:nose.r+R*Math.cos(alpha)};
    const lower={z:nose.z+R*Math.sin(beta),r:nose.r-R*Math.cos(beta)};
    const h=Math.max(5,c[k+'Projection']-.8),zu=h/Math.tan(alpha);
    const reach=Math.max(c[k+'Reach'],zu+.6,lower.z+1);
    const poly=[upper,{z:zu,r:h},{z:reach,r:h},{z:reach,r:Math.tan(beta)*reach},lower];
    // Lower/front convex nose joins both straight cutting edges tangentially.
    const a0=beta-PI/2,a1=alpha-3*PI/2;
    for(let j=1;j<=60;j++){const q=a0+(a1-a0)*j/60;poly.push({z:nose.z+R*Math.cos(q),r:nose.r+R*Math.sin(q)});}
    const holder=[{z:Math.max(0,zu),r:c[k+'Projection']},{z:Math.max(0,zu)+c[k+'HolderWidth'],r:c[k+'Projection']},
      {z:Math.max(0,zu)+c[k+'HolderWidth'],r:c[k+'Projection']+20},{z:Math.max(0,zu),r:c[k+'Projection']+20}];
    return {number:t,name:t===1?'粗车外圆刀':'精车外圆刀',insert:poly,bodies:[holder],nose,reference:'理论刀尖',tipAngle:c[k+'Angle'],relief:c[k+'Relief']};
  }
  function groove(c){
    const w=c.t2Width,R=c.t2Nose,shift=[0,w/2,w][c.t2Reference];
    const poly=[{z:shift-w,r:Math.max(1,R+.3)},{z:shift,r:Math.max(1,R+.3)}];
    if(R===0){poly.push({z:shift,r:0},{z:shift-w,r:0});}
    else{
      poly.push({z:shift,r:R});
      for(let j=1;j<=30;j++){const a=-PI/2*j/30;poly.push({z:shift-R+R*Math.cos(a),r:R+R*Math.sin(a)});}
      poly.push({z:shift-w+R,r:0});
      for(let j=1;j<=30;j++){const a=-PI/2-PI/2*j/30;poly.push({z:shift-w+R+R*Math.cos(a),r:R+R*Math.sin(a)});}
    }
    const neck=[{z:shift-w,r:Math.max(1,R+.3)},{z:shift,r:Math.max(1,R+.3)}, {z:shift,r:c.t2Projection},{z:shift-w,r:c.t2Projection}];
    const center=shift-w/2,hw=c.t2HolderWidth/2;
    const holder=[{z:center-hw,r:c.t2Projection},{z:center+hw,r:c.t2Projection},{z:center+hw,r:c.t2Projection+20},{z:center-hw,r:c.t2Projection+20}];
    return {number:2,name:R===0?'平底槽刀':'槽刀',insert:poly,bodies:[neck,holder],nose:{z:shift-R,r:R,radius:R},leftNose:{z:shift-w+R,r:R,radius:R},
      width:w,shift,flat:R===0,referencePoint:{z:0,r:0},reference:['右侧刃尖','刀宽中心','最左侧刃尖'][c.t2Reference],sideCut:!!c.t2SideCut};
  }
  function slice(poly,z){
    const intersections=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      if(Math.abs(b.z-a.z)<1e-10){if(Math.abs(z-a.z)<1e-9)intersections.push(a.r,b.r);continue;}
      if(z>=Math.min(a.z,b.z)-1e-9&&z<=Math.max(a.z,b.z)+1e-9){const t=(z-a.z)/(b.z-a.z);intersections.push(a.r+t*(b.r-a.r));}
    }
    if(!intersections.length)return null;
    return {lo:Math.min(...intersections),hi:Math.max(...intersections)};
  }
  function bounds(poly){return {minZ:Math.min(...poly.map(p=>p.z)),maxZ:Math.max(...poly.map(p=>p.z)),minR:Math.min(...poly.map(p=>p.r)),maxR:Math.max(...poly.map(p=>p.r))};}
  function model(t,input={}){
    const c=parameters(input),key=t+':'+Object.keys(defaults).map(k=>c[k]).join(',');
    if(cache.has(key))return cache.get(key);
    let m;
    if(t===1||t===4)m=wedge(t,c);
    else if(t===2)m=groove(c);
    else {
      const w=c.t3Width/2,h=w/Math.tan(rad(c.t3Angle/2)),neckTop=Math.max(c.t3Projection,h+2),hw=c.t3HolderWidth/2;
      m={number:3,name:'尖头螺纹刀',insert:[{z:0,r:0},{z:w,r:h},{z:w,r:h+.8},{z:-w,r:h+.8},{z:-w,r:h}],
        bodies:[[{z:-w,r:h+.8},{z:w,r:h+.8},{z:w,r:neckTop},{z:-w,r:neckTop}], [{z:-hw,r:neckTop},{z:hw,r:neckTop},{z:hw,r:neckTop+20},{z:-hw,r:neckTop+20}]],
        nose:{z:0,r:0,radius:0},reference:'尖头顶点',width:c.t3Width,tipAngle:c.t3Angle};
    }
    m.insertBounds=bounds(m.insert);m.bodyBounds=m.bodies.map(bounds);m.allBounds=bounds([...m.insert,...m.bodies.flat()]);
    if(cache.size>100)cache.clear();cache.set(key,m);return m;
  }
  function stockIndices(s,p,box){
    const lo=Math.max(0,Math.floor((p.z+box.minZ+s.length)/s.dz)),hi=Math.min(s.n-1,Math.floor((p.z+box.maxZ+s.length)/s.dz));return [lo,hi];
  }
  function intersects(s,p,poly,box,allowance=0){
    if(p.r+box.minR>s.initial+.00001||p.r+box.maxR<0)return null;
    const [a,b]=stockIndices(s,p,box);
    for(let i=a;i<=b;i++){
      if(s.radii[i]<1e-8)continue;
      const z=-s.length+(i+.5)*s.dz,cut=slice(poly,z-p.z);
      if(cut&&p.r+cut.hi>0&&s.radii[i]>p.r+cut.lo+allowance)return {z,stockR:s.radii[i],toolR:p.r+cut.lo,index:i};
    }
    return null;
  }
  function bodyCollision(s,p,m,c){
    for(let k=0;k<m.bodies.length;k++){const hit=intersects(s,p,m.bodies[k],m.bodyBounds[k],c.geometryTolerance);if(hit)return {...hit,part:k===m.bodies.length-1?'刀杆':'刀颈'};}
    return null;
  }
  function insertCollision(s,p,m,c){return intersects(s,p,m.insert,m.insertBounds,c.geometryTolerance);}
  function chuckCollision(p,m,c){
    const right=-c.length+c.grip,R=c.diameter/2+14;
    for(const poly of [m.insert,...m.bodies]){
      const b=bounds(poly);
      if(p.z+b.minZ>=right-c.geometryTolerance||p.r+b.minR>=R-c.geometryTolerance||p.r+b.maxR<=-R)continue;
      // The chuck is conservatively infinite to the left inside its radial envelope.
      for(const q of poly)if(p.z+q.z<right-c.geometryTolerance&&p.r+q.r<R-c.geometryTolerance&&p.r+q.r>-R)return true;
      const cross=slice(poly,right-p.z);if(cross&&p.r+cross.lo<R-c.geometryTolerance&&p.r+cross.hi>-R)return true;
    }
    return false;
  }
  function cut(s,p,m,c,move,baseline){
    const [a,b]=stockIndices(s,p,m.insertBounds);let depth=0,removed=0,overcut=null;
    if(p.r+m.insertBounds.minR>s.initial)return {depth,removed,overcut};
    for(let i=a;i<=b;i++){
      const z=-s.length+(i+.5)*s.dz,f=slice(m.insert,z-p.z);if(!f||p.r+f.hi<0)continue;
      const next=Math.max(0,p.r+f.lo),old=s.radii[i];
      if(next>=old-1e-9)continue;
      const required=c.experiment?.requiredRadius?.(z,move,m,c); 
        if(c.protectPart&&Number.isFinite(required)&&next<required-c.geometryTolerance&&old>next+1e-9)overcut={z,amount:required-next};
      depth=Math.max(depth,2*((baseline||s.radii)[i]-next));
      s.radii[i]=next;removed++;
    }
    return {depth,removed,overcut};
  }
  function compensationOffset(t,tangent,side,c){
    const m=model(t,c),len=Math.hypot(tangent.z,tangent.r),s=side==='left'?1:-1;
    const normal={z:-tangent.r/len*s,r:tangent.z/len*s};
    return {z:m.nose.radius*normal.z-m.nose.z,r:m.nose.radius*normal.r-m.nose.r};
  }
  const processLimits = {
    1: { name: '粗车外圆', minS: 500, maxS: 600, maxDepth: 5, maxF: .3, width: .01, color: '#f3bc63' },
    2: { name: '车槽', minS: 350, maxS: 450, maxDepth: null, finishAllowanceDiameter: .2, maxF: .08, width: 3, color: '#78b8ff' },
    3: { name: '螺纹', minS: 350, maxS: 350, maxDepth: .6, maxF: null, width: .18, color: '#bc9bff' },
    4: { name: '精车外圆', minS: 600, maxS: 800, maxDepth: .5, maxF: .1, width: .01, color: '#55e0c0' }
  };
  function getProcessLimits(number, c) { return number === 3 ? { ...processLimits[3], minS: c.threadMinS, maxS: c.threadMaxS, maxDepth: c.threadDepth } : processLimits[number]; }

  const api={processLimits,getProcessLimits,defaults,parameters,validate,model,slice,bounds,stockIndices,bodyCollision,insertCollision,chuckCollision,cut,compensationOffset};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ToolGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
