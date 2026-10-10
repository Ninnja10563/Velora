export const categoryIds = ["electronics", "computers", "phones", "home", "fashion", "beauty", "fitness", "office", "travel", "essentials"] as const;
export type CategoryId = (typeof categoryIds)[number];

export interface ProductOffer {
  id: string;
  retailer: string;
  price: number;
  currency: string;
  url: string;
  affiliateUrl?: string;
  availability: "unknown";
  lastChecked: null;
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
  specs: Record<string, string>;
  tags: string[];
  pros: string[];
  cons: string[];
  offers: ProductOffer[];
  source: { name: string; url: string; status: "demo"; lastChecked: null };
  rating: null;
  reviewCount: null;
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
  analyticsConsent?: boolean;
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
  mode: "demo";
  warnings: string[];
  searchId?: string;
}

/** External providers must return normalized facts, never prose-generated product facts. */
export interface ProductProvider {
  readonly id: string;
  readonly mode: "demo" | "live";
  search(input: SearchInput): Promise<Product[]>;
  health(): Promise<{ available: boolean; detail: string }>;
}
