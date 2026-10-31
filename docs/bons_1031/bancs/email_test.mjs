globalThis.Deno={env:{get:()=>"x"},serve:()=>{}};
const m=await import('./gc.mjs');
import fs from 'fs';
const base={themeId:"anniversaire",salonNom:"Excellence Coiffure",salonSous:"by Amandine J.",salonAddr:"20 rue Nationale 57200 Sarreguemines",salonTel:"03 87 00 00 00",logoUrl:"data:image/jpeg;base64,xx",couleur:"#b76e79",valeur:80,code:"BC-7K4Q2M",de:"Camille",pour:"Léa",message:"Joyeux anniversaire ma Léa ! <b>x</b>",dateExp:"31/10/2027",siret:"123 456 789 00012",mentionTva:m.lxBonMentionTva({usage_tva:null},20),perimetre:m.lxBonPerimetre("tout"),tkNum:1842};
for (const mo of ["maison","ecrin"]) { const h=m.buildBonHTMLModele(mo,base); fs.writeFileSync(`/tmp/eb/mail_${mo}.html`,h); console.log(mo,h.length, /<b>x<\/b>/.test(h)?"XSS!":"echappe", /data:image/.test(h)?"logo base64 present!":"pas de base64", /googleapis/.test(h)?"google!":"sans google"); }
console.log(m.lxBonPalette("#b76e79"), m.lxBonPalette("#C8A84E"), m.lxBonPalette("zz"));
