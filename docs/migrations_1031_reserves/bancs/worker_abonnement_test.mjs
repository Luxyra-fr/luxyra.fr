let calls=[]; let ok=0,ko=0; const T=(n,c,d)=>{ if(c) ok++; else { ko++; console.log('KO',n,JSON.stringify(d).slice(0,400)); } };
let st={};
globalThis.fetch=async(u,o={})=>{ u=String(u); const m=(o.method||'GET'); calls.push(m+' '+u.replace(/https:\/\/[^/]+/,'')+(o.body?' '+String(o.body).slice(0,200):''));
  const J=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
  if(u.includes('/rest/v1/salons?id=eq.')&&m==='GET') return J([st.salon]);
  if(u.includes('/rest/v1/salons?id=eq.')&&m==='PATCH') return st.patchFail? new Response('{"message":"refus trigger"}',{status:400}) : J(st.patchRows===0?[]:[{id:'s1'}]);
  if(u.includes('app_config')) return J([]);
  if(u.includes('api.stripe.com/v1/subscriptions/')&&m==='GET'){ if(st.stripeKo) return J({error:{type:'api_error',message:'panne'}},500); const id=u.split('subscriptions/')[1].split('?')[0]; return J(st.subs[id]||{error:{code:'resource_missing',message:'nf'}},st.subs[id]?200:404); }
  if(u.includes('api.stripe.com/v1/subscriptions/')&&m==='DELETE'){ const id=u.split('subscriptions/')[1]; st.deleted=(st.deleted||[]).concat(id); return J({id,status:'canceled'}); }
  if(u.includes('api.stripe.com/v1/subscriptions/')&&m==='POST'){ const id=u.split('subscriptions/')[1]; st.posted=(st.posted||[]).concat(id+' '+String(o.body)); const sub=Object.assign({},st.subs[id]||{id},{cancel_at_period_end:false,cancel_at:null}); return J(sub); }
  if(u.includes('claim_founder_slot')) return J(null);
  if(u.includes('/rest/v1/factures_luxyra')) return J(st.fact||[]);
  if(u.includes('checkout/sessions?customer')) return J({data:st.open||[]});
  if(u.includes('/expire')) { st.expired=(st.expired||0)+1; return J({id:'cs',status:'expired'}); }
  if(u.endsWith('/v1/checkout/sessions')) return J({id:'cs_new',url:'https://checkout.stripe.com/x'});
  if(u.includes('/v1/invoices/')) return J(st.inv);
  if(u.endsWith('/v1/refunds')) { st.refund=(o.body||''); st.idem=o.headers['Idempotency-Key']; return J({id:'re_1'}); }
  if(u.includes('/v1/customers')) return J({data:[{id:'cus_1'}],id:'cus_1'});
  if(u.includes('report_server_error')||u.includes('server_errors')) { st.rep=(st.rep||[]).concat(String(o.body)); return J({}); }
  return J({});
};
const W=await import('./w.mjs'); const env={SUPABASE_SERVICE_KEY:'k',STRIPE_SECRET_KEY:'sk'};
const req=(b)=>new Request('https://luxyra.fr/api/stripe/create-checkout',{method:'POST',body:JSON.stringify(b)});
const now=Math.floor(Date.now()/1000);
// 1 refus abonnement actif
st={salon:{id:'s1',siret:'73282932000074',stripe_subscription_id:'sub_A',stripe_customer_id:'cus_1'},subs:{sub_A:{id:'sub_A',status:'active',cancel_at_period_end:false,created:now-90*86400}}};
let r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('abonnement actif -> refus 409', r.code==='abonnement_actif', r);
// 2 abonnement programmé pour s'arrêter -> R2 : réactivé, aucune session de paiement
st.subs.sub_A.cancel_at_period_end=true; st.salon.plan='pro'; st.salon.status='active';
r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('R2 abonnement qui s arrête -> repris (reactive), pas de nouvelle session', r.reactive===true && !r.url && (st.posted||[]).some(x=>/sub_A .*cancel_at_period_end=false/.test(x)), {r,p:st.posted});
// 2b reprise + changement de formule Essentiel -> Pro (chemin switch-plan)
st={salon:{id:'s1',siret:'73282932000074',plan:'essential',status:'active',stripe_subscription_id:'sub_A',stripe_customer_id:'cus_1'},subs:{sub_A:{id:'sub_A',status:'active',cancel_at_period_end:true,created:now-90*86400,items:{data:[{id:'si_1'}]}}}};
r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('R2 reprise + passage Pro via switch-plan', r.reactive===true && r.plan==='pro' && (st.posted||[]).some(x=>/items%5B0%5D%5Bid%5D=si_1/.test(x)), {r,p:st.posted});
// 2c sessions ouvertes expirées quand on crée vraiment une session (abonnement résilié)
st={salon:{id:'s1',siret:'73282932000074',stripe_subscription_id:'sub_A',stripe_customer_id:'cus_1'},subs:{sub_A:{id:'sub_A',status:'canceled',created:now-90*86400}},open:[{id:'cs_old',mode:'subscription',metadata:{salon_id:'s1'}},{id:'cs_autre',mode:'payment',metadata:{salon_id:'s1'}}]};
r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('abonnement résilié -> session créée', !!r.url, r);
T('session abonnement ouverte expirée (1 seule, pas le paiement)', st.expired===1, st);
// 2d R5 past_due / unpaid -> regulariser
for(const stt of ['past_due','unpaid']){ st={salon:{id:'s1',siret:'73282932000074',stripe_subscription_id:'sub_A'},subs:{sub_A:{id:'sub_A',status:stt,cancel_at_period_end:false,created:now-90*86400}}};
 r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)); const j=await r.json();
 T('R5 '+stt+' -> 409 regulariser', r.status===409 && j.code==='regulariser', j); }
