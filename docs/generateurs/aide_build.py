# -*- coding: utf-8 -*-
# Génère les guides illustrés du centre d'aide : aide/<slug>.html + section « Guides » de aide.html
# Usage : python3 docs/generateurs/aide_build.py [dossier_captures_webp]
import os, re, sys, shutil, html as H
sys.path.insert(0, os.path.dirname(__file__))
from aide_guides import GUIDES

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
SRC_IMG = sys.argv[1] if len(sys.argv) > 1 else None
os.makedirs(ROOT + 'aide/img', exist_ok=True)

aide = open(ROOT + 'aide.html', encoding='utf-8').read()
STYLE = aide[aide.index('<style>') + 7: aide.index('</style>')]
NAV = aide[aide.index('<nav>'): aide.index('</script>', aide.index('<nav>')) + 9]
FOOT = aide[aide.index('<footer>'): aide.index('</footer>') + 9]

EXTRA = """
.g-wrap{max-width:900px;margin:0 auto;padding:110px 22px 40px}
.g-bc{font-size:13px;color:var(--text3);margin-bottom:18px}.g-bc a{color:var(--text2)}
.g-cat{display:inline-block;font-size:12px;color:var(--gold);border:1px solid var(--border);border-radius:50px;padding:4px 12px;margin-bottom:14px}
.g-h1{font-family:var(--f2);font-size:clamp(30px,5.5vw,46px);line-height:1.1;margin-bottom:12px}
.g-lead{color:var(--text2);font-size:16px;margin-bottom:26px}
.g-toc{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 18px;margin-bottom:30px;font-size:14px}
.g-toc ol{margin-left:18px}.g-toc li{margin:3px 0}
.g-sec{margin:34px 0}
.g-sec h2{font-family:var(--f2);font-size:26px;color:var(--gold);margin-bottom:10px}
.g-sec p,.g-sec li{color:var(--text2);font-size:15px;line-height:1.75}
.g-sec p{margin-bottom:10px}.g-sec ul{margin:6px 0 12px 20px}
.g-sec strong{color:var(--text)}
.g-fig{margin:16px 0 8px;background:#0b0b10;border:1px solid var(--border);border-radius:14px;overflow:hidden}
.g-fig img{display:block;width:100%;height:auto;cursor:zoom-in}
.g-fig figcaption{font-size:12px;color:var(--text3);padding:8px 14px;border-top:1px solid var(--border)}
.g-leg{list-style:none;margin:12px 0 0!important;padding:0;counter-reset:n}
.g-leg li{position:relative;padding:7px 0 7px 40px;border-bottom:1px solid rgba(255,255,255,.04)}
.g-leg li::before{counter-increment:n;content:counter(n);position:absolute;left:0;top:7px;width:26px;height:26px;border-radius:50%;background:#e8b84a;color:#141008;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
.g-nav{display:flex;gap:12px;justify-content:space-between;margin:40px 0 10px;flex-wrap:wrap}
.g-nav a{flex:1;min-width:220px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;color:var(--text);font-size:14px}
.g-nav a small{display:block;color:var(--text3);font-size:12px;margin-bottom:2px}
.g-nav a:hover{border-color:var(--gold)}
.g-demo{background:linear-gradient(135deg,rgba(212,168,67,.12),rgba(212,168,67,.03));border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin:30px 0;font-size:14px;color:var(--text2)}
.g-zoom{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:200;display:none;align-items:center;justify-content:center;padding:14px;cursor:zoom-out}
.g-zoom img{max-width:100%;max-height:100%;border-radius:8px}
"""

