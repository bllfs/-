/* Bounded SINUMERIK R arithmetic and backward REPEAT subset. No eval. */
(function(root){
  'use strict';
  class FlowError extends Error {constructor(message,line){super(message);this.line=line;this.code='程序流程错误';}}
  function expand(source){
    let line=0;
    const fail=message=>{throw new FlowError(message,line);};
    if(String(source).length>1500000||String(source).split(/\r?\n/).length>16000)fail('最多支持16000行、1500000个字符。');
    const vars=new Map(),labels=new Map(),loops=new Map(),out=[];
    function expression(s){
      let pos=0,depth=0;
      const ws=()=>{while(/\s/.test(s[pos]||'')&&pos<s.length)pos++;};
      const value=v=>{if(!Number.isFinite(v)||Math.abs(v)>1e9)fail('表达式结果无效或超出±10^9。');return v;};
      function atom(){
        ws();if(++depth>40)fail('表达式嵌套过深。');let v;
        if(s[pos]==='+'||s[pos]==='-'){const sign=s[pos++];v=(sign==='-'?-1:1)*atom();}
        else if(s[pos]==='('){pos++;v=sum();ws();if(s[pos++]!==')')fail('表达式括号不匹配。');}
        else {
          const tail=s.slice(pos),num=/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/.exec(tail),reg=/^R(\d+)(?![\w])/.exec(tail),fn=/^(SQRT|MAXVAL|MINVAL|ABS|TRUNC)\s*\(/.exec(tail);
          if(num){pos+=num[0].length;v=Number(num[0]);}
          else if(reg){pos+=reg[0].length;const key=Number(reg[1]);if(!vars.has(key))fail('R'+key+'尚未赋值。');v=vars.get(key);}
          else if(fn){pos+=fn[0].length;const a=sum();ws();let b;
            if(['MAXVAL','MINVAL'].includes(fn[1])){if(s[pos++]!==',')fail(fn[1]+'需要两个参数。');b=sum();ws();}
            if(s[pos++]!==')')fail('函数参数或括号无效。');
            v=fn[1]==='SQRT'?Math.sqrt(a):fn[1]==='ABS'?Math.abs(a):fn[1]==='TRUNC'?Math.trunc(a):fn[1]==='MAXVAL'?Math.max(a,b):Math.min(a,b);
          }else fail('无法识别表达式：'+tail.slice(0,24));
        }
        depth--;return value(v);
      }
      function product(){let v=atom();ws();while(s[pos]==='*'||s[pos]==='/'){const op=s[pos++],b=atom();if(op==='/'&&b===0)fail('表达式除数不能为0。');v=value(op==='*'?v*b:v/b);ws();}return v;}
      function sum(){let v=product();ws();while(s[pos]==='+'||s[pos]==='-'){const op=s[pos++],b=product();v=value(op==='+'?v+b:v-b);ws();}return v;}
      const v=sum();ws();if(pos!==s.length)fail('表达式含不支持的内容：'+s.slice(pos, pos+24));return v;
    }
    const rows=String(source).split(/\r?\n/).map((raw,i)=>{
      line=i+1;let s=raw.replace(/^\uFEFF/,'').split(';')[0].trim().toUpperCase();
      // Existing numeric blocks keep their original parenthesized-comment syntax.
      if(!/\bR\d+\s*=|\bREPEAT\b|\b(?:X|Z|F|S|CR|K)\s*=/.test(s)&&!/:/.test(s))return {text:s,line};
      s=s.replace(/^N\d+\s+/,'');
      const label=/^([A-Z][A-Z0-9_]{0,31}):\s*/.exec(s);
      if(label){if(labels.has(label[1]))fail('重复的标记：'+label[1]);labels.set(label[1],i);s=s.slice(label[0].length);}
      return {text:s,line};
    });
    const ranges=[];
    for(let pc=0;pc<rows.length;pc++){
      line=rows[pc].line;const s=rows[pc].text;
      if(/^REPEAT\b/.test(s)){
        const a=/^REPEAT\s+([A-Z][A-Z0-9_]{0,31})\s+P\s*=\s*(\d+)$/.exec(s);
        if(!a)fail('重复段须写为 REPEAT 标记 P=有限次数。');
        const start=labels.get(a[1]),count=Number(a[2]);
        if(start===undefined||start>=pc)fail('REPEAT 必须引用前方存在的标记。');
        if(count<1||count>10000)fail('P重复次数须为1–10000的整数。');
        if(ranges.some(([a,b])=>start<=b&&pc>=a))fail('此演示不支持交叠或嵌套的重复段。');
        ranges.push([start,pc]);loops.set(pc,{start,count,left:count});
      }
    }
    let steps=0,ended=false;
    for(let pc=0;pc<rows.length;pc++){
      const row=rows[pc];line=row.line;const s=row.text;if(!s||s==='%')continue;
      if(ended)fail('M30/M02后仍有程序内容。');
      if(++steps>100000)fail('流程执行超过100000步，拒绝运行。');
      const loop=loops.get(pc);
      if(loop){if(loop.left>0){loop.left--;pc=loop.start-1;}continue;}
      const assign=/^R(\d+)\s*=\s*(.+)$/.exec(s.replace(/^N\d+\s+/,''));
      if(assign){const key=Number(assign[1]);if(key>999)fail('此演示只支持R0–R999。');vars.set(key,expression(assign[2]));continue;}
      let expanded=s;
      if(/\b(?:X|Z|F|S|CR|K)\s*=/.test(s)){
        // Expressions are separated from the next address by whitespace.
        expanded=s.replace(/\b(CR|X|Z|F|S|K)\s*=\s*(.*?)(?=\s+(?:[A-Z]+\s*(?:=|[+\-\d.]|$))|$)/g,(_,word,expr)=>word+expression(expr).toFixed(9).replace(/\.?0+$/,''));
      }
      if(/\bR\d+\b|\bREPEAT\b|:/.test(expanded))fail('不支持此变量或流程语法。');
      out.push({text:expanded,line});if(out.length>16000)fail('展开后超过16000个程序段，拒绝运行。');
      if(/\bM0?(?:2|30)(?!\d)/.test(expanded.replace(/\([^)]*\)/g,'')))ended=true;
    }
    return out;
  }
  const api={expand};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LatheProgramFlow=api;
})(typeof globalThis!=='undefined'?globalThis:this);
