import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const ROOT='/sessions/quirky-affectionate-hypatia/luxyra.fr';
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
let ok=0,ko=0; const T=(n,c,d)=>{ if(c) ok++; else { ko++; console.log('KO',n,JSON.stringify(d||'').slice(0,300)); } };
async function page(){ const pg=await b.newPage(); await pg.setViewport({width:390,height:844});
 await pg.setRequestInterception(true); pg.body=null;
 pg.on('request',r=>{const u=r.url(); if(u.includes('/create-checkout')){pg.body=r.postData(); return r.respond({status:400,contentType:'application/json',body:JSON.stringify({error:'SIRET',code:'siret_requis'})});}
  if(u.startsWith('http://localhost')||u.startsWith('data:')||u.startsWith('blob:')) return r.continue();
  if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,body:fs.readFileSync(p)});} r.abort();});
 pg.errs=[]; pg.on('pageerror',e=>pg.errs.push(e.message)); pg.on('dialog',d=>d.accept());
 await pg.goto('http://localhost:8791/app.html?demo=coiffure',{waitUntil:'domcontentloaded'});
 await pg.waitForFunction(()=>window.CURRENT_OPERATOR&&typeof showTrialExpiredScreen==='function',{timeout:40000});
 await new Promise(r=>setTimeout(r,1500));
 await pg.evaluate(()=>{ window.render=function(){}; window.go=function(){}; window.__al=[]; window.showAlert=function(m){window.__al.push(m)}; [...document.body.children].forEach(e=>{ if(getComputedStyle(e).position==='fixed'&&e.id!=='modal') e.style.display='none'; }); });
 return pg; }
// 1. caisse réelle, sans SIRET
let pg=await page();
let r=await pg.evaluate(()=>{ window._lxSalonSuspendu=true; window.LX_MODE_CAISSE='reel'; SALON_CONFIG.siret=''; showTrialExpiredScreen({id:window._salonId,nom:'O’R STUDIO',siret:''}); return {siret:!!document.getElementById('lxFinSiret'), test:!!document.getElementById('lxFinTest')}; });
T('sans SIRET : champ affiché, pas de bloc test', r.siret && !r.test, r);
await pg.screenshot({path:'/tmp/fin_siret.png',fullPage:true});
r=await pg.evaluate(()=>{ document.getElementById('lxFinSiretInp').value='123 456 789 00011'; lxFinEssaiSiret(); return document.getElementById('lxFinSiretMsg').textContent; });
T('SIRET faux refusé (Luhn)', /Luhn|invalide/i.test(r), r);
r=await pg.evaluate(async()=>{ window.lxSaveSalonColumns=function(p){ window.__saved=p; return Promise.resolve({ok:true}); }; document.getElementById('lxFinSiretInp').value='732 829 320 00074'; lxFinEssaiSiret(); await new Promise(r=>setTimeout(r,200)); return {saved:window.__saved, txt:document.getElementById('lxFinSiret').innerText}; });
T('SIRET valide enregistré via lxSaveSalonColumns', r.saved && r.saved.siret==='73282932000074' && /enregistré/.test(r.txt), r);
// checkout renvoie siret_requis -> champ réaffiché
r=await pg.evaluate(async()=>{ window.__fb=null; const of=window.fetch; window.fetch=function(u,o){ if(String(u).includes('/create-checkout')){ window.__fb=o&&o.body; return Promise.resolve(new Response(JSON.stringify({error:'SIRET',code:'siret_requis'}),{status:400})); } return of.apply(this,arguments); }; document.getElementById('lxFinSiret').remove(); SALON_CONFIG.siret='73282932000074'; document.getElementById('cgvCheck').checked=true; checkCgvAndPay('essential'); await new Promise(r=>setTimeout(r,1500)); return {siret:!!document.getElementById('lxFinSiretInp'), al:window.__al, fb:window.__fb}; });
T('siret_requis du serveur -> champ SIRET réaffiché', r.siret && r.al.some(m=>/SIRET/.test(m)), r);
T('appel create-checkout fait', !!r.fb, r);
T('aucune erreur JS (1)', !pg.errs.length, pg.errs);
// 2. caisse test avec SIRET
pg=await page();
r=await pg.evaluate(async()=>{ window._lxSalonSuspendu=true; window.LX_MODE_CAISSE='test'; SALON_CONFIG.siret='73282932000074'; showTrialExpiredScreen({id:window._salonId,nom:'Test',siret:'73282932000074'}); const o={test:!!document.getElementById('lxFinTest'), siret:!!document.getElementById('lxFinSiret')};
  window.__passe=null; window.lxPasserEnReel=function(s){ window.__passe='['+s+']'; }; document.getElementById('cgvCheck').checked=true; checkCgvAndPay('pro'); await new Promise(r=>setTimeout(r,300)); o.passe=window.__passe; return o; });
T('caisse test : bloc « Passer en caisse réelle », pas de champ SIRET', r.test && !r.siret, r);
T('caisse test : paiement -> passage en caisse réelle (sans suite)', r.passe==='[]', r);
T('caisse test : aucun appel create-checkout', !pg.body, pg.body);
await pg.evaluate(()=>{ window.lxPasserEnReel=undefined; });
await pg.screenshot({path:'/tmp/fin_test.png',fullPage:true});
// 3. vue admin : rien
r=await pg.evaluate(()=>{ window._lxVueAdmin='x'; window.__al=[]; lxFinEssaiPasserReel(); checkCgvAndPay('pro'); return window.__al; });
T('vue admin : ni passage ni paiement', r.length>=2 && r.every(m=>/admin/i.test(m)), r);
T('aucune erreur JS (2)', !pg.errs.length, pg.errs);
console.log('fin d essai :',ok,'/',ok+ko); await b.close();