GRID_CSS = """
.guides-section{padding:0 24px 30px;max-width:var(--max);margin:0 auto}
.guides-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.guide-card{display:block;background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;color:var(--text);transition:border-color .2s,transform .2s}
.guide-card:hover{border-color:var(--gold);transform:translateY(-2px)}
.guide-card .gc-img{height:130px;background:#0b0b10 center top/cover no-repeat;border-bottom:1px solid var(--border)}
.guide-card .gc-b{padding:12px 14px 14px}
.guide-card .gc-c{font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.guide-card .gc-t{font-weight:700;font-size:15px;margin:3px 0 4px;line-height:1.3}
.guide-card .gc-r{font-size:13px;color:var(--text2);line-height:1.5}
"""

def first_img(g):
    for s in g['sections']:
        if s.get('img'):
            return s['img']
    return None

def page(g, i):
    secs = [s for s in g['sections']]
    toc = ''.join('<li><a href="#s%d">%s</a></li>' % (k + 1, re.sub(r'^\d+\.\s*', '', s['h'])) for k, s in enumerate(secs) if s.get('h'))
    body = ''
    for k, s in enumerate(secs):
        body += '<section class="g-sec" id="s%d">' % (k + 1)
        if s.get('h'):
            body += '<h2>%s</h2>' % s['h']
        body += s.get('p', '')
        if s.get('img'):
            body += ('<figure class="g-fig"><img src="/aide/img/%s.webp" alt="%s" loading="lazy" onclick="gZoom(this)">'
                     '<figcaption>Capture réelle de l\'application (mode démo, données fictives). Touchez pour agrandir.</figcaption></figure>') % (s['img'], H.escape(s['alt']))
        if s.get('leg'):
            body += '<ol class="g-leg">' + ''.join('<li>%s</li>' % l for l in s['leg']) + '</ol>'
        body += '</section>'
    prev = GUIDES[i - 1] if i > 0 else None
    nxt = GUIDES[i + 1] if i + 1 < len(GUIDES) else None
    nav = '<div class="g-nav">'
    nav += ('<a href="/aide/%s"><small>← Guide précédent</small>%s %s</a>' % (prev['slug'], prev['ic'], prev['titre'])) if prev else '<span></span>'
    nav += ('<a href="/aide/%s" style="text-align:right"><small>Guide suivant →</small>%s %s</a>' % (nxt['slug'], nxt['ic'], nxt['titre'])) if nxt else '<span></span>'
    nav += '</div>'
    fi = first_img(g)
    og = ('https://luxyra.fr/aide/img/%s.webp' % fi) if fi else 'https://luxyra.fr/luxyra-logo.png'
    return """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>%(t)s — Aide Luxyra</title>
<meta name="description" content="%(d)s">
<link rel="canonical" href="https://luxyra.fr/aide/%(slug)s">
<link rel="icon" href="/icon-192.png" type="image/png">
<meta property="og:title" content="%(t)s — Aide Luxyra"><meta property="og:description" content="%(d)s"><meta property="og:image" content="%(og)s"><meta property="og:locale" content="fr_FR">
<link rel="stylesheet" href="https://luxyra.fr/fonts/luxyra-fonts.css">
<style>%(style)s%(extra)s</style>
</head>
<body>
%(nav)s
<main class="g-wrap">
<div class="g-bc"><a href="/aide">Centre d'aide</a> › <a href="/aide#guides">Guides illustrés</a> › %(t)s</div>
<span class="g-cat">%(ic)s %(cat)s</span>
<h1 class="g-h1">%(t)s</h1>
<p class="g-lead">%(r)s</p>
%(toc)s
%(body)s
<div class="g-demo">💡 Envie d'essayer sans risque ? La <a href="/demo">démo libre</a> reproduit l'application avec des données fictives : rien n'est enregistré.</div>
%(gnav)s
</main>
<section class="contact-banner">
  <div class="contact-inner">
    <h2>Une question sur ce guide ?</h2>
    <p>Dans l'application : <strong>Paramètres › Support Luxyra</strong>. Ou par email : <strong>support@luxyra.fr</strong>.</p>
    <!--email_off--><a href="mailto:support@luxyra.fr?subject=Aide%%20%%E2%%80%%94%%20%(slugq)s" class="btn-gold">Contacter le support →</a><!--/email_off-->
  </div>
</section>
%(foot)s
<div class="g-zoom" id="gZoom" onclick="this.style.display='none'"><img alt=""></div>
<script>function gZoom(i){var z=document.getElementById('gZoom');z.querySelector('img').src=i.src;z.style.display='flex';}</script>
</body>
</html>
""" % dict(t=H.escape(g['titre']), d=H.escape(g['resume']), slug=g['slug'], og=og, style=STYLE, extra=EXTRA,
           nav=NAV.replace('src="luxyra-logo.png"', 'src="/luxyra-logo.png"'), ic=g['ic'], cat=g['cat'], r=g['resume'],
           toc=('<div class="g-toc"><strong>Dans ce guide</strong><ol>%s</ol></div>' % toc) if toc.count('<li>') > 1 else '',
           body=body, gnav=nav, foot=FOOT, slugq=g['slug'])

