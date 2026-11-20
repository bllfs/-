(function(root){
  'use strict';
  const handoffZ=-16.2; // OD contact continues past the rear R1 end at Z-16.
  function generate(E,input={}){
    const c=E.configuration({...experiment.stock,...input,experiment}),G=E.geometry,n=v=>Number((Math.abs(v)<5e-8?0:v).toFixed(6)).toString();
    if(c.diameter<28||c.length-c.grip<34+c.t2Width)throw Error('毛坯直径至少28mm，伸出长度须大于34+槽刀宽。');
    const p=(z,r)=>({z,r}),lines=['; 陀螺，X为直径，G710/G95/G97：mm、mm/r、r/min',
      '; T1粗车/T4精车仅加工前部；T2加工柄部、后肩、圆角和切断',
      '; 坐标为当前刀具的理论刀尖，刀尖圆弧偏置已计入轨迹；不叠加G41/G42',
      '; T2为平底刀；Z基准：'+G.model(2,c).reference+'；宽'+c.t2Width+'，刃角R'+c.t2Nose,
      'G18 G90 G710 DIAMON','G97','G95','G00 X46','G00 Z10','T1 D1','S550 M03'];
    function line(z,r,F){lines.push('G01 X'+n(r*2)+' Z'+n(z)+(F?' F'+n(F):''));}
    function rapid(z,r){lines.push('G00'+(r!==undefined?' X'+n(r*2):'')+(z!==undefined?' Z'+n(z):''));}
    function safe(){rapid(undefined,23);rapid(10);}
    const roughModel=G.model(1,c),nose=roughModel.nose,Rn=nose.radius;
    const circle=E.arc(p(0,.12),p(-10,12.77),13,true),rr=13-Rn;
    lines.push('; T1前部粗车，外圆接触延伸到Z-16.2；2ap≤5');
    rapid(undefined,18);rapid(2);rapid(undefined,14.12+Rn-nose.r);line(handoffZ-nose.z,14.12+Rn-nose.r,.3);rapid(undefined,18);rapid(2);
    for(const level of [11.92,9.56,7.2,4.84,2.48,.12]){
      rapid(undefined,level+Rn-nose.r);
      line(circle.cz-nose.z-Math.sqrt(rr*rr-(level+Rn-circle.cr)**2),level+Rn-nose.r,.3);
      lines.push('G02 X'+n(2*(circle.cr-nose.r))+' Z'+n(circle.cz-rr-nose.z)+' CR='+n(rr));
      line(-10+Rn-nose.z,13.12-nose.r);
      lines.push('G03 X'+n(2*(14.12+Rn-nose.r))+' Z'+n(-11-nose.z)+' CR='+n(1+Rn));
      line(handoffZ-nose.z,14.12+Rn-nose.r);rapid(undefined,18);rapid(2);
    }
    safe();lines.push('M05');
    const roughEnd=lines.length;
    lines.push('; T4前部精车，外圆接触延伸到Z-16.2；2ap≤0.5；刀尖R'+c.t4Nose,'T4 D1','S700 M03');
    const target=[p(0,0),p(-10,12.65),p(-10,13),p(-11,14),p(handoffZ,14)],codes=[2,1,3,1],rs=[13,null,1,null];
    function compensated(t,m,side){
      let tan;
      if(m.arc){const sign=Math.sign(m.arc.sweep);tan=at=>({z:-Math.sin(m.arc.a+m.arc.sweep*at)*sign,r:Math.cos(m.arc.a+m.arc.sweep*at)*sign});}
      else tan=()=>({z:m.end.z-m.start.z,r:m.end.r-m.start.r});
      const a=G.compensationOffset(t,tan(0),side,c),b=G.compensationOffset(t,tan(1),side,c);
      return {start:p(m.start.z+a.z,m.start.r+a.r),end:p(m.end.z+b.z,m.end.r+b.r),radius:m.arc?m.arc.radius+(side==='right'?1:-1)*Math.sign(m.arc.sweep)*G.model(t,c).nose.radius:null};
    }
    let first=true;
    for(let i=0;i<codes.length;i++){
      const m={start:target[i],end:target[i+1],mode:codes[i],arc:rs[i]?E.arc(target[i],target[i+1],rs[i],codes[i]===2):null};
      const q=compensated(4,m,'right');
      if(first){rapid(2,q.start.r);line(q.start.z,q.start.r,.1);first=false;}
      if(q.radius)lines.push('G0'+m.mode+' X'+n(q.end.r*2)+' Z'+n(q.end.z)+' CR='+n(q.radius));else line(q.end.z,q.end.r);
    }
    safe();lines.push('M05');
    const frontEnd=lines.length;
    const number=a=>{let seq=0;return a.map(l=>{l=l.replace(/\+\-/g,'-');return l.startsWith(';')?l:'N'+(++seq*10)+' '+l;}).join('\n')+'\n';};
    const m=G.model(2,c),shift=m.shift,R=m.nose.radius,virtualZ=right=>right-shift;
    if(R!==0)throw Error('本工艺要求T2为平底R0刀。');
    const allowance=E.toolConfig(2,c).finishAllowanceDiameter;
    const a=allowance/2,slotPositions=[-16],leftEnd=-31-shift;
    lines.push('; T2粗槽：各槽一次沿X推到目标，退出后向-Z移位；直径精加工余量'+n(allowance),'T2 D1','S400 M03');
    rapid(undefined,18);
    const slots=[{right:-16,r:6+a}];
    for(let right=-16-c.t2Width;right>-31+1e-7;right-=c.t2Width)slots.push({right,r:4+a});
    slots.push({right:-31,r:4+a});
    for(const q of slots){rapid(virtualZ(q.right));lines.push('G01 X'+n(q.r*2)+(q===slots[0]?' F0.08':''));rapid(undefined,18);}
    slotPositions.splice(0,slotPositions.length,...slots.map(q=>q.right));
    const slotsEnd=lines.length;
    // One rough contour removes the coarse stairs and leaves the finishing allowance.
    lines.push('; T2粗修轮廓：R1、肩面、R2、柄部，留直径'+n(allowance)+'余量');
    rapid(virtualZ(-15));lines.push('G01 X'+n(28+allowance)+' F0.08',
      'G03 X'+n(26+allowance)+' Z'+n(virtualZ(-16))+' CR=1',
      'G01 X'+n(12+allowance),'G02 X'+n(8+allowance)+' Z'+n(virtualZ(-18))+' CR=2',
      'G01 Z'+n(leftEnd));rapid(undefined,18);
    const allRoughEnd=lines.length;
    lines.push('; T2精加工：一次连续推进完成轮廓，无往返叠层及中途退刀');
    rapid(virtualZ(-15));lines.push('G01 X28 F0.08',
      'G03 X26 Z'+n(virtualZ(-16))+' CR=1','G01 X12',
      'G02 X8 Z'+n(virtualZ(-18))+' CR=2','G01 Z'+n(leftEnd));
    const uncutEnd=lines.length,stemStart=p(leftEnd,4),rootStart=p(virtualZ(-18),4),rootEnd=p(virtualZ(-16),6),cz=leftEnd;
    lines.push('; T2切断：保持当前Z，一次沿X推进到中心','G01 X0 F0.08');
    safe();lines.push('M05','M30');
    const frontRough=lines.slice(0,roughEnd),frontFine=lines.slice(roughEnd,frontEnd),backSlots=lines.slice(frontEnd,slotsEnd),backRough=lines.slice(frontEnd,allRoughEnd),backFine=lines.slice(allRoughEnd,uncutEnd),cutoff=lines.slice(uncutEnd),exit=['G00 X46','G00 Z10','M05','M30'];
    const all=number([...frontRough,...frontFine,...backRough,...backFine,...cutoff]);
    const rough=number([...frontRough,...backSlots,...exit]);
    const roughContour=number([...frontRough,...frontFine,...backRough,...exit]);
    const uncut=number([...frontRough,...frontFine,...backRough,...backFine,...exit]);
    const unsafe=number(['; 法兰后方使用外圆刀，禁止运行','G18 G90 G710 DIAMON','G97','G95','T1 D1','S550 M03','G00 X36 Z-20','G01 X28 Z-25 F0.3','M30']);
    const referenceHeader=['; 参考段，必须在对应粗车完成后使用','G18 G90 G710 DIAMON','G97','G95','G00 X46','G00 Z10'];
    return {all,rough,roughContour,uncut,front:number([...frontRough,...frontFine,'M30']),t1:number([...frontRough,'M30']),
      fine:number([...referenceHeader,...frontFine,'T2 D1','S400 M03','G00 X36',...backFine,...exit]),
      cutoff:number([...referenceHeader,'T2 D1','S400 M03','G00 X36','G00 Z'+n(cz),'G00 X8.2',...cutoff]),unsafe,
      config:c,reference:m.reference,geometry:{bodyArc:E.arc(p(0,0),p(-10,12.65),13,true),rootStart,rootEnd,cutoffZ:cz,cutoffEndX:0,slotPositions,frontHandoff:{contactZ:handoffZ,rearRoundEndZ:-16,overlap:.2},finishAllowanceDiameter:allowance,endFace:{z:-31,diameter:8,chamfer:0}},examples:{contour:all,taper:rough,groove:uncut,unsafe}};
  }

  function targetRadius(z,c={}){
    if(z>0)return 0;
    if(z<=-31-(c.t2Width||3)-.6)return (c.diameter||30)/2;
    if(z<=-18)return 4;
    if(z<=-16+1e-8)return 6-Math.sqrt(Math.max(0,4-(z+18)**2));
    if(z<-15)return 13+Math.sqrt(Math.max(0,1-(z+15)**2));
    if(z<=-11)return 14;
    if(z<=-10)return 13+Math.sqrt(Math.max(0,1-(z+11)**2));
    const cz=2.9999999695789556,cr=12.649110647888502;
    return Math.max(0,cr-Math.sqrt(Math.max(0,169-(z-cz)**2)));
  }

  const experiment={
    id:'top',revision:'flat-end-v7',name:'陀螺实验',exportName:'陀螺程序.txt',stock:{diameter:30,length:60,grip:15,startX:46,startZ:10,protectPart:1},
    labels:{contour:'完整程序 · 分区加工及切断',taper:'仅粗车 · T1 / T2',groove:'粗精车 · 保留连接',unsafe:'错误示例 · 禁止外圆刀进入柄部'},
    targetRadius,
    requiredRadius(z,move,model,c){
      // The three-millimetre part-off band is sacrificial during part-off.
      if(move.tool===2&&z>=-31-model.width-1e-8&&z<=-31+1e-8)return 0;
      return targetRadius(z,c);
    },
    validateCut(tool,p,move,c,model){
      if([1,4].includes(tool)&&p.z<-16-c.geometryTolerance){
        const nose=model.nose,contactZ=p.z+nose.z,contactR=p.r+nose.r-nose.radius;
        const axialOD=move.mode===1&&Math.abs(move.end.r-move.start.r)<1e-8&&contactR>=14-c.geometryTolerance&&contactZ>=handoffZ-c.geometryTolerance;
        if(!axialOD)return 'T1/T4仅允许在外圆直径≥28处轴向延伸至接触Z-16.2；柄部低径加工请使用T2。';
      }
      return null;
    },
    help:'总长31、柄径8、最大直径28。R13由X0 Z0与X25.3 Z-10定义，约76.6616°。T1/T4外圆接触延伸至Z-16.2，与T2后肩圆角区域重叠；T2为3mm平底刀，以最左侧刃尖为基准。粗槽每槽一次沿X进到目标后退刀，粗修轮廓留直径0.2mm余量，一次连续精修后直接切断，最左柄端为直径8mm平直端面。右刃接触点Z=程序Z+3mm。',
    drawing:'../陀螺/图纸/陀螺轮廓尺寸.svg',
    generate
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=experiment;
  else (root.LatheExperiments ||= {})[experiment.id]=experiment;
})(typeof globalThis!=='undefined'?globalThis:this);
