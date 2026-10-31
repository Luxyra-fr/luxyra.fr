import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-bons2';
const [,,page,modele,couleur,out,w,h,logo]=process.argv;
const LOGO=logo==='1'?'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="46" fill="none" stroke="#333" stroke-width="3"/><text x="50" y="62" font-size="34" text-anchor="middle" font-family="Georgia" fill="#333">EC</text></svg>').toString('base64'):'';
const salon={id:'00000000-0000-4000-8000-000000000001',nom:process.env.NOM||'Maison Lumière',sous_titre:process.env.SOUS||'Institut & Spa',adresse:'12 rue des Tilleuls',cp:'57200',ville:'Sarreguemines',tel:'03 87 00 00 00',logo:LOGO,couleur_primaire:couleur,slug:'demo-bc',bons_cadeaux_online_actif:true,config_json:JSON.stringify(modele?{bonModele:modele}:{})};
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const pg=await b.newPage(); await pg.setViewport({width:+w,height:+h,deviceScaleFactor:1});
await pg.evaluateOnNewDocument(()=>{window.__SALON_SLUG='demo-bc'; try{localStorage.clear()}catch(e){}});
await pg.setRequestInterception(true);
pg.on('request',r=>{const u=r.url();
 if(u.includes('/rest/v1/salons_public')) return r.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(salon)});
 if(u.includes('/api/bons-cadeaux/statut')) return r.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,paye:true,code:'BC-7K4Q2M',valeur:80,date_expiration:'2027-10-31',email:'ca•••@exemple.fr',carte:modele?{modele,de:'Camille',pour:'Léa',message:'Joyeux anniversaire ma Léa ! Un moment rien que pour toi.',theme_id:'anniversaire',scope:'tout',usage_tva:null,tva_rate:null,salon:{nom:salon.nom,sous_titre:salon.sous_titre,adresse:salon.adresse,cp:salon.cp,ville:salon.ville,tel:salon.tel,logo:salon.logo,couleur_primaire:couleur,taux_tva:20}}:null})});
 if(u.startsWith('http://localhost')||u.startsWith('data:')) return r.continue();
 if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)&&fs.statSync(p).isFile()) return r.respond({status:200,contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/woff2',body:fs.readFileSync(p)});}
 r.abort();});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.goto('http://localhost:8791/'+page+(page.includes('success')?'?session_id=cs_test_abcdefghijklmnop':''),{waitUntil:'networkidle0'}).catch(e=>errs.push(String(e)));
await new Promise(r=>setTimeout(r,1500));
if(page==='bons-cadeaux.html'){ await pg.evaluate(()=>{ const s=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v; e.dispatchEvent(new Event('input'))}}; s('offertPar','Camille'); s('offertA','Léa'); s('message','Un moment rien que pour toi, tu l’as bien mérité.'); if(window.choisirOccasion&&window.MODELE) choisirOccasion('anniversaire'); }); await new Promise(r=>setTimeout(r,500)); }
await pg.screenshot({path:out,fullPage:true});
console.log('errs',JSON.stringify(errs).slice(0,400)); await b.close();
