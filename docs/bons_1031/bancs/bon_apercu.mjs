import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const [,,url,out,w,h]=process.argv;
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const pg=await b.newPage(); await pg.setViewport({width:+w||1400,height:+h||900});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await pg.goto(url,{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,800));
await pg.screenshot({path:out,fullPage:true}); console.log('errs',JSON.stringify(errs).slice(0,500)); await b.close();
