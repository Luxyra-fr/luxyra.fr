# -*- coding: utf-8 -*-
import re, sys, html as H
sys.path.insert(0,'/sessions/quirky-affectionate-hypatia/gen')
from metiers import M
ROOT='/sessions/quirky-affectionate-hypatia/luxyra.fr/'
pro=open(ROOT+'pro.html',encoding='utf-8').read()
style=pro[pro.index('<style>'):pro.index('</style>')+8]
nav=pro[pro.index('<nav id="nav">'):pro.index('</nav>')+6]
nav=nav.replace('href="#fonctions"','href="/pro#fonctions"').replace('href="#parrainage"','href="/pro#parrainage"').replace('<a href="#" class="n-logo">','<a href="/pro" class="n-logo">')
nav=nav.replace('<a href="/pro#fonctions" onclick="lxCloseNav()">Fonctionnalités</a>','<a href="/pro#fonctions" onclick="lxCloseNav()">Fonctionnalités</a>\n    <a href="/demo" onclick="lxCloseNav()">Démo</a>')
tail=pro[pro.index('<footer>'):pro.index('</body>')]
tail=tail.replace('<a href="#" class="n-logo"','<a href="/pro" class="n-logo"')

EXTRA_CSS='''<style>
.mt-hero{padding:130px 24px 40px;text-align:center;max-width:var(--max);margin:0 auto}
.mt-ico{font-size:46px;margin-bottom:10px}
.mt-kicker{color:var(--gold);font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin-bottom:12px}
.mt-hero h1{font-family:var(--f2);font-size:clamp(32px,6vw,54px);line-height:1.1;font-weight:600;margin-bottom:16px}
.mt-hero h1 em{color:var(--gold);font-style:italic}
.mt-hero p.sub{color:var(--text2);font-size:clamp(15px,2.2vw,18px);max-width:680px;margin:0 auto 22px}
.mt-pts{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:26px}
.mt-pts span{border:1px solid var(--border);background:var(--card);border-radius:50px;padding:8px 14px;font-size:13px;color:var(--text)}
.mt-pts span:before{content:"✓ ";color:var(--gold);font-weight:800}
.mt-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.mt-btn{display:inline-block;padding:14px 26px;border-radius:12px;font-weight:800;font-size:15px}
.mt-btn.gold{background:linear-gradient(135deg,#d4a843,#b8960f);color:#111}
.mt-btn.line{border:1.5px solid var(--gold);color:var(--gold)}
.demo-wrap{max-width:1180px;margin:10px auto 0;padding:0 16px}
.demo-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:12px}
.demo-tabs button{background:var(--card);border:1px solid var(--border);color:var(--text2);border-radius:50px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--f1)}
.demo-tabs button.on{background:rgba(212,168,67,.15);border-color:var(--gold);color:var(--gold)}
.demo-frame{position:relative;border:1px solid rgba(212,168,67,.35);border-radius:18px;overflow:hidden;background:#0a0a0f;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(212,168,67,.05)}
.demo-frame .bar{display:flex;align-items:center;gap:6px;padding:9px 14px;background:#111118;border-bottom:1px solid var(--border);font-size:12px;color:var(--text3)}
.demo-frame .bar i{width:10px;height:10px;border-radius:50%;background:#3a3a44;display:inline-block}
.demo-frame .bar b{margin-left:8px;font-weight:600;color:var(--text2)}
.demo-stage{position:relative;width:100%;overflow:hidden}
.demo-stage iframe{position:absolute;top:0;left:0;border:0;transform-origin:0 0;background:#0a0a0f}
.demo-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:14px}
.demo-note{text-align:center;color:var(--text3);font-size:12px;margin-top:10px}
.mt-feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;max-width:var(--max);margin:0 auto;padding:0 20px}
.mt-feat{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px}
.mt-feat .i{font-size:26px;margin-bottom:8px}
.mt-feat h3{font-family:var(--f2);font-size:21px;font-weight:600;margin-bottom:6px;color:var(--text)}
.mt-feat p{color:var(--text2);font-size:14px}
.mt-sec{padding:70px 0 10px}
.mt-sec h2{font-family:var(--f2);font-size:clamp(26px,4.5vw,40px);font-weight:600;text-align:center;margin-bottom:8px}
.mt-sec h2 em{color:var(--gold);font-style:italic}
.mt-sec .lead{text-align:center;color:var(--text2);margin:0 auto 28px;max-width:620px;padding:0 20px}
.mt-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:900px;margin:0 auto;padding:0 20px}
.mt-mode{border:1px solid var(--border);border-radius:16px;padding:18px;background:var(--card);text-align:center;cursor:pointer}
.mt-mode .i{font-size:28px}.mt-mode h4{margin:6px 0 4px;font-size:16px}.mt-mode p{color:var(--text2);font-size:13px}
.mt-others{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:900px;margin:0 auto;padding:0 20px}
.mt-others a{border:1px solid var(--border);border-radius:50px;padding:8px 14px;font-size:13px;color:var(--text2);background:var(--card)}
.mt-others a.on{border-color:var(--gold);color:var(--gold)}
.mt-cta{text-align:center;padding:70px 20px 90px}
.mt-cta .price{font-family:var(--f2);font-size:40px;color:var(--gold);margin:6px 0}
</style>'''

