import { categories, products } from "./catalog.ts";
import { deduplicateProducts, getAssistantMode, inferIntent, productProvider } from "./providers.ts";
import type { CategoryId, Product, SearchInput, SearchIntent, SearchResult } from "./types.ts";

const kindRules: { kind: string; category: CategoryId; pattern: RegExp }[] = [
  { kind: "phone case", category: "phones", pattern: /\b(?:phone|iphone|pixel) cases?\b/i },
  { kind: "keyboard", category: "office", pattern: /\bkeyboards?\b/i },
  { kind: "tablet", category: "computers", pattern: /\btablets?|ipads?\b/i },
  { kind: "speaker", category: "electronics", pattern: /\bspeakers?\b/i },
  { kind: "television", category: "electronics", pattern: /\btelevisions?|tvs?\b/i },
  { kind: "smartwatch", category: "electronics", pattern: /\bsmartwatches?\b/i },
  { kind: "printer", category: "office", pattern: /\bprinters?\b/i },
  { kind: "router", category: "computers", pattern: /\brouters?\b/i },
  { kind: "suitcase", category: "travel", pattern: /\bsuitcases?\b/i },
  { kind: "headphones", category: "electronics", pattern: /\b(headphones?|headsets?|earphones?|over[ -]ear)\b/i },
  { kind: "earbuds", category: "electronics", pattern: /\b(earbuds?|in[ -]ear|beats fit pro)\b/i },
  { kind: "laptop", category: "computers", pattern: /\b(laptops?|notebooks?|macbooks?|tuf|loq)\b/i },
  { kind: "monitor", category: "computers", pattern: /\b(monitors?|display|g2724d|27up850)\b/i },
  { kind: "phone", category: "phones", pattern: /\b(phones?|smartphones?|iphone|pixel|galaxy)\b/i },
  { kind: "office chair", category: "office", pattern: /\b(chairs?|markus|steelcase)\b/i },
  { kind: "mouse", category: "office", pattern: /\b(mouse|mice|mx master)\b/i },
  { kind: "running shoes", category: "fitness", pattern: /\b(running shoes?|trainers?|pegasus|gel[ -]contend)\b/i },
  { kind: "shoes", category: "fashion", pattern: /\b(sneakers?|casual shoes?|stan smith)\b/i },
  { kind: "jacket", category: "fashion", pattern: /\b(jackets?|raincoat|rain shell|torrentshell)\b/i },
  { kind: "coffee maker", category: "home", pattern: /\b(coffee maker|aeropress|coffee brewer)\b/i },
  { kind: "kettle", category: "home", pattern: /\b(kettles?|stagg)\b/i },
  { kind: "multicooker", category: "home", pattern: /\b(multicookers?|pressure cooker|instant pot|slow cooker)\b/i },
  { kind: "cleanser", category: "beauty", pattern: /\b(cleansers?|face wash|skincare|skin care|cerave)\b/i },
  { kind: "toothbrush", category: "beauty", pattern: /\b(toothbrush(es)?|oral[ -]b)\b/i },
  { kind: "yoga mat", category: "fitness", pattern: /\b(yoga|yoga mat|manduka)\b/i },
  { kind: "backpack", category: "travel", pattern: /\b(backpacks?|daypacks?|laptop bags?|daylite)\b/i },
  { kind: "water bottle", category: "essentials", pattern: /\b(water bottles?|nalgene|hydro flask|hydration)\b/i },
];

