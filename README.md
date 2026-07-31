# Sapos Catalog V1

V1 autonome d'un catalogue client mobile-first pour `saposparfums.fr`.

## Ce que fait cette V1

- affiche une liste dynamique fluide et partageable
- filtre par marque, famille, genre et statut
- recherche par nom, marque, famille ou note
- trie par ordre catalogue, marque, nom ou prix
- ouvre un mini detail leger au clic
- se pilote depuis un simple fichier `CSV`

## Structure

- `index.html` : page catalogue
- `styles.css` : direction visuelle
- `app.js` : logique de filtres et rendu
- `data/catalog-source.csv` : source a remplir
- `scripts/build_catalog_from_csv.py` : conversion CSV vers `catalog.json`
- `data/catalog.json` : donnee affichee

## Lancer localement

Depuis le workspace :

```bash
cd /home/openclaw/.openclaw/workspace/sapos-catalog-v1
python3 -m http.server 4173
```

Puis ouvrir :

- `http://127.0.0.1:4173`

## Mettre a jour le catalogue

1. modifier `data/catalog-source.csv`
2. regenerer le JSON :

```bash
cd /home/openclaw/.openclaw/workspace/sapos-catalog-v1
python3 scripts/build_catalog_from_csv.py
```

## Colonnes du CSV

- `rank` : ordre d'affichage
- `brand` : marque
- `title` : nom du parfum
- `volume` : contenance
- `price` : prix
- `status` : `Disponible`, `Arrivage`, `Rupture`, etc.
- `families` : valeurs separees par `|`
- `gender` : `Mixte`, `Homme`, `Femme`
- `note` : commentaire court visible dans la liste
- `tags` : valeurs separees par `|`
- `url` : lien facultatif
- `image` : image facultative
- `collections` : valeurs separees par `|`
- `published_at` : date facultative

## Suite logique

1. brancher un vrai Google Sheet ou un CSV d'inventaire reel
2. ajouter une commande simple de republication
3. enrichir ensuite seulement les refs qui meritent plus de detail