DEMO_JS='''<script>
(function(){
  var M=%METIER%, mode=%MODE%, page="home", loaded=false;
  var stage=document.getElementById("demoStage"), fr=null;
  function dims(){ var w=stage.clientWidth; var mob=w<640; var vw=mob?400:1280, vh=mob?820:800; return {w:w,vw:vw,vh:vh,s:w/vw}; }
  function fit(){ var d=dims(); stage.style.height=Math.round(d.vh*d.s)+"px"; if(fr){ fr.style.width=d.vw+"px"; fr.style.height=d.vh+"px"; fr.style.transform="scale("+d.s+")"; } }
  function url(){ return "/app.html?demo="+M+"&mode="+mode+"&embed=1&page="+page; }
  function load(){ if(loaded) return; loaded=true; fr=document.createElement("iframe"); fr.title="Démo Luxyra"; fr.loading="lazy"; fr.src=url(); stage.appendChild(fr); fit(); fr.addEventListener("load",function(){ var l=document.getElementById("demoLoad"); if(l) l.remove(); }); }
  fit(); window.addEventListener("resize",fit);
  if("IntersectionObserver" in window){ var io=new IntersectionObserver(function(e){ if(e[0].isIntersecting){ load(); io.disconnect(); } },{rootMargin:"300px"}); io.observe(stage); } else load();
  function nav(p){ page=p; document.querySelectorAll(".demo-tabs button").forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-p")===p); });
    if(!loaded){ load(); return; }
    try{ var w=fr.contentWindow; if(w && typeof w.go==="function"){ w.go(p); return; } }catch(e){}
    fr.src=url(); }
  document.querySelectorAll(".demo-tabs button").forEach(function(b){ b.addEventListener("click",function(){ nav(b.getAttribute("data-p")); }); });
  document.querySelectorAll("[data-mode]").forEach(function(b){ b.addEventListener("click",function(){ mode=b.getAttribute("data-mode"); loaded=false; if(fr){ fr.remove(); fr=null; } load(); document.getElementById("demo").scrollIntoView({behavior:"smooth"}); }); });
  var big=document.getElementById("demoBig"); if(big) big.addEventListener("click",function(e){ e.preventDefault(); location.href="/app.html?demo="+M+"&mode="+mode+"&page="+page; });
})();
</script>'''

TABS=[("home","Accueil"),("planning","Planning"),("caisse","Caisse"),("clients","Clientèle"),("stats","Statistiques"),("accounting","Comptabilité"),("settings","Réglages")]
MODE_DEF={"coiffure":"salon","barbier":"salon","esthetique":"mixte","ongles":"salon","regard":"salon","maquillage":"domicile","tatouage":"salon","spa":"mixte","bien_etre":"domicile"}

