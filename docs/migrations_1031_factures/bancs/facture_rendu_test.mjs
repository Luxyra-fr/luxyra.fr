import fs from 'fs';
const src='//'+fs.readFileSync(new URL('../../luxyra-router-worker.js', import.meta.url),'utf8').split('// 2026-10-31 — FACTURES D\'ABONNEMENT LUXYRA')[1].split('async function handleBonEcarte')[0];
const ccEsc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f=new Function('ccEsc','CONFIG','_sbHeaders','lxSbGet','supabaseGet','lxMailLayout','lxMailBouton','brevoSendEmail','reportWorkerError','lxAuthUser','lxIsAdminUser','lxOwnsSalon','jsonResponse','lxIsInternal','stripeAPI', src+';return {lxFactureLuxyraHtml,lxFactClient,lxFactVendeur};');
const m=f(ccEsc,{},()=>({}),async()=>[],async()=>null,(x)=>x,(a,b)=>a,async()=>({}),async()=>{},async()=>null,()=>false,async()=>false,(x)=>x,async()=>false,async()=>({}));
const fac={id:'5b7ac5df-1fc3-461c-8322-381e11972b4f',numero:'LUX-2026-0001',date_facture:'2026-10-31',montant_ht:14.99,taux_tva:0,montant_tva:0,montant_ttc:14.99,description:'Abonnement Luxyra Pro Fondateur - Mensuel',plan:'pro',periode_debut:'2026-10-31',periode_fin:'2026-11-30',mode_paiement:'carte',type:'abonnement',montant_brut:14.99,remise:0,date_paiement:'2026-10-31T11:57:31Z'};
const salon={nom:"O'R STUDIO <script>",gerant_prenom:'Delphine',gerant_nom:'Fernandes',forme_juridique:'Entrepreneur individuel',adresse:'1 rue X',cp:'63500',ville:'PARENTIGNAT',siret:'78996595100012',siren:'789965951',tva_intra:'FR73789965951'};
const cfg={luxyra_adresse:"29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines",luxyra_siret_editeur:'91092846400023',luxyra_forme_juridique:'Entreprise individuelle (micro-entrepreneur)',luxyra_tva_pct:0};
const h=m.lxFactureLuxyraHtml(fac,{client:m.lxFactClient(salon),vendeur:m.lxFactVendeur(cfg)});
fs.writeFileSync('/tmp/facture_test.html',h);
const req=['FACTURE','LUX-2026-0001','Date d’émission','Alexandre JENSEN','EI','SIRET 910 928 464 00023','Sarreguemines','O&#39;R STUDIO','Delphine FERNANDES EI','SIREN 789965951','FR73789965951','prestation de services','Période','Qté','Prix unitaire','14,99 €','TVA non applicable, art. 293 B du CGI','acquittée le 31/10/2026','carte bancaire','escompte','40 €','L441-10','Net à payer','Adresse de livraison'];
let ok=0; for(const r of req){ if(h.includes(r)) ok++; else console.log('MANQUE',r); }
console.log('mentions',ok+'/'+req.length,'xss', h.includes('<script>')?'KO':'OK');
