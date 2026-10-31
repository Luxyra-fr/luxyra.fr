import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const ROOT='/sessions/quirky-affectionate-hypatia/wt-bons2';
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
for (const [f,w] of [['maison',700],['ecrin',700],['maison',390],['ecrin',390]]) {
 const pg=await b.newPage(); await pg.setViewport({width:w,height:900});
 await pg.setRequestInterception(true);
 pg.on('request',r=>{const u=r.url(); if(u.includes('/api/qr')) return r.respond({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="116" height="116"><rect width="116" height="116" fill="#fff"/><rect x="8" y="8" width="30" height="30" fill="#111"/><rect x="78" y="8" width="30" height="30" fill="#111"/><rect x="8" y="78" width="30" height="30" fill="#111"/><rect x="50" y="50" width="20" height="20" fill="#111"/></svg>'});
  if(u.startsWith('https://luxyra.fr/')){const p=ROOT+new URL(u).pathname; if(fs.existsSync(p)) return r.respond({status:200,body:fs.readFileSync(p)});} if(u.startsWith('file:')||u.startsWith('data:')) return r.continue(); r.abort();});
 await pg.goto('file:///tmp/eb/mail_'+f+'.html',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,500));
 await pg.screenshot({path:`/tmp/mail_${f}_${w}.png`,fullPage:true}); await pg.close(); }
await b.close(); console.log('ok');