def demo_block(k, mode, titre_bar):
    tabs=''.join('<button data-p="%s"%s>%s</button>'%(p,' class="on"' if p=="home" else '',l) for p,l in TABS)
    return '''<div class="demo-wrap" id="demo">
  <div class="demo-tabs">%s</div>
  <div class="demo-frame"><div class="bar"><i></i><i></i><i></i><b>%s</b><span style="margin-left:auto">Démo — données fictives</span></div>
  <div class="demo-stage" id="demoStage"><div class="demo-load" id="demoLoad">Chargement de l'application…</div></div></div>
  <div class="demo-note">C'est la vraie application Luxyra avec des données d'exemple. Cliquez, explorez : rien n'est enregistré. <a href="#" id="demoBig">Ouvrir en plein écran →</a></div>
</div>'''%(tabs,H.escape(titre_bar))

def page(m):
    k=m['k']; mode=MODE_DEF[k]
    others=''.join('<a href="/%s"%s>%s %s</a>'%(x['slug'],' class="on"' if x['k']==k else '',x['ico'],x['nom']) for x in M)
    feats=''.join('<div class="mt-feat reveal"><div class="i">%s</div><h3>%s</h3><p>%s</p></div>'%(i,H.escape(t),H.escape(d)) for i,t,d in m['feats'])
    pts=''.join('<span>%s</span>'%H.escape(p) for p in m['pts'])
    desc="%s : caisse conforme à la loi anti-fraude, planning, réservation en ligne sans commission, fiches clientes et fidélité. Essai gratuit 14 jours, dès 14,99 €/mois."%m['titre']
    ld='{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Luxyra — %s","applicationCategory":"BusinessApplication","operatingSystem":"Web, iOS, Android, Windows, macOS","url":"https://luxyra.fr/%s","offers":{"@type":"Offer","price":"14.99","priceCurrency":"EUR"}}'%(m['nom'],m['slug'])
    out='''<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>%(titre)s — Luxyra</title>
<meta name="description" content="%(desc)s">
<link rel="canonical" href="https://luxyra.fr/%(slug)s">
<link rel="icon" href="icon-192.png" type="image/png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Luxyra"><meta property="og:url" content="https://luxyra.fr/%(slug)s">
<meta property="og:title" content="%(titre)s — Luxyra"><meta property="og:description" content="%(desc)s"><meta property="og:image" content="https://luxyra.fr/luxyra-logo.png"><meta property="og:locale" content="fr_FR">
<script type="application/ld+json">%(ld)s</script>
<link rel="stylesheet" href="https://luxyra.fr/fonts/luxyra-fonts.css">
%(style)s
%(extra)s
<script src="/lx-monitoring.js" defer></script>
</head>
<body>
%(nav)s
<section class="mt-hero">
  <div class="mt-ico">%(ico)s</div>
  <div class="mt-kicker">Luxyra pour %(nomlow)s</div>
  <h1>%(h1)s</h1>
  <p class="sub">%(sub)s</p>
  <div class="mt-pts">%(pts)s</div>
  <div class="mt-btns"><a class="mt-btn gold" href="/inscription">Essai gratuit 14 jours →</a><a class="mt-btn line" href="#demo">Voir l'application</a></div>
</section>
%(demo)s
<section class="mt-sec"><h2>Pensé pour <em>votre métier</em></h2><p class="lead">Le vocabulaire, les fiches clientes et les catégories s'adaptent automatiquement.</p><div class="mt-feats">%(feats)s</div></section>
<section class="mt-sec"><h2>En établissement, à domicile <em>ou les deux</em></h2><p class="lead">Changez le mode dans la démo pour voir la différence.</p>
<div class="mt-modes">
<div class="mt-mode" data-mode="salon"><div class="i">🏪</div><h4>En établissement</h4><p>Planning par collaborateur, caisse au comptoir, réservation en ligne.</p></div>
<div class="mt-mode" data-mode="domicile"><div class="i">🚗</div><h4>À domicile</h4><p>Vous acceptez chaque demande, communes desservies, frais de déplacement calculés.</p></div>
<div class="mt-mode" data-mode="mixte"><div class="i">🔀</div><h4>Mixte</h4><p>La cliente choisit sur place ou chez elle, tout est géré au même endroit.</p></div>
</div></section>
<section class="mt-sec"><h2>Les indispensables, <em>inclus</em></h2><div class="mt-feats">
<div class="mt-feat reveal"><div class="i">🧾</div><h3>Caisse anti-fraude</h3><p>Tickets scellés, clôtures journalières, mensuelles et par exercice, exports pour le comptable. Conforme à l'art. 286, I, 3° bis du CGI.</p></div>
<div class="mt-feat reveal"><div class="i">🌐</div><h3>Site & réservation</h3><p>Votre page de réservation en ligne, sans commission sur vos ventes.</p></div>
<div class="mt-feat reveal"><div class="i">📱</div><h3>Partout</h3><p>Téléphone, tablette, ordinateur : s'installe comme une application.</p></div>
</div></section>
<section class="mt-sec"><h2>Les autres <em>métiers</em></h2><div class="mt-others">%(others)s</div></section>
<section class="mt-cta"><div class="mt-kicker">Sans engagement</div><div class="price">dès 14,99 € / mois</div><p style="color:var(--text2);margin-bottom:20px">14 jours d'essai gratuit, sans carte bancaire. Zéro commission.</p><a class="mt-btn gold" href="/inscription">Créer mon compte →</a></section>
%(tail)s
%(js)s
</body>
</html>
'''%dict(titre=H.escape(m['titre']),desc=H.escape(desc),slug=m['slug'],ld=ld,style=style,extra=EXTRA_CSS,nav=nav,ico=m['ico'],nomlow=H.escape(m['nom'].lower() if k!='tatouage' else 'tatoueurs & pierceurs'),h1=m['h1'],sub=H.escape(m['sub']),pts=pts,demo=demo_block(k,mode,'Luxyra · '+m['nom']),feats=feats,others=others,tail=tail,js=DEMO_JS.replace('%METIER%','"'+k+'"').replace('%MODE%','"'+mode+'"'))
    open(ROOT+m['slug']+'.html','w',encoding='utf-8').write(out)

