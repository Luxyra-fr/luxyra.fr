import fs from 'fs'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
const pg=await b.newPage(); await pg.setViewport({width:900,height:1200});
await pg.goto('http://localhost:8791/docs/bons_1031/bancs/apercu.html?c=%23b76e79&nom=Excellence%20Coiffure&sous=by%20Amandine%20J.',{waitUntil:'networkidle0'});
for (const m of ['maison','ecrin']) for (const f of ['carte','a6']) {
  const html=await pg.evaluate((m,f)=>LXBon.documentImpression(m,{code:"BC-7K4Q2M",val:80,de:"Camille",pour:"Léa",msg:"Joyeux anniversaire ma Léa ! Un moment rien que pour toi.",exp:"29/10/2027",scope:"Prestations et produits",tva:"TVA 20 % incluse",tk:"1842",occasion:"Joyeux anniversaire"},{nom:"Excellence Coiffure",sous:"by Amandine J.",adresse:"20 rue Nationale",cpv:"57200 Sarreguemines",tel:"03 87 00 00 00",couleur:"#b76e79"},f),m,f);
  const p2=await b.newPage(); await p2.setViewport({width:900,height:1200});
  await p2.setContent(html.replace('http://localhost:8791/fonts','http://localhost:8791/fonts'),{waitUntil:'networkidle0'});
  await p2.screenshot({path:`/tmp/print_${m}_${f}.png`,fullPage:true});
  await p2.pdf({path:`/tmp/print_${m}_${f}.pdf`,preferCSSPageSize:true,printBackground:true});
  await p2.close();
}
await b.close(); console.log('ok');
