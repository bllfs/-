(function(root){
  'use strict';
  const head='G18 G90 G710 DIAMON\nG97\nG95\nT1 D1\nS550 M03\n',back='G00 X46\nG00 Z10\n',end='M05\nM30';
  const pass=(d,f)=>`G00 X${d} Z4\nG01 Z-20 F${f}\nG03 X${d-4} Z-22 CR=2\nG01 Z-55\nG02 X${d} Z-57 CR=2\nG01 Z-75\n${back}`;
  const examples={
    contour:'; 基础圆柱，G02/G03圆弧轮廓\n'+head+pass(30,.3)+pass(26,.3)+end,
    taper:'; 外圆与锥面\n'+head+'G00 X26 Z4\nG01 Z-20 F0.3\nG01 X30 Z-50\nG01 Z-75\n'+back+'M05\nT4 D1\nS700 M03\nG00 X25.6 Z4\nG01 Z-20 F0.1\nG01 X29.6 Z-50\nG01 Z-75\n'+back+end,
    groove:'; 槽宽3，一次径向进到X24.46后退出\n'+head+'G00 X26 Z4\nG01 Z-45 F0.3\n'+back+'M05\nT2 D1\nS400 M03\nG00 X32 Z-30\nG01 X24.46 F0.08\nG00 X32\n'+back+end,
    thread:'; T3尖头螺纹刀，S350，导程K2；分刀径向退刀\n'+head+'M05\nT3 D1\nS350 M03\n'+[29.6,29.2,28.8].map(x=>`G00 X${x} Z4\nG33 Z-30 K2\n${back}`).join('')+end,
    unsafe:'; 错误示例：G00穿入毛坯，应拒绝\n'+head+'G00 X20 Z-30\n'+end
  };
  const experiment={id:'basic',name:'基础圆柱实验',exportName:'圆柱程序.txt',stock:{diameter:30,length:100,grip:12,startX:46,startZ:10,protectPart:0},
    labels:{contour:'圆弧轮廓 · G02 / G03',taper:'外圆粗精车与锥面',groove:'槽刀径向直进切槽',thread:'T3螺纹 · S350',unsafe:'错误示例 · G00穿料'},
    help:'基础圆柱实验用于编写和观察G00/G01/G02/G03/G33。毛坯默认Ø30×100、夹持12。没有指定成品目标轮廓；保留刀片、刀杆、卡盘与工艺参数检查，不施加其他实验的分区规则。',
    generate(){return {all:examples.contour,examples:{...examples}};}
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=experiment;else(root.LatheExperiments||={})[experiment.id]=experiment;
})(typeof globalThis!=='undefined'?globalThis:this);