# 1) Images
if SRC_IMG:
    need = set(s['img'] for g in GUIDES for s in g['sections'] if s.get('img'))
    for n in need:
        shutil.copyfile(os.path.join(SRC_IMG, n + '.webp'), ROOT + 'aide/img/' + n + '.webp')
    print('images :', len(need))

# 2) Pages guides
for i, g in enumerate(GUIDES):
    open(ROOT + 'aide/%s.html' % g['slug'], 'w', encoding='utf-8').write(page(g, i))
print('guides :', len(GUIDES))

# 3) Section « Guides illustrés » dans aide.html (idempotent, entre marqueurs)
cards = ''.join(
    '<a class="guide-card" href="/aide/%s" data-search="%s"><div class="gc-img" style="background-image:url(/aide/img/%s.webp)"></div>'
    '<div class="gc-b"><div class="gc-c">%s %s</div><div class="gc-t">%s</div><div class="gc-r">%s</div></div></a>'
    % (g['slug'], H.escape((g['titre'] + ' ' + g['resume'] + ' ' + ' '.join(s.get('h', '') for s in g['sections'])).lower()), first_img(g) or 'accueil',
       g['ic'], g['cat'], g['titre'], g['resume']) for g in GUIDES)
bloc = ('<!-- GUIDES:DEBUT (généré par docs/generateurs/aide_build.py) -->\n<section class="guides-section" id="guides">\n'
        '<div class="faq-cat-title" style="margin-top:4px"><span class="ic">🧭</span>Guides illustrés pas à pas</div>\n'
        '<p style="color:var(--text2);font-size:14px;margin:-4px 0 16px">Chaque guide montre les vrais écrans de l\'application, annotés étape par étape.</p>\n'
        '<div class="guides-grid" id="guidesGrid">' + cards + '</div>\n</section>\n<!-- GUIDES:FIN -->')
if '<!-- GUIDES:DEBUT' in aide:
    aide = re.sub(r'<!-- GUIDES:DEBUT.*?<!-- GUIDES:FIN -->', lambda m: bloc, aide, flags=re.S)
else:
    aide = aide.replace('<section class="cats-section">', bloc + '\n\n<section class="cats-section">', 1)
if '.guides-grid{' not in aide:
    aide = aide.replace('</style>', GRID_CSS + '</style>', 1)
# la recherche filtre aussi les guides
if 'guide-card' in aide and '/*GUIDES-SEARCH*/' not in aide:
    aide = aide.replace("function filterFaq(q){\n  q = (q||'').toLowerCase().trim();",
        "function filterFaq(q){\n  q = (q||'').toLowerCase().trim();\n  /*GUIDES-SEARCH*/document.querySelectorAll('.guide-card').forEach(function(c){c.style.display=(!q||(c.dataset.search||'').indexOf(q)>=0)?'':'none';});", 1)
open(ROOT + 'aide.html', 'w', encoding='utf-8').write(aide)
print('aide.html mis à jour')