const needRules: { tag: string; pattern: RegExp }[] = [
  { tag: "noise cancellation", pattern: /\b(anc|noise[ -]cancell?ing|noise cancellation|quiet)\b/i },
  { tag: "battery life", pattern: /\b(battery|long[ -]lasting|all[ -]day)\b/i },
  { tag: "studying", pattern: /\b(study|studying|student|school|university|college)\b/i },
  { tag: "travel", pattern: /\b(travel(?:ling|ing)?|commut(?:e|ing)|flight|flying)\b/i },
  { tag: "gaming", pattern: /\b(gaming|games?|gamer)\b/i },
  { tag: "performance", pattern: /\b(performance|powerful|fast)\b/i },
  { tag: "productivity", pattern: /\b(productivity|work|working|office)\b/i },
  { tag: "photography", pattern: /\b(photography|photos?|camera)\b/i },
  { tag: "gym", pattern: /\b(gym|workout|exercise|sweat)\b/i },
  { tag: "running", pattern: /\b(running|jogging|jog|run)\b/i },
  { tag: "lightweight", pattern: /\b(lightweight|light[ -]weight|light to carry)\b/i },
  { tag: "portable", pattern: /\b(portable|portability|compact|small)\b/i },
  { tag: "wireless", pattern: /\b(wireless|bluetooth)\b/i },
  { tag: "usb-c", pattern: /\busb[ -]?c\b/i },
  { tag: "4k", pattern: /\b4k\b/i },
  { tag: "android", pattern: /\bandroid\b/i },
  { tag: "ios", pattern: /\bios\b/i },
  { tag: "windows", pattern: /\bwindows\b/i },
  { tag: "macos", pattern: /\bmacos\b/i },
  { tag: "beginners", pattern: /\b(beginner|beginners|first time)\b/i },
  { tag: "adjustable", pattern: /\badjustable\b/i },
  { tag: "insulated", pattern: /\binsulated\b/i },
  { tag: "waterproof", pattern: /\bwaterproof\b/i },
];

export function extractBudget(query: string): number | undefined {
  const number = "([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)";
  const tests = [
    new RegExp(`(?:under|below|less than|up to|at most|no more than|maximum|max|budget(?: of| is)?|within)\\s*(?:(?:US|AU|CA)?\\$|USD|AUD|GBP|EUR|CAD|£|€)?\\s*${number}\\s*(k\\b)?`, "i"),
    new RegExp(`(?:\\$|£|€|USD\\s*|AUD\\s*|GBP\\s*|EUR\\s*|CAD\\s*)${number}\\s*(k\\b)?`, "i"),
  ];
  // Compare positions across both syntaxes so a later "$100 please" replaces
  // an earlier "under $300" when the conversation is refined.
  const match = tests.flatMap(pattern => [...query.matchAll(new RegExp(pattern.source, "gi"))]).sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
  if (!match) return undefined;
  const amount = Number(match[1].replaceAll(",", "")) * (match[2] ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 && amount <= 100000 ? amount : undefined;
}

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function excludesBrand(query: string, brand: string): boolean {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:not|no|avoid|exclude|except|anything but)\\s+${escaped}\\b`, "i").test(query);
}

/** Preserve generation and suffixes: iPhone 15 Pro is not an iPhone 15.
 * Model-only requests can establish category without requiring a brand name.
 */
function requestedModel(query: string): { name: string; category: CategoryId; brand: string } | undefined {
  const families: { pattern: RegExp; category: CategoryId; brand: string }[] = [
    { pattern: /\biphone\s?\d+[a-z]?(?:\s+(?:pro|max|plus|mini|air))*/i, category: "phones", brand: "Apple" },
    { pattern: /\bpixel\s?\d+[a-z]?(?:\s+(?:pro|xl|fold))*/i, category: "phones", brand: "Google" },
    { pattern: /\bgalaxy\s?[asz]\s?\d+[a-z]?(?:\s*(?:ultra|plus|fe|fold|flip|\+))*/i, category: "phones", brand: "Samsung" },
    { pattern: /\bwh[ -]?(?:\d{3,4}xm\d|ch\d+[a-z]?)\b/i, category: "electronics", brand: "Sony" },
    { pattern: /\bquietcomfort(?:\s+(?:ultra|45|35|headphones|earbuds))*/i, category: "electronics", brand: "Bose" },
    { pattern: /\bmacbook\s+(?:air|pro)\b/i, category: "computers", brand: "Apple" },
    { pattern: /\bg\d{4}[a-z]+\b/i, category: "computers", brand: "Dell" },
    { pattern: /\b27up850(?:[ -]w)?\b/i, category: "computers", brand: "LG" },
    { pattern: /\bloq\s?15irh8\b/i, category: "computers", brand: "Lenovo" },
  ];
  for (const family of families) {
    const match = query.match(family.pattern);
    if (match) return { name: match[0], category: family.category, brand: family.brand };
  }
  return undefined;
}

function matchesRequestedModel(product: Product, requested: ReturnType<typeof requestedModel>): boolean {
  if (!requested) return true;
  const actual = requestedModel(product.model || "") || requestedModel(product.name);
  const identity = (name: string) => normalize(name.replace(/\+/g, " plus ").replace(/\s+headphones\b/gi, ""));
  return actual ? identity(actual.name) === identity(requested.name) : normalize(product.name).includes(identity(requested.name));
}

function capacityInGb(specification: string): number | undefined {
  const match = specification.match(/(\d+(?:\.\d+)?)\s*(gb|tb)\b/i);
  return match ? Number(match[1]) * (match[2].toLowerCase() === "tb" ? 1024 : 1) : undefined;
}

function excludedFeatures(input: SearchInput): string[] {
  const text = [input.query, ...(input.priorities || [])].join(". ");
  return needRules.filter(rule => {
    const before = new RegExp(`\\b(?:without|no|not|avoid|exclude|excluding|don['’]t\\s+(?:need|want)|do\\s+not\\s+(?:need|want))\\s+(?:(?:a|an|any|active|using|with|need|want|interested\\s+in|looking\\s+for)\\s+){0,2}(?:${rule.pattern.source})`, "i");
    const after = new RegExp(`(?:${rule.pattern.source})\\s+(?:is\\s+)?(?:not\\s+(?:needed|required|wanted)|unnecessary|optional|does(?:n['’]t|\\s+not)\\s+matter)\\b`, "i");
    return before.test(text) || after.test(text);
  }).map(rule => rule.tag);
}

