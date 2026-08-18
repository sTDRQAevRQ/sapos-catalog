const DATA_URL = "./data/catalog.json";
const BRAND_LOGOS_URL = "./data/brand-logos.json";
const PAGE_SIZE = 48;
const PARTNER_PREVIEW_COUNT = 5;
const FEATURED_PARTNER_BRANDS = ["Hermès", "Guerlain", "Prada", "Acqua di Parma"];
const AVAILABILITY_REFRESH_TTL_MS = 5 * 60 * 1000;
const AVAILABILITY_BATCH_SIZE = 12;

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
  currentPage: 1,
  filters: {
    query: "",
    brand: new Set(),
    family: new Set(),
    gender: new Set(),
    status: new Set(),
    segment: new Set(),
    bestSeller: false,
    sort: "title-asc",
  },
};

let currentView = "list";
let lastFilterSignature = "";

let availableStatusLabels = new Set();
const NEW_WINDOW_DAYS = 15;
const availabilityCache = new Map();
const availabilityInFlight = new Set();
let availabilityRenderQueued = false;

function isVisibleCatalogItem(item) {
  if (!item) return false;
  if ((item.statusKey || "available") !== "available") return false;
  return Number(item.quantity) > 0;
}

function normalizeBrandKey(value) {
  return String(value || "")
    .trim()
    .replaceAll("’", "'")
    .replaceAll("`", "'")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

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
  return HOUSE_BRANDS.has(normalizeBrandKey(brand));
}

