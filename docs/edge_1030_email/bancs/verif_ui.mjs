// Banc navigateur (téléphone) : confirmation de l'adresse avec mot de passe (31/10/2026, contre-audit 3 M1).
import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core'; import fs from 'fs';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-comptes', OUT='/tmp/emshots', PORT=process.argv[2]||'8796';
let nOk=0,nKo=0; const kos=[]; const ok=(n,c,d)=>{ if(c)nOk++; else {nKo++; kos.push(n+(d!==undefined?' :: '+JSON.stringify(d).slice(0,300):''));} };
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const USER={id:'dddddddd-dddd-4ddd-8ddd-dddddddddd41',email:'lea@exemple.test',nom:'L',prenom:'Lea',email_verified:true,pays:'France'};
const TK='1'.repeat(64);
async function page(connecte, appels){
  const pg=await b.newPage(); await pg.setViewport({width:390,height:844,deviceScaleFactor:2});
  await pg.setRequestInterception(true);
  const H={'Access-Control-Allow-Origin':'*'};
  pg.on('request',r=>{ const u=r.url();
    if(r.method()==='OPTIONS') return r.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS'}});
    if(u.startsWith('http://localhost')) return r.continue();
    if(u.startsWith('https://luxyra.fr/')){ const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,contentType:p.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(p)}); }
    if(u.includes('/functions/v1/lx-profile')){ let body={}; try{body=JSON.parse(r.postData()||'{}');}catch(_){}
      appels.push(body);
      if(body.action==='verify_email'){
        if(body.session_token==='jeton-meme') return r.respond({status:200,contentType:'application/json',headers:H,body:JSON.stringify({ok:true,email:USER.email,user:USER,session_token:'jeton-neuf'})});
        if(!body.password) return r.respond({status:403,contentType:'application/json',headers:H,body:JSON.stringify({besoin_mot_de_passe:true,error:'Pour confirmer, saisissez le mot de passe de votre compte Luxyra.'})});
        if(body.password!=='bon') return r.respond({status:401,contentType:'application/json',headers:H,body:JSON.stringify({error:'Mot de passe incorrect'})});
        return r.respond({status:200,contentType:'application/json',headers:H,body:JSON.stringify({ok:true,email:USER.email,user:USER,session_token:'jeton-neuf'})});
      }
      if(body.action==='get') return r.respond({status:200,contentType:'application/json',headers:H,body:JSON.stringify({user:USER})});
      return r.respond({status:200,contentType:'application/json',headers:H,body:'{}'}); }
    return r.respond({status:200,contentType:'application/json',headers:H,body:'[]'});
  });
  pg.errors=[]; pg.on('pageerror',e=>pg.errors.push(e.message));
  await pg.goto(`http://localhost:${PORT}/compte.html`,{waitUntil:'domcontentloaded'});
  await pg.evaluate((c,u)=>{ localStorage.clear(); if(c){ localStorage.setItem('lx_token','jeton-meme'); localStorage.setItem('lx_account',JSON.stringify(u)); } },connecte,USER);
  await pg.goto(`http://localhost:${PORT}/compte.html?verif=${TK}`,{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,800));
  return pg;
}
// 1. pas connecté : page « Confirmer votre adresse » avec mot de passe
{ const appels=[]; const pg=await page(false,appels);
  const t=await pg.evaluate(()=>document.body.innerText);
  ok('pas connecté : page de confirmation avec mot de passe', /Confirmer votre adresse/.test(t) && !!(await pg.$('#vPass')), t.slice(0,300));
  ok('avertissement « pas créé de compte ? ne faites rien » + « Définir un mot de passe »', /pas créé de compte Luxyra/.test(t) && /Définir un mot de passe/.test(t));
  ok('lien retiré de la barre d\'adresse', !/verif=/.test(await pg.evaluate(()=>location.href)));
  await pg.screenshot({path:OUT+'/v1-confirmer-mdp.png'});
  await pg.type('#vPass','mauvais'); await pg.click('#btnVerifMdp'); await new Promise(r=>setTimeout(r,600));
  ok('mauvais mot de passe : message, reste sur la page', /Mot de passe incorrect/.test(await pg.evaluate(()=>document.getElementById('verifErr').innerText)) && !!(await pg.$('#vPass')));
  await pg.evaluate(()=>{document.getElementById('vPass').value='';}); await pg.type('#vPass','bon'); await pg.click('#btnVerifMdp'); await new Promise(r=>setTimeout(r,1000));
  const t2=await pg.evaluate(()=>document.body.innerText);
  ok('bon mot de passe : connecté, message « Adresse email confirmée »', /Adresse email confirmée/.test(t2) && (await pg.evaluate(()=>localStorage.getItem('lx_token')))==='jeton-neuf', t2.slice(0,300));
  ok('le mot de passe est bien envoyé avec le lien', appels.some(a=>a.action==='verify_email'&&a.token==='1'.repeat(64)&&a.password==='bon'));
  await pg.screenshot({path:OUT+'/v2-confirme.png'});
  ok('aucune erreur JS (1)', pg.errors.length===0, pg.errors); await pg.close(); }
// 2. « Définir un mot de passe » -> page mot de passe oublié
{ const appels=[]; const pg=await page(false,appels);
  await pg.evaluate(()=>{ [...document.querySelectorAll('a')].find(a=>/Définir un mot de passe/.test(a.innerText)).click(); }); await new Promise(r=>setTimeout(r,300));
  ok('« Définir un mot de passe » ouvre la page mot de passe oublié', /Mot de passe oublié/.test(await pg.evaluate(()=>document.body.innerText)) && !!(await pg.$('#fEmail')));
  ok('aucune erreur JS (2)', pg.errors.length===0, pg.errors); await pg.close(); }
// 3. connecté au même compte : confirmé directement, sans mot de passe
{ const appels=[]; const pg=await page(true,appels);
  const t=await pg.evaluate(()=>document.body.innerText);
  ok('connecté au même compte : confirmé sans mot de passe', /Adresse email confirmée/.test(t) && !(await pg.$('#vPass')) && appels.some(a=>a.action==='verify_email'&&a.session_token==='jeton-meme'&&!a.password), t.slice(0,200));
  ok('aucune erreur JS (3)', pg.errors.length===0, pg.errors); await pg.close(); }
await b.close();
console.log(`Confirmation d'adresse (téléphone) : ${nOk}/${nOk+nKo} OK`); if(kos.length){ console.log('ÉCHECS :\n- '+kos.join('\n- ')); process.exitCode=1; }
