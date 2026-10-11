# -*- coding: utf-8 -*-
import html as H, re
ROOT='/sessions/quirky-affectionate-hypatia/luxyra.fr/'
tpl=open(ROOT+'blog/reservation-en-ligne-sans-commission.html',encoding='utf-8').read()
head_style=tpl[tpl.index('<style>'):tpl.index('</style>')+8]
body_nav=tpl[tpl.index('<body>')+6:tpl.index('<nav class="breadcrumb">')]
footer=tpl[tpl.index('<footer>'):tpl.index('</footer>')+9]
A=[
dict(slug="prestations-a-domicile-frais-de-deplacement", cat="Domicile", date="2026-10-11", datefr="11 octobre 2026", min=6,
 titre="Prestations à domicile : fixer ses frais de déplacement et sa zone sans perdre de temps",
 court="Prestations à domicile et frais de déplacement",
 desc="Esthéticienne, coiffeuse, maquilleuse ou praticien bien-être à domicile : forfait, prix au km ou par commune, zone desservie, validation des demandes et acompte. Méthode simple.",
 intro="Travailler à domicile, c'est de la liberté… et des kilomètres. Bien fixer sa zone et ses frais de déplacement évite les trajets non rentables et les mauvaises surprises pour vos clientes.",
 tldr=["Choisissez <strong>une seule règle claire</strong> : forfait, prix au km ou prix par commune","Définissez une <strong>zone</strong> (rayon en km) ou une <strong>liste de communes</strong>","Affichez les frais <strong>avant</strong> la réservation, jamais après","<strong>Validez chaque demande</strong> avant qu'elle n'entre dans votre agenda","Demandez l'acompte <strong>après</strong> avoir accepté la demande"],
 body="""<h2>1. Trois façons de facturer le déplacement</h2>
<p><strong>Le forfait</strong> : un montant fixe, quelle que soit la distance (par exemple 10 €). Simple à comprendre, idéal si votre zone est petite.</p>
<p><strong>Le prix au kilomètre</strong> : par exemple 0,60 €/km au-delà des 5 premiers kilomètres offerts. Plus juste quand votre zone est grande.</p>
<p><strong>Le prix par commune</strong> : vous cochez les communes que vous desservez et vous fixez un montant pour chacune. C'est la méthode la plus lisible pour vos clientes (« Metz : 5 €, Woippy : 8 € ») et la plus facile à vérifier pour vous.</p>
<h2>2. Délimiter sa zone</h2>
<p>Un rayon en kilomètres autour de votre adresse suffit pour démarrer. Mais un rayon ignore les routes, les ponts et les bouchons : la liste de communes cochées est plus fiable. Dans Luxyra, les communes de votre rayon sont proposées et pré-cochées, vous décochez celles qui ne valent pas le trajet. Une cliente hors zone ne peut tout simplement pas réserver.</p>
<h2>3. Afficher les frais avant la réservation</h2>
<p>La cliente tape son adresse, la commune est reconnue (y compris les lieux-dits, rattachés à leur commune) et le montant du déplacement s'affiche avant qu'elle ne confirme. Le jour J, la ligne « Déplacement » est ajoutée automatiquement à l'encaissement. Pas de discussion, pas d'oubli.</p>
<h2>4. Valider chaque demande</h2>
<p>À domicile, accepter un rendez-vous engage un trajet. Une demande en attente vous laisse le choix : <strong>accepter</strong>, <strong>proposer un autre horaire</strong> (pour regrouper vos déplacements dans le même secteur) ou <strong>refuser</strong>. La cliente est prévenue par email ou SMS.</p>
<h2>5. L'acompte, après acceptation</h2>
<p>Demander un acompte au moment de la demande, c'est encaisser pour un rendez-vous que vous n'avez peut-être pas accepté. Mieux vaut l'inverse : vous acceptez, la cliente reçoit un lien sécurisé et règle l'acompte, qui est ensuite déduit le jour du rendez-vous. Si vous refusez ou annulez, il est remboursé automatiquement.</p>
<h2>6. Votre adresse reste privée</h2>
<p>Quand on travaille 100 % à domicile, on n'a pas envie d'afficher son adresse personnelle sur internet. Seule la ville apparaît sur votre page publique ; l'adresse complète reste sur les tickets et factures, où la loi l'exige.</p>""",
 cta="Voir la démo à domicile", ctaurl="/app.html?demo=maquillage&mode=domicile"),
dict(slug="acompte-arrhes-empreinte-bancaire", cat="Rendez-vous non honorés", date="2026-10-11", datefr="11 octobre 2026", min=7,
 titre="Acompte, arrhes ou empreinte bancaire : comment protéger son agenda",
 court="Acompte, arrhes ou empreinte bancaire",
 desc="Onglerie, regard, tatouage, institut : acompte, arrhes ou empreinte bancaire contre les rendez-vous non honorés. Différences juridiques, remboursement, TVA et bonnes pratiques.",
 intro="Une pose complète, une extension de cils ou une séance de tatouage non honorée, c'est une demi-journée perdue. Trois outils existent pour s'en protéger. Ils ne fonctionnent pas pareil, ni juridiquement ni en pratique.",
 tldr=["<strong>Arrhes</strong> : la cliente peut renoncer en les perdant (c'est la règle par défaut pour un consommateur)","<strong>Acompte</strong> : engagement ferme des deux côtés — à préciser clairement dans vos conditions","<strong>Empreinte bancaire</strong> : rien n'est débité, un montant est seulement bloqué quelques jours","Annoncez <strong>vos conditions d'annulation</strong> avant le paiement","Si vous annulez vous-même, la cliente est <strong>toujours remboursée</strong>"],
 body="""<h2>1. Arrhes ou acompte : la nuance qui compte</h2>
<p>Pour une cliente particulière, une somme versée à l'avance est considérée comme des <strong>arrhes</strong>, sauf si vos conditions disent clairement autre chose (article L214-1 du Code de la consommation). Avec des arrhes, la cliente peut renoncer au rendez-vous en les perdant ; si c'est vous qui annulez, vous devez lui rendre le double.</p>
<p>Avec un <strong>acompte</strong>, l'engagement est ferme : la cliente s'engage à payer la prestation. En pratique, dans la beauté, on parle souvent d'« acompte » pour une somme conservée en cas d'annulation tardive. Écrivez donc noir sur blanc vos conditions : délai d'annulation gratuite (par exemple 48 h) et ce qui se passe au-delà.</p>
<h2>2. L'empreinte bancaire</h2>
<p>La carte de la cliente est simplement <strong>pré-autorisée</strong> pour un montant fixe (par exemple 20 ou 30 €) : rien n'est débité. Si elle vient, l'empreinte est libérée. Si elle ne vient pas, vous pouvez encaisser ce montant. La pré-autorisation ne dure que quelques jours chez les prestataires de paiement : elle convient aux rendez-vous proches.</p>
<h2>3. Laquelle choisir ?</h2>
<ul><li><strong>Poses longues, extensions, tatouages</strong> : un acompte (souvent 20 à 30 %) réservé en ligne.</li><li><strong>Créneaux courts</strong> (barbier, épilations) : l'empreinte bancaire, moins dissuasive à la réservation.</li><li><strong>À domicile</strong> : l'acompte après acceptation de la demande.</li></ul>
<h2>4. Et la comptabilité ?</h2>
<p>La TVA d'une prestation de services est due à l'encaissement, acompte compris. Une somme conservée après une absence ou une annulation tardive reste une recette : elle doit apparaître dans votre caisse. L'administration considère le plus souvent qu'elle est soumise à la TVA (sauf de véritables arrhes indemnisant un dédit). Dans Luxyra, un acompte conservé ou une empreinte encaissée crée automatiquement un ticket dans la caisse, et un export donne la TVA due au mois du paiement.</p>
<p><em>Ces informations sont générales : en cas de doute, rapprochez-vous de votre expert-comptable.</em></p>
<h2>5. Les bonnes pratiques</h2>
<ul><li>Affichez vos conditions avant le paiement, pas après.</li><li>Envoyez un rappel la veille : la plupart des absences sont des oublis.</li><li>Remboursez sans discuter quand c'est vous qui annulez.</li><li>Gardez de la souplesse pour les vraies urgences : une cliente fidèle vaut plus qu'un acompte.</li></ul>""",
 cta="Voir la démo onglerie", ctaurl="/app.html?demo=ongles"),
dict(slug="micro-entreprise-ou-societe-caisse-et-comptabilite", cat="Conformité", date="2026-10-11", datefr="11 octobre 2026", min=7,
 titre="Micro-entreprise ou société : quelles obligations de caisse et de comptabilité en 2026 ?",
 court="Micro-entreprise ou société : caisse et comptabilité",
 desc="Institut, onglerie, barbier, praticien à domicile : logiciel de caisse obligatoire ou non, livre des recettes, TVA, seuils 2026, date de clôture d'exercice. Le point simple.",
 intro="Les obligations ne sont pas les mêmes selon que vous êtes micro-entrepreneur en franchise de TVA ou en société. Voici l'essentiel, sans jargon.",
 tldr=["En <strong>franchise de TVA</strong>, le logiciel de caisse sécurisé n'est pas obligatoire (art. 286, II du CGI)","Dès que vous facturez la TVA, il l'est : <strong>caisse conforme à la loi anti-fraude</strong>","Micro-entreprise : un <strong>livre des recettes encaissées</strong> suffit côté comptabilité","Seuils 2026 : <strong>83 600 €</strong> de CA (services), franchise de TVA jusqu'à <strong>37 500 €</strong>","Société : la clôture annuelle se fait <strong>à la date de votre exercice</strong>, pas forcément au 31 décembre"],
 body="""<h2>1. Le logiciel de caisse : obligatoire pour qui ?</h2>
<p>La loi impose un logiciel de caisse sécurisé (inaltérabilité, sécurisation, conservation et archivage des données) aux entreprises <strong>assujetties à la TVA</strong> qui encaissent des particuliers. Les entreprises en <strong>franchise en base de TVA</strong> (« TVA non applicable, art. 293 B du CGI ») n'y sont pas soumises. Un outil de caisse reste pratique, mais la bande Z mensuelle n'est pas obligatoire pour elles.</p>
<h2>2. Micro-entreprise : le livre des recettes</h2>
<p>Le micro-entrepreneur déclare ce qu'il a <strong>encaissé</strong> (et non ce qu'il a facturé). Il tient un livre chronologique des recettes : date, client, montant, mode de règlement. Un acompte payé en ligne compte le jour du paiement ; le jour du rendez-vous, seul le solde payé sur place est compté.</p>
<p>Seuils 2026-2028 : 83 600 € de chiffre d'affaires pour les prestations de services (203 100 € pour la vente de marchandises). Franchise de TVA jusqu'à 37 500 € pour les services (seuil majoré 41 250 €) et 85 000 € pour les ventes.</p>
<h2>3. Société ou entreprise au réel</h2>
<p>Vous collectez la TVA : la caisse doit être conforme à la loi anti-fraude, avec une clôture chaque jour, chaque mois et chaque année — ou à la fin de l'<strong>exercice</strong> s'il ne se termine pas au 31 décembre (par exemple au 31 mars). La TVA d'une prestation est due à l'encaissement, acomptes compris.</p>
<h2>4. Ce que Luxyra fait pour vous</h2>
<ul><li>Franchise de TVA : aucune TVA sur les tickets, mention « TVA non applicable, art. 293 B du CGI », livre des recettes encaissées prêt à déclarer.</li><li>Régime réel : tickets scellés, clôtures journalières, mensuelles, annuelles et par exercice, récapitulatif de TVA, ajustement de la TVA sur les paiements en ligne, journal comptable et fichier FEC.</li><li>Date de clôture d'exercice réglable (fixée au 31 décembre pour les micro-entreprises).</li></ul>
<p><em>Informations générales à jour en octobre 2026 ; votre situation peut nécessiter l'avis d'un professionnel.</em></p>""",
 cta="Voir la démo institut", ctaurl="/app.html?demo=esthetique"),
]
def build(a):
    tl=''.join('<li>%s</li>'%x for x in a['tldr'])
    ld='{"@context":"https://schema.org","@type":"Article","headline":"%s","description":"%s","datePublished":"%s","dateModified":"%s","inLanguage":"fr-FR","image":"https://luxyra.fr/luxyra-logo.png","author":{"@type":"Organization","name":"Luxyra","url":"https://luxyra.fr/"},"mainEntityOfPage":"https://luxyra.fr/blog/%s"}'%(a['titre'].replace('"',"'"),a['desc'].replace('"',"'"),a['date'],a['date'],a['slug'])
    out='''<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>%(t)s — Luxyra</title>
<meta name="description" content="%(d)s">
<link rel="canonical" href="https://luxyra.fr/blog/%(s)s">
<link rel="icon" href="/icon-192.png" type="image/png">
<meta property="og:type" content="article"><meta property="og:site_name" content="Luxyra"><meta property="og:url" content="https://luxyra.fr/blog/%(s)s"><meta property="og:title" content="%(t)s"><meta property="og:description" content="%(d)s"><meta property="og:image" content="https://luxyra.fr/luxyra-logo.png"><meta property="og:locale" content="fr_FR"><meta property="article:published_time" content="%(date)s">
<script type="application/ld+json">%(ld)s</script>
%(style)s
</head>
<body>%(nav)s<nav class="breadcrumb">
  <a href="/">Accueil</a> › <a href="/blog">Blog</a> › <span>%(court)s</span>
</nav>

<article>
  <div class="a-cat">%(cat)s</div>
  <h1 class="a-title">%(t)s</h1>
  <p class="a-intro">%(intro)s</p>
  <div class="a-meta"><span>⏱ Lecture %(min)s min</span><span>📅 %(datefr)s</span><span>✍ Par l'équipe Luxyra</span></div>
  <div class="tldr-box"><div class="tldr-title">À retenir en 1 minute</div><ul class="tldr-list">%(tl)s</ul></div>
%(body)s
  <div class="cta-end">
    <h3>Voyez-le dans la vraie application</h3>
    <p>Démo libre, données d'exemple, rien n'est enregistré. Essai gratuit 14 jours ensuite, sans carte bancaire.</p>
    <a href="%(ctaurl)s" class="btn">%(cta)s</a>
  </div>
</article>

%(footer)s

</body>
</html>
'''%dict(t=H.escape(a['titre']),d=H.escape(a['desc']),s=a['slug'],date=a['date'],ld=ld,style=head_style,nav=body_nav,court=H.escape(a['court']),cat=H.escape(a['cat']),intro=H.escape(a['intro']),min=a['min'],datefr=a['datefr'],tl=tl,body=a['body'],ctaurl=a['ctaurl'],cta=H.escape(a['cta']),footer=footer)
    open(ROOT+'blog/'+a['slug']+'.html','w',encoding='utf-8').write(out)
