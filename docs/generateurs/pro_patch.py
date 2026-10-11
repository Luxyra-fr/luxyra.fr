# -*- coding: utf-8 -*-
import sys; sys.path.insert(0,'/sessions/quirky-affectionate-hypatia/gen')
from metiers import M
exec(open('/sessions/quirky-affectionate-hypatia/gen/build.py',encoding='utf-8').read().split("for m in M: page(m)")[0].split("pro=open")[0])
import html as H
ROOT='/sessions/quirky-affectionate-hypatia/luxyra.fr/'
src=open('/sessions/quirky-affectionate-hypatia/gen/build.py',encoding='utf-8').read()
ns={}
exec(src.split("for m in M: page(m)")[0], ns)
f=ROOT+'pro.html'; s=open(f,encoding='utf-8').read()
def rep(a,b):
    global s; assert s.count(a)==1,(a[:60],s.count(a)); s=s.replace(a,b)
rep('<title>Logiciel de caisse coiffeur anti-fraude — Luxyra | Caisse, Planning & Site Vitrine</title>','<title>Logiciel de caisse et planning pour la beauté et le bien-être — Luxyra</title>')
rep('<meta property="og:title" content="Logiciel de caisse coiffeur anti-fraude — Luxyra">','<meta property="og:title" content="Luxyra — logiciel de caisse et planning beauté & bien-être">')
rep('<meta name="twitter:title" content="Logiciel de caisse coiffeur anti-fraude — Luxyra">','<meta name="twitter:title" content="Luxyra — logiciel de caisse et planning beauté & bien-être">')
rep('<div class="h-metiers">COIFFURE · BARBIER · ESTHÉTIQUE · ONGLES · BIEN-ÊTRE</div>','<div class="h-metiers">'+' · '.join('<a href="/%s" style="color:inherit">%s</a>'%(m['slug'],m['nom'].upper()) for m in M)+'</div>')
rep('<a href="#fonctions" class="btn-outline">Découvrir</a>','<a href="#demo" class="btn-outline">Voir l\'application</a>')
rep('<a href="#fonctions" onclick="lxCloseNav()">Fonctionnalités</a>','<a href="#fonctions" onclick="lxCloseNav()">Fonctionnalités</a>\n    <a href="#demo" onclick="lxCloseNav()">Démo</a>')
# section démo en direct
opts=''.join('<option value="%s">%s %s</option>'%(m['k'],m['ico'],H.escape(m['nom'])) for m in M)
demo_sec='''
<!-- DEMO EN DIRECT (2026-10-11) : la vraie application avec des données fictives -->
<section class="section" id="demo-sec" style="text-align:center;padding-bottom:20px">
  <div class="s-label reveal">En direct</div>
  <div class="s-title reveal">Voyez <em>vraiment</em> l'application</div>
  <div class="s-sub reveal" style="margin-left:auto;margin-right:auto">Choisissez votre métier : c'est la vraie application, avec des données d'exemple. Cliquez partout, rien n'est enregistré.</div>
  <div style="margin:0 auto 14px"><select id="demoMetier" style="background:#111;color:#fff;border:1px solid rgba(212,168,67,.5);border-radius:10px;padding:10px 14px;font-size:14px">%s</select></div>
</section>
%s
<div style="text-align:center;margin:14px 0 10px"><a class="btn-outline" id="demoPage" href="/logiciel-coiffure">Tout savoir pour la coiffure →</a></div>
'''%(opts, ns['demo_block']('coiffure','salon','Luxyra'))
rep('<!-- FONCTIONNALITES -->', demo_sec+'\n<!-- FONCTIONNALITES -->')
# grille métiers -> 9 liens
i=s.index('<div class="metiers-grid">'); j=s.index('</div>\n</section>',i)
grid='<div class="metiers-grid">\n'+''.join('    <a class="metier reveal" href="/%s" style="color:inherit"><div class="metier-icon">%s</div><h4>%s</h4><p>%s</p></a>\n'%(m['slug'],m['ico'],H.escape(m['nom']),H.escape(m['sub'])) for m in M)+'  '
s=s[:i]+grid+s[j:]
# css + js
rep('<script src="/lx-monitoring.js" defer></script>\n</head>', ns['EXTRA_CSS']+'\n<script src="/lx-monitoring.js" defer></script>\n</head>')
slugs='{'+','.join('"%s":"%s"'%(m['k'],m['slug']) for m in M)+'}'
noms='{'+','.join('"%s":"%s"'%(m['k'],m['nom']) for m in M)+'}'
js=ns['DEMO_JS'].replace('var M=%METIER%, mode=%MODE%,','var M="coiffure", mode="salon",').replace('  var big=document.getElementById("demoBig");','''  var MODES={"coiffure":"salon","barbier":"salon","esthetique":"mixte","ongles":"salon","regard":"salon","maquillage":"domicile","tatouage":"salon","spa":"mixte","bien_etre":"domicile"}, SL=%s, NM=%s;
  var sel=document.getElementById("demoMetier"); if(sel) sel.addEventListener("change",function(){ M=sel.value; mode=MODES[M]||"salon"; page="home"; document.querySelectorAll(".demo-tabs button").forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-p")==="home"); }); var a=document.getElementById("demoPage"); if(a){ a.href="/"+SL[M]; a.textContent="Tout savoir pour : "+NM[M]+" →"; } loaded=false; if(fr){ fr.remove(); fr=null; } load(); });
  var big=document.getElementById("demoBig");'''%(slugs,noms))
rep('</body>\n</html>', js+'\n</body>\n</html>')
open(f,'w',encoding='utf-8').write(s); print('ok')