const els = {
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
  paginationBar: document.querySelector("#pagination-bar"),
  paginationNumbers: document.querySelector("#pagination-numbers"),
  paginationPrev: document.querySelector("#pagination-prev"),
  paginationNext: document.querySelector("#pagination-next"),
  activeFilters: document.querySelector("#active-filters"),
  familyShortcuts: document.querySelector("#family-shortcuts"),
  familyToggle: document.querySelector("#family-toggle"),
  brandPickerToggle: document.querySelector("#brand-picker-toggle"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  sortMobile: document.querySelector("#sort-mobile"),
  heroSegmentAllBtn: document.querySelector("#hero-segment-all"),
  heroSegmentMainstreamBtn: document.querySelector("#hero-segment-mainstream"),
  heroSegmentNicheBtn: document.querySelector("#hero-segment-niche"),
  reset: document.querySelector("#reset-filters"),
  quickAvailable: document.querySelector("#quick-available"),
  quickAvailableMobile: document.querySelector("#quick-available-mobile"),
  viewGridBtn: document.querySelector("#view-grid-btn"),
  viewDetailedBtn: document.querySelector("#view-detailed-btn"),
  viewTextBtn: document.querySelector("#view-text-btn"),
  filters: {
    brand: document.querySelector("#brand-filters"),
    family: document.querySelector("#family-filters"),
    gender: document.querySelector("#gender-filters"),
    segment: document.querySelector("#segment-filters"),
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
  dialogCartLink: document.querySelector("#dialog-cart-link"),
  dialogLink: document.querySelector("#dialog-link"),
  template: document.querySelector("#product-row-template"),
  filtersPanel: document.querySelector("#filters-panel"),
  filtersToggle: document.querySelector("#filters-toggle"),
  filtersClose: document.querySelector("#filters-close"),
  filtersFabCount: document.querySelector("#filters-fab-count"),
  brandSearch: document.querySelector("#brand-search"),
  familySearch: document.querySelector("#family-search"),
  brandMoreBtn: document.querySelector("#brand-more-btn"),
  familyMoreBtn: document.querySelector("#family-more-btn"),
  brandPickerDialog: document.querySelector("#brand-picker-dialog"),
  brandPickerClose: document.querySelector("#brand-picker-close"),
  brandPickerSearch: document.querySelector("#brand-picker-search"),
  brandPickerList: document.querySelector("#brand-picker-list"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  navPanel: document.querySelector("#nav-panel"),
  navToggle: document.querySelector("#nav-toggle"),
  navClose: document.querySelector("#nav-close"),
  brandHome: document.querySelector("#brand-home"),
};

init().catch((error) => {
  console.error(error);
  if (els.resultsCountLine) els.resultsCountLine.textContent = "Erreur de chargement du catalogue.";
  els.skeletonList?.classList.add("hidden");
});

async function init() {
  bindUi();
  const [items, brandLogos] = await Promise.all([loadCatalogItems(), loadBrandLogos()]);
  state.items = items.filter(isVisibleCatalogItem);
  brandLogoMap = new Map(
    Object.entries(brandLogos || {}).map(([brand, url]) => [normalizeBrandKey(brand), url])
  );
  els.skeletonList?.classList.add("hidden");

  availableStatusLabels = getAvailableStatusLabels();

  syncViewFromHash();
  renderFilterOptions();
  ["brand", "family", "gender", "status", "segment"].forEach(syncFilterInputs);

  let savedView = "grid";
  try {
    savedView = localStorage.getItem("sapos-catalog-view") || "grid";
  } catch (error) {
    savedView = "grid";
  }
  setView(savedView);

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
  return brandLogoMap.get(normalizeBrandKey(brand)) || null;
}

function buildCartUrl(item) {
  const variantId = String(item.variantId || "").trim();
  if (!variantId) return null;
  return `https://saposparfums.fr/cart/${variantId}:1`;
}

function buildProductImageAlt(item) {
  const explicitAlt = String(item.imageAlt || "").trim();
  if (explicitAlt) return explicitAlt;

  const parts = [
    item.title,
    item.brand && !String(item.title || "").includes(item.brand) ? item.brand : null,
    item.volume,
  ].filter(Boolean);

  return parts.length ? `Visuel produit ${parts.join(" - ")}` : "Visuel produit Sapos Parfums";
}

function buildBrandLogoAlt(item) {
  const brand = String(item.brand || "").trim();
  if (brand) return `Logo ${brand}`;
  return "Logo marque";
}

function getProductHandle(item) {
  const rawUrl = String(item.url || "").trim();
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, window.location.origin);
    const match = url.pathname.match(/^\/products\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (error) {
    return null;
  }
}

function applyAvailabilityToItem(item, snapshot) {
  if (!snapshot || typeof snapshot.available !== "boolean") return false;

  const nextStatusKey = snapshot.available ? "available" : "out";
  const nextStatusLabel = snapshot.available ? "Disponible" : "Rupture";
  const nextQuantity = snapshot.available ? Math.max(Number(item.quantity) || 1, 1) : 0;

  let changed = false;
  if ((item.statusKey || "available") !== nextStatusKey) {
    item.statusKey = nextStatusKey;
    changed = true;
  }
  if ((item.statusLabel || "Disponible") !== nextStatusLabel) {
    item.statusLabel = nextStatusLabel;
    changed = true;
  }
  if ((item.quantity ?? null) !== nextQuantity) {
    item.quantity = nextQuantity;
    changed = true;
  }
  return changed;
}

function queueAvailabilityRender() {
  if (availabilityRenderQueued) return;
  availabilityRenderQueued = true;
  window.requestAnimationFrame(() => {
    availabilityRenderQueued = false;
    state.items = state.items.filter(isVisibleCatalogItem);
    availableStatusLabels = getAvailableStatusLabels();
    render();
  });
}

async function fetchAvailabilityBatch(handles) {
  if (!handles.length) return [];
  const params = new URLSearchParams();
  params.set("handles", handles.join(","));
  const response = await fetch(`/api/availability?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Availability refresh failed: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

async function refreshAvailabilityForItems(items) {
  const handles = [...new Set(items.map((item) => getProductHandle(item)).filter(Boolean))];
  const now = Date.now();
  const handlesToFetch = handles.filter((handle) => {
    if (availabilityInFlight.has(handle)) return false;
    const cached = availabilityCache.get(handle);
    return !cached || now - cached.checkedAt > AVAILABILITY_REFRESH_TTL_MS;
  });

  if (!handlesToFetch.length) return;
  handlesToFetch.forEach((handle) => availabilityInFlight.add(handle));

  try {
    for (let index = 0; index < handlesToFetch.length; index += AVAILABILITY_BATCH_SIZE) {
      const batch = handlesToFetch.slice(index, index + AVAILABILITY_BATCH_SIZE);
      let snapshots = [];
      try {
        snapshots = await fetchAvailabilityBatch(batch);
      } catch (error) {
        console.warn("Impossible de rafraîchir la disponibilité Shopify.", error);
      }

      const checkedAt = Date.now();
      const snapshotMap = new Map(
        snapshots
          .filter((entry) => entry && entry.handle)
          .map((entry) => [entry.handle, { ...entry, checkedAt }])
      );

      batch.forEach((handle) => {
        const snapshot = snapshotMap.get(handle);
        if (snapshot) {
          availabilityCache.set(handle, snapshot);
        }
      });
    }
  } finally {
    handlesToFetch.forEach((handle) => availabilityInFlight.delete(handle));
  }

  let changed = false;
  state.items.forEach((item) => {
    const handle = getProductHandle(item);
    if (!handle) return;
    changed = applyAvailabilityToItem(item, availabilityCache.get(handle)) || changed;
  });

  if (changed) {
    queueAvailabilityRender();
  }
}

function hasRichNote(item) {
  return Boolean((item.noteHtml || "").trim() || (item.note || "").trim());
}

function stripHtmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToStructuredLines(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|h4|li|ul|ol|table|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractInlineNoteSection(line) {
  const compact = String(line || "").replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const specs = [
    { label: "Notes de tête", regex: /^notes?\s+de\s+t[êe]te\s*:?\s*(.+)$/i },
    { label: "Notes de cœur", regex: /^notes?\s+de\s+c[œoe]ur\s*:?\s*(.+)$/i },
    { label: "Notes de fond", regex: /^notes?\s+de\s+fond\s*:?\s*(.+)$/i },
    { label: "Notes principales", regex: /^notes?\s+principales?\s*:\s*(.+)$/i },
    { label: "Notes de tête", regex: /^t[êe]te\s*:?\s*(.+)$/i },
    { label: "Notes de cœur", regex: /^c[œoe]ur\s*:?\s*(.+)$/i },
    { label: "Notes de fond", regex: /^fond\s*:?\s*(.+)$/i },
    { label: "Notes principales", regex: /^notes?\s*:\s*(.+)$/i },
  ];

  for (const { label, regex } of specs) {
    const match = compact.match(regex);
    if (!match) continue;
    return {
      label,
      value: cleanupNoteValue(match[1] || ""),
    };
  }

  return null;
}

function formatNotesParagraphs(sections) {
  const seen = new Set();

  return sections
    .filter((section) => {
      if (!section?.value) return false;
      const key = `${String(section.label || "").toLowerCase()}::${String(section.value || "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(
      (section) =>
        `<p><strong>${escapeHtml(section.label)} :</strong> ${escapeHtml(section.value)}</p>`
    )
    .join("");
}

function normalizeNoteHeading(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replaceAll("œ", "oe")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isNoteBoundaryLine(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return false;
  if (
    /^(pour quelle occasion|tenue et sillage|pourquoi choisir|extrait de parfum|disponible en flacon|livraison offerte|commandez|le format testeur|cette présentation testeur|présenté ici|format\s*:)/i.test(
      compact
    )
  ) {
    return true;
  }

  // Some Shopify descriptions place a marketing title right after the notes block.
  if (/^[A-ZÀ-ÖØ-Þ0-9][^.!?]{0,120}[–-][^.!?]{0,120}$/.test(compact) && !/,/.test(compact)) {
    return true;
  }

  return false;
}

function cleanupNoteValue(text) {
  return String(text || "")
    .split(
      /(?=\b(?:Pour quelle occasion\s*\?|Tenue et sillage|Pourquoi choisir|Saison conseillée\s*:|Disponible en flacon|Livraison offerte|Commandez(?:\s+dès\s+maintenant)?|Extrait de parfum)\b)/i
    )[0]
    .split(/(?=\s+[A-ZÀ-ÖØ-Þ0-9][^.!?]{0,120}\s+[–-]\s+[A-ZÀ-ÖØ-Þ])/)
    [0]
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

function cleanupInlineNoteValue(text) {
  return cleanupNoteValue(text)
    .split(
      /\b(?:dans une?|pour une?|avec une?|creant|créant|offrant|renforcant|renforçant|laissant)\s+(?:composition|construction|structure|ouverture|base|signature|fragrance|sensation|impression)\b/i
    )[0]
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

function detectNoteHeading(text) {
  const normalized = normalizeNoteHeading(text);
  if (/^notes?\s+de\s+tete$/.test(normalized)) return "Notes de tête";
  if (/^notes?\s+de\s+coeur$/.test(normalized)) return "Notes de cœur";
  if (/^notes?\s+de\s+fond$/.test(normalized)) return "Notes de fond";
  if (/^notes?\s+principales$/.test(normalized)) return "Notes principales";
  if (/^notes?\s+olfactives$/.test(normalized)) return "Notes olfactives";
  return null;
}

function extractStructuredNotesFromLines(lines) {
  if (!lines.length) return "";

  const sections = [];

  for (let index = 0; index < lines.length; index += 1) {
    const inlineSection = extractInlineNoteSection(lines[index]);
    if (inlineSection?.value) {
      sections.push(inlineSection);
      continue;
    }

    const headingLabel = detectNoteHeading(lines[index]);
    if (!headingLabel) continue;

    const values = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (detectNoteHeading(line)) break;
      if (isNoteBoundaryLine(line)) {
        break;
      }
      values.push(line.replace(/^notes?\s*:?\s*/i, "").trim());
    }

    if (values.length) {
      const joiner = headingLabel === "Notes olfactives" ? ", " : " ";
      const value = cleanupNoteValue(values.join(joiner));
      if (!value) continue;
      sections.push({
        label: headingLabel,
        value,
      });
    }
  }

  if (sections.length) {
    return formatNotesParagraphs(sections);
  }

  return "";
}

function extractStructuredNotesFromDom(doc) {
  const children = Array.from(doc.body?.children || []);
  if (!children.length) return "";

  const sections = [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const inlineSection = extractInlineNoteSection(child.textContent);
    if (inlineSection?.value) {
      sections.push(inlineSection);
      continue;
    }

    const headingLabel = detectNoteHeading(child.textContent);
    if (!headingLabel) continue;

    const values = [];
    for (let cursor = index + 1; cursor < children.length; cursor += 1) {
      const sibling = children[cursor];
      if (detectNoteHeading(sibling.textContent)) break;
      const text = sibling.textContent.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (isNoteBoundaryLine(text)) break;
      values.push(text.replace(/^notes?\s*:?\s*/i, "").trim());
    }

    if (values.length) {
      const joiner = headingLabel === "Notes olfactives" ? ", " : " ";
      const value = cleanupNoteValue(values.join(joiner));
      if (!value) continue;
      sections.push({
        label: headingLabel,
        value,
      });
    }
  }

  if (sections.length) {
    return formatNotesParagraphs(sections);
  }

  return "";
}

function extractStructuredNotesFromText(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const specs = [
    {
      label: "Notes de tête",
      regex:
        /NOTES?\s+DE\s+T[ÊE]TE\s*:?\s*(.+?)(?=\s+NOTES?\s+DE\s+(?:CŒUR|COEUR)|\s+NOTES?\s+DE\s+FOND|\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes de cœur",
      regex:
        /NOTES?\s+DE\s+(?:CŒUR|COEUR)\s*:?\s*(.+?)(?=\s+NOTES?\s+DE\s+FOND|\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes de fond",
      regex:
        /NOTES?\s+DE\s+FOND\s*:?\s*(.+?)(?=\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes de tête",
      regex:
        /(?:^|\s)T[ÊE]TE\s*:\s*(.+?)(?=\s+(?:C[ŒOE]UR|FOND)\s*:|\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes de cœur",
      regex:
        /(?:^|\s)C[ŒOE]UR\s*:\s*(.+?)(?=\s+FOND\s*:|\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes de fond",
      regex:
        /(?:^|\s)FOND\s*:\s*(.+?)(?=\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
    {
      label: "Notes principales",
      regex:
        /(?:^|\s)NOTES?\s*:\s*(.+?)(?=\s+POURQUOI|\s+POUR\s+QUELLE|\s+TENUE|\s+EXTRAIT\s+DE\s+PARFUM|$)/i,
    },
  ];

  const sections = specs
    .map(({ label, regex }) => {
      const match = compact.match(regex);
      return {
        label,
        value: cleanupNoteValue(match?.[1] || ""),
      };
    })
    .filter((section) => section.value);

  if (sections.length) {
    return formatNotesParagraphs(sections);
  }

  return "";
}

function extractNarrativeOlfactoryNotes(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return [];

  const patterns = [
    /([A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+(?:,\s*[A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+){1,}(?:\s+et\s+[A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+)?)\s+(?:composent|compose|forment|forme|réunissent|réunit|prolongent|prolonge|signent|signe)\b/gi,
    /([A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+(?:,\s*[A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+){1,}(?:\s+et\s+[A-ZÀ-ÖØ-öø-ÿa-z0-9'’ -]+)?)\s+(?:au\s+c[œoe]ur|en\s+fond|dans\s+le\s+fond|en\s+ouverture)\b/gi,
  ];

  const values = [];
  for (const pattern of patterns) {
    const matches = compact.matchAll(pattern);
    for (const match of matches) {
      const candidate = cleanupInlineNoteValue(match[1] || "")
        .replace(/\set\s/gi, ", ")
        .replace(/\s*;\s*/g, ", ")
        .trim()
        .replace(/[.:,;]+$/, "");
      if (!candidate) continue;
      candidate
        .split(/\s*,\s*/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => values.push(part));
    }
  }

  const uniqueValues = [];
  for (const value of values) {
    const normalizedValue = value
      .replace(/^(?:une?|des?|le|la|les|du|de la|de l'|d['’]|son|sa|ses|cette|ce)\s+/i, "")
      .trim();
    if (normalizedValue.length < 3) continue;
    if (/\b(?:parfum|fragrance|composition|sillage|tenue|occasion|saison|livraison|testeur|conditionnement|version|quotidien)\b/i.test(normalizedValue)) {
      continue;
    }
    if (!uniqueValues.some((existing) => existing.toLowerCase() === normalizedValue.toLowerCase())) {
      uniqueValues.push(normalizedValue);
    }
  }

  return uniqueValues.slice(0, 12);
}

function extractInlinePrimaryNotes(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return [];

  const patterns = [
    /\bassocie\s+([^.]*)/i,
    /\brepose sur\s+([^.]*)/i,
    /\bs['’]ouvre sur\s+([^.]*)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match?.[1]) continue;
    const normalized = cleanupInlineNoteValue(match[1])
      .replace(/\set\s/gi, ", ")
      .replace(/\s+ou\s+/gi, ", ")
      .replace(/\s*;\s*/g, ", ")
      .trim()
      .replace(/[.:,;]+$/, "");
    const notes = normalized
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (notes.length) {
      return notes;
    }
  }

  return [];
}

function normalizeNativePreviewHtml(html) {
  const compact = String(html || "").trim();
  if (!compact || !compact.includes("|")) return compact;

  const doc = new DOMParser().parseFromString(compact, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    node.nodeValue = node.nodeValue.replace(/\s*\|\s*/g, ", ");
  }

  return doc.body.innerHTML.trim();
}

function extractNativeNotesHtml(item) {
  const nativePreviewHtml = (item.notePreviewHtml || "").trim();
  if (nativePreviewHtml) {
    return normalizeNativePreviewHtml(nativePreviewHtml);
  }

  const html = (item.noteHtml || "").trim();
  if (html) {
    const structuredFromLines = extractStructuredNotesFromLines(htmlToStructuredLines(html));
    if (structuredFromLines) {
      return structuredFromLines;
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const structuredFromDom = extractStructuredNotesFromDom(doc);
    if (structuredFromDom) {
      return structuredFromDom;
    }

    const htmlText = htmlToStructuredLines(html).join(" ");
    const structuredFromHtmlText = extractStructuredNotesFromText(htmlText);
    if (structuredFromHtmlText) {
      return structuredFromHtmlText;
    }

    const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, strong"));

    for (const heading of headings) {
      const headingText = heading.textContent.trim();
      if (!/^(pyramide olfactive|notes principales|notes olfactives)$/i.test(headingText)) continue;

      const chunks = [];
      let cursor = heading.parentElement === doc.body ? heading.nextElementSibling : heading.nextElementSibling;
      while (cursor) {
        if (/^H[1-4]$/i.test(cursor.tagName)) break;
        if (cursor.matches("ul, ol")) {
          const listItems = Array.from(cursor.querySelectorAll("li")).filter(
            (node) => node.textContent.trim().length > 0
          );
          if (listItems.length) {
            chunks.push(`<ul>${listItems.map((node) => node.outerHTML).join("")}</ul>`);
          }
        } else if (cursor.matches("p")) {
          const text = cursor.textContent.trim();
          if (text) {
            chunks.push(cursor.outerHTML);
          }
        }
        cursor = cursor.nextElementSibling;
      }
      if (chunks.length) return chunks.join("");
    }

    const olfactiveListHeading = headings.find((heading) =>
      /^notes olfactives$/i.test(heading.textContent.trim())
    );
    if (olfactiveListHeading) {
      let cursor = olfactiveListHeading.nextElementSibling;
      while (cursor) {
        if (/^H[1-4]$/i.test(cursor.tagName)) break;
        if (cursor.matches("ul, ol")) {
          const values = Array.from(cursor.querySelectorAll("li"))
            .map((node) => node.textContent.replace(/\s+/g, " ").trim())
            .filter(Boolean);
          if (values.length) {
            return `<p><strong>Notes principales :</strong> ${escapeHtml(values.join(", "))}</p>`;
          }
        }
        cursor = cursor.nextElementSibling;
      }
    }

    const listItems = Array.from(doc.querySelectorAll("li")).filter((node) =>
      /^(notes?\s+de\s+t[êe]te|notes?\s+de\s+c[œoe]ur|notes?\s+de\s+fond|t[êe]te\s*:|c[œoe]ur\s*:|fond\s*:)/i.test(
        node.textContent.trim()
      )
    );
    if (listItems.length) {
      return `<ul>${listItems.map((node) => node.outerHTML).join("")}</ul>`;
    }

    const noteBlocks = Array.from(doc.querySelectorAll("p")).filter((node) =>
      /(notes?\s+de\s+t[êe]te|notes?\s+de\s+c[œoe]ur|notes?\s+de\s+fond|t[êe]te\s*:|c[œoe]ur\s*:|fond\s*:|^notes?\s*:)/i.test(
        node.textContent.trim()
      )
    );
    if (noteBlocks.length) {
      return noteBlocks.map((node) => node.outerHTML).join("");
    }

    const inlineNotes = extractInlinePrimaryNotes(htmlText);
    if (inlineNotes.length) {
      return `<p><strong>Notes principales :</strong> ${escapeHtml(inlineNotes.join(", "))}</p>`;
    }
  }

  const text = (item.note || "").trim();
  if (!text) return "";

  const structuredFromText = extractStructuredNotesFromText(text);
  if (structuredFromText) {
    return structuredFromText;
  }

  const noteLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(notes?\s+de\s+t[êe]te|notes?\s+de\s+c[œoe]ur|notes?\s+de\s+fond|t[êe]te\s*:|c[œoe]ur\s*:|fond\s*:|notes?\s*:)/i.test(
        line
      )
    );

  if (noteLines.length) {
    return noteLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }

  const inlineNotes = extractInlinePrimaryNotes(text);
  if (inlineNotes.length) {
    return `<p><strong>Notes principales :</strong> ${escapeHtml(inlineNotes.join(", "))}</p>`;
  }

  const narrativeNotes = extractNarrativeOlfactoryNotes(text);
  if (narrativeNotes.length) {
    return `<p><strong>Notes principales :</strong> ${escapeHtml(narrativeNotes.join(", "))}</p>`;
  }

  return "";
}

function extractNotePreviewHtml(item) {
  return extractNativeNotesHtml(item);
}

function hasNotePreview(item) {
  return Boolean(extractNotePreviewHtml(item));
}

function getCardNoteHtml(item) {
  const previewHtml = extractNotePreviewHtml(item);
  if (previewHtml) return previewHtml;

  return "<p>Notes non renseignées pour cette référence.</p>";
}

function setRichContent(element, item) {
  const html = (item.noteHtml || "").trim();
  if (html) {
    element.innerHTML = html;
    return;
  }
  element.textContent = item.note || item.subtitle || "Référence prête à être recommandée.";
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
  const items = await response.json();
  return Array.isArray(items) ? items.filter(isVisibleCatalogItem) : [];
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
        filterChipsInContainer(els.filters.brand, "");
      }
      if (key === "family" && els.familySearch) {
        els.familySearch.value = "";
        filterChipsInContainer(els.filters.family, "");
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
  els.dialog.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
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
    filterChipsInContainer(els.filters.brand, event.target.value.trim().toLowerCase());
  });

  els.familySearch?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    if (!familyExpanded) {
      renderFamilyFilterOptions(Boolean(query));
    }
    filterChipsInContainer(els.filters.family, query);
  });

  els.brandMoreBtn?.addEventListener("click", () => {
    openBrandPicker();
  });

  els.familyMoreBtn?.addEventListener("click", () => {
    familyExpanded = !familyExpanded;
    renderFamilyFilterOptions();
    syncFilterInputs("family");
  });

  els.brandPickerToggle?.addEventListener("click", () => {
    openBrandPicker();
  });

  els.brandPickerClose?.addEventListener("click", () => els.brandPickerDialog?.close());
  els.brandPickerDialog?.addEventListener("click", (event) => {
    if (event.target === els.brandPickerDialog) {
      els.brandPickerDialog.close();
    }
  });

  els.brandPickerSearch?.addEventListener("input", (event) => {
    filterChipsInContainer(els.brandPickerList, event.target.value.trim().toLowerCase());
  });

  els.familyToggle?.addEventListener("click", () => {
    const isOpen = els.familyShortcuts?.classList.toggle("hidden") === false;
    els.familyToggle.classList.toggle("is-open", isOpen);
  });

  document.querySelectorAll("[data-segment-value]").forEach((button) => {
    button.addEventListener("click", () => {
      applyHeroSegmentFilter(button.dataset.segmentValue || "");
    });
  });

  els.quickAvailable?.addEventListener("change", (event) => {
    applyQuickAvailable(event.target.checked);
  });

  els.quickAvailableMobile?.addEventListener("change", (event) => {
    applyQuickAvailable(event.target.checked);
  });

  els.viewGridBtn?.addEventListener("click", () => setView("grid"));
  els.viewDetailedBtn?.addEventListener("click", () => setView("detailed"));
  els.viewTextBtn?.addEventListener("click", () => setView("text"));

  els.paginationPrev?.addEventListener("click", () => {
    if (state.currentPage > 1) goToPage(state.currentPage - 1);
  });

  els.paginationNext?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(sortItems(filterItems()).length / PAGE_SIZE));
    if (state.currentPage < totalPages) goToPage(state.currentPage + 1);
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
  currentView = ["grid", "detailed", "text"].includes(mode) ? mode : "grid";
  els.list.classList.toggle("is-text", currentView === "text");
  els.list.classList.toggle("is-grid", currentView === "grid");
  els.viewGridBtn?.classList.toggle("is-active", currentView === "grid");
  els.viewDetailedBtn?.classList.toggle("is-active", currentView === "detailed");
  els.viewTextBtn?.classList.toggle("is-active", currentView === "text");
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
        const delta = currentY - lastY;
        if (delta > 8 && currentY > 140) {
          els.filtersToggle.classList.add("is-hidden");
        } else if (delta < -8 || currentY <= 140) {
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
      window.location.href = "https://saposparfums.fr/pages/toutes-les-marques";
      break;
    case "families":
      closeAllDrawers();
      navigateToView("families");
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
    case "mainstream":
     applyCategoryFilter({ segment: "Mainstream" });
     break;
    case "niche":
     applyCategoryFilter({ segment: "Niche" });
     break;
    case "contact":
      closeAllDrawers();
      window.open("https://saposparfums.fr/pages/contact", "_blank", "noopener");
      break;
    default:
      break;
  }
}

function applyCategoryFilter({ gender, bestSeller, segment } = {}) {
  state.filters.brand.clear();
  state.filters.family.clear();
  state.filters.query = "";
  els.search.value = "";
  state.filters.gender.clear();
  if (gender) {
    state.filters.gender.add(gender);
  }
  state.filters.segment.clear();
  if (segment) {
   state.filters.segment.add(segment);
  }
  state.filters.bestSeller = Boolean(bestSeller);
  syncFilterInputs("brand");
  syncFilterInputs("family");
  syncFilterInputs("gender");
  syncFilterInputs("segment");
  if (els.brandSearch) {
    els.brandSearch.value = "";
    filterChipsInContainer(els.filters.brand, "");
  }
  if (els.familySearch) {
    els.familySearch.value = "";
    filterChipsInContainer(els.filters.family, "");
  }
  closeAllDrawers();
  navigateToView("catalog");
}

function filterChipsInContainer(container, query) {
  if (!container) return;
  const choices = container.querySelectorAll(".filter-choice");
  choices.forEach((choice) => {
    const label = choice.querySelector("span")?.textContent?.toLowerCase() || "";
    choice.classList.toggle("hidden", Boolean(query) && !label.includes(query));
  });
}

const FAMILY_PREVIEW_COUNT = 0;
let familyExpanded = false;

function renderFilterOptions() {
  renderBrandFilterOptions();
  renderFamilyFilterOptions();
  renderGenderFilterOptions();
  renderSegmentFilterOptions();
}

function renderGenderFilterOptions() {
  const values = uniqueValues("gender");
  els.filters.gender.innerHTML = "";
  values.forEach((value) => {
    els.filters.gender.appendChild(createFilterChip("gender", value));
  });
}

function renderSegmentFilterOptions() {
  if (!els.filters.segment) return;
  const values = ["Mainstream", "Niche"];
  els.filters.segment.innerHTML = "";
  values.forEach((value) => {
    els.filters.segment.appendChild(createFilterChip("segment", value));
  });
}

function renderFamilyFilterOptions(forceShowAll) {
  const counts = summarizeCounts(state.items, (item) => item.families || []);
  els.filters.family.innerHTML = "";
  const showAll = familyExpanded || forceShowAll;
  const visible = showAll ? counts : counts.slice(0, FAMILY_PREVIEW_COUNT);
  visible.forEach(({ value, count }) => {
    els.filters.family.appendChild(createFilterChip("family", value, count));
  });
  if (els.familyMoreBtn) {
    const hasMore = counts.length > FAMILY_PREVIEW_COUNT;
    els.familyMoreBtn.classList.toggle("hidden", !hasMore || Boolean(forceShowAll));
    els.familyMoreBtn.textContent = familyExpanded
      ? "Voir moins de familles"
      : `+ voir toutes les familles (${counts.length})`;
  }
}

function renderBrandFilterOptions() {
  const brands = uniqueValues("brand");
  const houseBrands = brands.filter((brand) => isHouseBrand(brand));
  const partnerBrands = brands.filter((brand) => !isHouseBrand(brand));
  const previewPartners = FEATURED_PARTNER_BRANDS.filter((brand) => partnerBrands.includes(brand));
  const hasMore = partnerBrands.length > previewPartners.length;

  els.filters.brand.innerHTML = "";

  if (houseBrands.length) {
    els.filters.brand.appendChild(createGroupLabel("Nos marques"));
    const houseWrap = document.createElement("div");
    houseWrap.className = "filter-list filter-list-plain";
    houseBrands.forEach((brand) => {
      houseWrap.appendChild(createFilterChip("brand", brand));
    });
    els.filters.brand.appendChild(houseWrap);
  }

  if (previewPartners.length) {
    els.filters.brand.appendChild(createGroupLabel("Marques partenaires"));
    previewPartners.forEach((brand) => {
      els.filters.brand.appendChild(createFilterChip("brand", brand));
    });
  }

  if (els.brandMoreBtn) {
    els.brandMoreBtn.classList.toggle("hidden", !hasMore);
    els.brandMoreBtn.textContent = `Voir toutes les marques (${brands.length})`;
  }

  if (els.brandPickerList) {
    els.brandPickerList.innerHTML = "";
    if (houseBrands.length) {
      els.brandPickerList.appendChild(createGroupLabel("Nos marques"));
      houseBrands.forEach((brand) => {
        els.brandPickerList.appendChild(createFilterChip("brand", brand));
      });
    }
    if (partnerBrands.length) {
      els.brandPickerList.appendChild(createGroupLabel("Marques partenaires"));
      partnerBrands.forEach((brand) => {
        els.brandPickerList.appendChild(createFilterChip("brand", brand));
      });
    }
  }
}

function createGroupLabel(text) {
  const label = document.createElement("p");
  label.className = "filter-group-label";
  label.textContent = text;
  return label;
}

function renderFamilyShortcuts() {
  if (!els.familyShortcuts) return;
  const families = uniqueValues("families");
  els.familyShortcuts.innerHTML = "";

  families.forEach((family) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "family-chip";
    button.classList.toggle("is-active", state.filters.family.has(family));
    button.textContent = family;
    button.addEventListener("click", () => {
      if (state.filters.family.has(family) && state.filters.family.size === 1) {
        state.filters.family.clear();
      } else {
        state.filters.family.clear();
        state.filters.family.add(family);
      }
      syncFilterInputs("family");
      render();
    });
    els.familyShortcuts.appendChild(button);
  });
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
    state.currentPage = 1;
    lastFilterSignature = signature;
  }

  const results = sortItems(filterItems());
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  const startIndex = (state.currentPage - 1) * PAGE_SIZE;
  const visibleResults = results.slice(startIndex, startIndex + PAGE_SIZE);

  renderOverview(results);
  renderRows(visibleResults);
  renderActiveFilters();
  renderFamilyShortcuts();
  updateFiltersFabCount();
  syncQuickAvailableToggle();
  updatePaginationBar(results.length);
  updateResultsCount(results.length);

  els.title.textContent = `${results.length} reference${results.length > 1 ? "s" : ""}`;
  els.empty.classList.toggle("hidden", results.length !== 0);
  refreshAvailabilityForItems(visibleResults);
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

function updatePaginationBar(totalFiltered) {
  if (!els.paginationBar) return;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  els.paginationBar.classList.toggle("is-visible", totalPages > 1);
  if (totalPages <= 1) return;

  const current = state.currentPage;
  if (els.paginationNumbers) {
    els.paginationNumbers.innerHTML = "";
    buildPaginationSequence(current, totalPages).forEach((entry) => {
      if (entry === "…") {
        const span = document.createElement("span");
        span.className = "pagination-ellipsis";
        span.textContent = "…";
        els.paginationNumbers.appendChild(span);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pagination-number";
      button.textContent = String(entry);
      button.classList.toggle("is-active", entry === current);
      button.addEventListener("click", () => goToPage(entry));
      els.paginationNumbers.appendChild(button);
    });
  }

  if (els.paginationPrev) els.paginationPrev.disabled = current <= 1;
  if (els.paginationNext) els.paginationNext.disabled = current >= totalPages;
}

function buildPaginationSequence(current, total) {
  const delta = 1;
  const range = [];
  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i += 1) {
    range.push(i);
  }
  const sequence = [1];
  if (range.length && range[0] > 2) sequence.push("…");
  sequence.push(...range);
  if (range.length && range[range.length - 1] < total - 1) sequence.push("…");
  if (total > 1) sequence.push(total);
  return sequence;
}

function goToPage(page) {
  state.currentPage = page;
  render();
  document.querySelector(".catalog-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const priceInline = fragment.querySelector(".product-price-inline");
    const volume = fragment.querySelector(".product-volume");
    const price = fragment.querySelector(".product-price");
    const meta = fragment.querySelector(".product-meta");
    const noteWrap = fragment.querySelector(".product-note-wrap");
    const noteToggle = fragment.querySelector(".product-note-toggle");
    const noteDetail = fragment.querySelector(".product-note-detail");

    monogram.textContent = buildMonogram(item.brand || item.title);
    buildBadgeList(item).forEach(({ text, cls }) => {
      const badge = document.createElement("span");
      badge.className = `product-badge ${cls}`;
      badge.textContent = text;
      badgesEl.appendChild(badge);
    });
    if (item.image) {
      image.src = item.image;
      image.alt = buildProductImageAlt(item);
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
        logo.alt = buildBrandLogoAlt(item);
        logo.classList.remove("hidden");
        monogram.classList.add("hidden");
      } else {
        logo.classList.add("hidden");
        monogram.classList.remove("hidden");
      }
    }
    status.textContent = item.statusLabel || "Disponible";
    status.dataset.status = item.statusKey || "available";
    status.classList.toggle("hidden", (item.statusKey || "available") === "available");
    brand.textContent = item.brand || "Marque";
    title.textContent = item.title;
    priceInline.textContent = item.priceLabel || "Prix sur demande";
    volume.textContent = item.volume || "Contenance à préciser";
    price.textContent = item.priceLabel || "Prix sur demande";

    (item.families || []).slice(0, 3).forEach((value) => {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = value;
      meta.appendChild(badge);
    });

    noteWrap.classList.toggle("hidden", !hasRichNote(item));
    noteDetail.innerHTML = "";
    noteDetail.classList.add("hidden");
    noteDetail.dataset.loaded = "false";
    noteToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const expanded = noteToggle.getAttribute("aria-expanded") === "true";
      if (!expanded && noteDetail.dataset.loaded !== "true") {
        noteDetail.innerHTML = getCardNoteHtml(item);
        noteDetail.dataset.loaded = "true";
      }
      noteToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      noteToggle.querySelector("span").textContent = expanded ? "Voir les notes" : "Masquer les notes";
      noteDetail.classList.toggle("hidden", expanded);
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
    ...[...state.filters.segment].map((value) => ["segment", value]),
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
    els.dialogImage.alt = buildProductImageAlt(item);
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
      els.dialogLogo.alt = buildBrandLogoAlt(item);
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
  setRichContent(els.dialogNote, item);

  const shopUrl = item.url || "#";
  const cartUrl = buildCartUrl(item);
  const canAddToCart = Boolean(
    cartUrl && (item.statusKey || "available") === "available"
  );

  els.dialogLink.href = shopUrl;
  els.dialogLink.textContent = "Voir la fiche produit";
  els.dialogLink.classList.toggle("hidden", !item.url);

  if (els.dialogCartLink) {
    els.dialogCartLink.href = canAddToCart ? cartUrl : "#";
    els.dialogCartLink.classList.toggle("hidden", !canAddToCart);
  }

  els.dialogMeta.innerHTML = "";
  [
    item.volume,
    item.priceLabel,
    (item.statusKey || "available") !== "available" ? item.statusLabel : null,
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

  document.body.classList.add("dialog-open");
  els.dialog.showModal();
  const dialogCard = els.dialog.querySelector(".dialog-card");
  if (dialogCard) dialogCard.scrollTop = 0;
}

function getItemGenders(item) {
  const raw = item.gender;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return raw ? [raw] : [];
}

function matchesGenderFilter(item) {
  if (!state.filters.gender.size) return true;
  const itemGenders = getItemGenders(item);
  return [...state.filters.gender].some((selected) => {
    if (itemGenders.includes(selected)) return true;
    if (
      (selected === "Femme" || selected === "Homme") &&
      itemGenders.some((value) => value === "Unisexe" || value === "Mixte")
    ) {
      return true;
    }
    return false;
  });
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

    if (!matchesGenderFilter(item)) {
      return false;
    }

    if (state.filters.segment.size && !state.filters.segment.has(item.segment)) {
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

function createFilterChip(key, value, count) {
  const label = document.createElement("label");
  label.className = "filter-choice";
  const countHtml = typeof count === "number" ? ` <small class="filter-count">${count}</small>` : "";
  label.innerHTML = `
    <input type="checkbox" data-filter-key="${key}" value="${escapeHtml(value)}">
    <span>${escapeHtml(value)}${countHtml}</span>
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
  if (key === "segment") {
    syncHeroSegmentControls();
  }
}

function resetAllFilters() {
  state.filters.query = "";
  els.search.value = "";
  ["brand", "family", "gender", "status", "segment"].forEach((key) => {
    state.filters[key].clear();
    syncFilterInputs(key);
  });
  state.filters.bestSeller = false;
  if (els.brandSearch) {
    els.brandSearch.value = "";
    filterChipsInContainer(els.filters.brand, "");
  }
  if (els.familySearch) {
    els.familySearch.value = "";
    filterChipsInContainer(els.filters.family, "");
  }
  state.filters.sort = "title-asc";
  els.sort.value = "title-asc";
  if (els.sortMobile) els.sortMobile.value = "title-asc";
  render();
}

function syncHeroSegmentControls() {
  const selectedSegment = state.filters.segment.size === 1 ? [...state.filters.segment][0] : "";
  els.heroSegmentAllBtn?.classList.toggle("is-active", !selectedSegment);
  els.heroSegmentMainstreamBtn?.classList.toggle("is-active", selectedSegment === "Mainstream");
  els.heroSegmentNicheBtn?.classList.toggle("is-active", selectedSegment === "Niche");
}

function scrollToCatalogPanel() {
  document.querySelector(".catalog-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyHeroSegmentFilter(segmentValue) {
  state.filters.segment.clear();
  if (segmentValue) {
    state.filters.segment.add(segmentValue);
  }
  syncFilterInputs("segment");
  navigateToView("catalog");
}

function syncViewFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("brand=")) {
    const value = decodeURIComponent(hash.slice("brand=".length));
    state.filters.brand.clear();
    state.filters.brand.add(value);
    state.view = "catalog";
    syncFilterInputs("brand");
    return;
  }
  state.view = ["families", "available"].includes(hash) ? hash : "catalog";
}

function navigateToView(view) {
  const nextHash = view === "catalog" ? "" : `#${view}`;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  window.history.replaceState(null, "", nextUrl);
  state.view = view;
  render();

  if (view === "catalog") {
    scrollToCatalogPanel();
    return;
  }

  els.overviewPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getOverviewConfig(results) {
  if (state.view === "families") {
    return {
      label: "Familles olfactives",
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

function openBrandPicker() {
  if (!els.brandPickerDialog) return;
  els.brandPickerSearch.value = "";
  filterChipsInContainer(els.brandPickerList, "");
  els.brandPickerDialog.showModal();
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