for a in A: build(a)
# index du blog
f=ROOT+'blog/index.html'; s=open(f,encoding='utf-8').read()
def rep(x,y):
    global s; assert s.count(x)==1,(x[:60],s.count(x)); s=s.replace(x,y)
rep('<title>Blog Luxyra — Conseils pour gérer son salon de coiffure et de beauté</title>','<title>Blog Luxyra — Conseils pour les pros de la beauté et du bien-être</title>')
s=re.sub(r'<meta name="description" content="[^"]*">','<meta name="description" content="Conseils, guides et bonnes pratiques pour gérer votre activité de coiffure, barbier, esthétique, ongles, cils & sourcils, maquillage, tatouage, spa ou bien-être, en établissement ou à domicile.">',s,1)
s=re.sub(r'<meta name="keywords" content="[^"]*">','<meta name="keywords" content="blog beauté, gestion institut, gestion onglerie, logiciel salon, caisse anti-fraude, frais de déplacement domicile, acompte rendez-vous, micro-entreprise beauté">',s,1)
rep('<meta property="og:title" content="Blog Luxyra — Conseils gestion salon de coiffure et beauté">','<meta property="og:title" content="Blog Luxyra — Conseils pour les pros de la beauté et du bien-être">')
rep('<h1 class="h-title">Conseils &amp; <em>guides</em><br>pour votre salon</h1>','<h1 class="h-title">Conseils &amp; <em>guides</em><br>pour votre activité</h1>')
rep("tout ce qu'il faut savoir pour faire grandir votre salon en 2026.","en établissement ou à domicile, pour tous les métiers de la beauté et du bien-être.")
cards=''.join('''
    <a href="/blog/%s" class="article-card">
      <div class="article-cat">%s</div>
      <h2 class="article-title">%s</h2>
      <p class="article-excerpt">%s</p>
      <div class="article-meta">
        <span>⏱ Lecture %s min</span>
        <span class="article-link">Lire l'article →</span>
      </div>
    </a>
'''%(a['slug'],H.escape(a['cat']),H.escape(a['titre']),H.escape(a['desc']),a['min']) for a in A)
rep('  <div class="articles-grid">\n','  <div class="articles-grid">\n'+cards)
open(f,'w',encoding='utf-8').write(s)
print('ok')
