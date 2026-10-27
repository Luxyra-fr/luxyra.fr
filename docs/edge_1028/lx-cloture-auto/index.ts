// @ts-nocheck
// lx-cloture-auto v3 — 2026-10-28 (-2, Luxyra 6.8.0) — CLÔTURE Z AUTOMATIQUE (filet en cas d'oubli), réalignée sur l'application.
// v3 : (constat C3 de l'audit indépendant du 27-28/10/2026)
//  - la Z part du JOURNAL DES TICKETS (public.tickets du jour, mode de caisse de l'établissement, paires annulation du jour
//    exclues) — exactement la règle de lx_prive.z_journal_tickets / clotures_controle_journal et de « Recalculer depuis les
//    tickets enregistrés » de l'application (_lxZDoneDepuisTickets) — et non plus des rendez-vous ; les données de gestion
//    (collaborateur, phases, lignes, bons utilisés) sont reprises du rendez-vous correspondant (appointments, champs meta
//    compris) ou, à défaut, de raw_data du ticket ; les tickets créés par le serveur (paiements en ligne) y sont donc ;
//  - calculs = ceux de cloturerJournee() de l'application 6.7.0/6.8.0 (recopiés) : modèle bons v2 (_lxVentilV2 : vente de bon
//    à usage multiple hors CA, TVA 0, HT = TTC ; raw_data totalHorsCa / caHorsBum / bumUtilises / txTVAProd), retours partiels
//    (nbRetours, totalRetours, panier moyen sur les ventes), bons utilisés (totalBonsUtilises) ;
//  - cumuls de tickets du mois / de l'année (cumul_mois_tickets / cumul_annee_tickets) calculés (avant : 0 écrit, comme
//    l'application jusqu'à 6.7.0 — corrigé dans les deux) ; nombre de tickets = tickets numérotés (n° imprimé, à défaut n° serveur) ;
//  - empreinte de la Z inchangée : « Z|num|date|CA|HT|nb|annul|dernier hash|siret » (dernier hash = celui du dernier ticket
//    de la journée ou des jours précédents, comme v2) ;
//  - mode verify : recalcule les Z existantes avec ce même calcul et compare (totaux, HT, nombre, annulations, cumuls CA,
//    règlements, collaborateurs, empreinte) ; mode simulate ; mode run.
// v2 (2026-10-09) : _lxPayBuckets aligne sur l'application — un reglement « en ligne » va au poste « enligne ».
// Reserve au role service.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const J = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// ---- contexte attendu par le code recopie de l'application ----
var AP = [], T = [], SVC = [], TD = "", _lastTicketHash = "00000000";
var SALON_CONFIG = {}; var __TAUX = 20;
var __CTX = { CLOTURES: [] };
function lxTauxTVA(){ return __TAUX; }
function U(){ return crypto.randomUUID(); }

