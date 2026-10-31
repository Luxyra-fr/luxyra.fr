import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-code2';
let nOk=0,nKo=0; const kos=[]; const ok=(n,c,d)=>{ if(c)nOk++; else {nKo++; kos.push(n+(d!==undefined?' :: '+JSON.stringify(d).slice(0,300):''));} };
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const pg=await b.newPage(); await pg.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await pg.setRequestInterception(true); const appels=[];
pg.on('request',r=>{const u=r.url();
 if(u.includes('/functions/v1/lx-signup')){ const body=JSON.parse(r.postData()||'{}'); appels.push(body);
   if(!body.code) return r.respond({status:428,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code_requis:true,email:body.email,renvoi_s:3,error:'x'})});
   if(body.code!=='123456') return r.respond({status:400,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:'Code incorrect (4 essais restants).',code_faux:true,reste:4})});
   return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({session_token:'tok',user:{id:'u1',email:body.email,prenom:body.prenom,nom:body.nom,email_verified:true}})}); }
 if(u.includes('/functions/v1/')) return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({user:{id:'u1',email:'a@b.fr',email_verified:true},ok:true})});
 if(u.startsWith('http://localhost')||u.startsWith('data:')||u.startsWith('blob:')) return r.continue();
 if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,body:fs.readFileSync(p)});}
 if(u.includes('supabase.co')) return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'});
 r.abort();});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('dialog',d=>d.accept());
await pg.goto('http://localhost:8792/compte.html#register',{waitUntil:'domcontentloaded'});
await pg.waitForSelector('#rNom',{timeout:20000});
await pg.evaluate(()=>{ const s=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
 s('rNom','test'); s('rPre','Nina'); s('rTel','0612345678'); s('rEmail','nina@gmail.com'); s('rPass','Un-Mot-De-Passe-91'); s('rPass2','Un-Mot-De-Passe-91');
 const g=document.getElementById('rGenre'); if(g){ g.value=g.options[g.options.length-1].value; }
 s('rAdr','1 rue de la Paix'); s('rCp','57200'); s('rVille','Sarreguemines'); document.getElementById('rCgu').checked=true; doRegister(); });
await pg.waitForSelector('#lxCodeIn',{timeout:10000});
await new Promise(r=>setTimeout(r,400));
await pg.screenshot({path:'/tmp/code_modal.png'});
const t=await pg.evaluate(()=>document.getElementById('lxCodeBg').innerText);
ok('fenêtre du code affichée avec l’adresse', /nina@gmail\.com/.test(t) && /6 chiffres/.test(t), t);
ok('renvoi désactivé au début (compte à rebours)', await pg.evaluate(()=>document.getElementById('lxCodeRe').disabled));
await pg.type('#lxCodeIn','000000'); await new Promise(r=>setTimeout(r,600));
const m1=await pg.evaluate(()=>document.getElementById('lxCodeMsg').textContent);
ok('mauvais code : message, fenêtre toujours ouverte', /Code incorrect/.test(m1) && !!(await pg.$('#lxCodeBg')), m1);
await pg.screenshot({path:'/tmp/code_modal_err.png'});
await new Promise(r=>setTimeout(r,3500));
ok('renvoi réactivé après le délai', !(await pg.evaluate(()=>document.getElementById('lxCodeRe').disabled)));
await pg.click('#lxCodeRe'); await new Promise(r=>setTimeout(r,500));
ok('renvoyer : nouvel appel sans code', appels.filter(a=>!a.code).length===2, appels.length);
// collage
await pg.evaluate(()=>{ const i=document.getElementById('lxCodeIn'); i.value=' 12 34 56 '; i.dispatchEvent(new Event('input',{bubbles:true})); });
await new Promise(r=>setTimeout(r,800));
ok('collage « 12 34 56 » nettoyé et validé automatiquement : fenêtre fermée, compte ouvert', !(await pg.$('#lxCodeBg')) && await pg.evaluate(()=>!!localStorage.getItem('lx_token')), await pg.evaluate(()=>document.body.innerText.slice(0,200)));
ok('dernier appel avec code 123456 et tous les champs', appels.at(-1).code==='123456' && appels.at(-1).nom==='TEST' && appels.at(-1).ville==='Sarreguemines', appels.at(-1));
ok('aucune erreur JS', errs.length===0, errs);
// annulation
await pg.evaluate(()=>{ localStorage.clear(); });
const p2=await b.newPage(); await p2.setViewport({width:390,height:844});
// B1 (31/10) : 429 + code_requis -> la fenêtre s'ouvre avec le message ; le texte sous le champ dit « code »
const p3=await b.newPage(); await p3.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
await p3.setRequestInterception(true);
p3.on('request',r=>{const u=r.url();
 if(u.includes('/functions/v1/lx-signup')){ const body=JSON.parse(r.postData()||'{}');
   if(!body.code) return r.respond({status:429,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code_requis:true,error:'Trop de codes demandés pour cette adresse. Saisissez le dernier code reçu, ou réessayez dans une heure.'})});
   return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({session_token:'tok',user:{id:'u1',email:body.email,email_verified:true}})}); }
 if(u.includes('/functions/v1/')) return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
 if(u.startsWith('http://localhost')||u.startsWith('data:')||u.startsWith('blob:')) return r.continue();
 if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,body:fs.readFileSync(p)});}
 if(u.includes('supabase.co')) return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'});
 r.abort();});
const errs3=[]; p3.on('pageerror',e=>errs3.push(e.message));
await p3.goto('http://localhost:8792/compte.html#register',{waitUntil:'domcontentloaded'});
await p3.waitForSelector('#rNom',{timeout:20000});
await p3.evaluate(()=>{ const s=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;}; s('rEmail','nina@gmail.com'); const e=document.getElementById('rEmail'); e.focus(); e.dispatchEvent(new Event('input',{bubbles:true})); });
await new Promise(r=>setTimeout(r,300));
const sous=await p3.evaluate(()=>document.body.innerText);
ok('texte sous le champ : « Le code sera envoyé à »', /Le code sera envoy/.test(sous) && !/Le lien de confirmation sera envoy/.test(sous));
await p3.evaluate(()=>{ const s=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
 s('rNom','test'); s('rPre','Nina'); s('rTel','0612345678'); s('rPass','Un-Mot-De-Passe-91'); s('rPass2','Un-Mot-De-Passe-91');
 const g=document.getElementById('rGenre'); if(g){ g.value=g.options[g.options.length-1].value; }
 s('rAdr','1 rue de la Paix'); s('rCp','57200'); s('rVille','Sarreguemines'); document.getElementById('rCgu').checked=true; doRegister(); });
await p3.waitForSelector('#lxCodeIn',{timeout:10000}); await new Promise(r=>setTimeout(r,300));
const m3=await p3.evaluate(()=>document.getElementById('lxCodeMsg').textContent);
ok('B1 : 429 + code_requis -> fenêtre ouverte avec le message', /dernier code/.test(m3), m3);
await p3.type('#lxCodeIn','123456'); await new Promise(r=>setTimeout(r,800));
ok('B1 : le code saisi après le 429 ouvre le compte', !(await p3.$('#lxCodeBg')), null);
ok('B1 : aucune erreur JS', errs3.length===0, errs3);
console.log(`UI code : ${nOk}/${nOk+nKo} OK`); if(kos.length) console.log('ÉCHECS:\n- '+kos.join('\n- '));
await b.close();
