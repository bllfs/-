(function () {
  'use strict';
  const E = window.Turning, $ = id => document.getElementById(id);
  const experiments=window.LatheExperiments,requested=new URLSearchParams(location.search).get('experiment')||'basic';
  const activeExperiment=experiments[requested]||experiments.basic;
  const editor = $('editor'), canvas = $('view'), ctx = canvas.getContext('2d');
  const keys = ['diameter', 'length', 'grip', 'startX', 'startZ', 'threadMinS', 'threadMaxS', 'threadDepth',...Object.keys(E.geometry.defaults)];
  const storageKey='lathe-experiment-'+activeExperiment.id+(activeExperiment.revision?'-'+activeExperiment.revision:'');
  const toolStorageKey='lathe-shared-tools';
  const stockKeys=['diameter','length','grip','startX','startZ','protectPart'];
  let plan = null, sim = null, running = false, previousFrame = 0, activeLine = -1, errorLine = -1, animationId = 0;
  let boundsPlan=null,boundsKey=null,cachedBounds=null;
  let gutterSource=null,oldActive=-1,oldError=-1;
  let width = 900, height = 365, previewStock = null, visibleConfig = { ...E.defaults }, saving = null;
  const modeName = n => 'G' + String(n).padStart(2, '0');
  const time = s => { const v = Math.max(0, Math.round(s)); return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); };
  const fmt = v => Math.abs(v) < .0005 ? '0.000' : v.toFixed(3);
  function stopAnimation() { running = false; cancelAnimationFrame(animationId); animationId = 0; }
  function config() { const c = {}; for (const k of keys) c[k] = $(k).value === '' ? NaN : Number($(k).value); c.experiment=activeExperiment; return c; }
  function saveState(){try{const c=config(),settings={},toolSettings={};for(const k of keys)(stockKeys.includes(k)?settings:toolSettings)[k]=c[k];localStorage.setItem(storageKey,JSON.stringify({source:editor.value,settings}));localStorage.setItem(toolStorageKey,JSON.stringify(toolSettings));}catch{}}
  function persist() {
    clearTimeout(saving);
    saving=setTimeout(saveState,250);
  }
  function gutter(){
    const n=editor.value.split('\n').length;$('lineCount').textContent=n+' 行';
    if(gutterSource!==editor.value){const f=document.createDocumentFragment();for(let i=1;i<=n;i++){const s=document.createElement('span');s.textContent=i;f.appendChild(s);}$('gutter').replaceChildren(f);gutterSource=editor.value;oldActive=oldError=-1;}
    const ch=$('gutter').children;
    if(oldActive>0)ch[oldActive-1]?.classList.remove('active');if(oldError>0)ch[oldError-1]?.classList.remove('error');
    if(activeLine>0)ch[activeLine-1]?.classList.add('active');if(errorLine>0)ch[errorLine-1]?.classList.add('error');
    oldActive=activeLine;oldError=errorLine;$('gutter').scrollTop=editor.scrollTop;
  }
  function badge(text, cls = '') { $('stateBadge').textContent = text; $('stateBadge').className = 'state-badge ' + cls; }
  function message(kind, title, body, line = 0) {
    const box = document.createElement('div'); box.className = 'message ' + kind;
    if (line) { const b = document.createElement('button'); b.textContent = '第 ' + line + ' 行'; b.onclick = () => focusLine(line); box.appendChild(b); }
    const content = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = title;
    content.append(strong, document.createTextNode(body)); box.appendChild(content); $('messages').appendChild(box);
  }
  function focusLine(line) {
    const lines = editor.value.split('\n'); let at = 0;
    for (let i = 0; i < line - 1; i++) at += lines[i].length + 1;
    editor.focus(); editor.setSelectionRange(at, at + (lines[line - 1] || '').length);
    editor.scrollTop = Math.max(0, (line - 5) * 23); gutter();
  }
  function updatePreview() {
    try { visibleConfig = E.configuration(config()); previewStock = E.stock(visibleConfig); }
    catch { visibleConfig = { ...E.defaults }; previewStock = E.stock(visibleConfig); }
    $('stockCaption').textContent = '毛坯 Ø' + visibleConfig.diameter + ' × ' + visibleConfig.length;
  }
  function invalidate() {
    stopAnimation(); plan = null; sim = null; activeLine = errorLine = -1;
    $('playBtn').textContent = '播放仿真'; $('playBtn').disabled = true; $('finishBtn').disabled=true; $('stepBtn').disabled = true;
    badge('待检查'); $('summary').textContent = '程序已修改，等待重新检查';
    $('messages').replaceChildren(); message('', '准备检查', '点击「检查程序」后，才会允许播放。');
    updatePreview(); gutter(); telemetry(); draw(); persist();
  }
  function validate() {
    stopAnimation(); activeLine = errorLine = -1;
    plan = E.compile(editor.value, config()); sim = plan.ok ? E.simulation(plan) : null;
    $('messages').replaceChildren();
    if (plan.ok) {
      visibleConfig = plan.config; previewStock = E.stock(plan.config);
      badge('检查通过', 'ready');
      $('summary').textContent = plan.moves.length + ' 段运动 · ' + plan.warnings.length + ' 条提示';
      const tools = [...new Set(plan.moves.map(m => m.tool).filter(Boolean))].map(t => 'T' + t).join(' / ');
      message('', '允许演示', tools + '；预计运动时间 ' + time(plan.duration) + '，去除约 ' + ((plan.initialVolume - plan.remainingVolume) / 1000).toFixed(2) + ' cm³。');
      for (const item of plan.warnings) message('warning', item.code, item.message, item.line);
      $('playBtn').disabled = false; $('finishBtn').disabled=false; $('stepBtn').disabled = false;
      $('currentLine').textContent = '检查通过。点击播放，或逐段观察刀具运动。';
    } else {
      badge('拒绝运行', 'error');
      $('summary').textContent = '发现错误 · 禁止播放';
      for (const item of plan.errors) message('error', item.code, item.message, item.line);
      errorLine = plan.errors[0]?.line || -1;
      $('playBtn').disabled = true; $('finishBtn').disabled=true; $('stepBtn').disabled = true;
      $('currentLine').textContent = '程序未通过检查，修改后请重新检查。';
    }
    $('playBtn').textContent = '播放仿真'; updatePreview(); gutter(); telemetry(); draw(); persist();
  }
  function telemetry() {
    const p = sim?.position || plan?.collision?.position || { r: visibleConfig.startX / 2, z: visibleConfig.startZ };
    $('readX').textContent = fmt(p.r * 2); $('readZ').textContent = fmt(p.z);
    const m = sim && !sim.done ? sim.plan.moves[sim.index] : null;
    $('readMode').textContent = m ? modeName(m.mode) + ' · T' + (m.tool || '—') : sim?.done ? '完成' : '—';
    $('readFeed').textContent = m ? m.rate.toFixed(1) : '—';
    $('feedLabel').textContent = m?.mode === 33 ? '同步进给 K×S' : m?.mode === 0 ? '快速定位' : '实际进给';
    $('readSpindle').textContent = m && m.spindle ? (m.rpm + ' r/min' + (m.pitch ? ' · K' + m.pitch : '')) : sim?.done ? '已停止' : '—';
    const ratio = sim ? Math.min(1, sim.elapsed / sim.plan.duration) : 0;
    $('progress').value = ratio; $('progressLabel').textContent = Math.round(ratio * 100) + '%';
    $('timeLabel').textContent = time(sim?.elapsed || 0) + ' / ' + time(plan?.ok ? plan.duration : 0);
    if (m) {
      if (activeLine !== m.line) {
        activeLine = m.line; gutter();
        const y = (activeLine - 1) * 23;
        if (y < editor.scrollTop || y > editor.scrollTop + editor.clientHeight - 60) {
          editor.scrollTop = Math.max(0, y - editor.clientHeight / 3); $('gutter').scrollTop = editor.scrollTop;
        }
      }
      $('currentLine').textContent = 'L' + m.line + '  ' + m.text + (m.depth > 0 ? (m.tool===2?'  |  直径去除≈':'  |  2ap≈') + m.depth.toFixed(3) + ' mm' : '');
    } else if (sim?.done) {
      activeLine = -1; gutter();
      $('currentLine').textContent = '仿真完成 · 去除约 ' + ((plan.initialVolume - plan.remainingVolume) / 1000).toFixed(2) + ' cm³ · 可复位后重新播放';
    }
  }
  function complete() {
    stopAnimation();
    // Match the preflight envelope exactly after all animation samples finish.
    sim.stock.radii.set(plan.finalStock.radii);
    badge('仿真完成', 'done'); $('playBtn').textContent = '重新播放'; $('stepBtn').disabled = true;
  }
  function reset() {
    stopAnimation(); activeLine = errorLine = -1;
    if (plan?.ok) { sim = E.simulation(plan); badge('已复位', 'ready'); $('stepBtn').disabled = false; $('playBtn').disabled = false; $('finishBtn').disabled=false; }
    else { sim = null; badge(plan?.errors?.length ? '拒绝运行' : '待检查', plan?.errors?.length ? 'error' : ''); }
    $('playBtn').textContent = '播放仿真'; gutter(); telemetry(); draw();
  }
  function play() {
    if (!plan?.ok) return;
    if (running) { stopAnimation(); badge('已暂停', 'paused'); $('playBtn').textContent = '继续播放'; return; }
    if (sim.done) reset();
    running = true; previousFrame = 0; badge('正在切削', 'playing'); $('playBtn').textContent = '暂停';
    animationId = requestAnimationFrame(frame);
  }
  function frame(now) {
    animationId = 0;
    if (!running) return;
    if (!previousFrame) previousFrame = now;
    const dt = Math.min(.1, (now - previousFrame) / 1000); previousFrame = now;
    E.advance(sim, dt * Number($('speed').value));
    if (sim.done) complete();
    telemetry(); draw();
    if (running) animationId = requestAnimationFrame(frame);
  }
  function step() {
    if (!plan?.ok || sim.done) return;
    stopAnimation(); $('playBtn').textContent = '继续播放';
    const m = plan.moves[sim.index]; E.advance(sim, Math.max(0, m.duration * (1 - sim.t)) + 1e-9);
    if (sim.done) complete(); else badge('逐段执行', 'paused');
    telemetry(); draw();
  }
  const colors = { 0: '#f3bc63', 1: '#55e0c0', 2: '#78b8ff', 3: '#78b8ff', 33: '#bc9bff' };
  function draw() {
    if (!ctx) return;
    const c = visibleConfig, s = sim?.stock || plan?.collision?.stock || previewStock || E.stock(c);
    const p = sim?.position || plan?.collision?.position || { z: c.startZ, r: c.startX / 2 };
    const moves = plan?.ok ? plan.moves : [];
    let maxR = Math.max(c.diameter / 2 + 18, c.startX / 2 + 5), maxZ = Math.max(16, c.startZ + 6), minZ = -c.length - 24;
    const bk=[c.length,c.diameter,c.startX,c.startZ].join(',');
    if(boundsPlan!==plan||boundsKey!==bk||!cachedBounds){for(const m of moves)for(let i=0;i<=8;i++){const a=E.interpolate(m,i/8);maxR=Math.max(maxR,a.r+6);maxZ=Math.max(maxZ,a.z+6);minZ=Math.min(minZ,a.z-8);}cachedBounds={maxR,maxZ,minZ};boundsPlan=plan;boundsKey=bk;}
    ({maxR,maxZ,minZ}=cachedBounds);
    const scale = Math.max(.2, Math.min((width - 95) / (maxZ - minZ), (height - 75) / (2 * maxR)));
    const left = (width - (maxZ - minZ) * scale) / 2, cy = height / 2 + 2;
    const x = z => left + (z - minZ) * scale, y = r => cy - r * scale;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#111a26'; ctx.fillRect(0, 0, width, height);
    ctx.font = '11px Consolas, Microsoft YaHei, monospace'; ctx.textBaseline = 'middle';
    // Engineering grid and true physical Z scale.
    ctx.lineWidth = 1; ctx.strokeStyle = '#1d2b3d'; ctx.beginPath();
    for (let z = Math.ceil(minZ / 10) * 10; z <= maxZ; z += 10) { ctx.moveTo(x(z), 25); ctx.lineTo(x(z), height - 40); }
    for (let r = Math.ceil(-maxR / 10) * 10; r <= maxR; r += 10) { ctx.moveTo(25, y(r)); ctx.lineTo(width - 20, y(r)); }
    ctx.stroke();
    // Original stock remains as a faint reference behind removed material.
    const rawTop = y(c.diameter / 2), rawBottom = y(-c.diameter / 2);
    ctx.fillStyle = '#1b2a39'; ctx.fillRect(x(-c.length), rawTop, c.length * scale, c.diameter * scale);
    ctx.strokeStyle = '#52677d'; ctx.setLineDash([4, 5]); ctx.strokeRect(x(-c.length), rawTop, c.length * scale, c.diameter * scale); ctx.setLineDash([]);
    // Surface of revolution, mirrored below the centerline.
    const gradient = ctx.createLinearGradient(0, rawTop, 0, rawBottom);
    gradient.addColorStop(0, '#bdced9'); gradient.addColorStop(.25, '#7e95a8'); gradient.addColorStop(.48, '#415a71'); gradient.addColorStop(.52, '#3c5369'); gradient.addColorStop(.78, '#8299ac'); gradient.addColorStop(1, '#b0c3d0');
    ctx.fillStyle = gradient; ctx.beginPath();
    ctx.moveTo(x(-c.length), y(s.radii[0]));
    for (let i = 0; i < s.n; i++) ctx.lineTo(x(-c.length + (i + .5) * s.dz), y(s.radii[i]));
    ctx.lineTo(x(0), y(s.radii[s.n - 1])); ctx.lineTo(x(0), y(-s.radii[s.n - 1]));
    for (let i = s.n - 1; i >= 0; i--) ctx.lineTo(x(-c.length + (i + .5) * s.dz), y(-s.radii[i]));
    ctx.lineTo(x(-c.length), y(-s.radii[0])); ctx.closePath(); ctx.fill();
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) { const px = x(-c.length + (i + .5) * s.dz), py = y(sign * s.radii[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.strokeStyle = '#94bdb9'; ctx.lineWidth = 1.1; ctx.stroke();
    }
    // Lathe chuck and clamping zone, not a second camera view.
    const chuckLeft = x(-c.length - 17), chuckRight = x(-c.length + c.grip), chuckR = (c.diameter / 2 + 14) * scale;
    ctx.fillStyle = '#26364a'; ctx.strokeStyle = '#51657a'; ctx.lineWidth = 1;
    ctx.fillRect(chuckLeft, cy - chuckR, chuckRight - chuckLeft, chuckR * 2); ctx.strokeRect(chuckLeft, cy - chuckR, chuckRight - chuckLeft, chuckR * 2);
    ctx.save(); ctx.beginPath(); ctx.rect(x(-c.length), cy - chuckR, c.grip * scale, chuckR * 2); ctx.clip();
    ctx.strokeStyle = '#b58c5145';
    for (let a = -height; a < width + height; a += 10) { ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a + height, height); ctx.stroke(); }
    ctx.restore(); ctx.fillStyle = '#a8b7c8'; ctx.textAlign = 'center'; ctx.fillText('卡盘 / 夹持', (chuckLeft + chuckRight) / 2, cy - chuckR - 11);
    // Centerline and front-face datum.
    ctx.setLineDash([8, 4, 2, 4]); ctx.strokeStyle = '#6b879e'; ctx.beginPath(); ctx.moveTo(25, cy); ctx.lineTo(width - 20, cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#3c536b'; ctx.beginPath(); ctx.moveTo(x(0), 30); ctx.lineTo(x(0), height - 40); ctx.stroke();
    ctx.fillStyle = '#96adc2'; ctx.textAlign = 'center'; ctx.fillText('Z0', x(0), height - 48);
    for (let z = -Math.floor(c.length / 20) * 20; z < 0; z += 20) ctx.fillText(String(z), x(z), height - 48);
    ctx.textAlign = 'right'; ctx.fillText('+Z', width - 22, cy + 14); ctx.textAlign = 'left'; ctx.fillText('+X（直径）', 25, 19);
    // Full programmed path; the active block is emphasized.
    if ($('showPath').checked && moves.length) {
      ctx.save(); ctx.beginPath(); ctx.rect(15, 20, width - 30, height - 55); ctx.clip();
      moves.forEach((m, index) => {
        const active = sim && !sim.done && index === sim.index;
        ctx.strokeStyle = colors[m.mode]; ctx.globalAlpha = active ? .95 : .35; ctx.lineWidth = active ? 2 : 1;
        ctx.setLineDash(m.mode === 0 ? [4, 4] : []); ctx.beginPath();
        const n = m.arc ? 90 : 1;
        for (let j = 0; j <= n; j++) { const pt = E.interpolate(m, j / n); if (!j) ctx.moveTo(x(pt.z), y(pt.r)); else ctx.lineTo(x(pt.z), y(pt.r)); }
        ctx.stroke();
      }); ctx.restore();
    }
    const m = sim && !sim.done ? moves[sim.index] : null;
    const tool=plan?.collision?.tool||m?.tool||(sim?.done?moves[moves.length-1]?.tool:1)||1;
    const shape=E.geometry.model(tool,c),bad=!!plan?.collision;
    function polygon(poly,fill,stroke){ctx.beginPath();poly.forEach((q,i)=>{const xx=x(p.z+q.z),yy=y(p.r+q.r);if(!i)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
    for(const body of shape.bodies)polygon(body,bad?'#723441':'#41546b',bad?'#ff878b':'#8aa0b6');
    polygon(shape.insert,bad?'#cc5266':E.tools[tool].color,bad?'#ffb7bc':'#e5edf5');
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x(p.z),y(p.r),2.5,0,Math.PI*2);ctx.fill();
    ctx.font='12px Microsoft YaHei, sans-serif';ctx.fillStyle=bad?'#ff9da3':E.tools[tool].color;ctx.textAlign='left';
    ctx.fillText('T'+tool+' '+shape.name,x(p.z)+12,Math.max(28,y(p.r)-12));
    if(plan?.collision?.hit?.z!==undefined){const h=plan.collision.hit;const xx=x(h.z),yy=y(h.toolR??p.r);ctx.strokeStyle='#ff737e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xx-7,yy-7);ctx.lineTo(xx+7,yy+7);ctx.moveTo(xx+7,yy-7);ctx.lineTo(xx-7,yy+7);ctx.stroke();}
    // Dimension of the original cylinder; X is never mistaken for radius.
    const dimX = x(0) + 24;
    if (dimX + 43 < width) {
      ctx.strokeStyle = '#607a90'; ctx.beginPath(); ctx.moveTo(dimX, rawTop); ctx.lineTo(dimX, rawBottom); ctx.moveTo(dimX - 4, rawTop); ctx.lineTo(dimX + 4, rawTop); ctx.moveTo(dimX - 4, rawBottom); ctx.lineTo(dimX + 4, rawBottom); ctx.stroke();
      ctx.fillStyle = '#9fb5c7'; ctx.textAlign = 'left'; ctx.fillText('Ø' + c.diameter, dimX + 7, cy - 9);
    }
    if (m?.mode === 33) { ctx.fillStyle = '#c4b0f1'; ctx.textAlign = 'left'; ctx.fillText('G33 同步 · 导程 ' + m.pitch + ' mm/r · 60° 外螺纹', 25, height - 22); }
  }
  function resize() {
    const rect = $('canvasWrap').getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  editor.addEventListener('input', invalidate);
  editor.addEventListener('scroll', () => { $('gutter').scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); invalidate(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); validate(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('exportBtn').click(); }
  });
  keys.forEach(k => $(k).addEventListener('input',()=>{invalidate();drawToolPreview();}));
  $('validateBtn').onclick = validate; $('playBtn').onclick = play; $('stepBtn').onclick = step; $('resetBtn').onclick = reset;
  $('showPath').onchange = draw;
  $('helpBtn').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
  $('loadExample').onclick = () => {
    editor.value = E.examples[$('examples').value]; editor.scrollTop = 0; invalidate();
    $('messages').replaceChildren(); message('', '程序已载入', '按当前刀具尺寸检查程序后播放。');
  };
  $('importBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async () => {
    const file = $('fileInput').files[0]; if (!file) return;
    if (file.size > 400000) { message('error', '文件过大', '请导入小于 400 KB 的 UTF-8 程序文本。'); $('fileInput').value = ''; return; }
    try { editor.value = await file.text(); editor.scrollTop = 0; invalidate(); message('', '已导入', file.name + '；请核对毛坯和刀位设置，再检查程序。'); }
    catch { message('error', '导入失败', '无法读取所选文件。'); }
    $('fileInput').value = '';
  };
  $('exportBtn').onclick = () => download(new Blob(['\uFEFF' + editor.value], { type: 'text/plain;charset=utf-8' }), activeExperiment.exportName||'车削程序.txt');
  $('saveImage').onclick = () => canvas.toBlob(blob => { if (blob) download(blob, activeExperiment.name+'仿真.png'); }, 'image/png');
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) { stopAnimation(); badge('已暂停', 'paused'); $('playBtn').textContent = '继续播放'; } });

  function drawToolPreview(){
    const cv=$('toolPreview'),rect=cv.getBoundingClientRect(),w=Math.max(300,rect.width),h=190,dpr=Math.min(2,devicePixelRatio||1);
    cv.width=w*dpr;cv.height=h*dpr;const q=cv.getContext('2d');q.setTransform(dpr,0,0,dpr,0,0);q.clearRect(0,0,w,h);
    let c;try{c=E.configuration(config());}catch{c=E.defaults;}
    const t=Number($('toolPreviewChoice').value),m=E.geometry.model(t,c),b=m.allBounds;
    const sc=Math.min((w-100)/(b.maxZ-b.minZ+5),(h-40)/(b.maxR+2)),ox=(w-(b.maxZ-b.minZ)*sc)/2-b.minZ*sc,oy=h-22;
    const xx=z=>ox+z*sc,yy=r=>oy-r*sc;
    q.strokeStyle='#34475d';q.setLineDash([4,4]);q.beginPath();q.moveTo(20,oy);q.lineTo(w-20,oy);q.moveTo(xx(0),10);q.lineTo(xx(0),h-5);q.stroke();q.setLineDash([]);
    const poly=(ps,fill)=>{q.beginPath();ps.forEach((p,i)=>{if(!i)q.moveTo(xx(p.z),yy(p.r));else q.lineTo(xx(p.z),yy(p.r));});q.closePath();q.fillStyle=fill;q.fill();q.strokeStyle='#a1b8cd';q.stroke();};
    m.bodies.forEach(p=>poly(p,'#3d526b'));poly(m.insert,E.tools[t].color);
    q.strokeStyle='#f5f8ff';q.lineWidth=1;q.beginPath();q.arc(xx(m.nose.z),yy(m.nose.r),m.nose.radius*sc,0,Math.PI*2);q.stroke();
    q.fillStyle='#fff';q.beginPath();q.arc(xx(0),yy(0),3,0,Math.PI*2);q.fill();q.font='12px Microsoft YaHei, sans-serif';q.fillText('坐标基准',xx(0)+8,oy-4);
    $('toolInfo').textContent=t===3?'刃宽 '+c.t3Width+' mm · S350 r/min · 尖角 '+c.t3Angle+'° · 尖头顶点基准':t===2?'宽 '+c.t2Width+' mm · 刃角 R'+c.t2Nose+' · 径向伸出 '+c.t2Projection+' mm · Z基准：'+m.reference:'刀尖角 '+m.tipAngle+'° · 副偏角 '+m.relief+'° · 刀尖 R'+m.nose.radius+' · 理论刀尖基准';
  }
  $('toolPreviewChoice').onchange=drawToolPreview;
  $('finishBtn').onclick=()=>{if(!plan?.ok)return;stopAnimation();if(!sim)sim=E.simulation(plan);E.advance(sim,plan.duration+1);complete();telemetry();draw();};
  $('generateBtn').onclick=async()=>{
    const btn=$('generateBtn');btn.disabled=true;btn.textContent='正在计算';await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    try{const data=activeExperiment.generate(E,config());E.examples=data.examples;editor.value=data.all;editor.scrollTop=0;invalidate();message('','程序已生成','请检查后播放。');}
    catch(e){message('error','无法生成',e.message);}finally{btn.disabled=false;btn.textContent='按刀具参数生成程序';}
  };
  new ResizeObserver(drawToolPreview).observe($('toolPreview'));

  for(const k of stockKeys)if(activeExperiment.stock[k]!==undefined)$(k).value=activeExperiment.stock[k];
  const expSelect=$('experimentSelect');for(const item of Object.values(experiments)){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;expSelect.appendChild(option);}expSelect.value=activeExperiment.id;
  expSelect.onchange=()=>{clearTimeout(saving);saveState();location.search='?experiment='+encodeURIComponent(expSelect.value);};
  $('sceneTitle').textContent=activeExperiment.name+' · 侧视';$('experimentHelp').textContent=activeExperiment.help;
  if(activeExperiment.drawing){$('drawingLink').href=activeExperiment.drawing;$('drawingLink').hidden=false;}
  let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey));let tools=JSON.parse(localStorage.getItem(toolStorageKey));if(localStorage.getItem('lathe-t2-profile')!=='flat-left-v1'){tools={...(tools||{}),t2Nose:0,t2Reference:2};localStorage.setItem(toolStorageKey,JSON.stringify(tools));localStorage.setItem('lathe-t2-profile','flat-left-v1');}for(const k of keys){if(stockKeys.includes(k)){if(Number.isFinite(saved?.settings?.[k]))$(k).value=saved.settings[k];}else if(Number.isFinite(tools?.[k]))$(k).value=tools[k];}}catch{}
  updatePreview();gutter();telemetry();drawToolPreview();new ResizeObserver(resize).observe($('canvasWrap'));
  $('validateBtn').disabled=$('loadExample').disabled=$('generateBtn').disabled=true;
  $('currentLine').textContent='正在准备实验程序…';
  editor.value=typeof saved?.source==='string'?saved.source:'';gutter();
  window.LatheReady=new Promise(resolve=>requestAnimationFrame(()=>setTimeout(()=>{
    try{const data=activeExperiment.generate(E,config());E.examples=data.examples;for(const [key,label] of Object.entries(activeExperiment.labels)){const option=document.createElement('option');option.value=key;option.textContent=label;$('examples').appendChild(option);}editor.value=typeof saved?.source==='string'?saved.source:data.all;gutter();$('currentLine').textContent='检查程序后播放，或导入自己的.txt程序。';}
    catch(e){message('error','实验程序无法生成',e.message);}
    finally{$('validateBtn').disabled=$('generateBtn').disabled=false;$('loadExample').disabled=!Object.keys(E.examples).length;resolve();}
  },0)));
  // Local QA can inspect state without mutating the validated kernel.
  window.TurningLab = { getState: () => ({ plan, sim, running, experiment:activeExperiment.id }), validate, reset, step };
})();
