let calls=[]; let ok=0,ko=0; const T=(n,c,d)=>{ if(c) ok++; else { ko++; console.log('KO',n,JSON.stringify(d).slice(0,400)); } };
let st={};
globalThis.fetch=async(u,o={})=>{ u=String(u); const m=(o.method||'GET'); calls.push(m+' '+u.replace(/https:\/\/[^/]+/,'')+(o.body?' '+String(o.body).slice(0,200):''));
  const J=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
  if(u.includes('/rest/v1/salons?id=eq.')&&m==='GET') return J([st.salon]);
  if(u.includes('/rest/v1/salons?id=eq.')&&m==='PATCH') return st.patchFail? new Response('{"message":"refus trigger"}',{status:400}) : J(st.patchRows===0?[]:[{id:'s1'}]);
  if(u.includes('app_config')) return J([]);
  if(u.includes('api.stripe.com/v1/subscriptions/')&&m==='GET') return J(st.subs[u.split('subscriptions/')[1].split('?')[0]]||{error:{message:'nf'}});
  if(u.includes('api.stripe.com/v1/subscriptions/')&&m==='DELETE') return J({id:'x',status:'canceled'});
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
// 2 abonnement programmé pour s'arrêter -> autorisé
st.subs.sub_A.cancel_at_period_end=true; st.open=[{id:'cs_old',mode:'subscription',metadata:{salon_id:'s1'}},{id:'cs_autre',mode:'payment',metadata:{salon_id:'s1'}}];
r=await (await W.__hcc(req({salon_id:'s1',plan:'pro',email:'a@b.fr'}),env)).json();
T('abonnement qui s arrête -> session créée', !!r.url, r);
T('session abonnement ouverte expirée (1 seule, pas le paiement)', st.expired===1, st);
// 3 suspendu sans abonnement, SIRET manquant
st={salon:{id:'s1',siret:'',status:'suspended'},subs:{}};
r=await (await W.__hcc(req({salon_id:'s1',plan:'essential',email:'a@b.fr'}),env)).json();
T('sans SIRET -> siret_requis', r.code==='siret_requis', r);
st.salon.siret='73282932000074';
r=await (await W.__hcc(req({salon_id:'s1',plan:'essential',email:'a@b.fr'}),env)).json();
T('suspendu sans abonnement -> session créée', !!r.url, r);
// 4 updateSalonPlan : ancien récent -> remboursé
st={salon:{id:'s1',stripe_subscription_id:'sub_old'},subs:{sub_old:{id:'sub_old',created:now-600,latest_invoice:'in_1'}},inv:{id:'in_1',status:'paid',amount_paid:1499,payments:{data:[{payment:{payment_intent:'pi_1'}}]}}};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('abonnement double récent -> remboursé (pi, idempotent)', /payment_intent=pi_1/.test(st.refund||'') && st.idem==='lx-abo-double-sub_old', st);
// 5 ancien vieux -> pas de remboursement
st={salon:{id:'s1',stripe_subscription_id:'sub_old'},subs:{sub_old:{id:'sub_old',created:now-40*86400,latest_invoice:'in_1'}},inv:{id:'in_1',status:'paid',amount_paid:1499,payment_intent:'pi_1'}};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('ancien abonnement (40 j) -> jamais remboursé', !st.refund, st);
// 6 même abonnement (webhook rejoué) -> rien
st={salon:{id:'s1',stripe_subscription_id:'sub_new'},subs:{}}; calls=[];
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('webhook rejoué -> ni annulation ni remboursement', !calls.some(c=>c.startsWith('DELETE'))&&!st.refund, calls);
// 7 activation refusée -> alerte critique
st={salon:{id:'s1'},subs:{},patchFail:true};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation refusée -> alerte critique', (st.rep||[]).some(x=>/NON activ/.test(x)&&/critical/.test(x)), st.rep);
st={salon:{id:'s1'},subs:{},patchRows:0};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation 0 ligne -> alerte', (st.rep||[]).some(x=>/NON activ/.test(x)), st.rep);
st={salon:{id:'s1'},subs:{}};
await W.__usp(env,'s1','pro','sub_new','cus_1');
T('activation OK -> pas d alerte', !(st.rep||[]).length, st.rep);
console.log('worker :',ok,'/',ok+ko);
