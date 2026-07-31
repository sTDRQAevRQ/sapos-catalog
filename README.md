# Sapos Catalog V1

V1 autonome d'un catalogue client mobile-first pour `saposparfums.fr`.

## Ce que fait cette V1

- affiche une liste dynamique fluide et partageable
- menu burger lateral (marques, best-sellers, homme/femme/unisexe, contact)
- filtre par marque, famille, genre et statut
- recherche par nom, marque, famille ou note
- trie par ordre catalogue, marque, nom ou prix
- ouvre un mini detail leger au clic
- fusionne les refs Shopify existantes avec une couche de pilotage `CSV`

## Structure

- `index.html` : page catalogue
- `styles.css` : direction visuelle
- `app.js` : logique de filtres et rendu
- `data/catalog-source.csv` : couche de pilotage et refs hors Shopify
- `scripts/build_catalog_from_csv.py` : fusion Shopify + CSV vers `catalog.json`
- `scripts/sync_shopify_catalog.py` : sync Shopify seule si besoin de debug
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
2. regenerer le JSON hybride :

```bash
cd /home/openclaw/.openclaw/workspace/sapos-catalog-v1
python3 scripts/build_catalog_from_csv.py
```

## Role du CSV

- ajouter une ref qui n'existe pas dans Shopify
- surcharger une ref Shopify existante via son `url`
- ajuster `status`, `price`, `note`, `tags`, `rank`, etc.

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
- `published_at` : date facultative (format `AAAA-MM-JJ`) — une ref est marquée "Nouveau" sur le catalogue pendant 30 jours après cette date
- `best_seller` : `oui` / `non` (ou `1`/`0`, `x`) — pilote l'entree "Best sellers" du menu burger et le badge "Best-seller" sur la fiche
- `discontinued` : `oui` / `non` — le parfum n'est plus produit par la marque mais reste vendable (independant du `status`, qui gere la disponibilite en stock). Affiche le badge "Discontinué".

## Logos de marque (fallback quand une ref n'a pas de photo)

- fichier : `data/brand-logos.json`
- format : `{ "Nom de la marque exact": "https://url-du-logo.png" }`
- la marque est comparee sans tenir compte de la casse/espaces, mais doit correspondre au champ `brand` du CSV
- ordre d'affichage sur une ref : photo produit (`image`) > logo de la marque (`brand-logos.json`) > monogramme
- pas besoin de relancer le script Python : ce fichier est charge directement par le catalogue au chargement de la page

## Suite logique

1. brancher un vrai Google Sheet ou un CSV d'inventaire reel
2. ajouter une commande simple de republication
3. enrichir ensuite seulement les refs qui meritent plus de detail
