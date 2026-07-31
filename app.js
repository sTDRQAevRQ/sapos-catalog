const DATA_URL = "./data/catalog.json";

const state = {
  items: [],
  view: "catalog",
  filters: {
    query: "",
    brand: new Set(),
    family: new Set(),
    gender: new Set(),
    status: new Set(),
    sort: "featured",
  },
};

let availableStatusLabels = new Set();

const els = {
  heroStats: document.querySelector("#hero-stats"),
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
  activeFilters: document.querySelector("#active-filters"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  reset: document.querySelector("#reset-filters"),
  quickAvailable: document.querySelector("#quick-available"),
  filters: {
    brand: document.querySelector("#brand-filters"),
    family: document.querySelector("#family-filters"),
    gender: document.querySelector("#gender-filters"),
    status: document.querySelector("#status-filters"),
  },
  dialog: document.querySelector("#product-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
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
  filtersBackdrop: document.querySelector("#filters-backdrop"),
  filtersFabCount: document.querySelector("#filters-fab-count"),
  brandSearch: document.querySelector("#brand-search"),
};

init().catch((error) => {
  console.error(error);
  els.heroStats.innerHTML = '<span class="stat-pill">Erreur de chargement du catalogue.</span>';
  els.skeletonList?.classList.add("hidden");
});

async function init() {
  bindUi();
  state.items = await loadCatalogItems();
  els.skeletonList?.classList.add("hidden");

  availableStatusLabels = getAvailableStatusLabels();
  availableStatusLabels.forEach((label) => state.filters.status.add(label));

  syncViewFromHash();
  renderFilterOptions();
  ["brand", "family", "gender", "status"].forEach(syncFilterInputs);
  render();
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

  els.reset.addEventListener("click", resetAllFilters);
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

  els.filtersToggle?.addEventListener("click", openFiltersDrawer);
  els.filtersClose?.addEventListener("click", closeFiltersDrawer);
  els.filtersBackdrop?.addEventListener("click", closeFiltersDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFiltersDrawer();
    }
  });

  els.brandSearch?.addEventListener("input", (event) => {
    filterBrandChips(event.target.value.trim().toLowerCase());
  });

  els.quickAvailable?.addEventListener("change", (event) => {
    state.filters.status.clear();
    if (event.target.checked) {
      availableStatusLabels.forEach((label) => state.filters.status.add(label));
    }
    syncFilterInputs("status");
    render();
  });
}

function openFiltersDrawer() {
  els.filtersPanel?.classList.add("is-open");
  els.filtersBackdrop?.classList.add("is-visible");
  document.body.classList.add("filters-open");
}

function closeFiltersDrawer() {
  els.filtersPanel?.classList.remove("is-open");
  els.filtersBackdrop?.classList.remove("is-visible");
  document.body.classList.remove("filters-open");
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
  const options = {
    brand: uniqueValues("brand"),
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

function render() {
  const results = sortItems(filterItems());
  renderStats(results);
  renderOverview(results);
  renderRows(results);
  renderActiveFilters();
  updateFiltersFabCount();
  syncQuickAvailableToggle();

  els.title.textContent = `${results.length} reference${results.length > 1 ? "s" : ""}`;
  els.empty.classList.toggle("hidden", results.length !== 0);
}

function syncQuickAvailableToggle() {
  if (!els.quickAvailable) return;
  const isAvailableOnly =
    availableStatusLabels.size > 0 &&
    state.filters.status.size === availableStatusLabels.size &&
    [...state.filters.status].every((label) => availableStatusLabels.has(label));
  els.quickAvailable.checked = isAvailableOnly;
}

function updateFiltersFabCount() {
  if (!els.filtersFabCount) return;
  const count =
    state.filters.brand.size +
    state.filters.family.size +
    state.filters.gender.size +
    state.filters.status.size +
    (state.filters.query ? 1 : 0);
  els.filtersFabCount.textContent = String(count);
  els.filtersFabCount.classList.toggle("hidden", count === 0);
}

function renderStats(results) {
  const brands = new Set(results.map((item) => item.brand).filter(Boolean)).size;
  const families = new Set(results.flatMap((item) => item.families || [])).size;
  const available = results.filter((item) => item.statusKey === "available").length;

  els.heroStats.innerHTML = "";
  [
    {
      view: "catalog",
      label: `${state.items.length} refs`,
      detail: "Voir toutes les references",
    },
    {
      view: "brands",
      label: `${brands} marque${brands > 1 ? "s" : ""}`,
      detail: "Voir toutes les marques",
    },
    {
      view: "families",
      label: `${families} familles`,
      detail: "Voir toutes les familles",
    },
    {
      view: "available",
      label: `${available} disponibles`,
      detail: "Voir les references disponibles",
    },
  ].forEach(({ view, label, detail }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stat-pill stat-pill-button";
    button.dataset.view = view;
    button.innerHTML = `<span>${escapeHtml(label)}</span><span class="stat-pill-hint">${escapeHtml(detail)}</span>`;
    button.addEventListener("click", () => navigateToView(view));
    els.heroStats.appendChild(button);
  });
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
    const image = fragment.querySelector(".product-image");
    const monogram = fragment.querySelector(".product-monogram");
    const status = fragment.querySelector(".product-status");
    const brand = fragment.querySelector(".product-brand");
    const title = fragment.querySelector(".product-title");
    const volume = fragment.querySelector(".product-volume");
    const price = fragment.querySelector(".product-price");
    const note = fragment.querySelector(".product-note");
    const meta = fragment.querySelector(".product-meta");

    monogram.textContent = buildMonogram(item.brand || item.title);
    if (item.image) {
      image.src = item.image;
      image.alt = item.imageAlt || item.title;
      image.classList.remove("hidden");
      monogram.classList.add("hidden");
    } else {
      image.removeAttribute("src");
      image.alt = "";
      image.classList.add("hidden");
      monogram.classList.remove("hidden");
    }
    status.textContent = item.statusLabel || "Disponible";
    status.dataset.status = item.statusKey || "available";
    brand.textContent = item.brand || "Marque";
    title.textContent = item.title;
    volume.textContent = item.volume || "Contenance a preciser";
    price.textContent = item.priceLabel || "Prix sur demande";
    note.textContent = item.note || item.subtitle || "Reference prete a recommander.";

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
  els.dialogBrand.textContent = item.brand || "Marque";
  els.dialogTitle.textContent = item.title;
  els.dialogNote.textContent = item.note || item.subtitle || "Reference prete a etre conseillee.";
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
  availableStatusLabels.forEach((label) => state.filters.status.add(label));
  syncFilterInputs("status");
  if (els.brandSearch) {
    els.brandSearch.value = "";
    filterBrandChips("");
  }
  state.filters.sort = "featured";
  els.sort.value = "featured";
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

function formatRowIndex(rank, fallbackIndex) {
  const numeric = Number(rank);
  return String(Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackIndex).padStart(2, "0");
}
