import Script from "next/script";

export default function HomePage() {
  return (
    <>
      <div className="page-shell">
        <header className="hero">
          <div className="hero-copy">
            <h1>Le catalogue Sapos Parfums</h1>
            <h2 className="hero-text">Une selection elegante a parcourir selon vos envies.</h2>
            <div className="hero-stats" id="hero-stats">
              <span className="stat-pill">Chargement du catalogue…</span>
            </div>
          </div>
          <div className="hero-rail">
            <div className="hero-card">
              <p className="hero-card-label">En un coup d'oeil</p>
              <ul className="hero-points">
                <li>Recherche rapide</li>
                <li>Tri par marque et disponibilite</li>
                <li>Nouveautes visibles en un instant</li>
              </ul>
            </div>
            <div className="hero-mini-card">
              <p className="hero-mini-label">Conseil</p>
              <p className="hero-mini-text">Utilisez les filtres pour affiner la selection selon vos envies.</p>
            </div>
          </div>
        </header>

        <main className="catalog-layout">
          <aside className="filters-panel">
            <div className="filters-sticky">
              <label className="search-box" htmlFor="search">
                <span>Recherche</span>
                <input id="search" type="search" placeholder="Nom, marque, famille, note…" />
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
                <h2 id="results-title">References</h2>
                <p className="toolbar-note">Vue liste premium, concue pour partager rapidement les references disponibles.</p>
              </div>
              <div className="toolbar-right">
                <label className="sort-box" htmlFor="sort">
                  <span>Trier</span>
                  <select id="sort" defaultValue="featured">
                    <option value="featured">Ordre catalogue</option>
                    <option value="brand-asc">Marque A → Z</option>
                    <option value="title-asc">Nom A → Z</option>
                    <option value="title-desc">Nom Z → A</option>
                    <option value="price-asc">Prix croissant</option>
                    <option value="price-desc">Prix decroissant</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="active-filters" id="active-filters"></div>
            <div className="catalog-list" id="catalog-list"></div>
            <div className="empty-state hidden" id="empty-state">
              <p>Aucune reference ne correspond aux filtres actuels.</p>
              <button type="button" id="reset-filters">Reinitialiser les filtres</button>
            </div>
          </section>
        </main>
      </div>

      <dialog className="product-dialog" id="product-dialog">
        <article className="dialog-card">
          <button type="button" className="dialog-close" id="dialog-close" aria-label="Fermer">×</button>
          <div className="dialog-body">
            <p className="dialog-brand" id="dialog-brand"></p>
            <h3 id="dialog-title"></h3>
            <div className="dialog-meta" id="dialog-meta"></div>
            <p className="dialog-note" id="dialog-note"></p>
            <div className="dialog-tags" id="dialog-tags"></div>
            <div className="dialog-actions">
              <a id="dialog-link" className="primary-link" href="#" target="_blank" rel="noreferrer">Voir le lien</a>
            </div>
          </div>
        </article>
      </dialog>

      <template id="product-row-template">
        <article className="product-row">
          <button type="button" className="product-row-button">
            <div className="product-visual">
              <img className="product-image hidden" alt="" loading="lazy" />
              <span className="product-monogram"></span>
            </div>
            <div className="product-main">
              <div className="product-brandline">
                <p className="product-brand"></p>
                <span className="product-status"></span>
              </div>
              <h3 className="product-title"></h3>
              <p className="product-note"></p>
              <div className="product-meta"></div>
            </div>
            <div className="product-side">
              <p className="product-volume"></p>
              <p className="product-price"></p>
            </div>
          </button>
        </article>
      </template>

      <Script src="/catalog.js" strategy="afterInteractive" />
    </>
  );
}
