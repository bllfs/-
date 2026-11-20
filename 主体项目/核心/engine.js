/* Offline educational turning kernel. Units: mm, min; X words are diameters. */
(function (root) {
  'use strict';
  const G = typeof module !== 'undefined' && module.exports ? require('../刀具/tool-model.js') : root.ToolGeometry;
  const Flow = typeof module !== 'undefined' && module.exports ? require('./program-flow.js') : root.LatheProgramFlow;
  const EPS = 1e-7, STEP = 0.025, MAX_SAMPLES = 1800000;
  const defaults = { ...G.defaults, minX: -5, diameter: 30, length: 100, grip: 12, startX: 46, startZ: 10,
    maxX: 180, minZ: -180, maxZ: 80, resolution: 0.04, toolWidth: 0.01,
    threadMinS: 350, threadMaxS: 350, threadDepth: 0.6 };
  const tools=G.processLimits, toolConfig=G.getProcessLimits;
  const gCodes = new Set([0, 1, 2, 3, 18, 33, 71, 710, 90, 91, 94, 95, 97]);
  const mCodes = new Set([2, 3, 4, 5, 30]);
  class NCError extends Error { constructor(message, code = '程序错误') { super(message); this.code = code; } }
  function fail(message, code) { throw new NCError(message, code); }
  function configuration(input = {}) {
    const c = { ...defaults, ...input };
    for (const key of Object.keys(defaults)) if (!Number.isFinite(c[key])) fail('参数必须为有限数值：' + key, '设置错误');
    if (c.diameter < 5 || c.diameter > 120) fail('毛坯直径必须在 5–120 mm。', '设置错误');
    if (c.length < 10 || c.length > 150) fail('毛坯长度必须在 10–150 mm。', '设置错误');
    if (c.grip < 5 || c.grip >= c.length - 5) fail('夹持长度至少 5 mm，并且必须比毛坯长度小 5 mm 以上。', '设置错误');
    if (c.resolution < .01 || c.resolution > .5 || c.toolWidth < .005 || c.toolWidth > 2) fail('离散精度或刀宽超出支持范围。', '设置错误');
    if (c.maxX < c.diameter + 10 || c.maxX > 500 || c.minZ > -c.length - 20 || c.minZ < -1000 || c.maxZ < 10 || c.maxZ > 1000) fail('演示行程范围无效。', '设置错误');
    if (c.startX < 0 || c.startX > c.maxX || c.startZ < c.minZ || c.startZ > c.maxZ) fail('初始刀位超出演示行程。', '设置错误');
    if (c.threadMinS < 1 || c.threadMaxS > 6000 || c.threadMinS > c.threadMaxS || c.threadDepth <= 0 || c.threadDepth > 5) fail('3 号螺纹刀参数无效：核对转速上下限与单刀直径切深。', '设置错误');
    try { G.validate(c); } catch(e) { fail(e.message, "刀具设置错误"); }
    return c;
  }
  function stock(c) {
    const n = Math.ceil(c.length / c.resolution);
    return { radii: new Float64Array(n).fill(c.diameter / 2), n, dz: c.length / n, length: c.length, initial: c.diameter / 2 };
  }
  function stripComments(raw) {
    let out = '', depth = 0;
    for (const ch of raw) {
      if (ch === ';' && depth === 0) break;
      if (ch === '(') { if (depth) fail('不支持嵌套括号注释。', '语法错误'); depth++; continue; }
      if (ch === ')') { if (!depth) fail('注释括号不匹配。', '语法错误'); depth--; continue; }
      if (!depth) out += ch;
    }
    if (depth) fail('注释缺少右括号。', '语法错误');
    return out.trim().toUpperCase();
  }
  function tokenize(raw) {
    let s = stripComments(raw);
    if (!s || s === '%') return [];
    const result = [];
    while (s.length) {
      s = s.trimStart(); if (!s) break;
      const mode = /^(DIAMON|DIAMOF|DIAM90)(?![A-Z])/.exec(s);
      if (mode) { result.push({ word: mode[1], value: null }); s = s.slice(mode[0].length); continue; }
      const token = /^([A-Z]+)\s*(?:=\s*)?([+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(s);
      if (!token) fail('无法识别“' + s.slice(0, 24) + '”。使用英文字符和数值；支持数值指令及有限R参数/REPEAT子集。', '语法错误');
      const value = Number(token[2]);
      if (!Number.isFinite(value)) fail('数值不是有限数。', '语法错误');
      result.push({ word: token[1], value }); s = s.slice(token[0].length);
    }
    return result;
  }
  function groups(tokens) {
    const words = {}, gs = [], ms = [];
    for (const t of tokens) {
      if (t.word === 'G' || t.word === 'M') {
        if (!Number.isInteger(t.value)) fail('G/M 指令号必须是整数。', '语法错误');
        (t.word === 'G' ? gs : ms).push(t.value); continue;
      }
      if (!['N', 'X', 'Z', 'F', 'S', 'T', 'D', 'CR', 'K', 'DIAMON', 'DIAMOF', 'DIAM90'].includes(t.word))
        fail('不支持地址 ' + t.word + '。圆弧请用 CR=半径；螺纹请用 K 导程。', '不支持的指令');
      if (Object.hasOwn(words, t.word)) fail('同一行重复出现 ' + t.word + '。', '语法错误');
      words[t.word] = t.value;
    }
    if (Object.hasOwn(words, 'N') && (!Number.isInteger(words.N) || words.N < 0)) fail('N 段号必须为非负整数。', '语法错误');
    for (const g of gs) if (!gCodes.has(g)) fail('不支持 G' + g + '，本工具不会忽略该指令。', '不支持的指令');
    for (const m of ms) if (!mCodes.has(m)) fail('不支持 M' + m + '。', '不支持的指令');
    for (const family of [[0, 1, 2, 3, 33], [90, 91], [94, 95, 97], [71, 710]])
      if (gs.filter(g => family.includes(g)).length > 1) fail('同一行含冲突的同组 G 指令。', '模态冲突');
    if (gs.length !== new Set(gs).size || ms.length !== new Set(ms).size) fail('同一行重复 G/M 指令。', '语法错误');
    if (ms.filter(m => [3, 4, 5].includes(m)).length > 1 || ms.filter(m => [2, 30].includes(m)).length > 1) fail('同一行含冲突的 M 指令。', '模态冲突');
    if (Object.hasOwn(words, 'DIAMOF') || Object.hasOwn(words, 'DIAM90')) fail('仅支持 DIAMON 直径编程；半径或混合编程被拒绝。', '编程方式错误');
    return { words, gs, ms };
  }
  const mod = (x, p) => ((x % p) + p) % p;
  function phaseDistance(z, origin, pitch) { const t = mod(z - origin + pitch / 2, pitch); return Math.abs(t - pitch / 2); }
  function indices(s, z, width) {
    if (z + width / 2 < -s.length || z - width / 2 > 0) return [1, 0];
    const a = Math.max(0, Math.floor((z - width / 2 + s.length) / s.dz));
    const b = Math.min(s.n - 1, Math.floor((z + width / 2 + s.length) / s.dz));
    return [a, b];
  }
  function collides(s, p, c, width = c.toolWidth) {
    const [a, b] = indices(s, p.z, width);
    for (let i = a; i <= b; i++) if (p.r < s.radii[i] - EPS && s.radii[i] > EPS) return true;
    return false;
  }
  function protectedZone(p, c, width = c.toolWidth) {
    return p.z - width / 2 <= -c.length + c.grip && p.r <= c.diameter / 2 + 14;
  }
  function applyCut(s, p, move, c) {
    const [a, b] = indices(s, p.z, move.width || c.toolWidth);
    for (let i = a; i <= b; i++) {
      const z = -s.length + (i + .5) * s.dz;
      const r = move.mode === 33 ? p.r + (1/Math.tan(c.t3Angle*Math.PI/360)) * phaseDistance(z, move.start.z, move.pitch) : p.r;
      s.radii[i] = Math.max(0, Math.min(s.radii[i], r));
    }
  }
  function sweepAngle(a, b, clockwise) {
    let d = mod(b - a, 2 * Math.PI);
    if (clockwise) d = d < EPS ? -2 * Math.PI : d - 2 * Math.PI;
    else if (d < EPS) d = 2 * Math.PI;
    return d;
  }
  function arc(start, end, radiusWord, clockwise) {
    const dx = end.z - start.z, dy = end.r - start.r, chord = Math.hypot(dx, dy), radius = Math.abs(radiusWord);
    if (radius < .01) fail('CR 圆弧半径必须至少为 0.01 mm。', '圆弧错误');
    if (chord < EPS) fail('CR 方式不能定义整圆；请拆成两段圆弧。', '圆弧错误');
    if (chord > 2 * radius + EPS) fail('圆弧无法成立：端点距离大于直径 2×|CR|。X 坐标已按直径换算。', '圆弧错误');
    const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    for (const sign of [1, -1]) {
      const cz = (start.z + end.z) / 2 - sign * dy * h / chord;
      const cr = (start.r + end.r) / 2 + sign * dx * h / chord;
      const a = Math.atan2(start.r - cr, start.z - cz), b = Math.atan2(end.r - cr, end.z - cz);
      const sweep = sweepAngle(a, b, clockwise);
      if ((radiusWord > 0 && Math.abs(sweep) <= Math.PI + EPS) || (radiusWord < 0 && Math.abs(sweep) >= Math.PI - EPS))
        return { cz, cr, radius, a, sweep, length: radius * Math.abs(sweep) };
    }
    fail('无法求解圆弧。', '圆弧错误');
  }
  function interpolate(move, t) {
    if (move.arc) { const a = move.arc.a + move.arc.sweep * t; return { z: move.arc.cz + move.arc.radius * Math.cos(a), r: move.arc.cr + move.arc.radius * Math.sin(a) }; }
    return { z: move.start.z + (move.end.z - move.start.z) * t, r: move.start.r + (move.end.r - move.start.r) * t };
  }
  function volume(s) { let v = 0; for (const r of s.radii) v += Math.PI * r * r * s.dz; return v; }
  function compile(source, input = {}) {
    const errors = [], warnings = [], moves = [], blocks = [], threads = [];
    let c;
    try { c = configuration(input); } catch (e) { return { ok: false, errors: [{ line: 0, code: e.code, message: e.message }], warnings, moves: [] }; }
    const material = stock(c);
    const state = { metric: false, mode: null, absolute: true, feedMode: 95, feed: null, rpm: null, spindle: 0, tool: null, ended: false, z: c.startZ, r: c.startX / 2 };
    let expanded;
    try { expanded=Flow.expand(source); } catch(e) { return {ok:false,errors:[{line:e.line||0,code:e.code||'程序流程错误',message:e.message}],warnings,moves:[]}; }
    const lines = expanded.map(b=>b.text);
    if (String(source).split(/\r?\n/).length > 16000 || String(source).length > 1500000) return { ok: false, errors: [{ line: 0, code: '程序过大', message: '最多支持16000行、1500000个字符。' }], warnings, moves: [] };
    if (protectedZone({ z: state.z, r: state.r }, c) || collides(material, state, c))
      return { ok: false, errors: [{ line: 0, code: '初始刀位碰撞', message: '初始刀位接触毛坯或夹持区；请调整初始 X/Z。' }], warnings, moves: [] };
    let totalSamples = 0, totalTime = 0, stoppedAt = -1, collisionScene = null, radialStroke = null;
    for (let row = 0; row < lines.length; row++) {
      const line = expanded[row].line;
      try {
        const tokens = tokenize(lines[row]); if (!tokens.length) continue;
        if (state.ended) fail('M30/M02 后仍有程序内容；请删除或移到结束指令之前。', '结束位置错误');
        const { words: w, gs, ms } = groups(tokens);
        const has = k => Object.hasOwn(w, k);
        if (gs.includes(710)) state.metric = true;
        if (gs.includes(90)) state.absolute = true;
        if (gs.includes(91)) fail('此演示只接受 G90 绝对坐标；请把 G91 程序改为绝对坐标。', '编程方式错误');
        if (gs.includes(94)) state.feedMode = 94;
        if (gs.includes(95)) state.feedMode = 95;
        const motion = gs.find(g => [0, 1, 2, 3, 33].includes(g));
        if (motion !== undefined) state.mode = motion;
        if (has('S')) { if (w.S < 1 || w.S > 6000) fail('S 转速必须在 1–6000 r/min。', '转速错误'); state.rpm = w.S; }
        if (has('F')) { if (w.F <= 0) fail('F 进给量必须大于 0。', '进给错误'); state.feed = w.F; }
        if (has('D') && w.D !== 1) fail('只支持 D1 刀刃号；本演示不使用真实刀具偏置。', '刀刃号错误');
        if (has('T')) {
          if (!Object.hasOwn(tools, w.T)) fail('刀号只支持 T1、T2、T3、T4；请使用 T1 D1 这类写法。', '刀号错误');
          if (state.spindle) fail('换刀前必须 M05 停止主轴。', '不安全换刀');
          if (state.r * 2 < c.diameter + 4 || state.z < 2) fail('换刀前请退到安全刀位：X ≥ 毛坯直径+4，且 Z ≥ 2。', '不安全换刀');
          if (has('X') || has('Z')) fail('T 换刀不能与坐标运动写在同一行。', '不安全换刀');
          state.tool = w.T;
        } else if (has('D') && !state.tool) fail('请先用 T1–T4 选择刀具。', '缺少刀具');
        if (ms.includes(3)) state.spindle = 3;
        if (ms.includes(4)) state.spindle = 4;
        if (ms.includes(5)) state.spindle = 0;
        const finish = ms.some(m => [2, 30].includes(m));
        const hasPosition = has('X') || has('Z');
        if (finish && hasPosition) fail('结束指令请单独写在一行，不与坐标运动混用。', '结束位置错误');
        if (has('CR') && ![2, 3].includes(state.mode)) fail('CR 只能用于 G02/G03 圆弧。', '参数错误');
        if (has('K') && state.mode !== 33) fail('K 在本工具中仅用于 G33 导程。', '参数错误');
        if (!hasPosition && (has('CR') || has('K'))) fail('圆弧或螺纹参数缺少终点坐标。', '参数错误');
        if (hasPosition) {
          if (!state.metric) fail('运动前请用 G710 明确几何尺寸与F为公制。', '缺少公制设置');
          if (state.mode === null) fail('首次坐标运动必须指定 G00/G01/G02/G03/G33。', '缺少运动指令');
          const start = { z: state.z, r: state.r }, end = { z: has('Z') ? w.Z : state.z, r: has('X') ? w.X / 2 : state.r };
          if (end.r * 2 < c.minX || end.r * 2 > c.maxX || end.z < c.minZ || end.z > c.maxZ) fail('终点超出演示行程：X ' + c.minX + '…' + c.maxX + '，Z ' + c.minZ + '…' + c.maxZ + ' mm。', '行程越界');
          const tool = toolConfig(state.tool, c);
          const move = { line, text: lines[row].trim(), mode: state.mode, start, end, pitch: null, rpm: state.rpm, feedMode: state.feedMode, feed: state.feed, arc: null, spindle: state.spindle, tool: state.tool, width: tool?.width || c.toolWidth };
          let length = Math.hypot(end.z - start.z, end.r - start.r);
          if ([2, 3].includes(state.mode)) {
            if (!has('CR')) fail('本工具的圆弧每一段均须指定 CR=半径。', '圆弧错误');
            move.arc = arc(start, end, w.CR, state.mode === 2); length = move.arc.length;
          }
          if (state.mode !== 0) {
            if (!tool) fail('切削前必须用 T1/T2/T3/T4 选择刀具。', '缺少刀具');
            if (!state.spindle || !state.rpm) fail('切削前必须设置 S 转速并执行 M03/M04 启动主轴。', '主轴未启动');
            if (state.rpm < tool.minS || state.rpm > tool.maxS) fail('T' + state.tool + ' ' + tool.name + '要求 S' + tool.minS + '–' + tool.maxS + ' r/min。', '刀具转速不符');
            if (state.mode === 33 && state.tool !== 3) fail('G33 螺纹切削必须使用 T3 螺纹刀。', '刀具用途不符');
            if (state.mode !== 33 && state.tool === 3) fail('T3 螺纹刀仅支持 G33；外圆用 T1/T4，切槽用 T2。', '刀具用途不符');
            if (state.mode === 33) {
              if (!has('K') || w.K < .1 || w.K > 20) fail('G33 每段必须指定 K 导程（0.1–20 mm/r）。', '螺纹参数错误');
              if (Math.abs(end.r - start.r) > EPS) fail('G33 仅支持等直径外螺纹；请先用 G00 在工件前方定位 X，再沿 Z 车螺纹。', '不支持的螺纹');
              if (end.z >= start.z - EPS) fail('G33 仅支持沿 Z 负向的外螺纹。', '不支持的螺纹');
              if (start.z < w.K) fail('G33 起点应在端面前方至少一个导程（起点 Z ≥ K），为同步预留空行程。', '螺纹引入不足');
              if (end.z > -w.K || end.z <= -c.length + c.grip + c.toolWidth) fail('G33 终点应进入工件，并避开夹持区。', '螺纹终点错误');
              if (start.r >= c.diameter / 2) fail('螺纹刀位未进入毛坯外径，请先设置正确的切削直径。', '螺纹空切');
              move.pitch = w.K; move.rate = w.K * state.rpm;
              const phase = mod(start.z, w.K);
              for (const t of threads) if (end.z < t.startZ && start.z > t.endZ && (Math.abs(t.pitch - w.K) > .0001 || Math.min(mod(phase - t.phase, w.K), mod(t.phase - phase, w.K)) > .01))
                fail('与已有螺纹导程或起始相位不一致，会造成乱牙；请使用相同 K 和相同起点 Z。', '螺纹相位冲突');
              if (state.rpm > 1200) warnings.push({ line, code: '螺纹转速提示', message: 'G33 使用较高转速；本工具不模拟主轴加减速和退刀同步。' });
              threads.push({ pitch: w.K, phase, startZ: start.z, endZ: end.z });
            } else {
              if (!state.feed) fail('G01/G02/G03 首次切削前须指定 F 进给。', '缺少进给');
              if (state.feedMode === 95 && state.feed > 2) fail('演示限制：G95 的 F 不得超过 2 mm/r，请检查进给单位。', '进给超限');
              move.rate = state.feedMode === 95 ? state.feed * state.rpm : state.feed;
              if (move.rate / state.rpm > tool.maxF + EPS) fail('T' + state.tool + ' 每转进给不得超过 ' + tool.maxF + ' mm/r（G94 也会换算检查）。', '刀具进给超限');
            }
            if (move.rate > 3000) fail('切削速度超过本演示的 3000 mm/min 上限，请检查 F、S 或 K。', '进给超限');
          } else move.rate = 6000;
          if (length < EPS) { continue; }
          const samples = Math.max(1, Math.ceil(length / STEP), move.arc ? Math.ceil(Math.abs(move.arc.sweep) / .03) : 0);
          totalSamples += samples;
          if (totalSamples > MAX_SAMPLES) fail('总轨迹过长，超过演示计算上限；请减少重复段。', '计算上限');
          const previous = moves[moves.length - 1];
          // A thread is displayed in a fixed axial section. Its stationary crest is
          // not the rotating contact at the tip. Permit a full radial withdrawal
          // from a completed G33 only; all other rapid travel is checked normally.
          const threadRetract = state.mode === 0 && previous?.mode === 33 && Math.abs(end.z - start.z) < EPS && end.r > c.diameter / 2 + .5;
          const radialIn = state.tool === 2 && state.mode === 1 && Math.abs(end.z-start.z)<EPS && end.r<start.r-EPS;
          if (radialIn && (!radialStroke || Math.abs(radialStroke.z-start.z)>EPS)) radialStroke={z:start.z,before:new Float64Array(material.radii)};
          const before = radialIn ? radialStroke.before : new Float64Array(material.radii);
          if (end.r>start.r+.005 || Math.abs(end.z-start.z)>.0001 || state.tool!==2) radialStroke=null;
          const geometry=G.model(state.tool||1,c);
          let contact = false, maxDepth = 0;
          for (let j = 0; j <= samples; j++) {
            const p = interpolate(move, j / samples);
            if (p.r*2<c.minX-EPS || p.r*2>c.maxX+EPS || p.z<c.minZ-EPS || p.z>c.maxZ+EPS) fail('运动轨迹超出演示行程。','轨迹越界');
            const saveCollision=(kind,hit)=>{collisionScene={kind,position:{...p},tool:state.tool||1,hit,stock:{...material,radii:Array.from(material.radii)}};};
            if(G.chuckCollision(p,geometry,c)){saveCollision('卡盘',null);fail('刀片或刀杆进入卡盘/夹持保护区。','夹持区碰撞');}
            const body=G.bodyCollision(material,p,geometry,c);
            if(body){saveCollision(body.part,body);fail('T'+state.tool+' '+body.part+'与剩余材料干涉，Z≈'+body.z.toFixed(3)+'。','刀杆碰撞');}
            const hit=G.insertCollision(material,p,geometry,c),hits=!!hit;
            if(state.mode===0&&hits&&!threadRetract){saveCollision('刀片',hit);fail('G00运动中的刀片轮廓穿入剩余材料。','G00碰料');}
            if(state.mode!==0){
              const regionError=c.experiment?.validateCut?.(state.tool,p,move,c,geometry);
              if(regionError){saveCollision('加工区域',hit);fail(regionError,'刀具区域限制');}
              if(state.tool===2 && !c.t2SideCut && Math.abs(end.z-start.z)>EPS && hits)fail('当前槽刀未允许侧刃修形，材料内仅可径向进刀。','槽刀侧刃受限');
              if(state.mode===33){
                const [ia,ib]=indices(material,p.z,.18),slope=1/Math.tan(c.t3Angle*Math.PI/360);
                for(let ii=ia;ii<=ib;ii++){const zz=-material.length+(ii+.5)*material.dz;maxDepth=Math.max(maxDepth,2*(before[ii]-p.r-slope*phaseDistance(zz,move.start.z,move.pitch)));}
                if(maxDepth>tool.maxDepth+.000001)fail('T3螺纹单刀直径切入量超过2ap限制。','吃刀量超限');
                applyCut(material,p,move,c);contact ||= hits;
              }
              else {
                const result=G.cut(material,p,geometry,c,move,before); contact ||= result.removed>0;
                if(state.tool===2 && !c.t2SideCut && Math.abs(end.z-start.z)>EPS && result.removed>0)fail('当前槽刀未允许侧刃修形，材料内仅可径向进刀。','槽刀侧刃受限');
                if(result.overcut){saveCollision('目标轮廓',result.overcut);fail('刀片切入目标轮廓，Z≈'+result.overcut.z.toFixed(3)+'，过切≈'+result.overcut.amount.toFixed(3)+' mm。','刀具轮廓干涉');}
                maxDepth=Math.max(maxDepth,result.depth);
                if(Number.isFinite(tool.maxDepth)&&maxDepth>tool.maxDepth+.000001)fail('T'+state.tool+'实际直径切入量约'+maxDepth.toFixed(3)+' mm，超过2ap≤'+tool.maxDepth+' mm。径向连续进刀不会因分行而重置。','吃刀量超限');
              }
            }
          }
          if (state.mode !== 0 && !contact) warnings.push({ line, code: '空切提示', message: '此切削段未接触剩余材料。' });
          move.samples = samples; move.length = length; move.depth = maxDepth; move.duration = length / move.rate * 60;
          move.startTime = totalTime; totalTime += move.duration; move.endTime = totalTime;
          moves.push(move); state.z = end.z; state.r = end.r;
        }
        if (finish) { state.ended = true; stoppedAt = line; }
        blocks.push({ line, spindle: state.spindle, rpm: state.rpm, tool: state.tool, motionCount: moves.length });
      } catch (e) {
        errors.push({ line, code: e.code || '程序错误', message: e.message });
        break; // Never validate later blocks from a partially applied invalid block.
      }
    }
    if (!errors.length && !state.ended) errors.push({ line: String(source).split(/\r?\n/).length, code: '缺少程序结束', message: '程序末尾必须有 M30 或 M02。' });
    if (!errors.length && !moves.length) errors.push({ line: 0, code: '空程序', message: '没有可演示的运动指令。' });
    if (!errors.length && (state.r < c.diameter / 2 + 1 || state.z < 1)) warnings.push({ line: stoppedAt, code: '退刀提示', message: '程序结束前建议退至 X 大于毛坯直径且 Z 大于端面的安全位置。' });
    if (!errors.length && state.spindle) warnings.push({ line: stoppedAt, code: '主轴结束提示', message: '本演示把 M30/M02 作为结束；建议显式写 M05 停止主轴。' });
    const airCount = warnings.filter(w => w.code === '空切提示').length;
    if (airCount > 3) {
      for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].code === '空切提示') warnings.splice(i, 1);
      warnings.push({ line: 0, code: '空切汇总', message: '分层轮廓中有 ' + airCount + ' 段沿已加工表面或在材料外移动，可播放观察。' });
    }
    if (warnings.length > 150) warnings.splice(150, warnings.length - 150, { line: 0, code: '提示截断', message: '其余提示已省略。' });
    return { ok: !errors.length, errors, warnings, moves: errors.length ? [] : moves, blocks, config: c,
      duration: totalTime, initialVolume: Math.PI * (c.diameter / 2) ** 2 * c.length,
      collision: collisionScene, finalStock: errors.length ? null : material, remainingVolume: volume(material), source: String(source) };
  }
  function simulation(plan) {
    if (!plan.ok) fail('程序未通过检查，禁止启动仿真。');
    const s = stock(plan.config);
    return { stock: s, index: 0, t: 0, elapsed: 0, done: false, position: { z: plan.config.startZ, r: plan.config.startX / 2 }, plan };
  }
  function advance(sim, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) fail('仿真时间步长无效。');
    const plan = sim.plan;
    let remaining = seconds;
    while (sim.index < plan.moves.length && remaining > 0) {
      const m = plan.moves[sim.index];
      const dt = Math.min(remaining, m.duration * (1 - sim.t)), next = Math.min(1, sim.t + dt / m.duration);
      const steps = Math.max(1, Math.ceil((next - sim.t) * m.samples));
      for (let j = 0; j <= steps; j++) {
        const t = sim.t + (next - sim.t) * j / steps, p = interpolate(m, t);
        if (m.mode === 33) applyCut(sim.stock,p,m,plan.config);
        else if(m.mode!==0) G.cut(sim.stock,p,G.model(m.tool,plan.config),plan.config,m);
      }
      sim.t = next; sim.position = interpolate(m, next); sim.elapsed += dt; remaining -= dt;
      if (next >= 1 - 1e-10) { sim.index++; sim.t = 0; }
      else break;
    }
    if (sim.index >= plan.moves.length) { sim.done = true; sim.elapsed = plan.duration; }
    return sim;
  }
  const examples={};
  const api = { geometry:G, defaults, tools, toolConfig, configuration, stock, compile, simulation, advance, interpolate, volume, examples, arc, phaseDistance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Turning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