// ================= CODE RECOPIE DE L'APPLICATION (app.html 6.8.0, commentaires retires, logique inchangee) =================
function _lxPayBuckets(a){
  var b={cb:0,esp:0,chq:0,bon:0,vir:0,aut:0,enligne:0};
  function add(method,amt){
    var m=String(method||"").toLowerCase(); amt=Number(amt)||0;
    if(m.indexOf("ligne")>=0||m.indexOf("stripe")>=0||m.indexOf("online")>=0) b.enligne+=amt;
    else if(m.indexOf("esp")>=0) b.esp+=amt;
    else if(m.indexOf("cb")>=0) b.cb+=amt;
    else if(m.indexOf("ch")>=0) b.chq+=amt;
    else if(m.indexOf("bon")>=0) b.bon+=amt;
    else if(m.indexOf("vir")>=0) b.vir+=amt;
    else b.aut+=amt;
  }
  var _usedPayments=!!(a && a.payments && a.payments.length);
  if(_usedPayments){ a.payments.forEach(function(p){ add(p.method,p.amount); }); }
  else if(a){ add(a.met,a.pr); }
  try{
    if(_usedPayments && a){
      var _acOn=Number(a.acompte)||0;
      if(_acOn>0.004 && typeof _lxIsAcompteOnline==="function" && _lxIsAcompteOnline(a.acompteMode)){
        b.enligne+=Math.round(_acOn*100)/100;
      }
    }
  }catch(_eAc){}
  return b;
}
function _lxIsAcompteOnline(mode){
  var m=String(mode||"").toLowerCase();
  return m.indexOf("ligne")>=0 || m.indexOf("stripe")>=0 || m.indexOf("online")>=0;
}
function _lxEstRetour(a){
  try{ if(!a) return false; if(a.isRetour===true) return true;
    var its=a.items||[]; for(var i=0;i<its.length;i++){ if(its[i]&&its[i].isRetour===true) return true; } }catch(_e){}
  return false;
}
function _lxR2(x){ return Math.round((Number(x)||0)*100)/100; }
function _lxTxPrest(){ return Number(lxTauxTVA()); }
function _lxTxProdDefaut(){ var s=_lxTxPrest(); return (SALON_CONFIG && SALON_CONFIG.tvaProduits!=null && !isNaN(Number(SALON_CONFIG.tvaProduits)))?Number(SALON_CONFIG.tvaProduits):s; }
function _lxItemMontant(it){ return (Number(it&&it.price)||0)*(Number(it&&it.qty)||1)-(Number(it&&it.remise)||0); }
function _lxEstBum(it){ return !!(it && !it.isSep && it.isBon===true && it.bonUsage==="BUM"); }
function _lxTicketV2(a){
  if(!a) return false;
  if(Array.isArray(a.bonsUtil) && a.bonsUtil.length) return true;
  var its=a.items||[]; for(var i=0;i<its.length;i++){ if(_lxEstBum(its[i])) return true; }
  return false;
}
function _lxTauxLigne(it, txS, txP){ if(txS>0 && it && it.tvaTaux!=null && !isNaN(Number(it.tvaTaux))) return Number(it.tvaTaux); return (it&&it.isProd)?txP:txS; }
function _lxVentilV2(a){
  var pr=_lxR2(a&&a.pr), txS=_lxTxPrest(), txP=_lxTxProdDefaut();
  var S={}, ordre=[], hc=0;
  (a&&a.items||[]).forEach(function(it){
    if(!it||it.isSep) return; var m=_lxItemMontant(it);
    if(_lxEstBum(it)){ hc+=m; return; }
    var t=_lxTauxLigne(it,txS,txP), k=String(t)+"|"+(it.isProd?"Q":"P");
    if(!S[k]){ S[k]={taux:t, nat:it.isProd?"Q":"P", amt:0, b:0}; ordre.push(k); }
    S[k].amt+=m;
  });
  hc=_lxR2(hc); if(pr>=0){ if(hc>pr) hc=pr; } else { if(hc<pr) hc=pr; }
  var ca=_lxR2(pr-hc);
  (a&&Array.isArray(a.bonsUtil)?a.bonsUtil:[]).forEach(function(b){
    if(!b||b.usage==="BUM") return; var L=b.lignes||{};
    Object.keys(L).forEach(function(k){ var v=Number(L[k])||0; if(!S[k]){ var p=k.split("|"); S[k]={taux:Number(p[0]), nat:p[1]==="Q"?"Q":"P", amt:0, b:0}; ordre.push(k); } S[k].b+=v; });
  });
  var N=0; ordre.forEach(function(k){ S[k].n=S[k].amt-S[k].b; N+=S[k].n; });
  var reste=N-ca, cumul=0, vivants=ordre.filter(function(k){ return Math.abs(S[k].n)>0.0049; });
  if(Math.abs(N)<0.005){
    ordre.forEach(function(k){ S[k].ttc=0; });
    if(Math.abs(ca)>0.004){ var k0=ordre[0]||(String(txS)+"|P"); if(!S[k0]){ S[k0]={taux:txS,nat:"P"}; ordre.push(k0); } S[k0].ttc=ca; }
  } else {
    ordre.forEach(function(k){ S[k].ttc=0; });
    vivants.forEach(function(k,i){ if(i===vivants.length-1){ S[k].ttc=_lxR2(ca-cumul); } else { S[k].ttc=_lxR2(S[k].n-reste*S[k].n/N); cumul=_lxR2(cumul+S[k].ttc); } });
  }
  var prest=0, prod=0, R={}, ordreT=[];
  ordre.forEach(function(k){ var x=S[k]; if(x.nat==="Q") prod+=x.ttc; else prest+=x.ttc; var kt=String(x.taux); if(!R[kt]){ R[kt]={taux:x.taux, ttc:0}; ordreT.push(kt); } R[kt].ttc+=x.ttc; });
  var ht=0, tva=0, parTaux=[];
  ordreT.sort(function(p,q){ return Number(q)-Number(p); }).forEach(function(kt){ var r=R[kt]; r.ttc=_lxR2(r.ttc); if(Math.abs(r.ttc)<0.005) return; r.ht=_lxR2(r.ttc/(1+r.taux/100)); r.tva=_lxR2(r.ttc-r.ht); ht+=r.ht; tva+=r.tva; parTaux.push(r); });
  ht=_lxR2(ht); tva=_lxR2(tva);
  return {prest:_lxR2(prest), prod:_lxR2(prod), horsCa:hc, parTaux:parTaux, htCa:ht, ht:_lxR2(ht+hc), tva:tva, ttc:pr, ca:ca};
}
function _lxHorsCa(a){ return _lxTicketV2(a)?_lxVentilV2(a).horsCa:0; }
function _lxCaTtc(a){ var p=Number(a&&a.pr)||0; var h=_lxHorsCa(a); return h?_lxR2(p-h):p; }
function _lxBumPaye(a){ var s=0; ((a&&a.payments)||[]).forEach(function(p){ if(p&&p.bonUsage==="BUM") s+=Number(p.amount)||0; }); return _lxR2(s); }
function _splitPrestProd(a){
  if(typeof _lxTicketV2==="function" && _lxTicketV2(a)){ var _v2=_lxVentilV2(a); return {prest:_v2.prest, prod:_v2.prod, total:_v2.ttc, horsCa:_v2.horsCa}; }
  var realPr = Number((a&&a.pr)||0)||0;
  if(!a || !a.items || !a.items.length) return {prest:realPr, prod:0, total:realPr};
  var sumPrestI=0, sumProdI=0;
  for(var i=0;i<a.items.length;i++){
    var it=a.items[i]; if(!it || it.isSep) continue;
    var sub=(Number(it.price)||0)*(Number(it.qty)||1)-(Number(it.remise)||0);
    if(it.isProd) sumProdI+=sub; else sumPrestI+=sub;
  }
  var itemsTot=sumPrestI+sumProdI;
  if(Math.abs(itemsTot)<0.005 || itemsTot*realPr<0 || (itemsTot<0 && realPr===0)) return {prest:realPr, prod:0, total:realPr};
  var prod = Math.round((sumProdI/itemsTot)*realPr*100)/100;
  var prest = Math.round((realPr-prod)*100)/100;
  return {prest:prest, prod:prod, total:realPr};
}
function caPerCollabForAppt(a){
  var result = {};
  var totalPr = Number(a.pr) || 0;
  if(typeof _lxTicketV2==="function" && _lxTicketV2(a)) totalPr = _lxCaTtc(a);
  if(totalPr <= 0) return result;
  var phases = (typeof getApptPhases === "function") ? getApptPhases(a) : (a.aPhases || []);
  var workPhases = (phases || []).filter(function(p){ return p && p.t === "w"; });
  var distinctStIds = {};
  workPhases.forEach(function(p){
    var sid = p.stId || a.stId;
    if(sid != null) distinctStIds[String(sid)] = true;
  });
  var nbDistinctCollabs = Object.keys(distinctStIds).length;
  if(!workPhases.length || nbDistinctCollabs <= 1){
    var k = String(a.stId);
    result[k] = (result[k] || 0) + totalPr;
    return result;
  }
  var addonsTotal = 0;
  if(Array.isArray(a.items)){
    a.items.forEach(function(it){ addonsTotal += (Number(it.price) || 0); });
  }
  var basePr = Math.max(0, totalPr - addonsTotal);
  var phasesWithPrice = workPhases.map(function(p){
    var sv = (p.sId != null) ? (typeof gS === "function" ? gS(p.sId) : null) : null;
    var catalogPrice = sv ? (Number(sv.p) || 0) : 0;
    return { stId: p.stId || a.stId, catalogPrice: catalogPrice, dur: Number(p.d) || 0 };
  });
  var sumCatalog = phasesWithPrice.reduce(function(s, p){ return s + p.catalogPrice; }, 0);
  if(sumCatalog > 0){
    var factor = basePr / sumCatalog;
    phasesWithPrice.forEach(function(p){
      var k = String(p.stId);
      result[k] = (result[k] || 0) + (p.catalogPrice * factor);
    });
  } else {
    var sumDur = phasesWithPrice.reduce(function(s, p){ return s + p.dur; }, 0);
    if(sumDur > 0){
      phasesWithPrice.forEach(function(p){
        var k = String(p.stId);
        result[k] = (result[k] || 0) + (basePr * p.dur / sumDur);
      });
    } else {
      var kk = String(a.stId);
      result[kk] = (result[kk] || 0) + basePr;
    }
  }
  if(addonsTotal > 0){
    var ka = String(a.stId);
    result[ka] = (result[ka] || 0) + addonsTotal;
  }
  return result;
}
function getApptPhases(a){
  if(a.aPhases&&a.aPhases.length)return a.aPhases;
  var sv=gS(a.sId);
  if(sv&&sv.phases&&sv.phases.length){
    a.aPhases=JSON.parse(JSON.stringify(sv.phases));
    return a.aPhases;
  }
  return[];
}
function gS(id){for(var i=0;i<SVC.length;i++)if(SVC[i].id===id)return SVC[i];return null;}
var _LX_APPT_META_KEYS = ["operator_id","operator_name","poste","ts","extraClients","clientNom","clientPrenom",
  "isAcompte","isAcompteCancel","apptId","isRetenue","retenueKey","retenueRdv","origTkNum","origTkNums",
  "bonVenduRemise","offertRemise","dbNum","bonsUtil",
  "isAcompteEnLigne","acompteKey","acompteRdv","datePaiement","dateRemboursement","refundId",
  "lxEffets","lxEffetsAnnules","lxEffetsInverses","lxDoublonDe",
  "isRetour","retourRefId","retourRefTk","retourRefDate","retourMotif","lxEffetsRetour",
  "serveur","recetteKey","recetteType","ccCommandeId","ccNumero","bonCode","bonId","carteAboId","recetteRef","isRembEnLigne"];
