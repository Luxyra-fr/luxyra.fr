import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core'; import fs from 'fs';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-email', OUT='/tmp/emshots'; fs.mkdirSync(OUT,{recursive:true});
let nOk=0,nKo=0; const kos=[]; const ok=(n,c,d)=>{ if(c)nOk++; else {nKo++; kos.push(n+(d!==undefined?' :: '+JSON.stringify(d).slice(0,300):''));} };
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const USER={id:'dddddddd-dddd-4ddd-8ddd-dddddddddd01',email:'elise.test@laposte.fr',nom:'TESTEUR',prenom:'Elise',telephone:'0611111111',email_verified:false,email_rejete_at:'2026-10-29T13:33:02Z',adresse:'1 rue X',cp:'57200',ville:'Sarreguemines',pays:'France'};
async function page(user, url, appels){
  const pg=await b.newPage(); await pg.setViewport({width:390,height:844,deviceScaleFactor:2});
  await pg.setRequestInterception(true);
  pg.on('request',r=>{ const u=r.url();
    if(u.startsWith('http://localhost')) return r.continue();
    if(u.startsWith('https://luxyra.fr/')){ const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,contentType:p.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(p)}); }
    if(u.includes('/functions/v1/lx-profile')){ let body={}; try{body=JSON.parse(r.postData()||'{}');}catch(_){}
      appels&&appels.push(body);
      if(body.action==='get') return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({user})});
      if(body.action==='change_email'){ if(body.password!=='bon') return r.respond({status:401,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:'Mot de passe incorrect'})});
        const u2=Object.assign({},user,{email:body.new_email,email_rejete_at:null}); return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({ok:true,user:u2,envoye:true,session_token:'jeton2'})}); }
      return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'}); }
    if(r.method()==='OPTIONS') return r.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS'}});
    return r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'});
  });
  pg.errors=[]; pg.on('pageerror',e=>pg.errors.push(e.message));
  await pg.goto('http://localhost:8795/compte.html',{waitUntil:'domcontentloaded'});
  if(user){ await pg.evaluate((u)=>{ localStorage.setItem('lx_token','jeton1'); localStorage.setItem('lx_account',JSON.stringify(u)); },user); await pg.goto('http://localhost:8795/'+(url||'compte.html'),{waitUntil:'networkidle0'}); }
  await new Promise(r=>setTimeout(r,800));
  return pg;
}
// 1. bandeau rouge + formulaire ouvert
{ const appels=[]; const pg=await page(USER,null,appels);
  const t=await pg.evaluate(()=>{ const v=document.getElementById('verifBanner'); return v?v.innerText:''; });
  ok('bandeau « adresse incorrecte : corrigez-la » affiché', /semble incorrecte : corrigez-la/.test(t) && /elise\.test@laposte\.fr/.test(t), t);
  ok('formulaire de correction ouvert d\'office', await pg.evaluate(()=>{ const f=document.getElementById('corrEmailForm'); return !!f && getComputedStyle(f).display!=='none'; }));
  await pg.screenshot({path:OUT+'/1-bandeau-rejet.png'});
  // suggestion laposte.fr -> laposte.net
  await pg.focus('#ceNew'); await pg.type('#ceNew','elise.test@laposte.fr'); await pg.evaluate(()=>document.getElementById('ceNew').blur());
  const sg=await pg.evaluate(()=>{ const s=document.querySelector('#corrEmailForm .lx-email-sugg'); return s?s.innerText:''; });
  ok('suggestion « Vouliez-vous dire elise.test@laposte.net ? »', /Vouliez-vous dire elise\.test@laposte\.net \?/.test(sg), sg);
  await pg.screenshot({path:OUT+'/2-suggestion.png'});
  await pg.evaluate(()=>document.querySelector('#corrEmailForm .lx-email-sugg a').click());
  ok('clic sur la suggestion : champ corrigé', await pg.evaluate(()=>document.getElementById('ceNew').value)==='elise.test@laposte.net');
  // mauvais mot de passe
  await pg.type('#cePass','faux'); await pg.click('#btnCorrEmail'); await new Promise(r=>setTimeout(r,600));
  ok('mauvais mot de passe : message d\'erreur, rien changé', /Mot de passe incorrect/.test(await pg.evaluate(()=>document.getElementById('ceMsg').innerText)));
  await pg.evaluate(()=>{ document.getElementById('cePass').value=''; }); await pg.type('#cePass','bon'); await pg.click('#btnCorrEmail'); await new Promise(r=>setTimeout(r,800));
  const apres=await pg.evaluate(()=>({ txt:document.body.innerText, tok:localStorage.getItem('lx_token'), acc:JSON.parse(localStorage.getItem('lx_account')||'{}').email }));
  ok('correction OK : message de confirmation, nouveau jeton et compte mis à jour', /Adresse corrigée\. Un lien de confirmation a été envoyé à elise\.test@laposte\.net/.test(apres.txt) && apres.tok==='jeton2' && apres.acc==='elise.test@laposte.net', apres);
  ok('après correction : bandeau jaune « Confirmez » (plus rouge)', /Confirmez votre adresse email/.test(apres.txt) && !/semble incorrecte/.test(apres.txt));
  const ce=appels.filter(a=>a.action==='change_email').pop();
  ok('appel serveur : action change_email + mot de passe', ce && ce.new_email==='elise.test@laposte.net' && ce.password==='bon', ce);
  await pg.screenshot({path:OUT+'/3-apres-correction.png'});
  ok('aucune erreur JS', pg.errors.length===0, pg.errors);
}
// 2. compte non confirmé sans rejet : lien « Adresse mal saisie ? »
{ const pg=await page(Object.assign({},USER,{email_rejete_at:null}));
  const t=await pg.evaluate(()=>document.getElementById('verifBanner').innerText);
  ok('compte non confirmé : bandeau normal + lien « Adresse mal saisie ? Corrigez-la »', /Confirmez votre adresse email/.test(t) && /Adresse mal saisie \? Corrigez-la/.test(t) && await pg.evaluate(()=>getComputedStyle(document.getElementById('corrEmailForm')).display==='none'), t);
  await pg.evaluate(()=>document.getElementById('lnkCorrEmail').click());
  ok('clic : formulaire ouvert', await pg.evaluate(()=>getComputedStyle(document.getElementById('corrEmailForm')).display!=='none'));
  ok('aucune erreur JS (2)', pg.errors.length===0, pg.errors);
}
// 3. compte confirmé + rejet : bandeau « écrivez à contact »
{ const pg=await page(Object.assign({},USER,{email_verified:true}));
  const t=await pg.evaluate(()=>document.body.innerText);
  ok('compte confirmé + rejet : bandeau « écrivez à contact@luxyra.fr », pas de formulaire', /semble incorrecte/.test(t) && /contact@luxyra\.fr/.test(t) && !(await pg.$('#corrEmailForm')), t.slice(0,300));
  await pg.screenshot({path:OUT+'/4-confirme-rejete.png'});
}
// 4. inscription : suggestion + rappel
{ const pg=await page(null);
  await pg.evaluate(()=>{ PAGE='register'; render(); });
  await pg.focus('#rEmail'); await pg.type('#rEmail','marie@gmial.com'); await pg.evaluate(()=>document.getElementById('rEmail').blur());
  const sg=await pg.evaluate(()=>{ const s=document.querySelector('.lx-email-sugg'); return s?s.innerText:''; });
  ok('inscription : « Vouliez-vous dire marie@gmail.com ? »', /Vouliez-vous dire marie@gmail\.com \?/.test(sg), sg);
  await pg.screenshot({path:OUT+'/5-inscription-suggestion.png'});
  await pg.evaluate(()=>{ const i=document.getElementById('rEmail'); i.value='marie@gmail.com'; i.dispatchEvent(new Event('input')); });
  const rp=await pg.evaluate(()=>document.querySelector('.lx-email-sugg').innerText);
  ok('inscription : rappel « Le lien de confirmation sera envoyé à : marie@gmail.com »', /Le lien de confirmation sera envoyé à : marie@gmail\.com/.test(rp), rp);
  ok('aucune erreur JS (4)', pg.errors.length===0, pg.errors);
}
// 5. fonction de suggestion : cas
{ const pg=await page(null);
  const cas=await pg.evaluate(()=>{ const t={'a@gmail.com':'','a@gmial.com':'a@gmail.com','a@gmai.com':'a@gmail.com','a@gamil.com':'a@gmail.com','a@hotmial.fr':'a@hotmail.fr','a@hotmail.fe':'a@hotmail.fr','a@outlok.fr':'a@outlook.fr','a@yahooo.fr':'a@yahoo.fr','a@laposte.fr':'a@laposte.net','a@laposte.net':'','a@orange.fe':'a@orange.fr','a@free.fe':'a@free.fr','a@sfr.fe':'a@sfr.fr','a@icloud.co':'a@icloud.com','a@gmail.con':'a@gmail.com','a@gmail.cmo':'a@gmail.com','a@wanadoo.fr':'','a@salon-amandine.fr':'','a@luxyra.fr':'','a@exemple.test':'','a@hotmail.co':'a@hotmail.com','pas-une-adresse':'','a@orange.fr':'','a@sfr.fr':'','a@free.fr':'','a@hotmail.be':'','a@yahoo.de':'','a@outlook.lu':'','a@live.be':'','a@gmx.ch':'','a@hotmal.be':'a@hotmail.be','a@skynet.be':'','a@pt.lu':'','a@mail.de':'','a@mail.com':'','a@orang.fr':'a@orange.fr','a@posteo.de':''}; const out=[]; for(const k in t){ const v=LX.suggererEmail(k); if(v!==t[k]) out.push(k+' -> '+v+' (attendu '+t[k]+')'); } return out; });
  ok('suggestions : 37 cas (vrais domaines jamais corrigés)', cas.length===0, cas);
}
// 6. site.html : champ e-mail de réservation
{ const src=fs.readFileSync(ROOT+'/site.html','utf8');
  ok('site.html : suggestion sur l\'e-mail d\'inscription et de réservation', /id="aEmail" type="email" required'\+\(isLogin\?'':' data-lx-sugg="1"'\)/.test(src) && /id="bkEmail" type="email" data-lx-sugg="Votre confirmation de rendez-vous sera envoyée à : "/.test(src));
}
await b.close();
console.log(`Navigateur (téléphone) e-mail mal saisi : ${nOk}/${nOk+nKo} OK`); if(kos.length) console.log('ÉCHECS:\n- '+kos.join('\n- '));
