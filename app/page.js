import Script from "next/script";

export default function HomePage() {
  return (
    <>
      <div className="page-shell">
        <header className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Catalogue client</p>
            <h1>Une liste de parfums agréable, rapide et vivante.</h1>
            <p className="hero-text">
              Pensé pour être envoyé tel quel au client, puis mis à jour sans refaire un document entier.
            </p>
            <div className="hero-stats" id="hero-stats">
              <span className="stat-pill">Chargement du catalogue…</span>
            </div>
          </div>
          <div className="hero-card">
            <p className="hero-card-label">Usage visé</p>
            <ul className="hero-points">
              <li>Recherche instantanée</li>
              <li>Filtres par marque, style, genre, statut</li>
              <li>Consultation fluide sur mobile</li>
              <li>Base prête pour sync Shopify</li>
            </ul>
          </div>
        </header>

        <main className="catalog-layout">
          <aside className="filters-panel">
            <div className="filters-sticky">
              <label className="search-box" htmlFor="search">
                <span>Recherche</span>
                <input id="search" type="search" placeholder="Nom, marque, note, style…" />
              </label>

              <div className="filter-block">
                <div className="filter-head">
                  <h2>Marques</h2>
                  <button type="button" className="filter-clear" data-clear="brand">Effacer</button>
                </div>
                <div className="filter-list" id="brand-filters"></div>
              </div>

              <div className="filter-block">
                <div className="filter-head">
                  <h2>Familles</h2>
                  <button type="button" className="filter-clear" data-clear="family">Effacer</button>
                </div>
                <div className="filter-list" id="family-filters"></div>
              </div>

              <div className="filter-block">
                <div className="filter-head">
                  <h2>Genre</h2>
                  <button type="button" className="filter-clear" data-clear="gender">Effacer</button>
                </div>
                <div className="filter-list" id="gender-filters"></div>
              </div>

              <div className="filter-block">
                <div className="filter-head">
                  <h2>Statut</h2>
                  <button type="button" className="filter-clear" data-clear="status">Effacer</button>
                </div>
                <div className="filter-list" id="status-filters"></div>
              </div>
            </div>
          </aside>

          <section className="catalog-panel">
            <div className="toolbar">
              <div className="toolbar-left">
                <p className="toolbar-label">Catalogue</p>
                <h2 id="results-title">Parfums</h2>
              </div>
              <div className="toolbar-right">
                <label className="sort-box" htmlFor="sort">
                  <span>Trier</span>
                  <select id="sort" defaultValue="featured">
                    <option value="featured">Recommandés</option>
                    <option value="title-asc">Nom A → Z</option>
                    <option value="title-desc">Nom Z → A</option>
                    <option value="price-asc">Prix croissant</option>
                    <option value="price-desc">Prix décroissant</option>
                    <option value="newest">Plus récents</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="active-filters" id="active-filters"></div>
            <div className="catalog-grid" id="catalog-grid"></div>
            <div className="empty-state hidden" id="empty-state">
              <p>Aucun parfum ne correspond aux filtres actuels.</p>
              <button type="button" id="reset-filters">Réinitialiser les filtres</button>
            </div>
          </section>
        </main>
      </div>

      <dialog className="product-dialog" id="product-dialog">
        <article className="dialog-card">
          <button type="button" className="dialog-close" id="dialog-close" aria-label="Fermer">×</button>
          <div className="dialog-media-wrap">
            <img id="dialog-image" className="dialog-image" alt="" />
          </div>
          <div className="dialog-body">
            <p className="dialog-brand" id="dialog-brand"></p>
            <h3 id="dialog-title"></h3>
            <p className="dialog-subtitle" id="dialog-subtitle"></p>
            <div className="dialog-meta" id="dialog-meta"></div>
            <div className="dialog-tags" id="dialog-tags"></div>
            <div className="dialog-actions">
              <a id="dialog-link" className="primary-link" href="#" target="_blank" rel="noreferrer">Voir le parfum</a>
            </div>
          </div>
        </article>
      </dialog>

      <template id="product-card-template">
        <article className="product-card">
          <button type="button" className="product-card-button">
            <div className="product-image-wrap">
              <img className="product-image" alt="" />
              <span className="product-status"></span>
            </div>
            <div className="product-content">
              <div className="product-topline">
                <p className="product-brand"></p>
                <p className="product-price"></p>
              </div>
              <h3 className="product-title"></h3>
              <p className="product-subtitle"></p>
              <div className="product-badges"></div>
            </div>
          </button>
        </article>
      </template>

      <Script src="/catalog.js" strategy="afterInteractive" />
    </>
  );
}
