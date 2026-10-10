import { categories, products } from "./catalog.ts";
import { deduplicateProducts, inferIntent, productProvider } from "./providers.ts";
import type { CategoryId, Product, SearchInput, SearchIntent, SearchResult } from "./types.ts";

const kindRules: { kind: string; category: CategoryId; pattern: RegExp }[] = [
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
    { pattern: /\bgalaxy\s?[asz]\s?\d+[a-z]?(?:\s+(?:ultra|plus|fe|fold|flip))*/i, category: "phones", brand: "Samsung" },
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

function mentionsMultipleChoices(query: string): boolean {
  const normalizedQuery = normalize(query);
  const mentionedModels = products.filter(product => {
    const family = product.name.replace(/\s+Headphones$/i, "");
    const withoutBrand = family.toLowerCase().startsWith(`${product.brand.toLowerCase()} `) ? family.slice(product.brand.length + 1) : family;
    return [family, withoutBrand].some(alias => normalize(alias).length >= 5 && normalizedQuery.includes(normalize(alias)));
  });
  if (mentionedModels.length > 1) return true;
  if (!/\b(compare|comparison|versus|vs|or)\b/i.test(query)) return false;
  const brands = new Set(products.filter(product => {
    const escaped = product.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !excludesBrand(query, product.brand) && new RegExp(`\\b${escaped}\\b`, "i").test(query);
  }).map(product => product.brand));
  return brands.size > 1;
}

function parseIntent(input: SearchInput): SearchIntent & { kind?: string; exactId?: string; brand?: string } {
  const explicitCategory = categories.find(category => category.id === input.category);
  const rule = kindRules.find(rule => rule.kind === "backpack" && rule.pattern.test(input.query)) || kindRules.find(rule => rule.pattern.test(input.query));
  const namedCategory = categories.find(category => normalize(category.name) === normalize(input.query) || category.id === input.query.toLowerCase());
  const categoryHints: [RegExp, CategoryId][] = [[/\b(home office|workspace|desk setup|office|productivity)\b/i, "office"], [/\b(computers|gaming setup)\b/i, "computers"], [/\b(electronics|tech)\b/i, "electronics"], [/\b(home|kitchen)\b/i, "home"], [/\b(fashion|clothes|clothing)\b/i, "fashion"], [/\b(beauty|personal care)\b/i, "beauty"], [/\b(fitness|sports|workout gear)\b/i, "fitness"], [/\b(travel gear|luggage)\b/i, "travel"], [/\beveryday essentials\b/i, "essentials"]];
  const broadCategory = categoryHints.find(([pattern]) => pattern.test(input.query))?.[1];
  const model = requestedModel(input.query);
  const exact = products.find(product => normalize(input.query).includes(normalize(product.name)));
  const queryBrand = products.find(product => !excludesBrand(input.query, product.brand) && new RegExp(`\\b${product.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(input.query))?.brand || (/\b(macbook|iphone)\b/i.test(input.query) ? "Apple" : /\bpixel\b/i.test(input.query) ? "Google" : /\bgalaxy\b/i.test(input.query) ? "Samsung" : undefined);
  const provided = (input.priorities || []).map(priority => needRules.find(rule => rule.pattern.test(priority))?.tag || priority.toLowerCase());
  const inferred = needRules.filter(rule => rule.pattern.test(input.query)).map(rule => rule.tag);
  const queryBudget = extractBudget(input.query);
  const budget = input.budget !== undefined && queryBudget !== undefined ? Math.min(input.budget, queryBudget) : input.budget ?? queryBudget;
  return {
    query: input.query, category: explicitCategory?.id || rule?.category || model?.category || exact?.category || namedCategory?.id || broadCategory,
    budget, priorities: [...new Set([...provided, ...inferred])],
    kind: rule?.kind, exactId: exact?.id, brand: input.brand || queryBrand || model?.brand,
  };
}

function requestedCurrency(input: SearchInput): string {
  if (/\bAUD\b|AU\$|A\$/i.test(input.query)) return "AUD";
  if (/\bCAD\b|CA\$/i.test(input.query)) return "CAD";
  if (/\bGBP\b|£/i.test(input.query)) return "GBP";
  if (/\bEUR\b|€/i.test(input.query)) return "EUR";
  return input.currency || "USD";
}

export function rankProducts(input: SearchInput, catalog: Product[] = products): SearchResult {
  const parsed = parseIntent(input);
  const { kind, exactId, brand, ...intent } = parsed;
  const warnings = ["Demo catalog: prices and specifications are illustrative, not live retailer data. Check the manufacturer before buying.", "Reviews, stock, delivery, warranty, and price history have not been verified. No reliability or review-quality score is assigned."];
  const result: SearchResult = { products: [], summary: "", intent, mode: "demo", warnings };
  const excluded = excludedFeatures(input);
  if (excluded.length) {
    // A missing positive tag does not prove that a product lacks that feature.
    // Do not reinterpret a negative requirement as a positive recommendation.
    result.intent.priorities = intent.priorities.filter(priority => !excluded.includes(priority));
    result.summary = `You asked to avoid ${excluded.join(", ")}. I cannot verify that negative requirement from this sample catalog.`;
    result.clarification = `The catalog does not consistently document the absence of ${excluded.join(", ")}, so I have not recommended a product. Check manufacturer specifications or try a different requirement.`;
    return result;
  }
  if (mentionsMultipleChoices(input.query)) {
    result.summary = "You mentioned multiple shopping options. A single-model search would leave out part of your request.";
    result.clarification = "Search for each model separately and select Compare on its card. The comparison page will show your selected products side by side.";
    return result;
  }
  const unsupportedType = /\b(keyboards?|tablets?|televisions?|tvs?|dishwashers?|toasters?|mattresses?|drones?|bicycles?|printers?|routers?|perfumes?|speakers?|desktops?|fridges?|refrigerators?|suitcases?|chargers?|smartwatches?|power ?banks?|(?:phone|iphone|pixel|laptop) cases?)\b/i.test(input.query);
  if (unsupportedType) {
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
  if (currency !== "USD") {
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
    (intent.budget === undefined || product.price <= intent.budget) &&
    (!kind || product.tags.includes(kind)) && (!exactId || product.id === exactId) &&
    !excludesBrand(input.query, product.brand) &&
    (!brand || product.brand.toLowerCase() === brand.toLowerCase()) &&
    hardTags.every(tag => product.tags.includes(tag)) &&
    (!gpu || normalize(product.specs.Graphics || "").includes(gpu)) &&
    (!model || normalize(product.name).includes(normalize(model.name))) &&
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
    const budgetText = intent.budget ? ` The sample price is within your $${intent.budget.toLocaleString("en-US")} USD limit.` : "";
    return {
      ...product, matchedNeeds,
      recommendation: index === 0 ? (matchedNeeds.length ? "Best match" : "Lowest sample price") : product.price === lowest ? "Budget pick" : "Worth comparing",
      explanation: `${matchedNeeds.length ? `Matches ${matchedNeeds.join(", ")} in the sample catalog.` : "Matches your selected product category."}${budgetText} ${product.cons[0] ? `Trade-off: ${product.cons[0].charAt(0).toLowerCase()}${product.cons[0].slice(1)}.` : ""}`.trim(),
    };
  });
  const unsupported = intent.priorities.filter(priority => !eligible.some(product => product.tags.includes(priority)));
  if (unsupported.length) warnings.push(`No supporting sample evidence for: ${unsupported.join(", ")}. These needs have not been assumed to be satisfied.`);
  if (!eligible.length) {
    result.summary = "No sample products meet all of these filters.";
    result.clarification = "Try another brand, remove a feature filter, or browse the category. Your budget has been kept unchanged.";
  } else {
    result.summary = `Found ${eligible.length} ${eligible.length === 1 ? "sample match" : "sample matches"}${intent.budget ? ` within $${intent.budget.toLocaleString("en-US")} USD` : ""}. Ordered by matching stated needs, then lower sample price. Availability and real-world performance are unverified.`;
  }
  return result;
}

export async function searchProducts(input: SearchInput): Promise<SearchResult> {
  const [catalog, inferred] = await Promise.all([productProvider.search(input), inferIntent(input)]);
  const local = parseIntent(input);
  // An AI-suggested broad category alone cannot turn an unknown product into unrelated results.
  const merged: SearchInput = { ...input, priorities: [...new Set([...(input.priorities || []), ...(inferred.intent?.priorities || [])])].slice(0, 10) };
  if (local.category && !input.category) merged.category = local.category;
  const result = rankProducts(merged, catalog);
  if (inferred.warning) result.warnings.push(inferred.warning);
  if (!process.env.AI_INTENT_ENDPOINT) result.warnings.push("Using local natural-language rules. No external AI or retailer API is connected.");
  return result;
}