for m in M: page(m)

# page démo : choix du métier
cards=''.join('<a class="mt-mode" style="display:block" href="/app.html?demo=%s"><div class="i">%s</div><h4>%s</h4><p>Ouvrir la démo →</p></a>'%(m['k'],m['ico'],H.escape(m['nom'])) for m in M)
demo='''<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Démo gratuite du logiciel Luxyra — sans inscription</title>
<meta name="description" content="Essayez la vraie application Luxyra avec des données d'exemple : planning, caisse, clientèle, statistiques, comptabilité. Sans inscription, rien n'est enregistré.">
<link rel="canonical" href="https://luxyra.fr/demo"><link rel="icon" href="icon-192.png" type="image/png">
<link rel="stylesheet" href="https://luxyra.fr/fonts/luxyra-fonts.css">
%s
%s
</head><body>
%s
<section class="mt-hero"><div class="mt-kicker">Démo libre</div><h1>Essayez Luxyra <em>en vrai</em></h1><p class="sub">La vraie application, avec des données d'exemple pour votre métier. Sans inscription, rien n'est enregistré.</p></section>
<div class="mt-modes" style="max-width:1000px;padding-bottom:80px">%s</div>
%s
</body></html>'''%(style,EXTRA_CSS,nav,cards,tail)
open(ROOT+'demo.html','w',encoding='utf-8').write(demo)
print("ok")
