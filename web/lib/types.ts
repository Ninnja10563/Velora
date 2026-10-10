export const categoryIds = ["electronics", "computers", "phones", "home", "fashion", "beauty", "fitness", "office", "travel", "essentials"] as const;
export type CategoryId = (typeof categoryIds)[number];
export type DataStatus = "demo" | "live" | "cached";

export interface ProductOffer {
  id: string;
  retailer: string;
  price: number;
  currency: string;
  url: string;
  affiliateUrl?: string;
  availability: "unknown" | "in_stock" | "out_of_stock" | "preorder";
  lastChecked: string | null;
  status?: DataStatus;
  shipping?: number | null;
  delivery?: string | null;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: CategoryId;
  description: string;
  image: string;
  imageKind: "product" | "category";
  imageAlt: string;
  price: number;
  currency: string;
  variant: string;
  model?: string | null;
  specs: Record<string, string>;
  tags: string[];
  pros: string[];
  cons: string[];
  offers: ProductOffer[];
  source: { name: string; url: string; status: DataStatus; lastChecked: string | null };
  attributeSources?: Record<string, { url: string; lastChecked: string; kind: "retailer" | "manufacturer" }>;
  rating: number | null;
  reviewCount: number | null;
  warranty: string | null;
  returnPolicy: string | null;
}

export type RecommendedProduct = Product & {
  recommendation: string;
  explanation: string;
  matchedNeeds: string[];
};

export interface SearchInput {
  query: string;
  budget?: number;
  category?: string;
  brand?: string;
  priorities?: string[];
  currency?: string;
  location?: string;
  analyticsConsent?: boolean;
  /** Provider-only keywords; never accepted from the public request without validation. */
  retrievalQuery?: string;
}

export interface SearchIntent {
  query: string;
  category?: CategoryId;
  budget?: number;
  priorities: string[];
}

export interface SearchResult {
  products: RecommendedProduct[];
  summary: string;
  clarification?: string;
  intent: SearchIntent;
  mode: "demo" | "live" | "cached";
  provider?: string;
  assistantMode?: "local" | "openai" | "http";
  warnings: string[];
  searchId?: string;
}

/** External providers must return normalized facts, never prose-generated product facts. */
export interface ProductProvider {
  readonly id: string;
  readonly mode: "demo" | "live" | "unconfigured";
  search(input: SearchInput): Promise<Product[]>;
  getById(id: string, options?: { refresh?: boolean }): Promise<Product | null>;
  health(): Promise<{ available: boolean; detail: string }>;
}
