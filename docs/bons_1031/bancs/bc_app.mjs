import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-bons2';
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
async function page(vp){
 const pg=await b.newPage(); await pg.setViewport(vp);
 await pg.setRequestInterception(true);
 pg.on('request',r=>{const u=r.url(); if(u.startsWith('http://localhost')||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();
  if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});} r.abort();});
 pg.errs=[]; pg.on('pageerror',e=>pg.errs.push(e.message)); pg.on('dialog',d=>d.accept());
 await pg.goto('http://localhost:8791/app.html?demo=coiffure',{waitUntil:'domcontentloaded'});
 await pg.waitForFunction(()=>window.CURRENT_OPERATOR&&typeof lxBonChoisirModele==='function'&&window.GC,{timeout:40000});
 await new Promise(r=>setTimeout(r,1500));
 await pg.evaluate(()=>{[...document.body.children].forEach(e=>{ if(/DÉMO Luxyra|MODE DÉMO/.test(e.innerText||'')&&getComputedStyle(e).position==='fixed') e.style.display='none'; });});
 return pg;
}
const res={};
const pg=await page({width:1280,height:900});
// 1) défaut : aucun modèle -> ancienne fenêtre
res.defaut=await pg.evaluate(()=>{ SALON_CONFIG.bonModele=""; if(!GC.length) return 'pas de bon démo'; chooseGiftTheme(GC[0].id); var t=document.getElementById('modal').innerText; cM(); return /Luxe Noir|Classique/.test(t)?'ancien':'?'+t.slice(0,80); });
await pg.evaluate(()=>go('gifts')); await new Promise(r=>setTimeout(r,600));
res.banniere=await pg.evaluate(()=>/Modèle des bons/.test(document.body.innerText));
await pg.screenshot({path:'/tmp/app_gifts.png'});
// 2) fenêtre de réglage
await pg.evaluate(()=>{ lxBonChoisirModele(); window._lxBonModeleChoix='maison'; _lxBonRendreChoix(); }); await new Promise(r=>setTimeout(r,500));
await pg.screenshot({path:'/tmp/app_reglage_A.png'});
await pg.evaluate(()=>{ window._lxBonModeleChoix='ecrin'; _lxBonRendreChoix(); }); await new Promise(r=>setTimeout(r,500));
await pg.screenshot({path:'/tmp/app_reglage_B.png'});
// 3) enregistrer (démo) puis section config
res.save=await pg.evaluate(async()=>{ await lxBonEnregistrerModele(); var sec=LX_CFG_SECTIONS.find(s=>s.k==='bonModele'); return {mod:SALON_CONFIG.bonModele, mem:sec.mem()}; });
// 4) impression avec modèle
res.impr=await pg.evaluate(()=>{ SALON_CONFIG.bonModele='ecrin'; chooseGiftTheme(GC[0].id); return /Carte 85 × 55/.test(document.getElementById('modal').innerText); });
await new Promise(r=>setTimeout(r,500)); await pg.screenshot({path:'/tmp/app_imprimer_B.png'});
res.ancien=await pg.evaluate(()=>{ chooseGiftThemeAncien(GC[0].id); var ok=/Classique/.test(document.getElementById('modal').innerText); cM(); return ok; });
// 5) doc d'impression généré depuis l'app (fenêtre interceptée)
res.doc=await pg.evaluate(()=>{ var html=null; var o=window.open; window.open=function(){ return {document:{open(){},write(h){html=h},close(){}}}; }; SALON_CONFIG.bonModele='maison'; lxBonImprimerModele(GC[0].id,'carte'); window.open=o; return html? (html.indexOf('lxbA')>0 && html.indexOf(GC[0].code)>0):false; });
res.mention=await pg.evaluate(()=>_lxBonPourRendu(GC[0]));
res.errs=pg.errs;
// téléphone
const pm=await page({width:390,height:844,deviceScaleFactor:2});
await pm.evaluate(()=>{ SALON_CONFIG.bonModele='maison'; chooseGiftTheme(GC[0].id); }); await new Promise(r=>setTimeout(r,500));
await pm.screenshot({path:'/tmp/app_imprimer_A_mob.png'});
await pm.evaluate(()=>{ cM(); lxBonChoisirModele(); }); await new Promise(r=>setTimeout(r,500));
await pm.screenshot({path:'/tmp/app_reglage_mob.png'});
res.errsMob=pm.errs;
console.log(JSON.stringify(res,null,1)); await b.close();