function mentionsMultipleChoices(query: string, catalog: Product[]): boolean {
  const normalizedQuery = normalize(query);
  const mentions: { start: number; end: number; name: string }[] = [];
  for (const product of catalog) {
    const family = product.name.replace(/\s+Headphones$/i, "");
    const withoutBrand = family.toLowerCase().startsWith(`${product.brand.toLowerCase()} `) ? family.slice(product.brand.length + 1) : family;
    for (const alias of new Set([normalize(family), normalize(withoutBrand)])) {
      if (alias.length < 5) continue;
      let start = normalizedQuery.indexOf(alias);
      while (start >= 0) {
        mentions.push({ start, end: start + alias.length, name: normalize(product.model || product.name) });
        start = normalizedQuery.indexOf(alias, start + alias.length);
      }
    }
  }
  // A base name inside one longer model mention is not a second selection.
  const distinct = mentions.filter(mention => !mentions.some(other => other.start <= mention.start && other.end >= mention.end && other.end - other.start > mention.end - mention.start));
  if (new Set(distinct.map(mention => mention.name)).size > 1) return true;
  if (!/\b(compare|comparison|versus|vs|or)\b/i.test(query)) return false;
  const brands = new Set(catalog.filter(product => {
    const escaped = product.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !excludesBrand(query, product.brand) && new RegExp(`\\b${escaped}\\b`, "i").test(query);
  }).map(product => product.brand));
  return brands.size > 1;
}

