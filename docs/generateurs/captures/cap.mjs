// node cap.mjs shots.json [prefix]
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const shots = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const only = process.argv[3];
const BG = fs.readFileSync('bg.jpg');
const b = await puppeteer.launch({executablePath:await chromium.executablePath(), args:[...chromium.args,'--lang=fr-FR'], headless:true});
const FIND = `window.__lxFind=function(text,opt){opt=opt||{};var w=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT),best=null;while(w.nextNode()){var n=w.currentNode;if(opt.within&&!opt.within.contains(n))continue;var r=n.getBoundingClientRect();if(!r.width||!r.height)continue;var st=getComputedStyle(n);if(st.visibility==='hidden'||st.display==='none'||st.opacity==='0')continue;var t=(n.innerText||'').trim();if(!t)continue;var ok=opt.exact?t===text:t.indexOf(text)>=0;if(ok){var a=r.width*r.height;if(!best||a<best.a)best={n:n,a:a};}}var el=best&&best.n;if(el&&opt.up){for(var i=0;i<opt.up&&el.parentElement;i++)el=el.parentElement;}return el;};`;
const out = fs.existsSync('boxes.json')?JSON.parse(fs.readFileSync('boxes.json','utf8')):{};
for (const s of shots) {
  if (only && !s.id.startsWith(only)) continue;
  const pg = await b.newPage();
  const W=s.w||820, H=s.h||1000;
  await pg.setViewport(s.vp==='mobile'?{width:390,height:s.h||844,deviceScaleFactor:2,isMobile:true,hasTouch:true}:{width:W,height:H,deviceScaleFactor:2});
  await pg.setRequestInterception(true);
  pg.on('request', r => { const u=r.url(); if (u.includes('images.unsplash.com')) return r.respond({status:200,contentType:'image/jpeg',body:BG}); if (u.startsWith('http://localhost')||u.startsWith('data:')||u.startsWith('blob:')) return r.continue(); return r.abort(); });
  pg.on('pageerror', e => console.log(s.id,'ERR', e.message.slice(0,140)));
  pg.on('dialog', d => d.dismiss());
  await pg.goto('http://localhost:8765/app.html?'+(s.q||'demo=coiffure'), {waitUntil:'domcontentloaded', timeout:60000});
  await pg.waitForFunction(()=>window.CURRENT_OPERATOR && document.querySelector('#app'), {timeout:30000});
  await new Promise(r=>setTimeout(r,2500));
  await pg.evaluate(FIND+`[...document.body.children].forEach(function(e){if(/DÉMO Luxyra/.test(e.innerText||'')&&getComputedStyle(e).position==='fixed')e.style.display='none';});`);
  for (const st of (s.steps||[])) {
    try {
      if (st.js) await pg.evaluate(new Function('return (async()=>{'+st.js+'})()'));
      if (st.click) { const ok = await pg.evaluate((t,o)=>{const e=window.__lxFind(t,o||{});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true;}, st.click, st.o||{}); if(!ok) console.log(s.id,'CLICK?',st.click); }
      if (st.type) { await pg.evaluate((sel,v)=>{const e=document.querySelector(sel);e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}, st.type, st.v); }
    } catch(e) { console.log(s.id,'STEPERR',e.message.slice(0,200)); }
    await new Promise(r=>setTimeout(r,st.wait||700));
  }
  await new Promise(r=>setTimeout(r,s.wait||900));
  if (s.scroll) await pg.evaluate((t)=>{const e=typeof t==='string'&&t[0]!=='#'?window.__lxFind(t):document.querySelector(t);if(e)e.scrollIntoView({block:'start'});window.scrollBy(0,-90);}, s.scroll);
  if (s.scrollY!=null) await pg.evaluate((y)=>{(document.scrollingElement||document.body).scrollTop=y; const m=document.querySelector('.mbox'); if(m&&m.scrollHeight>m.clientHeight) m.scrollTop=y;}, s.scrollY);
  await new Promise(r=>setTimeout(r,400));
  const res = await pg.evaluate((ann,clip)=>{
    function box(a){ let el=null; if(a.sel) el=document.querySelector(a.sel); if(!el&&a.text) el=window.__lxFind(a.text,{up:a.up||0,exact:!!a.exact}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }
    let c=null; if(clip&&clip.from){ const e=window.__lxFind(clip.from,{}); const ap=document.querySelector(clip.box||'#app').getBoundingClientRect(); if(e){ const r=e.getBoundingClientRect(); c={x:ap.x,y:Math.max(0,r.y-(clip.pad==null?14:clip.pad)),w:ap.width,h:clip.h}; } clip=null; } if(clip){ if(clip.sel||clip.text){ const bb=box(clip); if(bb){ const p=clip.pad==null?10:clip.pad; c={x:Math.max(0,bb.x-p),y:Math.max(0,bb.y-p),w:bb.w+2*p,h:bb.h+2*p}; if(clip.maxh&&c.h>clip.maxh)c.h=clip.maxh; } } else c=clip; }
    return {boxes:(ann||[]).map(box), clip:c, sx:window.scrollX, sy:window.scrollY};
  }, s.ann||[], s.clip||null);
  const opt = {path:'raw/'+s.id+'.png'};
  if (res.clip) { const vw=await pg.evaluate(()=>[innerWidth,innerHeight]); res.clip.w=Math.min(res.clip.w, vw[0]-res.clip.x); res.clip.h=Math.min(res.clip.h, vw[1]-res.clip.y); opt.clip={x:res.clip.x+res.sx,y:res.clip.y+res.sy,width:res.clip.w,height:res.clip.h}; }
  await pg.screenshot(opt);
  out[s.id] = {boxes:res.boxes, clip:res.clip, ann:s.ann||[]};
  console.log(s.id, 'ok', res.boxes.map(x=>x?'✓':'✗').join(''), res.clip?'clip':'');
  await pg.close();
}
await b.close();
fs.writeFileSync('boxes.json', JSON.stringify(out,null,1));
