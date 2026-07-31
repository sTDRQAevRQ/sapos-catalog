const DATA_URL = "./data/catalog.json";
const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1200&q=80";

const state = {
  items: [],
  filters: {
    query: "",
    brand: new Set(),
    family: new Set(),
    gender: new Set(),
    status: new Set(),
    sort: "featured",
  },
};

const els = {
  heroStats: document.querySelector("#hero-stats"),
  grid: document.querySelector("#catalog-grid"),
  empty: document.querySelector("#empty-state"),
  title: document.querySelector("#results-title"),
  activeFilters: document.querySelector("#active-filters"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  reset: document.querySelector("#reset-filters"),
  filters: {
    brand: document.querySelector("#brand-filters"),
    family: document.querySelector("#family-filters"),
    gender: document.querySelector("#gender-filters"),
    status: document.querySelector("#status-filters"),
  },
  dialog: document.querySelector("#product-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogImage: document.querySelector("#dialog-image"),
  dialogBrand: document.querySelector("#dialog-brand"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogSubtitle: document.querySelector("#dialog-subtitle"),
  dialogMeta: document.querySelector("#dialog-meta"),
  dialogTags: document.querySelector("#dialog-tags"),
  dialogLink: document.querySelector("#dialog-link"),
  template: document.querySelector("#product-card-template"),
};

init().catch((error) => {
  console.error(error);
  els.heroStats.innerHTML = '<span class="stat-pill">Erreur de chargement du catalogue.</span>';
});

async function init() {
  bindUi();
  const response = await fetch(DATA_URL);
  state.items = await response.json();
  renderFilterOptions();
  render();
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
      render();
    });
  });

  els.reset.addEventListener("click", resetAllFilters);
  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) {
      els.dialog.close();
    }
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
      const node = createFilterChip(key, value);
      els.filters[key].appendChild(node);
    });
  }
}

function render() {
  const results = sortItems(filterItems());
  renderStats(results);
  renderCards(results);
  renderActiveFilters();

  els.title.textContent = `${results.length} parfum${results.length > 1 ? "s" : ""}`;
  els.empty.classList.toggle("hidden", results.length !== 0);
}

function renderStats(results) {
  const brands = new Set(results.map((item) => item.brand).filter(Boolean)).size;
  const families = new Set(results.flatMap((item) => item.families || [])).size;
  const available = results.filter((item) => item.statusKey === "available").length;

  els.heroStats.innerHTML = "";
  [
    `${state.items.length} refs prêtes à afficher`,
    `${brands} marque${brands > 1 ? "s" : ""} visibles`,
    `${families} familles repérées`,
    `${available} disponibles`,
  ].forEach((label) => {
    const span = document.createElement("span");
    span.className = "stat-pill";
    span.textContent = label;
    els.heroStats.appendChild(span);
  });
}

function renderCards(results) {
  els.grid.innerHTML = "";

  results.forEach((item) => {
    const fragment = els.template.content.cloneNode(true);
    const button = fragment.querySelector(".product-card-button");
    const image = fragment.querySelector(".product-image");
    const status = fragment.querySelector(".product-status");
    const brand = fragment.querySelector(".product-brand");
    const price = fragment.querySelector(".product-price");
    const title = fragment.querySelector(".product-title");
    const subtitle = fragment.querySelector(".product-subtitle");
    const badges = fragment.querySelector(".product-badges");

    image.src = item.image || PLACEHOLDER_IMAGE;
    image.alt = item.imageAlt || item.title;
    status.textContent = item.statusLabel || "Disponible";
    brand.textContent = item.brand || "Marque";
    price.textContent = item.priceLabel || "";
    title.textContent = item.title;
    subtitle.textContent = item.subtitle || "Fiche prête pour enrichissement inventaire.";

    const badgeValues = [...(item.families || []).slice(0, 2)];
    if (item.gender) {
      badgeValues.push(item.gender);
    }

    badgeValues.slice(0, 3).forEach((value) => {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = value;
      badges.appendChild(badge);
    });

    button.addEventListener("click", () => openDialog(item));
    els.grid.appendChild(fragment);
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

  filterEntries.forEach(([key, value]) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span>${value}</span>`;
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
  els.dialogImage.src = item.image || PLACEHOLDER_IMAGE;
  els.dialogImage.alt = item.imageAlt || item.title;
  els.dialogBrand.textContent = item.brand || "Marque";
  els.dialogTitle.textContent = item.title;
  els.dialogSubtitle.textContent = item.subtitle || "Fiche prête à être enrichie.";
  els.dialogLink.href = item.url || "#";

  els.dialogMeta.innerHTML = "";
  [
    item.priceLabel,
    item.statusLabel,
    ...(item.collections || []).slice(0, 3),
  ]
    .filter(Boolean)
    .forEach((value) => {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = value;
      els.dialogMeta.appendChild(badge);
    });

  els.dialogTags.innerHTML = "";
  [...(item.families || []), ...(item.tags || []).slice(0, 5)]
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
        item.subtitle,
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
    case "price-asc":
      sorted.sort((a, b) => (a.priceValue ?? Number.MAX_SAFE_INTEGER) - (b.priceValue ?? Number.MAX_SAFE_INTEGER));
      break;
    case "price-desc":
      sorted.sort((a, b) => (b.priceValue ?? -1) - (a.priceValue ?? -1));
      break;
    case "newest":
      sorted.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
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
  document
    .querySelectorAll(`input[data-filter-key="${key}"]`)
    .forEach((input) => {
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
  state.filters.sort = "featured";
  els.sort.value = "featured";
  render();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