function lxMapApptRow(a) {
  var _cId = a.client_id;
  if (!_cId && a.pass_type && ["H","F","E"].indexOf(a.pass_type) >= 0) { _cId = "passage-" + a.pass_type; }
  else if (!_cId && a.comment) {
    if (a.comment.indexOf("passage-E") >= 0) _cId = "passage-E";
    else if (a.comment.indexOf("passage-H") >= 0) _cId = "passage-H";
    else if (a.comment.indexOf("passage-F") >= 0) _cId = "passage-F";
  }
  var _ap = {
    id: a.id, cId: _cId, sId: a.service_id, stId: a.collab_id,
    date: a.date_rdv, time: a.heure, pr: Number(a.prix),
    heureEncaiss: a.heure_encaissement || null,
    brutTotal: a.brut_total ? Number(a.brut_total) : undefined,
    remise: Number(a.remise || 0),
    st: a.status, met: a.mode_paiement,
    tkNum: a.ticket_num, hash: a.hash, prevHash: a.prev_hash, hashAlgo: a.hash_algo,
    items: a.items || [], comment: a.comment || "",
    aPhases: a.a_phases || [],
    clients: a.clients || [], fromCaisse: a.from_caisse || false,
    cancelled: a.cancelled, cancelReason: a.cancel_reason,
    isCancel: a.is_cancel === true,
    cancelRef: (a.cancel_ref != null ? a.cancel_ref : null),
    contraSameDay: a.contra_same_day === true,
    payments: (a.payments && Array.isArray(a.payments) && a.payments.length > 0) ? a.payments : null
  };
  if (a.cancelled) {
    if (a.cancel_date) _ap.cancelDate = String(a.cancel_date).slice(0, 10);
    if (a.cancel_reason) _ap.cancelMotif = a.cancel_reason;
  }
  if (_ap.items && _ap.items.length) {
    for (var _ii = 0; _ii < _ap.items.length; _ii++) {
      var _it = _ap.items[_ii];
      if (_it && _it.isAcompteData) {
        _ap.acompte = _it.acompte; _ap.acompteMode = _it.acompteMode;
        _ap.acompteDate = _it.acompteDate; _ap.acompteTkNum = _it.acompteTkNum || null;
        break;
      }
    }
  }
  if ((_ap.st === "done" || _ap.tkNum) && _ap.items && _ap.items.length) {
    _ap.items = _ap.items.filter(function (x) { return !(x && x.isAcompteData && /ligne|stripe|online/i.test(String(x.acompteMode || ""))); });
  }
  if (a.lieu) _ap.lieu = a.lieu;
  if (a.adresse_domicile) _ap.adresse = a.adresse_domicile;
  if (a.printed === true) _ap.printed = true;
  try {
    if (a.meta && typeof a.meta === "object" && !Array.isArray(a.meta)) {
      for (var _mk in a.meta) { if (Object.prototype.hasOwnProperty.call(a.meta, _mk) && _LX_APPT_META_KEYS.indexOf(_mk) >= 0) _ap[_mk] = a.meta[_mk]; }
    }
  } catch (_eM) {}
  return _ap;
}
// Journal : lignes retenues par la Z (même règle que _lxZJournalCalc / lx_prive.z_journal_tickets) + total
function _lxZJournalRetenues(rows){
  var tks={}; rows.forEach(function(r){ if(r.tk!=null&&r.tk!=="") tks[String(r.tk)]=1; });
  var refs={};
  rows.forEach(function(r){ var ic=String(r.isCancel)==="true", sd=String(r.contraSameDay)==="true";
    if(sd||(ic&&r.cancelRef!=null&&tks[String(r.cancelRef)])){ r._lxContraSD=true; if(r.cancelRef!=null) refs[String(r.cancelRef)]=1; } });
  var total=0; rows.forEach(function(r){ total+=Number(r.total_ttc)||0; });
  return { retenues: rows.filter(function(r){ return !r._lxContraSD && !(r.tk!=null&&refs[String(r.tk)]); }), total: Math.round(total*100)/100 };
}
// Liste « encaissements du jour » depuis le journal (même logique que _lxZDoneDepuisTickets de l'application) ;
// base de gestion = rendez-vous correspondant (appointments), à défaut raw_data du ticket.
function _lxZDoneDepuisJournal(jour, rows, corr){
  var dispo=AP.filter(function(a){ return a&&a.st==="done"&&a.date===jour; }), pris={};
  var corrParTk={}; (corr||[]).forEach(function(cr){ if(cr&&cr.ticket_id) (corrParTk[cr.ticket_id]=corrParTk[cr.ticket_id]||[]).push(cr); });
  return rows.map(function(r){
    var rid=String(r.rid||""), nu=rid.replace(/^online_/,""), base=null;
    for(var i=0;i<dispo.length;i++){ var a=dispo[i]; if(pris[i]) continue;
      var aid=String(a.id||""), anu=aid.replace(/^online_/,"");
      if((rid&&(aid===rid||anu===nu))||(r.tk!=null&&String(a.tkNum)===String(r.tk)&&Math.abs((Number(a.pr)||0)-(Number(r.total_ttc)||0))<0.005)){ base=a; pris[i]=1; break; } }
    var rawB=(r.raw_data&&typeof r.raw_data==="object")?r.raw_data:null;
    var o=base?Object.assign({},base):(rawB?Object.assign({},rawB,{id:rid||r.id, st:"done", date:jour}):{id:rid||r.id, st:"done", date:jour, stId:r.collaborateur_id, items:Array.isArray(r.items)?r.items:[]});
    if(!base){ o.stId=(o.stId!=null?o.stId:r.collaborateur_id); if(!Array.isArray(o.items)) o.items=Array.isArray(r.items)?r.items:[]; o.heureEncaiss=r.heure_ticket?String(r.heure_ticket).slice(0,5):(o.heureEncaiss||null); }
    var _bumP=_lxBumPaye(o);
    o.pr=Math.round((Number(r.total_ttc)||0)*100)/100;
    o.tkNum=(r.tk!=null&&r.tk!=="")?(Number(r.tk)||r.tk):(o.tkNum||r.num||null);
    o.cancelled=false; o.remise=Number(r.total_remise)||0; if(r.total_brut!=null) o.brutTotal=Number(r.total_brut);
    var dp=(r.detail_paiement&&typeof r.detail_paiement==="object"&&!Array.isArray(r.detail_paiement))?r.detail_paiement:null, pays=[];
    if(dp&&Object.keys(dp).length) Object.keys(dp).forEach(function(k){ pays.push({method:k,amount:Number(dp[k])||0}); });
    else pays.push({method:r.mode_paiement||"aut",amount:o.pr});
    (corrParTk[r.id]||[]).forEach(function(cr){ (cr.lignes||[]).forEach(function(l){ if(l) pays.push({method:l.mode,amount:Number(l.montant)||0}); }); });
    o.payments=pays; o.acompte=0; o.met=r.mode_paiement||o.met; o._lxDepuisJournal=true; o._bumPaye=_bumP;
    return o;
  });
}
// Calcul de la Z (cloturerJournee de l'application, sur la liste du journal ; effets de bord retirés)
function calculerZ(done){
  var annul=AP.filter(function(a){return a.cancelled&&a.cancelDate===TD;});
  var totalPrest=0, totalProd=0, totalHorsCa=0, totalBumUtil=0;
  done.forEach(function(a){
    var sp=_splitPrestProd(a);
    totalPrest+=sp.prest; totalProd+=sp.prod;
    if(sp.horsCa) totalHorsCa+=sp.horsCa;
    var _bmU=(a._bumPaye!=null)?a._bumPaye:_lxBumPaye(a); if(_bmU) totalBumUtil+=_bmU;
  });
  totalPrest=Math.round(totalPrest*100)/100;
  totalProd=Math.round(totalProd*100)/100;
  totalHorsCa=Math.round(totalHorsCa*100)/100; totalBumUtil=Math.round(totalBumUtil*100)/100;
  var totalCA=totalPrest+totalProd;
  if(totalHorsCa) totalCA=Math.round((totalCA+totalHorsCa)*100)/100;
  var txTVA=lxTauxTVA();
  var _dualTVA=(SALON_CONFIG.tvaProduits!=null && Number(SALON_CONFIG.tvaProduits)!==Number(txTVA));
  var txTVAprod=_dualTVA?Number(SALON_CONFIG.tvaProduits):Number(txTVA);
  var prestHT=Math.round(totalPrest/(1+txTVA/100)*100)/100;
  var prestTVA=Math.round((totalPrest-prestHT)*100)/100;
  var prodHT=Math.round(totalProd/(1+txTVAprod/100)*100)/100;
  var prodTVA=Math.round((totalProd-prodHT)*100)/100;
  var totalHT=_dualTVA?Math.round((prestHT+prodHT)*100)/100:Math.round(totalCA/(1+txTVA/100)*100)/100;
  if(totalHorsCa) totalHT=Math.round(((_dualTVA?(prestHT+prodHT):Math.round((totalCA-totalHorsCa)/(1+txTVA/100)*100)/100)+totalHorsCa)*100)/100;
  var totalTVA=Math.round((totalCA-totalHT)*100)/100;
  var tkNums=done.map(function(a){return a.tkNum||0;}).filter(function(n){return n>0;});
  var tkMin=tkNums.length?Math.min.apply(null,tkNums):0;
  var tkMax=tkNums.length?Math.max.apply(null,tkNums):0;
  var heures=done.map(function(a){
    if(a.heureEncaiss && /^\d{2}:\d{2}$/.test(String(a.heureEncaiss).slice(0,5))) return String(a.heureEncaiss).slice(0,5);
    if(a.time && typeof a.time==="string" && /^\d{2}:\d{2}$/.test(a.time.slice(0,5))) return a.time.slice(0,5);
    return "";
  }).filter(function(h){return h;}).sort();
  var hPremier=heures.length?heures[0]:"--:--";
  var hDernier=heures.length?heures[heures.length-1]:"--:--";
  var perSty={};T.forEach(function(t){perSty[t.id]={n:t.n,ca:0,nb:0};});
  done.forEach(function(a){
    var dist = (typeof caPerCollabForAppt === "function") ? caPerCollabForAppt(a) : null;
    if(dist && Object.keys(dist).length){
      Object.keys(dist).forEach(function(sid){
        var key = +sid; if(!perSty[key]) key = sid;
        if(perSty[key]) perSty[key].ca += dist[sid];
      });
      if(perSty[a.stId]&&a.tkNum) perSty[a.stId].nb++;
    } else if(perSty[a.stId]){
      perSty[a.stId].ca+=a.pr;if(a.tkNum)perSty[a.stId].nb++;
    }
  });
  var nbTicketsNum=done.filter(function(a){ return !!a.tkNum; }).length;
  var _retZ=done.filter(function(a){ return _lxEstRetour(a); }), _retZTot=0; _retZ.forEach(function(a){ _retZTot+=Number(a.pr)||0; });
  var _nbVentesZ=nbTicketsNum-_retZ.filter(function(a){ return !!a.tkNum; }).length;
  var totalRemises=0;var brutTotalGlobal=0;
  done.forEach(function(a){totalRemises+=(a.remise||0);brutTotalGlobal+=(a.brutTotal||a.pr);});
  var totalBonsUtilises=0; done.forEach(function(a){ totalBonsUtilises+=(Number(a.bonVenduRemise)||0)+(Number(a.offertRemise)||0); });
  var totalAnnul=0;annul.forEach(function(a){totalAnnul+=a.pr||0;});
  var _nextClotureNum = (function(){ var m=0; __CTX.CLOTURES.forEach(function(x){if(x.num && x.num>m)m=x.num;}); return m+1; })();
  var c={id:U(),date:TD,ts:new Date().toISOString(),num:_nextClotureNum,
    nbTickets:nbTicketsNum,nbAnnul:annul.length,totalAnnul:totalAnnul,
    tkMin:tkMin,tkMax:tkMax,hPremier:hPremier,hDernier:hDernier,
    totalCA:totalCA,totalPrest:totalPrest,totalProd:totalProd,
    totalHT:totalHT,totalTVA:totalTVA,txTVA:txTVA,
    prestHT:prestHT,prestTVA:prestTVA,prodHT:prodHT,prodTVA:prodTVA,
    totalRemises:totalRemises,brutTotalGlobal:brutTotalGlobal,totalBonsUtilises:Math.round(totalBonsUtilises*100)/100,
    panierMoyen:(_retZ.length?(_nbVentesZ>0?Math.round(totalCA/_nbVentesZ*100)/100:0):(nbTicketsNum>0?Math.round(totalCA/nbTicketsNum*100)/100:0)),
    nbRetours:_retZ.length, totalRetours:Math.round(_retZTot*100)/100,
    details:{cb:0,esp:0,chq:0,bon:0,vir:0,aut:0,enligne:0},
    perSty:perSty,hash:""};
  if(totalHorsCa){ c.totalHorsCa=totalHorsCa; c.caHorsBum=Math.round((totalCA-totalHorsCa)*100)/100; }
  if(totalBumUtil) c.bumUtilises=totalBumUtil;
  if(_dualTVA) c.txTVAProd=txTVAprod;
  done.forEach(function(a){var bk=_lxPayBuckets(a);c.details.cb+=bk.cb;c.details.esp+=bk.esp;c.details.chq+=bk.chq;c.details.bon+=bk.bon;c.details.vir+=bk.vir;c.details.aut+=bk.aut;c.details.enligne+=(bk.enligne||0);});
  Object.keys(c.details).forEach(function(k){ c.details[k]=Math.round(c.details[k]*100)/100; });
  var moisKey=TD.slice(0,7), anKey=TD.slice(0,4);
  var clotMois=__CTX.CLOTURES.filter(function(x){return x.date.indexOf(moisKey)===0;});
  var cumulMois=totalCA, cumulMoisTk=nbTicketsNum; clotMois.forEach(function(x){cumulMois+=x.totalCA; cumulMoisTk+=(Number(x.nbTickets)||0);});
  c.cumulMois=Math.round(cumulMois*100)/100; c.cumulMoisTk=cumulMoisTk;
  var clotAn=__CTX.CLOTURES.filter(function(x){return x.date.indexOf(anKey)===0;});
  var cumulAn=totalCA, cumulAnTk=nbTicketsNum; clotAn.forEach(function(x){cumulAn+=x.totalCA; cumulAnTk+=(Number(x.nbTickets)||0);});
  c.cumulAnnuel=Math.round(cumulAn*100)/100; c.cumulAnTk=cumulAnTk;
  var _maxPerp=0; __CTX.CLOTURES.forEach(function(x){ if(typeof x.cumulPerpetuelCA==="number"&&x.cumulPerpetuelCA>_maxPerp)_maxPerp=x.cumulPerpetuelCA; });
  c.cumulPerpetuelCA=Math.round((_maxPerp+totalCA)*100)/100;
  c.hashChaine="Z|"+c.num+"|"+c.date+"|"+c.totalCA.toFixed(2)+"|"+c.totalHT.toFixed(2)+"|"+c.nbTickets+"|"+c.nbAnnul+"|"+_lastTicketHash+"|"+SALON_CONFIG.siret;
  c.hashAlgo="SHA-256";
  return c;
}
// ================= FIN DU CODE RECOPIE =================
async function sha256Hex(s){ const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase(); }

