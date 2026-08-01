const DATA_URL = "./data/catalog.json";
const BRAND_LOGOS_URL = "./data/brand-logos.json";
const PAGE_SIZE = 24;

const HOUSE_BRANDS = new Set([
  "sapos parfums",
  "signature royale",
  "noble essence",
  "atelier d'orient",
  "maison lazaar paris",
]);

let brandLogoMap = new Map();

const state = {
  items: [],
  view: "catalog",
  visibleCount: PAGE_SIZE,
  filters: {
    query: "",
    brand: new Set(),
    family: new Set(),
    gender: new Set(),
    status: new Set(),
    bestSeller: false,
    sort: "title-asc",
  },
};

let currentView = "list";
let lastFilterSignature = "";

let availableStatusLabels = new Set();
const NEW_WINDOW_DAYS = 30;

function isNewItem(item) {
  if (!item.publishedAt) return false;
  const published = new Date(item.publishedAt);
  if (Number.isNaN(published.getTime())) return false;
  const diffDays = (Date.now() - published.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= NEW_WINDOW_DAYS;
}

function buildBadgeList(item) {
  const badges = [];
  if (isNewItem(item)) badges.push({ text: "Nouveau", cls: "badge-new" });
  if (item.bestSeller) badges.push({ text: "Best-seller", cls: "badge-best" });
  if (item.discontinued) badges.push({ text: "Discontinué", cls: "badge-discontinued" });
  return badges;
}

function isHouseBrand(brand) {
  return HOUSE_BRANDS.has(String(brand || "").trim().toLowerCase());
}

const els = {
  heroSummary: document.querySelector("#hero-summary"),
  overviewPanel: document.querySelector("#overview-panel"),
  overviewList: document.querySelector("#overview-list"),
  overviewLabel: document.querySelector("#overview-label"),
  overviewTitle: document.querySelector("#overview-title"),
  overviewText: document.querySelector("#overview-text"),
  overviewBack: document.querySelector("#overview-back"),
  list: document.querySelector("#catalog-list"),
  skeletonList: document.querySelector("#skeleton-list"),
  empty: document.querySelector("#empty-state"),
  title: document.querySelector("#results-title"),
  resultsCountLine: document.querySelector("#results-count-line"),
  loadMoreBtn: document.querySelector("#load-more-btn"),
  activeFilters: document.querySelector("#active-filters"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  sortMobile: document.querySelector("#sort-mobile"),
  reset: document.querySelector("#reset-filters"),
  quickAvailable: document.querySelector("#quick-available"),
  quickAvailableMobile: document.querySelector("#quick-available-mobile"),
  viewListBtn: document.querySelector("#view-list-btn"),
  viewGridBtn: document.querySelector("#view-grid-btn"),
  filters: {
    brand: document.querySelector("#brand-filters"),
    family: document.querySelector("#family-filters"),
    gender: document.querySelector("#gender-filters"),
    status: document.querySelector("#status-filters"),
  },
  dialog: document.querySelector("#product-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogImage: document.querySelector("#dialog-image"),
  dialogLogo: document.querySelector("#dialog-logo"),
  dialogMonogram: document.querySelector("#dialog-monogram"),
  dialogBadges: document.querySelector("#dialog-badges"),
  dialogBrand: document.querySelector("#dialog-brand"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogMeta: document.querySelector("#dialog-meta"),
  dialogNote: document.querySelector("#dialog-note"),
  dialogTags: document.querySelector("#dialog-tags"),
  dialogLink: document.querySelector("#dialog-link"),
  template: document.querySelector("#product-row-template"),
  filtersPanel: document.querySelector("#filters-panel"),
  filtersToggle: document.querySelector("#filters-toggle"),
  filtersClose: document.querySelector("#filters-close"),
  filtersFabCount: document.querySelector("#filters-fab-count"),
  brandSearch: document.querySelector("#brand-search"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  navPanel: document.querySelector("#nav-panel"),
  navToggle: document.querySelector("#nav-toggle"),
  navClose: document.querySelector("#nav-close"),
  brandHome: document.querySelector("#brand-home"),
};

init().catch((error) => {
  console.error(error);
  els.heroSummary.textContent = "Erreur de chargement du catalogue.";
  els.skeletonList?.classList.add("hidden");
});

async function init() {
  bindUi();
  const [items, brandLogos] = await Promise.all([loadCatalogItems(), loadBrandLogos()]);
  state.items = items;
  brandLogoMap = new Map(
    Object.entries(brandLogos || {}).map(([brand, url]) => [brand.trim().toLowerCase(), url])
  );
  els.skeletonList?.classList.add("hidden");

  availableStatusLabels = getAvailableStatusLabels();
  availableStatusLabels.forEach((label) => state.filters.status.add(label));
  updateHeroSummary();

  syncViewFromHash();
  renderFilterOptions();
  ["brand", "family", "gender", "status"].forEach(syncFilterInputs);

  let savedView = "list";
  try {
    savedView = localStorage.getItem("sapos-catalog-view") || "list";
  } catch (error) {
    savedView = "list";
  }
  setView(savedView);

  render();
}

function updateHeroSummary() {
  if (!els.heroSummary) return;
  const totalBrands = new Set(state.items.map((item) => item.brand).filter(Boolean)).size;
  els.heroSummary.textContent = `${state.items.length} références au catalogue${
    totalBrands ? ` · ${totalBrands} marques` : ""
  }`;
}

function getAvailableStatusLabels() {
  const labels = new Set();
  state.items.forEach((item) => {
    if (item.statusKey === "available" && item.statusLabel) {
      labels.add(item.statusLabel);
    }
  });
  return labels;
}

async function loadBrandLogos() {
  try {
    const response = await fetch(BRAND_LOGOS_URL, { cache: "no-store" });
    if (!response.ok) return {};
    return await response.json();
  } catch (error) {
    return {};
  }
}

function getBrandLogo(brand) {
  if (!brand) return null;
  return brandLogoMap.get(String(brand).trim().toLowerCase()) || null;
}

async function loadCatalogItems() {
  const inlineData = document.querySelector("#catalog-data");
  if (inlineData?.textContent) {
    const raw = inlineData.textContent.trim();
    if (raw && raw !== "__CATALOG_DATA__") {
      return JSON.parse(raw);
    }
  }

  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Catalogue HTTP ${response.status}`);
  }
  return response.json();
}

function bindUi() {
  els.search.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    render();
  });

  els.sort.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    if (els.sortMobile) els.sortMobile.value = event.target.value;
    render();
  });

  els.sortMobile?.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    els.sort.value = event.target.value;
    render();
  });

  document.querySelectorAll(".filter-clear").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.clear;
      state.filters[key].clear();
      syncFilterInputs(key);
      if (key === "brand" && els.brandSearch) {
        els.brandSearch.value = "";
        filterBrandChips("");
      }
      render();
    });
  });

  els.reset.addEventListener("click", () => {
    resetAllFilters();
    navigateToView("catalog");
  });
  els.overviewBack.addEventListener("click", () => navigateToView("catalog"));
  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) {
      els.dialog.close();
    }
  });
  window.addEventListener("hashchange", () => {
    syncViewFromHash();
    render();
  });

  els.filtersToggle?.addEventListener("click", () => openDrawer(els.filtersPanel));
  els.filtersClose?.addEventListener("click", closeAllDrawers);
  els.navToggle?.addEventListener("click", () => openDrawer(els.navPanel));
  els.navClose?.addEventListener("click", closeAllDrawers);
  els.drawerBackdrop?.addEventListener("click", closeAllDrawers);
  els.brandHome?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllDrawers();
    }
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => handleNavAction(button.dataset.nav));
  });

  els.brandSearch?.addEventListener("input", (event) => {
    filterBrandChips(event.target.value.trim().toLowerCase());
  });

  els.quickAvailable?.addEventListener("change", (event) => {
    applyQuickAvailable(event.target.checked);
  });

  els.quickAvailableMobile?.addEventListener("change", (event) => {
    applyQuickAvailable(event.target.checked);
  });

  els.viewListBtn?.addEventListener("click", () => setView("list"));
  els.viewGridBtn?.addEventListener("click", () => setView("grid"));

  els.loadMoreBtn?.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    render();
  });

  bindFabScrollBehavior();
}

function applyQuickAvailable(checked) {
  state.filters.status.clear();
  if (checked) {
    availableStatusLabels.forEach((label) => state.filters.status.add(label));
  }
  syncFilterInputs("status");
  render();
}

function setView(mode) {
  currentView = mode === "grid" ? "grid" : "list";
  els.list.classList.toggle("is-grid", currentView === "grid");
  els.viewListBtn?.classList.toggle("is-active", currentView === "list");
  els.viewGridBtn?.classList.toggle("is-active", currentView === "grid");
  try {
    localStorage.setItem("sapos-catalog-view", currentView);
  } catch (error) {
    // stockage indisponible, on ignore
  }
}

function bindFabScrollBehavior() {
  if (!els.filtersToggle) return;
  let lastY = window.scrollY;
  let ticking = false;

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (currentY > lastY && currentY > 140) {
          els.filtersToggle.classList.add("is-hidden");
        } else {
          els.filtersToggle.classList.remove("is-hidden");
        }
        lastY = currentY;
        ticking = false;
      });
    },
    { passive: true }
  );
}

function openDrawer(panel) {
  closeAllDrawers();
  panel?.classList.add("is-open");
  els.drawerBackdrop?.classList.add("is-visible");
  document.body.classList.add("filters-open");
}

function closeAllDrawers() {
  els.filtersPanel?.classList.remove("is-open");
  els.navPanel?.classList.remove("is-open");
  els.drawerBackdrop?.classList.remove("is-visible");
  document.body.classList.remove("filters-open");
}

function handleNavAction(action) {
  switch (action) {
    case "all":
      resetAllFilters();
      navigateToView("catalog");
      closeAllDrawers();
      break;
    case "best-sellers":
      applyCategoryFilter({ bestSeller: true });
      break;
    case "brands":
      closeAllDrawers();
      navigateToView("brands");
      break;
    case "men":
      applyCategoryFilter({ gender: "Homme" });
      break;
    case "women":
      applyCategoryFilter({ gender: "Femme" });
      break;
    case "unisex":
      applyCategoryFilter({ gender: "Mixte" });
      break;
    case "contact":
      closeAllDrawers();
      window.open("https://saposparfums.fr/pages/contact", "_blank", "noopener");
      break;
    default:
      break;
  }
}

function applyCategoryFilter({ gender, bestSeller } = {}) {
  state.filters.brand.clear();
  state.filters.family.clear();
  state.filters.query = "";
  els.search.value = "";
  state.filters.gender.clear();
  if (gender) {
    state.filters.gender.add(gender);
  }
  state.filters.bestSeller = Boolean(bestSeller);
  syncFilterInputs("brand");
  syncFilterInputs("family");
  syncFilterInputs("gender");
  if (els.brandSearch) {
    els.brandSearch.value = "";
    filterBrandChips("");
  }
  closeAllDrawers();
  navigateToView("catalog");
}

function filterBrandChips(query) {
  if (!els.filters.brand) return;
  const choices = els.filters.brand.querySelectorAll(".filter-choice");
  choices.forEach((choice) => {
    const label = choice.querySelector("span")?.textContent?.toLowerCase() || "";
    choice.classList.toggle("hidden", Boolean(query) && !label.includes(query));
  });
}

function renderFilterOptions() {
  renderBrandFilterOptions();

  const options = {
    family: uniqueValues("families"),
    gender: uniqueValues("gender"),
    status: uniqueValues("statusLabel"),
  };

  for (const [key, values] of Object.entries(options)) {
    els.filters[key].innerHTML = "";
    values.forEach((value) => {
      els.filters[key].appendChild(createFilterChip(key, value));
    });
  }
}

function renderBrandFilterOptions() {
  const brands = uniqueValues("brand");
  const houseBrands = brands.filter((brand) => isHouseBrand(brand));
  const partnerBrands = brands.filter((brand) => !isHouseBrand(brand));

  els.filters.brand.innerHTML = "";

  if (houseBrands.length) {
    els.filters.brand.appendChild(createGroupLabel("Nos marques"));
    houseBrands.forEach((brand) => {
      els.filters.brand.appendChild(createFilterChip("brand", brand));
    });
  }

  if (partnerBrands.length) {
    els.filters.brand.appendChild(createGroupLabel("Marques partenaires"));
    partnerBrands.forEach((brand) => {
      els.filters.brand.appendChild(createFilterChip("brand", brand));
    });
  }
}

function createGroupLabel(text) {
  const label = document.createElement("p");
  label.className = "filter-group-label";
  label.textContent = text;
  return label;
}

function getFilterSignature() {
  return JSON.stringify({
    q: state.filters.query,
    b: [...state.filters.brand].sort(),
    f: [...state.filters.family].sort(),
    g: [...state.filters.gender].sort(),
    s: [...state.filters.status].sort(),
    bs: state.filters.bestSeller,
    sort: state.filters.sort,
    view: state.view,
  });
}

function render() {
  const signature = getFilterSignature();
  if (signature !== lastFilterSignature) {
    state.visibleCount = PAGE_SIZE;
    lastFilterSignature = signature;
  }

  const results = sortItems(filterItems());
  const visibleResults = results.slice(0, state.visibleCount);

  renderOverview(results);
  renderRows(visibleResults);
  renderActiveFilters();
  updateFiltersFabCount();
  syncQuickAvailableToggle();
  updateLoadMoreButton(results.length);
  updateResultsCount(results.length);

  els.title.textContent = `${results.length} reference${results.length > 1 ? "s" : ""}`;
  els.empty.classList.toggle("hidden", results.length !== 0);
}

function updateResultsCount(totalFiltered) {
  if (!els.resultsCountLine) return;
  const totalCatalog = state.items.length;
  if (totalFiltered === totalCatalog) {
    els.resultsCountLine.textContent = `${totalCatalog} référence${totalCatalog > 1 ? "s" : ""} au catalogue`;
    return;
  }
  els.resultsCountLine.textContent = `${totalFiltered} référence${totalFiltered > 1 ? "s" : ""} affichée${
    totalFiltered > 1 ? "s" : ""
  } sur ${totalCatalog} au catalogue`;
}

function updateLoadMoreButton(totalFiltered) {
  if (!els.loadMoreBtn) return;
  const remaining = totalFiltered - state.visibleCount;
  if (remaining > 0) {
    els.loadMoreBtn.textContent = `Afficher ${Math.min(remaining, PAGE_SIZE)} de plus (${remaining} restantes)`;
    els.loadMoreBtn.classList.add("is-visible");
  } else {
    els.loadMoreBtn.classList.remove("is-visible");
  }
}

function syncQuickAvailableToggle() {
  const isAvailableOnly =
    availableStatusLabels.size > 0 &&
    state.filters.status.size === availableStatusLabels.size &&
    [...state.filters.status].every((label) => availableStatusLabels.has(label));
  if (els.quickAvailable) els.quickAvailable.checked = isAvailableOnly;
  if (els.quickAvailableMobile) els.quickAvailableMobile.checked = isAvailableOnly;
}

function updateFiltersFabCount() {
  if (!els.filtersFabCount) return;
  const count =
    state.filters.brand.size +
    state.filters.family.size +
    state.filters.gender.size +
    state.filters.status.size +
    (state.filters.bestSeller ? 1 : 0) +
    (state.filters.query ? 1 : 0);
  els.filtersFabCount.textContent = String(count);
  els.filtersFabCount.classList.toggle("hidden", count === 0);
}

function renderOverview(results) {
  const config = getOverviewConfig(results);
  const isCatalog = state.view === "catalog";

  els.overviewPanel.classList.toggle("hidden", isCatalog);
  els.overviewLabel.textContent = config.label;
  els.overviewTitle.textContent = config.title;
  els.overviewText.textContent = config.text;
  els.overviewList.innerHTML = "";

  if (isCatalog) {
    return;
  }

  config.items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overview-item";
    button.innerHTML = `
      <span class="overview-item-title">${escapeHtml(item.title)}</span>
      <span class="overview-item-meta">${escapeHtml(item.meta)}</span>
    `;
    button.addEventListener("click", item.action);
    els.overviewList.appendChild(button);
  });
}

function renderRows(results) {
  els.list.innerHTML = "";

  results.forEach((item, itemIndex) => {
    const fragment = els.template.content.cloneNode(true);
    const button = fragment.querySelector(".product-row-button");
    const badgesEl = fragment.querySelector(".product-badges");
    const image = fragment.querySelector(".product-image");
    const logo = fragment.querySelector(".product-logo");
    const monogram = fragment.querySelector(".product-monogram");
    const status = fragment.querySelector(".product-status");
    const brand = fragment.querySelector(".product-brand");
    const title = fragment.querySelector(".product-title");
    const volume = fragment.querySelector(".product-volume");
    const price = fragment.querySelector(".product-price");
    const note = fragment.querySelector(".product-note");
    const meta = fragment.querySelector(".product-meta");

    monogram.textContent = buildMonogram(item.brand || item.title);
    buildBadgeList(item).forEach(({ text, cls }) => {
      const badge = document.createElement("span");
      badge.className = `product-badge ${cls}`;
      badge.textContent = text;
      badgesEl.appendChild(badge);
    });
    if (item.image) {
      image.src = item.image;
      image.alt = item.imageAlt || item.title;
      image.classList.remove("hidden");
      logo.classList.add("hidden");
      monogram.classList.add("hidden");
    } else {
      const brandLogo = getBrandLogo(item.brand);
      image.removeAttribute("src");
      image.alt = "";
      image.classList.add("hidden");
      if (brandLogo) {
        logo.src = brandLogo;
        logo.alt = item.brand || item.title;
        logo.classList.remove("hidden");
        monogram.classList.add("hidden");
      } else {
        logo.classList.add("hidden");
        monogram.classList.remove("hidden");
      }
    }
    status.textContent = item.statusLabel || "Disponible";
    status.dataset.status = item.statusKey || "available";
    brand.textContent = item.brand || "Marque";
    title.textContent = item.title;
    volume.textContent = item.volume || "Contenance à préciser";
    price.textContent = item.priceLabel || "Prix sur demande";
    note.textContent = item.note || item.subtitle || "Référence prête à être recommandée.";

    [
      ...(item.families || []).slice(0, 2),
      item.gender,
    ]
      .filter(Boolean)
      .forEach((value) => {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = value;
        meta.appendChild(badge);
      });

    button.addEventListener("click", () => openDialog(item));
    els.list.appendChild(fragment);
  });
}

function renderActiveFilters() {
  els.activeFilters.innerHTML = "";
  const filterEntries = [
    ...[...state.filters.brand].map((value) => ["brand", value]),
    ...[...state.filters.family].map((value) => ["family", value]),
    ...[...state.filters.gender].map((value) => ["gender", value]),
    ...[...state.filters.status].map((value) => ["status", value]),
  ];

  if (state.filters.bestSeller) {
    filterEntries.unshift(["bestSeller", "Best sellers"]);
  }

  if (state.filters.query) {
    filterEntries.unshift(["query", state.filters.query]);
  }

  els.activeFilters.classList.toggle("has-filters", filterEntries.length > 0);

  filterEntries.forEach(([key, value]) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(value)}</span>`;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.addEventListener("click", () => {
      if (key === "query") {
        state.filters.query = "";
        els.search.value = "";
      } else if (key === "bestSeller") {
        state.filters.bestSeller = false;
      } else {
        state.filters[key].delete(value);
        syncFilterInputs(key);
      }
      render();
    });
    chip.appendChild(close);
    els.activeFilters.appendChild(chip);
  });
}

function openDialog(item) {
  els.dialogBadges.innerHTML = "";
  buildBadgeList(item).forEach(({ text, cls }) => {
    const badge = document.createElement("span");
    badge.className = `product-badge ${cls}`;
    badge.textContent = text;
    els.dialogBadges.appendChild(badge);
  });

  if (item.image) {
    els.dialogImage.src = item.image;
    els.dialogImage.alt = item.imageAlt || item.title;
    els.dialogImage.classList.remove("hidden");
    els.dialogLogo.classList.add("hidden");
    els.dialogMonogram.classList.add("hidden");
  } else {
    const brandLogo = getBrandLogo(item.brand);
    els.dialogImage.removeAttribute("src");
    els.dialogImage.alt = "";
    els.dialogImage.classList.add("hidden");
    if (brandLogo) {
      els.dialogLogo.src = brandLogo;
      els.dialogLogo.alt = item.brand || item.title;
      els.dialogLogo.classList.remove("hidden");
      els.dialogMonogram.classList.add("hidden");
    } else {
      els.dialogLogo.classList.add("hidden");
      els.dialogMonogram.classList.remove("hidden");
      els.dialogMonogram.textContent = buildMonogram(item.brand || item.title);
    }
  }

  els.dialogBrand.textContent = item.brand || "Marque";
  els.dialogTitle.textContent = item.title;
  els.dialogNote.textContent = item.note || item.subtitle || "Référence prête à être conseillée.";
  els.dialogLink.href = item.url || "#";
  els.dialogLink.classList.toggle("hidden", !item.url);

  els.dialogMeta.innerHTML = "";
  [
    item.volume,
    item.priceLabel,
    item.statusLabel,
    ...(item.families || []).slice(0, 3),
    item.gender,
  ]
    .filter(Boolean)
    .forEach((value) => {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = value;
      els.dialogMeta.appendChild(badge);
    });

  els.dialogTags.innerHTML = "";
  [...(item.tags || []), ...(item.collections || [])]
    .filter(Boolean)
    .slice(0, 8)
    .forEach((value) => {
      const badge = document.createElement("span");
      badge.className = "chip";
      badge.textContent = value;
      els.dialogTags.appendChild(badge);
    });

  els.dialog.showModal();
}

function filterItems() {
  return state.items.filter((item) => {
    if (state.filters.bestSeller && !item.bestSeller) {
      return false;
    }

    if (state.filters.query) {
      const haystack = [
        item.title,
        item.brand,
        item.volume,
        item.note,
        item.gender,
        ...(item.families || []),
        ...(item.tags || []),
        ...(item.collections || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(state.filters.query)) {
        return false;
      }
    }

    if (state.filters.brand.size && !state.filters.brand.has(item.brand)) {
      return false;
    }

    if (
      state.filters.family.size &&
      !(item.families || []).some((value) => state.filters.family.has(value))
    ) {
      return false;
    }

    if (state.filters.gender.size && !state.filters.gender.has(item.gender)) {
      return false;
    }

    if (state.filters.status.size && !state.filters.status.has(item.statusLabel)) {
      return false;
    }

    return true;
  });
}

function sortItems(items) {
  const sorted = [...items];

  switch (state.filters.sort) {
    case "title-asc":
      sorted.sort((a, b) => a.title.localeCompare(b.title, "fr"));
      break;
    case "title-desc":
      sorted.sort((a, b) => b.title.localeCompare(a.title, "fr"));
      break;
    case "brand-asc":
      sorted.sort((a, b) => {
        const brandOrder = (a.brand || "").localeCompare(b.brand || "", "fr");
        if (brandOrder !== 0) {
          return brandOrder;
        }
        return a.title.localeCompare(b.title, "fr");
      });
      break;
    case "price-asc":
      sorted.sort(
        (a, b) => (a.priceValue ?? Number.MAX_SAFE_INTEGER) - (b.priceValue ?? Number.MAX_SAFE_INTEGER)
      );
      break;
    case "price-desc":
      sorted.sort((a, b) => (b.priceValue ?? -1) - (a.priceValue ?? -1));
      break;
    default:
      sorted.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.title.localeCompare(b.title, "fr"));
      break;
  }

  return sorted;
}

function createFilterChip(key, value) {
  const label = document.createElement("label");
  label.className = "filter-choice";
  label.innerHTML = `
    <input type="checkbox" data-filter-key="${key}" value="${escapeHtml(value)}">
    <span>${escapeHtml(value)}</span>
  `;

  const input = label.querySelector("input");
  input.addEventListener("change", () => {
    if (input.checked) {
      state.filters[key].add(value);
    } else {
      state.filters[key].delete(value);
    }
    render();
  });

  return label;
}

function uniqueValues(key) {
  const values = new Set();
  state.items.forEach((item) => {
    const raw = item[key];
    if (Array.isArray(raw)) {
      raw.filter(Boolean).forEach((value) => values.add(value));
    } else if (raw) {
      values.add(raw);
    }
  });
  return [...values].sort((a, b) => a.localeCompare(b, "fr"));
}

function syncFilterInputs(key) {
  document.querySelectorAll(`input[data-filter-key="${key}"]`).forEach((input) => {
    input.checked = state.filters[key].has(input.value);
  });
}

function resetAllFilters() {
  state.filters.query = "";
  els.search.value = "";
  ["brand", "family", "gender", "status"].forEach((key) => {
    state.filters[key].clear();
    syncFilterInputs(key);
  });
  state.filters.bestSeller = false;
  availableStatusLabels.forEach((label) => state.filters.status.add(label));
  syncFilterInputs("status");
  if (els.brandSearch) {
    els.brandSearch.value = "";
    filterBrandChips("");
  }
  state.filters.sort = "title-asc";
  els.sort.value = "title-asc";
  if (els.sortMobile) els.sortMobile.value = "title-asc";
  render();
}

function syncViewFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  state.view = ["brands", "families", "available"].includes(hash) ? hash : "catalog";
}

function navigateToView(view) {
  const nextHash = view === "catalog" ? "" : `#${view}`;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  window.history.replaceState(null, "", nextUrl);
  state.view = view;
  render();

  if (view === "catalog") {
    document.querySelector(".catalog-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  els.overviewPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getOverviewConfig(results) {
  if (state.view === "brands") {
    return {
      label: "Marques",
      title: "Toutes les marques disponibles",
      text: "Choisissez une marque pour afficher directement ses references dans le catalogue.",
      items: summarizeCounts(results, (item) => item.brand).map(({ value, count }) => ({
        title: value,
        meta: `${count} reference${count > 1 ? "s" : ""}`,
        action: () => applySingleFilter("brand", value),
      })),
    };
  }

  if (state.view === "families") {
    return {
      label: "Familles",
      title: "Toutes les familles olfactives",
      text: "Choisissez une famille pour revenir sur une selection deja filtree.",
      items: summarizeCounts(results, (item) => item.families || []).map(({ value, count }) => ({
        title: value,
        meta: `${count} reference${count > 1 ? "s" : ""}`,
        action: () => applySingleFilter("family", value),
      })),
    };
  }

  if (state.view === "available") {
    return {
      label: "Disponibilite",
      title: "Disponibilite des references",
      text: "Choisissez un statut pour afficher uniquement les references correspondantes.",
      items: summarizeCounts(results, (item) => item.statusLabel).map(({ value, count }) => ({
        title: value,
        meta: `${count} reference${count > 1 ? "s" : ""}`,
        action: () => applySingleFilter("status", value),
      })),
    };
  }

  return {
    label: "Catalogue",
    title: "Toutes les references",
    text: "",
    items: [],
  };
}

function summarizeCounts(items, picker) {
  const counts = new Map();

  items.forEach((item) => {
    const raw = picker(item);
    const values = Array.isArray(raw) ? raw : [raw];

    values
      .filter(Boolean)
      .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  });

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "fr"));
}

function applySingleFilter(key, value) {
  state.filters[key].clear();
  state.filters[key].add(value);
  syncFilterInputs(key);
  navigateToView("catalog");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildMonogram(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
