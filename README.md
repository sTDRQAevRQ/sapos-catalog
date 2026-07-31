# Sapos Catalog V1

V1 autonome d'un catalogue client mobile-first pour `saposparfums.fr`.

## Ce que fait cette V1

- affiche un catalogue fluide et partageable
- filtre par marque, famille, genre et statut
- recherche par nom, tag, style ou collection
- trie par nom, prix ou nouveauté
- ouvre une fiche détail légère au clic
- sépare complètement l'interface et la donnée

## Structure

- `index.html` : page catalogue
- `styles.css` : direction visuelle
- `app.js` : logique de filtres et rendu
- `data/catalog.json` : source de données affichée
- `scripts/sync_shopify_catalog.py` : synchro Shopify vers `catalog.json`

## Lancer localement

Depuis le workspace :

```bash
cd /home/openclaw/.openclaw/workspace/sapos-catalog-v1
python3 -m http.server 4173
```

Puis ouvrir :

- `http://127.0.0.1:4173`

## Régénérer la donnée depuis Shopify

Le script lit automatiquement `../shopify.env`.

```bash
cd /home/openclaw/.openclaw/workspace/sapos-catalog-v1
python3 scripts/sync_shopify_catalog.py
```

## Étape suivante logique

1. brancher cette V1 sur un sous-domaine du type `catalogue.saposparfums.fr`
2. enrichir `catalog.json` avec les vrais statuts inventaire, prix, marques et visuels
3. ajouter ensuite soit un import CSV, soit un mini back-office