function parseIntent(input: SearchInput, catalog: Product[] = products): SearchIntent & { kind?: string; exactId?: string; brand?: string } {
  const explicitCategory = categories.find(category => category.id === input.category);
  const knownRule = kindRules.find(rule => rule.kind === "backpack" && rule.pattern.test(input.query)) || kindRules.find(rule => rule.pattern.test(input.query));
  const dynamicType = catalog.flatMap(product => product.tags.map(tag => ({ tag, category: product.category }))).find(({ tag }) => {
    if (needRules.some(rule => rule.pattern.test(tag)) || categories.some(category => category.id === tag || category.name.toLowerCase() === tag) || tag.length < 3) return false;
    const phrase = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${phrase}s?\\b`, "i").test(`${input.query} ${input.retrievalQuery || ""}`);
  });
  const rule = knownRule || (dynamicType ? { kind: dynamicType.tag, category: dynamicType.category } : undefined);
  const namedCategory = categories.find(category => normalize(category.name) === normalize(input.query) || category.id === input.query.toLowerCase());
  const categoryHints: [RegExp, CategoryId][] = [[/\b(home office|workspace|desk setup|office|productivity)\b/i, "office"], [/\b(computers|gaming setup)\b/i, "computers"], [/\b(electronics|tech)\b/i, "electronics"], [/\b(home|kitchen)\b/i, "home"], [/\b(fashion|clothes|clothing)\b/i, "fashion"], [/\b(beauty|personal care)\b/i, "beauty"], [/\b(fitness|sports|workout gear)\b/i, "fitness"], [/\b(travel gear|luggage)\b/i, "travel"], [/\beveryday essentials\b/i, "essentials"]];
  const broadCategory = categoryHints.find(([pattern]) => pattern.test(input.query))?.[1];
  const model = requestedModel(input.query);
  const exact = catalog.find(product => normalize(input.query).includes(normalize(product.name)));
  const queryBrand = catalog.find(product => !excludesBrand(input.query, product.brand) && new RegExp(`\\b${product.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(input.query))?.brand || (/\b(macbook|iphone)\b/i.test(input.query) ? "Apple" : /\bpixel\b/i.test(input.query) ? "Google" : /\bgalaxy\b/i.test(input.query) ? "Samsung" : undefined);
  const provided = (input.priorities || []).map(priority => needRules.find(rule => rule.pattern.test(priority))?.tag || priority.toLowerCase());
  const inferred = needRules.filter(rule => rule.pattern.test(input.query)).map(rule => rule.tag);
  const queryBudget = extractBudget(input.query);
  const budget = input.budget !== undefined && queryBudget !== undefined ? Math.min(input.budget, queryBudget) : input.budget ?? queryBudget;
  return {
    query: input.query, category: explicitCategory?.id || rule?.category || model?.category || exact?.category || namedCategory?.id || broadCategory,
    budget, priorities: [...new Set([...provided, ...inferred])],
    kind: rule?.kind, exactId: exact?.source.status === "demo" ? exact.id : undefined, brand: input.brand || queryBrand || model?.brand,
  };
}

function requestedCurrency(input: SearchInput): string {
  if (/\bAUD\b|AU\$|A\$/i.test(input.query)) return "AUD";
  if (/\bCAD\b|CA\$/i.test(input.query)) return "CAD";
  if (/\bGBP\b|£/i.test(input.query)) return "GBP";
  if (/\bEUR\b|€/i.test(input.query)) return "EUR";
  return input.currency || "USD";
}

export function rankProducts(input: SearchInput, catalog: Product[] = products, providerMode: "demo" | "live" = catalog.every(product => product.source.status === "demo") ? "demo" : "live"): SearchResult {
  const demo = providerMode === "demo";
  const parsed = parseIntent(input, catalog);
  const { kind, exactId, brand, ...intent } = parsed;
  const warnings = demo ? ["Demo catalog: prices and specifications are illustrative, not live retailer data. Check the manufacturer before buying.", "Reviews, stock, delivery, warranty, and price history have not been verified. No reliability or review-quality score is assigned."] : ["Prices and product details come from the identified provider. Cached records retain their original observation timestamps; check the retailer before purchasing.", "Prices exclude taxes and any delivery cost not explicitly provided. Independent reliability and review quality have not been assessed."];
  const result: SearchResult = { products: [], summary: "", intent, mode: demo ? "demo" : catalog.length && catalog.every(product => product.source.status === "cached") ? "cached" : "live", warnings };
  const excluded = excludedFeatures(input);
  if (excluded.length) {
    // A missing positive tag does not prove that a product lacks that feature.
    // Do not reinterpret a negative requirement as a positive recommendation.
    result.intent.priorities = intent.priorities.filter(priority => !excluded.includes(priority));
    result.summary = `You asked to avoid ${excluded.join(", ")}. I cannot verify that negative requirement from the available product records.`;
    result.clarification = `The catalog does not consistently document the absence of ${excluded.join(", ")}, so I have not recommended a product. Check manufacturer specifications or try a different requirement.`;
    return result;
  }
  if (mentionsMultipleChoices(input.query, catalog)) {
    result.summary = "You mentioned multiple shopping options. A single-model search would leave out part of your request.";
    result.clarification = "Search for each model separately and select Compare on its card. The comparison page will show your selected products side by side.";
    return result;
  }
  const unsupportedType = /\b(keyboards?|tablets?|televisions?|tvs?|dishwashers?|toasters?|mattresses?|drones?|bicycles?|printers?|routers?|perfumes?|speakers?|desktops?|fridges?|refrigerators?|suitcases?|chargers?|smartwatches?|power ?banks?|(?:phone|iphone|pixel|laptop) cases?)\b/i.test(input.query);
  if (demo && unsupportedType) {
    result.summary = "That product type is not covered by this sample catalog yet.";
    result.clarification = "Try headphones, laptops, monitors, phones, office chairs, running shoes, or backpacks. A connected product feed can expand the selection.";
    return result;
  }
  if (!intent.category) {
    result.summary = "Tell me a little more about what you want to find.";
    result.clarification = "What kind of product are you looking for? Try headphones, a laptop, an office chair, or running shoes, and add your budget.";
    return result;
  }
  const currency = requestedCurrency(input);
  if (demo && currency !== "USD") {
    result.summary = `This sample catalog has USD prices only. No ${currency} prices or exchange rates are available.`;
    result.clarification = "Switch the search currency to USD to explore the demo, or connect a product feed for your region.";
    return result;
  }
  const hardTags = intent.priorities.filter(tag => ["wireless", "4k", "android", "ios", "windows", "macos", "usb-c", "noise cancellation", "insulated", "waterproof"].includes(tag));
  if (kind === "laptop" && intent.priorities.includes("gaming")) hardTags.push("gaming");
  if ((kind === "headphones" || kind === "earbuds") && intent.priorities.includes("gym")) hardTags.push("gym");
  const gpu = input.query.match(/\b(?:rtx|gtx)\s?\d{4}\b/i)?.[0].replace(/\s/g, "").toLowerCase();
  const memory = input.query.match(/\b(\d+)\s?gb\s?(?:ram|memory)\b/i)?.[1];
  const model = requestedModel(input.query);
  const chip = kind === "laptop" ? input.query.match(/\bm\d+(?:\s+(?:pro|max|ultra))?\b/i)?.[0] : undefined;
  const storage = [...input.query.matchAll(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\b(?:\s*(ram|memory|ssd|storage|drive))?/gi)]
    .find(match => !/^(ram|memory)$/i.test(match[3] || "") && (Number(match[1]) >= 128 || match[2].toLowerCase() === "tb" || /^(ssd|storage|drive)$/i.test(match[3] || "")));
  const requiredStorage = storage ? Number(storage[1]) * (storage[2].toLowerCase() === "tb" ? 1024 : 1) : undefined;
  const eligible = deduplicateProducts(catalog).filter(product =>
    product.category === intent.category && product.currency === currency &&
    product.offers.some(offer => offer.currency === currency && offer.availability !== "out_of_stock") &&
    (intent.budget === undefined || product.price <= intent.budget) &&
    (!kind || product.tags.includes(kind)) && (!exactId || product.id === exactId) &&
    !excludesBrand(input.query, product.brand) &&
    (!brand || product.brand.toLowerCase() === brand.toLowerCase()) &&
    hardTags.every(tag => product.tags.includes(tag)) &&
    (!gpu || normalize(product.specs.Graphics || "").includes(gpu)) &&
    matchesRequestedModel(product, model) &&
    (!chip || normalize(product.specs.Processor || "").endsWith(normalize(chip))) &&
    (requiredStorage === undefined || capacityInGb(product.specs.Storage || "") === requiredStorage) &&
    (!memory || Number.parseInt(product.specs.Memory || "0") >= Number(memory))
  );
  const matches = (product: Product) => intent.priorities.filter(priority => product.tags.includes(priority));
  // Explicit ordering: number of supported requested needs, then lower sample price.
  // The count is an auditable sort key, not an invented product-quality rating.
  eligible.sort((a, b) => matches(b).length - matches(a).length || a.price - b.price || a.name.localeCompare(b.name));
  const lowest = eligible.length ? Math.min(...eligible.map(product => product.price)) : 0;
  result.products = eligible.map((product, index) => {
    const matchedNeeds = matches(product);
    const budgetText = intent.budget ? ` The ${demo ? "sample" : "listed"} price is within your ${intent.budget.toLocaleString("en-US")} ${currency} limit.` : "";
    return {
      ...product, matchedNeeds,
      recommendation: index === 0 ? (matchedNeeds.length ? "Best match" : demo ? "Lowest sample price" : "Lowest listed price") : product.price === lowest ? "Budget pick" : "Worth comparing",
      explanation: `${matchedNeeds.length ? `Matches ${matchedNeeds.join(", ")} in the ${demo ? "sample catalog" : "provider records"}.` : "Matches your selected product category."}${budgetText} ${product.cons[0] ? `Trade-off: ${product.cons[0].charAt(0).toLowerCase()}${product.cons[0].slice(1)}.` : ""}`.trim(),
    };
  });
  const unsupported = intent.priorities.filter(priority => !eligible.some(product => product.tags.includes(priority)));
  if (unsupported.length) warnings.push(`No supporting ${demo ? "sample " : "provider "}evidence for: ${unsupported.join(", ")}. These needs have not been assumed to be satisfied.`);
  if (!eligible.length) {
    result.summary = `No ${demo ? "sample " : "available "}products meet all of these filters.`;
    result.clarification = "Try another brand, remove a feature filter, or browse the category. Your budget has been kept unchanged.";
  } else {
    result.summary = `Found ${eligible.length} ${demo ? "sample " : ""}${eligible.length === 1 ? "match" : "matches"}${intent.budget ? ` within ${intent.budget.toLocaleString("en-US")} ${currency}` : ""}. Ordered by matching stated needs, then lower ${demo ? "sample" : "listed"} price. ${demo ? "Availability and real-world performance are unverified." : "See each offer for availability and its observation time."}`;
  }
  return result;
}

export async function searchProducts(input: SearchInput): Promise<SearchResult> {
  const inferred = await inferIntent(input);
  const local = parseIntent(input);
  const assistantMode = getAssistantMode();
  const demo = productProvider.mode === "demo";
  // A tool call may narrow retrieval, but it cannot raise a known budget, change
  // the user's currency, or replace original model/variant constraint checks.
  const budget = local.budget ?? inferred.intent?.budget ?? undefined;
  const merged: SearchInput = {
    ...input, budget, currency: requestedCurrency(input),
    priorities: [...new Set([...(input.priorities || []), ...(inferred.intent?.priorities || [])])].slice(0, 10),
    category: input.category || local.category || (!demo ? inferred.intent?.category || undefined : undefined),
    brand: input.brand || local.brand || inferred.intent?.brand || undefined,
    retrievalQuery: inferred.intent?.query,
  };
  const catalog = await productProvider.search(merged);
  const result = rankProducts(merged, catalog, demo ? "demo" : "live");
  result.provider = productProvider.id;
  result.assistantMode = assistantMode;
  if (inferred.intent?.clarification && !local.category) {
    result.products = [];
    result.summary = "A little more detail is needed before recommending products.";
    result.clarification = inferred.intent.clarification;
  }
  if (inferred.warning) result.warnings.push(inferred.warning);
  if (assistantMode === "local") result.warnings.push("Using local natural-language rules. No external AI is connected.");
  return result;
}