function roleDuJeton(req){ try{ const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""); const p=t.split(".")[1]; return String(JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/"))).role||""); }catch{ return ""; } }
function aujourdHuiParis(){ return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
const r2 = (x) => Math.round((Number(x)||0)*100)/100;

async function toutLire(table, cols, filtre){
  const out=[]; let from=0; const pas=1000;
  while(true){
    let q=sb.from(table).select(cols).range(from, from+pas-1); q=filtre(q);
    const { data, error } = await q; if(error) throw new Error(table+": "+error.message);
    out.push(...(data||[])); if(!data || data.length<pas) break; from+=pas;
  }
  return out;
}

async function chargerSalon(salonId){
  const { data: s, error } = await sb.from("salons").select("id,nom,siret,taux_tva,taux_tva_produits,status,mode_caisse").eq("id", salonId).single();
  if(error || !s) throw new Error("salon introuvable");
  const collabs = await toutLire("collaborateurs","id,nom",q=>q.eq("salon_id",salonId).order("id"));
  const svcs = await toutLire("services","id,prix,phases",q=>q.eq("salon_id",salonId).order("id"));
  const appts = await toutLire("appointments","*",q=>q.eq("salon_id",salonId).order("id"));
  const clos = await toutLire("clotures","id,num,date_cloture,timestamp_cloture,total_ca,total_ht,nb_tickets,nb_annulations,detail_paiements,detail_collabs,cumul_mois_ca,cumul_annee_ca,cumul_mois_tickets,cumul_annee_tickets,cumul_perpetuel_ca,hash,mode_caisse",q=>q.eq("salon_id",salonId).order("num"));
  return { s, collabs, svcs, appts, clos };
}
// Journal des tickets d'une journée (mode de caisse) + corrections de règlement avant clôture
async function lireJournal(salonId, D, mode){
  const rows = await toutLire("tickets","id,num,date_ticket,heure_ticket,total_ttc,total_ht,total_remise,total_brut,mode_paiement,detail_paiement,status,mode_caisse,items,collaborateur_id,raw_data,rid:raw_data->>id,tk:raw_data->>tkNum,isCancel:raw_data->>isCancel,cancelRef:raw_data->>cancelRef,contraSameDay:raw_data->>contraSameDay",
    q=>q.eq("salon_id",salonId).eq("date_ticket",D).order("num"));
  const ret = rows.filter(r=>r && r.status!=="cancelled" && (!r.mode_caisse || !mode || r.mode_caisse===mode));
  const { data: corr } = await sb.from("corrections_reglement").select("ticket_id,lignes,avant_cloture").eq("salon_id",salonId).eq("ticket_date",D).eq("avant_cloture",true);
  return { rows: ret, corr: corr || [] };
}

// Etat « a la fin de la journee D » : une annulation faite APRES D n'existait pas encore.
function preparerContexte(base, D, cloturesAvant){
  const taux = (base.s.taux_tva===null || base.s.taux_tva===undefined || base.s.taux_tva==="") ? 20 : Number(base.s.taux_tva);
  __TAUX = isNaN(taux) ? 20 : taux;
  SALON_CONFIG = { siret: base.s.siret || "", tvaProduits: (base.s.taux_tva_produits!=null) ? Number(base.s.taux_tva_produits) : __TAUX };
  if(__TAUX===0) SALON_CONFIG.tvaProduits = 0;
  T = base.collabs.map(c=>({ id:c.id, n:c.nom }));
  SVC = base.svcs.map(v=>({ id:v.id, p:Number(v.prix), phases:v.phases||[] }));
  AP = base.appts.map(lxMapApptRow).map(a=>{
    if(a.cancelled && a.cancelDate && a.cancelDate > D){ const b={...a}; b.cancelled=false; delete b.cancelDate; delete b.cancelMotif; return b; }
    return a;
  });
  TD = D;
  const avecHash = AP.filter(a=>a.hash && a.date && a.date<=D).sort((a,b)=>(b.tkNum||0)-(a.tkNum||0));
  _lastTicketHash = avecHash.length ? (avecHash[0].hash||"00000000") : "00000000";
  __CTX.CLOTURES = cloturesAvant.map(z=>({ num:z.num, date:z.date_cloture, totalCA:Number(z.total_ca), nbTickets:Number(z.nb_tickets)||0, cumulPerpetuelCA:Number(z.cumul_perpetuel_ca) }));
}
async function calculerJour(base, D, cloturesAvant){
  preparerContexte(base, D, cloturesAvant);
  const j = await lireJournal(base.s.id, D, base.s.mode_caisse || null);
  const jr = _lxZJournalRetenues(j.rows);
  const done = _lxZDoneDepuisJournal(D, jr.retenues, j.corr);
  const c = calculerZ(done);
  return { c, journalTotal: jr.total, journalNb: jr.retenues.length };
}

function comparer(c, z){
  const diffs=[];
  const eq=(a,b)=>Math.abs((Number(a)||0)-(Number(b)||0))<0.006;
  if(!eq(c.totalCA,z.total_ca)) diffs.push("total_ca "+r2(c.totalCA)+" vs "+z.total_ca);
  if(!eq(c.totalHT,z.total_ht)) diffs.push("total_ht "+r2(c.totalHT)+" vs "+z.total_ht);
  if(c.nbTickets!==z.nb_tickets) diffs.push("nb_tickets "+c.nbTickets+" vs "+z.nb_tickets);
  if(c.nbAnnul!==z.nb_annulations) diffs.push("nb_annul "+c.nbAnnul+" vs "+z.nb_annulations);
  if(!eq(c.cumulMois,z.cumul_mois_ca)) diffs.push("cumul_mois "+r2(c.cumulMois)+" vs "+z.cumul_mois_ca);
  if(!eq(c.cumulAnnuel,z.cumul_annee_ca)) diffs.push("cumul_annee "+r2(c.cumulAnnuel)+" vs "+z.cumul_annee_ca);
  if(Number(z.cumul_mois_tickets)>0 && c.cumulMoisTk!==Number(z.cumul_mois_tickets)) diffs.push("cumul_mois_tickets "+c.cumulMoisTk+" vs "+z.cumul_mois_tickets);
  const dp=z.detail_paiements||{}; ["cb","esp","chq","bon","vir","aut","enligne"].forEach(k=>{ if(dp[k]!==undefined && !eq(c.details[k],dp[k])) diffs.push("paiement."+k+" "+r2(c.details[k])+" vs "+dp[k]); });
  const dc=z.detail_collabs||{}; Object.keys(c.perSty).forEach(k=>{ const o=dc[k]; if(!o){ if(c.perSty[k].nb>0) diffs.push("collab "+k+" absent"); return; } if(!eq(c.perSty[k].ca,o.ca)||c.perSty[k].nb!==o.nb) diffs.push("collab "+k+" "+r2(c.perSty[k].ca)+"/"+c.perSty[k].nb+" vs "+r2(o.ca)+"/"+o.nb); });
  return { diffs, hashOk: (c.hash===z.hash) };
}

async function journeesAClore(base, salonId){
  const auj = aujourdHuiParis();
  const mode = base.s.mode_caisse || null;
  const tks = await toutLire("tickets","date_ticket,status,mode_caisse",q=>q.eq("salon_id",salonId).neq("status","cancelled").lt("date_ticket",auj));
  const avecZ = new Set(base.clos.map(z=>z.date_cloture));
  return [...new Set(tks.filter(t=>!t.mode_caisse || !mode || t.mode_caisse===mode).map(t=>t.date_ticket))].filter(d=>!avecZ.has(d)).sort();
}

Deno.serve(async (req) => {
  if (roleDuJeton(req) !== "service_role") return J(403, { error: "reserve au service" });
  let body = {}; try { body = await req.json(); } catch {}
  const mode = body.mode || "simulate";
  try {
    if (mode === "verify") {
      const base = await chargerSalon(body.salon_id);
      const res = []; let ok=0, hashOk=0, n=0;
      for (let i=0;i<base.clos.length;i++){
        const z=base.clos[i]; if(body.depuis && z.date_cloture < body.depuis) continue;
        n++;
        const { c } = await calculerJour(base, z.date_cloture, base.clos.slice(0,i));
        c.num = z.num; // le numero reel (pour le hash)
        c.hash = await sha256Hex("Z|"+c.num+"|"+c.date+"|"+c.totalCA.toFixed(2)+"|"+c.totalHT.toFixed(2)+"|"+c.nbTickets+"|"+c.nbAnnul+"|"+_lastTicketHash+"|"+SALON_CONFIG.siret);
        const cmp = comparer(c, z);
        if(!cmp.diffs.length) ok++; if(cmp.hashOk) hashOk++;
        if(cmp.diffs.length || !cmp.hashOk) res.push({ num:z.num, date:z.date_cloture, hash: cmp.hashOk, diffs: cmp.diffs.slice(0,8) });
      }
      return J(200, { version: 3, salon: base.s.nom, z_verifiees: n, totaux_identiques: ok, hash_identiques: hashOk, ecarts: res.slice(0,60) });
    }
    // simulate / run
    const { data: salons } = await sb.from("salons").select("id,nom,status").in("status",["active","trial"]);
    const cibles = (salons||[]).filter(s=>!body.salon_id || s.id===body.salon_id);
    const rapport = [];
    for (const s of cibles){
      const base = await chargerSalon(s.id);
      const dates = await journeesAClore(base, s.id);
      for (const D of dates){
        const { c, journalTotal } = await calculerJour(base, D, base.clos);
        c.hash = await sha256Hex(c.hashChaine); delete c.hashChaine;
        c.auto = true; c.operator_name = "Clôture automatique"; c.auto_motif = "Journée non clôturée manuellement"; c.source = "tickets"; c.lxCalcVersion = 3;
        const ligne = { salon: s.nom, date: D, num: c.num, total_ca: r2(c.totalCA), total_ht: r2(c.totalHT), nb_tickets: c.nbTickets, nb_annul: c.nbAnnul, hors_ca_bum: c.totalHorsCa || 0, hash: c.hash.slice(0,12)+"..." };
        if (Math.abs(c.totalCA - journalTotal) > 0.005) { rapport.push({ ...ligne, ecrit: false, erreur: "total calculé différent du journal ("+journalTotal+")" }); continue; }
        if (mode !== "run") { rapport.push({ ...ligne, ecrit: false }); continue; }
        const { data: deja } = await sb.from("clotures").select("id").eq("salon_id", s.id).eq("date_cloture", D).limit(1);
        if (deja && deja.length) { rapport.push({ ...ligne, ecrit: false, raison: "deja close" }); continue; }
        const raw = {}; for (const k in c) { if (k!=="id" && typeof c[k] !== "function" && typeof c[k] !== "undefined") raw[k]=c[k]; }
        const data = { id: c.id, salon_id: s.id, date_cloture: c.date, num: c.num, total_ca: c.totalCA, total_ht: c.totalHT,
          nb_tickets: c.nbTickets, nb_annulations: c.nbAnnul, detail_paiements: c.details || {}, detail_collabs: c.perSty || {},
          cumul_mois_ca: c.cumulMois || 0, cumul_mois_tickets: c.cumulMoisTk || 0, cumul_annee_ca: c.cumulAnnuel || 0, cumul_annee_tickets: c.cumulAnTk || 0,
          hash: c.hash, hash_algo: c.hashAlgo || "SHA-256", solde_reel: null, ecart_caisse: null, ecart_justification: null, raw_data: raw };
        const ins = await sb.from("clotures").insert(data).select("id,num").single();
        if (ins.error) { rapport.push({ ...ligne, ecrit: false, erreur: ins.error.message }); continue; }
        const lk = await sb.from("tickets").update({ locked: true, cloture_id: ins.data.id }).eq("salon_id", s.id).eq("date_ticket", D).eq("locked", false).select("id");
        await sb.from("audit_log").insert({ salon_id: s.id, action: "CLOTURE_Z", details: D+" - Z#"+c.num+" - "+c.nbTickets+" tickets - "+r2(c.totalCA).toFixed(2)+"E (cloture automatique : journee non cloturee)", operator_name: "Clôture automatique" });
        base.clos.push({ num: c.num, date_cloture: D, total_ca: c.totalCA, nb_tickets: c.nbTickets, cumul_perpetuel_ca: null });
        rapport.push({ ...ligne, ecrit: true, tickets_verrouilles: (lk.data||[]).length, erreur_verrou: lk.error ? lk.error.message : null });
      }
    }
    return J(200, { version: 3, mode, aujourdhui: aujourdHuiParis(), resultat: rapport });
  } catch (e) {
    return J(500, { error: String(e?.message || e) });
  }
});