// 2e R4 Stripe en panne -> 503
st={salon:{id:'s1',siret:'73282932000074',stripe_subscription_id:'sub_A'},subs:{},stripeKo:true};
r=await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env); 
T('R4 lecture Stripe en échec -> 503', r.status===503, await r.json());
// 2f abonnement introuvable chez Stripe -> session créée
st={salon:{id:'s1',siret:'73282932000074',stripe_subscription_id:'sub_X',stripe_customer_id:'cus_1'},subs:{}};
r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('abonnement introuvable chez Stripe -> session créée', !!r.url, r);
// 3 suspendu sans abonnement, SIRET manquant
st={salon:{id:'s1',siret:'',status:'suspended'},subs:{}};
r=await (await W.__hcc(req({salon_id:'s1',plan:'essential',email:'a@b.fr'}),env)).json();
T('sans SIRET -> siret_requis', r.code==='siret_requis', r);
st.salon.siret='73282932000074';
r=await (await W.__hcc(req({salon_id:'s1',plan:'essential',email:'a@b.fr'}),env)).json();
T('suspendu sans abonnement -> session créée', !!r.url, r);
// 4 updateSalonPlan : ancien récent -> remboursé
st={salon:{id:'s1',stripe_subscription_id:'sub_old'},subs:{sub_old:{id:'sub_old',status:'active',created:now-600,latest_invoice:'in_1'},sub_new:{id:'sub_new',status:'active',created:now-60}},inv:{id:'in_1',status:'paid',amount_paid:1499,payments:{data:[{payment:{payment_intent:'pi_1'}}]}},fact:[{numero:'LX-2026-0042'}]};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('abonnement double récent -> remboursé (pi, idempotent)', /payment_intent=pi_1/.test(st.refund||'') && st.idem==='lx-abo-double-sub_old', st);
T('R3 alerte avec avoir manuel et n° de facture Luxyra', (st.rep||[]).some(x=>/AVOIR/.test(x)&&/LX-2026-0042/.test(x)), st.rep);
// 5 ancien vieux -> pas de remboursement
st={salon:{id:'s1',stripe_subscription_id:'sub_old'},subs:{sub_old:{id:'sub_old',status:'canceled',created:now-40*86400,latest_invoice:'in_1'},sub_new:{id:'sub_new',status:'active',created:now-60}},inv:{id:'in_1',status:'paid',amount_paid:1499,payment_intent:'pi_1'}};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('ancien abonnement (40 j) -> jamais remboursé', !st.refund, st);
// 6 même abonnement (webhook rejoué) -> rien
st={salon:{id:'s1',stripe_subscription_id:'sub_new'},subs:{sub_new:{id:'sub_new',status:'active',created:now-60}}}; calls=[];
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('webhook rejoué -> ni annulation ni remboursement', !calls.some(c=>c.startsWith('DELETE'))&&!st.refund, calls);
// 7 activation refusée -> alerte critique
st={salon:{id:'s1'},subs:{sub_new:{id:'sub_new',status:'active',created:now-60}},patchFail:true};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation refusée -> alerte critique', (st.rep||[]).some(x=>/NON activ/.test(x)&&/critical/.test(x)), st.rep);
st={salon:{id:'s1'},subs:{sub_new:{id:'sub_new',status:'active',created:now-60}},patchRows:0};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation 0 ligne -> alerte', (st.rep||[]).some(x=>/NON activ/.test(x)), st.rep);
st={salon:{id:'s1'},subs:{sub_new:{id:'sub_new',status:'active',created:now-60}}};
let ap=await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation OK -> pas d alerte, true', !(st.rep||[]).length && ap===true, st.rep);
// R1a : rejeu de A (plus ancien) alors que le salon est sur B vivant -> B gardé, A traité comme doublon
calls=[]; st={salon:{id:'s1',stripe_subscription_id:'sub_B'},subs:{sub_A:{id:'sub_A',status:'active',created:now-300,latest_invoice:'in_A'},sub_B:{id:'sub_B',status:'active',created:now-100,latest_invoice:'in_B'}},inv:{id:'in_A',status:'paid',amount_paid:1499,payment_intent:'pi_A'}};
ap=await W.__usp(env,'s1','pro','sub_A','cus_1');
T('R1 rejeu A plus ancien -> B jamais annulé', !(st.deleted||[]).includes('sub_B'), st.deleted);
T('R1 rejeu A -> A annulé + remboursé (pi_A), salon non modifié', (st.deleted||[]).includes('sub_A') && /pi_A/.test(st.refund||'') && !calls.some(c=>c.startsWith('PATCH')) && ap===false, {d:st.deleted,r:st.refund,calls});
// R1b : arrivant déjà annulé (doublon déjà traité) -> rien
calls=[]; st={salon:{id:'s1',stripe_subscription_id:'sub_B'},subs:{sub_A:{id:'sub_A',status:'canceled',created:now-300},sub_B:{id:'sub_B',status:'active',created:now-100}}};
ap=await W.__usp(env,'s1','pro','sub_A','cus_1');
T('R1 arrivant annulé -> aucune annulation, aucun remboursement, salon intact', !(st.deleted||[]).length && !st.refund && !calls.some(c=>c.startsWith('PATCH')) && ap===false, calls);
// R1c : arrivant illisible -> rien annulé, activation, alerte critique
calls=[]; st={salon:{id:'s1',stripe_subscription_id:'sub_B'},subs:{sub_B:{id:'sub_B',status:'active',created:now-100}}};
ap=await W.__usp(env,'s1','pro','sub_Z','cus_1');
T('R1 arrivant illisible -> rien annulé + alerte critique', !(st.deleted||[]).length && (st.rep||[]).some(x=>/illisible/.test(x)&&/critical/.test(x)), {d:st.deleted,rep:st.rep});
// R1d : ordre normal B arrive après A (A en place) -> A annulé et remboursé, salon sur B
calls=[]; st={salon:{id:'s1',stripe_subscription_id:'sub_A'},subs:{sub_A:{id:'sub_A',status:'active',created:now-300,latest_invoice:'in_A'},sub_B:{id:'sub_B',status:'active',created:now-100}},inv:{id:'in_A',status:'paid',amount_paid:1499,payment_intent:'pi_A'}};
ap=await W.__usp(env,'s1','pro','sub_B','cus_1');
T('ordre normal -> A annulé/remboursé, salon activé sur B', (st.deleted||[]).includes('sub_A') && /pi_A/.test(st.refund||'') && calls.some(c=>c.startsWith('PATCH')&&/sub_B/.test(c)) && ap===true, {d:st.deleted,calls});
console.log('worker :',ok,'/',ok+ko);
