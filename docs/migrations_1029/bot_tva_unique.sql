-- Luxyra — 2026-10-29 (6.8.5) — Bot : une seule règle de TVA dans tous les documents (lot 3 de l'audit indépendant).
-- NON APPLIQUÉ. À appliquer APRÈS la mise en service de la 6.8.5 (pages publiées, docs/migrations_1029/tva_unique.sql, lx-cloture-auto v3.5)
-- — date de mise en service à vérifier dans le texte avant d'appliquer. Puis vérifier avec lx-bot-eval (questions : « pourquoi la TVA
-- de ma Z de juillet n'est pas la même que celle du FEC ? », « mon livre à 5,5 % apparaît-il à 5,5 % ? », « j'ai changé mon taux de
-- TVA : mes mois passés changent-ils ? », « écart d'arrondi dans le rapport, c'est grave ? »).
BEGIN;
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('tva_regle_unique_1029','TVA : la même dans tous les documents (somme des tickets, par taux)',1344,$kb$Depuis la version 6.8.5 (29/10/2026), la TVA et le hors taxe (HT) sont les mêmes, au centime, dans tous les documents : clôture Z du jour, clôtures du mois / de l'année / de l'exercice, rapport du mois (PDF et aperçu), Excel comptable, pack ZIP (récap TVA, journal des ventes, journal de caisse), FEC, exports EBP / Quadratus, e-mail au comptable, statistiques.
La règle : chaque ticket calcule sa TVA PAR TAUX (HT d'un taux = montant TTC à ce taux divisé par 1 + taux, arrondi au centime ; TVA = TTC − HT), et la TVA d'une journée, d'un mois ou d'une année est la SOMME des TVA des tickets. C'est la TVA qui figure sur les tickets remis aux clients (c'est elle qui est due) ; la déclaration (CA3) s'arrondit ensuite à l'euro.
Plusieurs taux : un produit qui a son propre taux (fiche du produit, onglet « 💰 Prix » › « Dont taux de TVA », ex. 5,5 %) est compté à SON taux partout : une ligne de TVA par taux sur le ticket imprimé et le duplicata, sur la Z, dans le rapport, le récap TVA, l'Excel et le FEC (« TVA collectée 5.5% »), et la vente va bien en produits (707).
Changement de taux (Paramètres › « Caisse et paiements » › « Taux TVA ») : il s'applique aux tickets suivants seulement ; les documents des mois passés gardent les montants et taux enregistrés sur les tickets de l'époque (rien n'est recalculé au nouveau taux).
Clôtures Z faites AVANT la 6.8.5 : elles calculaient le HT sur le total de la journée ; elles sont scellées et ne changent jamais. Pour un mois qui en contient, le rapport, l'Excel, le récap TVA et l'e-mail au comptable montrent un encadré « Rapprochement avec les clôtures Z scellées » (HT et TVA des Z, somme des tickets, écart d'arrondi, en général quelques centimes). La TVA à déclarer est celle des tickets. Exemple réel : juillet 2026, TVA des Z 994,32 €, TVA des tickets 994,23 € (écart 0,09 €).
Clôture refusée « LX_Z_ECART_TVA » (rare : appareil resté hors connexion) : relancer la clôture ; l'application recalcule depuis les tickets enregistrés.
Question sur ce que l'expert-comptable doit déclarer, ou demande de retraitement d'un mois déjà déclaré : transmettre à un humain <ESCALATE/>.$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
-- Entrée « Où changer mon taux de TVA ? » : les mois passés ne changent pas
UPDATE public.support_bot_kb SET contenu = replace(contenu, 'Les tickets déjà enregistrés gardent leur taux. Le changement est inscrit au journal.',
  'Les tickets déjà enregistrés gardent leur taux, et les documents des mois passés (rapport, Excel, récap TVA, FEC, Z) gardent les montants enregistrés à l''époque (version 6.8.5). Le changement est inscrit au journal.'),
  maj_le = now()
 WHERE cle = 'tva_taux_1016' AND position('version 6.8.5' in contenu) = 0;
-- Entrée « Ticket de caisse : ce qui est imprimé » : une ligne de TVA par taux
UPDATE public.support_bot_kb SET contenu = replace(contenu, '4. « Total HT : », le détail de TVA (TVA / HT / TTC), « Total TTC : ».',
  '4. « Total HT : », le détail de TVA (une ligne par taux : TVA / HT / TTC ; ligne « Non soumis » pour la vente d''un bon à usage multiple), « Total TTC : ».'),
  maj_le = now()
 WHERE cle = 'ticket_contenu_1016' AND position('une ligne par taux' in contenu) = 0;
COMMIT;
