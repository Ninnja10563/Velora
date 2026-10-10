"use client";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useId,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  X,
  Plus,
  Search,
  Compass,
  Heart,
  SlidersHorizontal,
  Columns3,
  Bell,
  Settings,
  Sun,
  Moon,
  Menu,
  Headphones,
  Laptop,
  Smartphone,
  Armchair,
  Shirt,
  Dumbbell,
  Plane,
  Coffee,
  Sparkles,
  ShieldCheck,
  Clock3,
  ExternalLink,
  Bookmark,
  CircleHelp,
  LoaderCircle,
  Trash2,
  Download,
  Wallet,
  Leaf,
  CheckCheck,
} from "lucide-react";
import { products, categories } from "@/lib/catalog";
import { validateBrowserState } from "@/lib/browser-state";
import type { Product, RecommendedProduct } from "@/lib/types";
type SearchResult = {
  products: RecommendedProduct[];
  summary: string;
  clarification?: string;
  mode: string;
  searchId?: string;
  warnings: string[];
};
type Preferences = {
  currency: string;
  location: string;
  analyticsConsent: boolean;
  theme: string;
};
type HistoryItem = { query: string; createdAt: string; budget?: number };
type Watch = { id: string; target: number };
type Account = {
  authenticated: boolean;
  identityAvailable?: boolean;
  user?: { id: string; displayName: string } | null;
  syncAvailable: boolean;
  message?: string;
  state?: {
    savedProductIds: string[];
    comparisonProductIds: string[];
    preferences: Preferences;
    searchHistory: HistoryItem[];
  };
};
const defaultPrefs: Preferences = {
  currency: "USD",
  location: "United States",
  analyticsConsent: false,
  theme: "light",
};
const categoryIcons: Record<string, typeof Search> = {
  electronics: Headphones,
  computers: Laptop,
  phones: Smartphone,
  home: Armchair,
  fashion: Shirt,
  beauty: Leaf,
  fitness: Dumbbell,
  office: Coffee,
  travel: Plane,
  essentials: Bookmark,
};
const popularPrompts = [
  "Headphones for my daily commute",
  "A laptop for work under $1,000",
  "Upgrade my home office",
  "Running shoes under $150",
];
function money(price: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: price % 1 ? 2 : 0,
  }).format(price);
}
function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) {
        const validated = validateBrowserState(key, JSON.parse(v));
        if (validated !== null) setValue(validated as T);
      }
    } catch {}
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
  }, [key, value, ready]);
  return [value, setValue, ready] as const;
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? "small" : ""}`}>
      <svg viewBox="0 0 38 38" aria-hidden="true">
        <path d="m4 10 10 24h9L33 10H23l-5 14-5-14z" fill="currentColor" />
        <path
          d="m29 1 1.8 4.8L36 8l-5.2 2.2L29 15l-1.8-4.8L22 8l5.2-2.2z"
          fill="currentColor"
        />
      </svg>
      <span>
        velora<span className="logo-dot">.</span>
      </span>
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-title">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ProductImage({
  product,
  large = false,
}: {
  product: Product;
  large?: boolean;
}) {
  return (
    <div className={`product-image ${large ? "large" : ""}`}>
      <img
        src={product.image}
        alt={product.imageAlt || product.name}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
          e.currentTarget.parentElement?.classList.add("image-unavailable");
        }}
      />
      {product.imageKind === "category" && (
        <span className="image-caption">Illustrative image</span>
      )}
    </div>
  );
}
function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-intro">
      <div className="section-kicker">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
export default function Velora() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [saved, setSaved] = useStored<string[]>("velora-saved", []);
  const [compare, setCompare] = useStored<string[]>("velora-compare", []);
  const [history, setHistory] = useStored<HistoryItem[]>("velora-history", []);
  const [prefs, setPrefs] = useStored<Preferences>(
    "velora-preferences",
    defaultPrefs,
  );
  const [watches, setWatches] = useStored<Watch[]>("velora-watchlist", []);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState("recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState<
    "method" | "disclosure" | "account" | "delete" | null
  >(null);
  const [watchProduct, setWatchProduct] = useState<Product | null>(null);
  const [target, setTarget] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refinement, setRefinement] = useState("");
  const [chat, setChat] = useState<{ role: string; text: string }[]>([]);
  const searchRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const page = pathname.startsWith("/product/")
    ? "product"
    : pathname.split("/")[1] || "discover";
  const activeProduct = products.find(
    (p) => p.id === decodeURIComponent(pathname.split("/")[2] || ""),
  );
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNav(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.style.colorScheme = prefs.theme;
  }, [prefs.theme]);
  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((data) => setAccount(data as Account))
      .catch(() => setAccount({ authenticated: false, syncAvailable: false }));
    return () => abortRef.current?.abort();
  }, []);
  const nav = (path: string) => {
    router.push(path);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  function toggleSave(id: string) {
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    notify(
      saved.includes(id)
        ? "Removed from your shortlist"
        : "Saved to your shortlist",
    );
  }
  function toggleCompare(id: string) {
    if (compare.includes(id)) {
      setCompare((c) => c.filter((x) => x !== id));
      return;
    }
    if (compare.length >= 4) {
      notify("Compare up to 4 products. Remove one to add another.");
      return;
    }
    setCompare((c) => [...c, id]);
    notify("Added to comparison");
  }
  const togglePriority = (p: string) =>
    setPriorities((list) =>
      list.includes(p) ? list.filter((v) => v !== p) : [...list, p],
    );
  async function runSearch(
    text: string = query,
    cat: string = category,
    isRefine = false,
    budgetOverride?: string,
  ) {
    if (!text.trim() && cat === "all") {
      searchRef.current?.focus();
      notify("Tell us a little about what you’re looking for.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    setLastQuery(text);
    setQuery(text);
    setBrand("all");
    if (!isRefine) setChat([{ role: "you", text }]);
    else setChat((c) => [...c, { role: "you", text: refinement }]);
    nav("/search");
    setCategory(cat);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text || `Show me ${cat}`,
          budget:
            (budgetOverride ?? budget)
              ? Number(budgetOverride ?? budget)
              : undefined,
          category: cat === "all" ? undefined : cat,
          priorities,
          currency: prefs.currency,
          analyticsConsent: prefs.analyticsConsent,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as SearchResult & { error?: string };
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Search is unavailable. Please try again.",
        );
      setResult(data);
      setChat((c) => [
        ...c,
        { role: "assistant", text: data.clarification || data.summary },
      ]);
      setHistory((h) =>
        [
          {
            query: text,
            createdAt: new Date().toISOString(),
            ...(budget ? { budget: Number(budget) } : {}),
          },
          ...h.filter((v) => v.query !== text),
        ].slice(0, 20),
      );
      setRefinement("");
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const searchCategory = (id: string) => {
    setCategory(id);
    setBrand("all");
    runSearch(
      `Find me ${categories.find((c) => c.id === id)?.name.toLowerCase() || id}`,
      id,
    );
  };
  const featured = products
    .filter((p) =>
      ["electronics", "computers", "home", "fitness"].includes(p.category),
    )
    .filter((p, i, a) => a.findIndex((x) => x.category === p.category) === i)
    .slice(0, 4);
  const displayProducts = (() => {
    let list: Product[] = (result?.products || []).filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (brand === "all" || p.brand === brand) &&
        (!budget || p.price <= Number(budget)),
    );
    if (sort === "price-asc")
      list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc")
      list = [...list].sort((a, b) => b.price - a.price);
    return list;
  })();
  function outbound(p: Product, offerId?: string, source = "card") {
    return `/api/outbound?product=${encodeURIComponent(p.id)}&offer=${encodeURIComponent(offerId || p.offers[0]?.id || "")}&source=${source}${prefs.analyticsConsent ? `&consent=true${result?.searchId ? `&searchId=${encodeURIComponent(result.searchId)}` : ""}` : ""}`;
  }
  function startWatch(p: Product) {
    setWatchProduct(p);
    setTarget(String(Math.floor(p.price * 0.85)));
  }
  async function syncAccount() {
    setSyncing(true);
    try {
      const r = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedProductIds: saved,
          comparisonProductIds: compare,
          preferences: prefs,
          searchHistory: history,
        }),
      });
      const data = (await r.json()) as {
        error?: string;
        state?: Account["state"];
      };
      if (!r.ok) throw new Error(data.error || "Sync is unavailable");
      setAccount((a) => (a ? { ...a, state: data.state } : a));
      notify("Your shopping workspace is synced");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Unable to sync");
    } finally {
      setSyncing(false);
    }
  }
  function exportData() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { saved, compare, history, preferences: prefs, watchlist: watches },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "velora-my-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function clearLocal() {
    abortRef.current?.abort();
    setLoading(false);
    setError("");
    setQuery("");
    setBudget("");
    setLastQuery("");
    setRefinement("");
    setChat([]);
    setCategory("all");
    setBrand("all");
    setSaved([]);
    setCompare([]);
    setHistory([]);
    setWatches([]);
    setPrefs(defaultPrefs);
    setResult(null);
    setModal(null);
    notify("Your data has been removed from this browser.");
  }
  function renderProductCard(product: Product, index = 0) {
    const rec =
      "recommendation" in product
        ? String(product.recommendation)
        : [
            "The everyday upgrade",
            "Made for your workflow",
            "A little more comfort",
            "Find your next favorite",
          ][index % 4];
    return (
      <article key={product.id} className="product-card">
        <div className="product-visual">
          <button
            className="image-link"
            aria-label={`View ${product.name}`}
            onClick={() => nav(`/product/${product.id}`)}
          >
            <ProductImage product={product} />
          </button>
          <button
            className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`}
            aria-label={`${saved.includes(product.id) ? "Unsave" : "Save"} ${product.name}`}
            aria-pressed={saved.includes(product.id)}
            onClick={() => toggleSave(product.id)}
          >
            <Heart
              size={18}
              fill={saved.includes(product.id) ? "currentColor" : "none"}
            />
          </button>
          <span className="product-rec">{rec}</span>
        </div>
        <div className="product-body">
          <div className="product-brand">{product.brand}</div>
          <button
            className="product-name"
            onClick={() => nav(`/product/${product.id}`)}
          >
            {product.name}
          </button>
          <p className="product-description">{product.description}</p>
          <div className="product-price-row">
            <strong>{money(product.price, product.currency)}</strong>
            <span>Sample price · {product.currency}</span>
          </div>
          {"explanation" in product && (
            <p className="match-reason">{String(product.explanation)}</p>
          )}
          <div className="product-actions">
            <button
              className={`compare-button ${compare.includes(product.id) ? "selected" : ""}`}
              onClick={() => toggleCompare(product.id)}
              aria-pressed={compare.includes(product.id)}
            >
              {compare.includes(product.id) ? (
                <Check size={15} />
              ) : (
                <Plus size={15} />
              )}{" "}
              Compare
            </button>
            <button
              className="detail-link"
              aria-label={`Details for ${product.name}`}
              onClick={() => nav(`/product/${product.id}`)}
            >
              Details <ArrowUpRight size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  }
  function EmptyState({
    icon: Icon = Search,
    title,
    description,
    action = "Explore products",
    onAction = () => nav("/"),
  }: {
    icon?: typeof Search;
    title: string;
    description: string;
    action?: string;
    onAction?: () => void;
  }) {
    return (
      <div className="empty-state">
        <Icon size={34} strokeWidth={1.2} />
        <h2>{title}</h2>
        <p>{description}</p>
        <button className="primary-button" onClick={onAction}>
          {action}
          <ArrowRight size={16} />
        </button>
      </div>
    );
  }
  function searchBox(compact = false) {
    return (
      <form
        className={`search-composer ${compact ? "compact" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query, "all");
        }}
      >
        <label
          htmlFor={compact ? "results-query" : "shopping-query"}
          className="sr-only"
        >
          What are you looking for?
        </label>
        <div className="composer-input">
          <Sparkles size={21} />
          <textarea
            ref={searchRef}
            id={compact ? "results-query" : "shopping-query"}
            placeholder="Tell us what you’re looking for. We’ll find your fit."
            value={query}
            maxLength={1000}
            rows={compact ? 1 : 2}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runSearch(query, "all");
              }
            }}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-options">
            <div className="budget-control">
              <Wallet size={15} />
              <label htmlFor="shopping-budget">Budget</label>
              <span>$</span>
              <input
                id="shopping-budget"
                aria-label="Maximum budget"
                type="number"
                step="0.01"
                min="1"
                max="100000"
                placeholder="Any"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              <span className="currency-label">{prefs.currency}</span>
            </div>
            <button
              type="button"
              className={`preference-button ${filtersOpen ? "selected" : ""}`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal size={15} />
              <span>Preferences</span>
              {priorities.length > 0 && (
                <span className="count-mini">{priorities.length}</span>
              )}
            </button>
          </div>
          <button className="search-submit" disabled={loading} type="submit">
            <span>{loading ? "Finding your fit" : "Find my match"}</span>
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowRight size={17} />
            )}
          </button>
        </div>
        {filtersOpen && (
          <div className="composer-preferences">
            <span>What matters most?</span>
            <div className="priority-options">
              {[
                "value",
                "portability",
                "battery",
                "comfort",
                "performance",
                "noise cancellation",
              ].map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`chip ${priorities.includes(p) ? "active" : ""}`}
                  aria-pressed={priorities.includes(p)}
                  onClick={() => togglePriority(p)}
                >
                  {priorities.includes(p) && <Check size={13} />} {p}
                </button>
              ))}
            </div>
            <small>
              We match priorities only when supported by catalog information.
            </small>
          </div>
        )}
      </form>
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        id="main-sidebar"
        className={`sidebar ${mobileNav ? "mobile-open" : ""}`}
      >
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
          aria-label="Velora home"
        >
          <Logo />
        </a>
        <button
          className="new-search"
          onClick={() => {
            setQuery("");
            setBudget("");
            setCategory("all");
            setBrand("all");
            setFiltersOpen(false);
            setResult(null);
            nav("/");
            setTimeout(() => searchRef.current?.focus(), 100);
          }}
        >
          <Plus size={18} /> New search
        </button>
        <div className="nav-label">YOUR SHOPPING SPACE</div>
        <nav aria-label="Main navigation">
          {[
            { id: "discover", label: "Discover", icon: Compass, path: "/" },
            {
              id: "search",
              label: "Shopping assistant",
              icon: Sparkles,
              path: "/search",
            },
            {
              id: "saved",
              label: "Saved products",
              icon: Heart,
              path: "/saved",
              count: saved.length,
            },
            {
              id: "compare",
              label: "Compare",
              icon: Columns3,
              path: "/compare",
              count: compare.length,
            },
            {
              id: "alerts",
              label: "Price watchlist",
              icon: Bell,
              path: "/alerts",
              count: watches.length,
            },
          ].map(({ id, label, icon: Icon, path, count }) => (
            <a
              key={id}
              href={path}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                nav(path);
              }}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {!!count && <span className="nav-count">{count}</span>}
            </a>
          ))}
        </nav>
        <div className="recent-area">
          <div className="nav-label">RECENT SEARCHES</div>
          {history.length === 0 ? (
            <p className="recent-empty">
              Your next great find
              <br />
              starts with a question.
            </p>
          ) : (
            history.slice(0, 4).map((h, i) => (
              <button
                key={i}
                className="recent-search"
                onClick={() => {
                  setBudget(h.budget ? String(h.budget) : "");
                  runSearch(
                    h.query,
                    "all",
                    false,
                    h.budget ? String(h.budget) : "",
                  );
                }}
              >
                <Clock3 size={14} />
                <span>{h.query}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="thoughtful-note">
            <span>
              A little less searching.
              <br />A lot more finding.
            </span>
            <svg viewBox="0 0 50 50" aria-hidden="true">
              <path
                d="M25 4v42M4 25h42M10 10l30 30M10 40l30-30"
                stroke="currentColor"
                strokeWidth="6"
              />
            </svg>
          </div>
          <a
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              nav("/settings");
            }}
          >
            <Settings size={17} />
            <span>Settings</span>
          </a>
          <button
            className="profile-button"
            onClick={() => setModal("account")}
          >
            <span className="avatar">
              {account?.authenticated
                ? account.user?.displayName.charAt(0).toUpperCase()
                : "Y"}
            </span>
            <span>
              <strong>
                {account?.authenticated
                  ? account.user?.displayName.split(" ")[0]
                  : "Your personal space"}
              </strong>
              <small>
                {account?.authenticated
                  ? "Connected account"
                  : "Shopping as a guest"}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              aria-controls="main-sidebar"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              {page === "discover"
                ? "Discover"
                : page === "product"
                  ? "Product details"
                  : page === "alerts"
                    ? "Price watchlist"
                    : page === "search"
                      ? "Shopping assistant"
                      : page.charAt(0).toUpperCase() + page.slice(1)}
            </span>
            <span className="breadcrumb-divider">/</span>
            <span className="topbar-subtitle">A better way to shop</span>
          </div>
          <div className="topbar-actions">
            <span className="demo-tag">
              <span />
              Demo catalog
            </span>
            <button
              className="icon-button"
              aria-label={
                prefs.theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              onClick={() =>
                setPrefs((p) => ({
                  ...p,
                  theme: p.theme === "dark" ? "light" : "dark",
                }))
              }
            >
              {prefs.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="header-avatar"
              aria-label="Open your account"
              onClick={() => setModal("account")}
            >
              {account?.authenticated
                ? account.user?.displayName.charAt(0).toUpperCase()
                : "Y"}
            </button>
          </div>
        </header>
        <main id="main-content" className={`main-content page-${page}`}>
          {page === "discover" && (
            <>
              <section className="hero">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> LESS GUESSWORK. BETTER
                  FINDS.
                </div>
                <h1>
                  Find your kind of <span>perfect.</span>
                </h1>
                <p className="hero-description">
                  Big decisions or everyday upgrades. Tell us what you need,
                  <br className="desktop-break" /> and discover the right
                  products for your life and budget.
                </p>
                {searchBox()}
                <div className="suggested">
                  <span>A little inspiration</span>
                  <div className="prompt-grid">
                    {popularPrompts.map((p, i) => {
                      const Icon = [Headphones, Laptop, Armchair, Dumbbell][i];
                      return (
                        <button
                          className="prompt-chip"
                          key={p}
                          onClick={() => {
                            setCategory("all");
                            runSearch(p, "all");
                          }}
                        >
                          <Icon size={15} />
                          {p}
                          <ArrowUpRight size={13} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="trust-line">
                  <span>
                    <ShieldCheck size={14} /> Your needs come first
                  </span>
                  <i />
                  <button onClick={() => setModal("method")}>
                    <SlidersHorizontal size={14} /> Recommendations, explained
                  </button>
                  <i />
                  <span>
                    <Wallet size={14} /> Your budget, respected
                  </span>
                </div>
              </section>
              <section className="discovery-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">A GOOD PLACE TO START</div>
                    <h2>Find something that fits.</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => nav("/categories")}
                  >
                    Explore all categories <ArrowRight size={16} />
                  </button>
                </div>
                <div className="category-strip">
                  {[
                    "electronics",
                    "computers",
                    "home",
                    "fitness",
                    "beauty",
                    "travel",
                  ].map((id) => (
                    <button
                      className="category-tile"
                      key={id}
                      onClick={() => searchCategory(id)}
                    >
                      <div className="category-image">
                        <img
                          src={`/images/category-${id}.jpg`}
                          alt=""
                          loading="lazy"
                        />
                      </div>
                      <span>
                        {categories.find((c) => c.id === id)?.name || id}
                        <ArrowUpRight size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="featured-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">
                      SMALL UPGRADES, EVERYDAY JOY
                    </div>
                    <h2>Worth a closer look.</h2>
                  </div>
                  <span className="section-caption">
                    A few finds from our sample catalog
                  </span>
                </div>
                <div className="product-grid">
                  {featured.map((p, i) => renderProductCard(p, i))}
                </div>
              </section>
              <section className="manifesto">
                <div className="manifesto-symbol">
                  <Logo small />
                </div>
                <div>
                  <h2>Good shopping starts with you.</h2>
                  <p>
                    Your priorities. Your budget. Clear trade-offs.
                    <br />A little help finding what really matters.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setModal("method")}
                >
                  The Velora approach <ArrowUpRight size={16} />
                </button>
              </section>
            </>
          )}
          {page === "categories" && (
            <>
              <PageIntro
                eyebrow="FOLLOW YOUR CURIOSITY"
                title="A world of better finds."
                description="Pick a starting point. We’ll help you narrow it down."
              />
              <div className="all-categories">
                {categories.map((c) => {
                  const Icon = categoryIcons[c.id] || Compass;
                  return (
                    <button key={c.id} onClick={() => searchCategory(c.id)}>
                      <Icon size={25} strokeWidth={1.4} />
                      <h2>{c.name}</h2>
                      <p>{c.description}</p>
                      <span>
                        Explore <ArrowRight size={16} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {page === "search" && (
            <>
              <PageIntro
                eyebrow="YOUR PERSONAL SHOPPING ASSISTANT"
                title={
                  result && !loading
                    ? "Let’s find your fit."
                    : "What’s on your wish list?"
                }
                description="Tell us what matters. We’ll help you make sense of the options."
              />
              {searchBox(true)}
              {loading ? (
                <div className="search-loading" role="status">
                  <LoaderCircle className="spin" size={30} />
                  <h2>Looking for your kind of perfect</h2>
                  <p>
                    Matching your needs, checking your budget, comparing the
                    sample catalog.
                  </p>
                </div>
              ) : error ? (
                <EmptyState
                  title="That search hit a snag."
                  description={error}
                  action="Try again"
                  onAction={() => runSearch(lastQuery)}
                />
              ) : result ? (
                <>
                  <div className="assistant-summary">
                    <Logo small />
                    <div>
                      <span className="assistant-name">
                        A little guidance from Velora
                      </span>
                      <p>{result.clarification || result.summary}</p>
                      <div className="summary-meta">
                        <span>Demo catalog · sample prices</span>
                        <button onClick={() => setModal("method")}>
                          How we choose <CircleHelp size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {result.warnings?.length > 0 && (
                    <p className="data-note">{result.warnings.join(" ")}</p>
                  )}
                  <div className="results-toolbar">
                    <h2>
                      {displayProducts.length}{" "}
                      {displayProducts.length === 1
                        ? "thoughtful match"
                        : "thoughtful matches"}
                    </h2>
                    <div className="filter-controls">
                      <label>
                        <span className="sr-only">Filter by brand</span>
                        <select
                          value={brand}
                          onChange={(e) => setBrand(e.target.value)}
                        >
                          <option value="all">All brands</option>
                          {Array.from(
                            new Set(result.products.map((p) => p.brand)),
                          ).map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">Sort products</span>
                        <select
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="recommended">Recommended</option>
                          <option value="price-asc">Price: low to high</option>
                          <option value="price-desc">Price: high to low</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  {displayProducts.length ? (
                    <div className="product-grid results-grid">
                      {displayProducts.map((p, i) => renderProductCard(p, i))}
                    </div>
                  ) : (
                    <EmptyState
                      title="A little more detail would help."
                      description={
                        result.clarification ||
                        "No products match these filters. Try a different category or clear your brand filter. We won’t increase your budget for you."
                      }
                      action="Start a new search"
                      onAction={() => {
                        setResult(null);
                        setBrand("all");
                        setCategory("all");
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    />
                  )}
                  <section className="refinement-section">
                    <div>
                      <Sparkles size={20} />
                      <h3>Let’s make it more you.</h3>
                    </div>
                    <p>
                      Refine your needs, set a lower budget, or tell us about a
                      must-have feature.
                    </p>
                    {chat.length > 2 && (
                      <div className="chat-history">
                        {chat.slice(2).map((m, i) => (
                          <div className={`chat-message ${m.role}`} key={i}>
                            <strong>
                              {m.role === "you" ? "You" : "Velora"}
                            </strong>
                            <p>{m.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <form
                      className="refinement-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (refinement.trim())
                          runSearch(
                            `${lastQuery}. ${refinement}`,
                            category,
                            true,
                          );
                      }}
                    >
                      <input
                        aria-label="Refine your search"
                        placeholder="e.g. I’d prefer something lightweight…"
                        value={refinement}
                        onChange={(e) => setRefinement(e.target.value)}
                        maxLength={500}
                      />
                      <button
                        className="icon-button"
                        disabled={!refinement.trim()}
                        aria-label="Send refinement"
                      >
                        <ArrowUp size={20} />
                      </button>
                    </form>
                  </section>
                </>
              ) : (
                <div className="search-start">
                  <span>Not sure where to begin?</span>
                  <div className="prompt-grid">
                    {popularPrompts.map((p) => (
                      <button
                        className="prompt-chip"
                        key={p}
                        onClick={() => runSearch(p, "all")}
                      >
                        {p}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {page === "saved" && (
            <>
              <PageIntro
                eyebrow="KEEP THE GOOD FINDS CLOSE"
                title="Your shortlist."
                description={`${saved.length ? `${saved.length} ${saved.length === 1 ? "find" : "finds"} you’ve saved.` : "A place for the things that catch your eye."} Saved in this browser, ready when you are.`}
              />
              {saved.length ? (
                <div className="product-grid">
                  {products
                    .filter((p) => saved.includes(p.id))
                    .map((p, i) => renderProductCard(p, i))}
                </div>
              ) : (
                <EmptyState
                  icon={Heart}
                  title="Something good will go here."
                  description="Tap the heart on a product to save it. Take your time and come back when you’re ready."
                />
              )}
            </>
          )}
          {page === "compare" && (
            <>
              <PageIntro
                eyebrow="A CLEARER WAY TO CHOOSE"
                title="The details make the difference."
                description="Your options, side by side. Compare up to four products and decide what matters most."
              />
              {compare.length ? (
                <>
                  <div className="comparison-top">
                    <span>
                      {compare.length} of 4 products selected · demo catalog
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setCompare([])}
                    >
                      Clear comparison <X size={14} />
                    </button>
                  </div>
                  {new Set(
                    products
                      .filter((p) => compare.includes(p.id))
                      .map((p) => p.category),
                  ).size > 1 && (
                    <p className="notice">
                      These products belong to different categories. Their
                      prices and features are shown separately; they aren’t
                      equivalent alternatives.
                    </p>
                  )}
                  <div className="comparison-scroll">
                    <table className="comparison-table">
                      <thead>
                        <tr>
                          <th>At a glance</th>
                          {compare.map((id) => {
                            const p = products.find((p) => p.id === id);
                            return p ? (
                              <th key={id}>
                                <button
                                  className="compare-remove icon-button"
                                  aria-label={`Remove ${p.name} from comparison`}
                                  onClick={() => toggleCompare(id)}
                                >
                                  <X size={16} />
                                </button>
                                <ProductImage product={p} />
                                <span>{p.name}</span>
                                <small>{p.variant}</small>
                              </th>
                            ) : null;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            label: "Sample price",
                            value: (p: Product) =>
                              money(p.price, p.currency) + ` ${p.currency}`,
                          },
                          { label: "Brand", value: (p: Product) => p.brand },
                          {
                            label: "What stands out",
                            value: (p: Product) => p.pros.join(" · "),
                          },
                          {
                            label: "The trade-offs",
                            value: (p: Product) => p.cons.join(" · "),
                          },
                          {
                            label: "Specifications",
                            value: (p: Product) => (
                              <dl>
                                {Object.entries(p.specs).map(([k, v]) => (
                                  <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>{v}</dd>
                                  </div>
                                ))}
                              </dl>
                            ),
                          },
                          {
                            label: "Reviews & reliability",
                            value: () => "Not verified in the demo catalog",
                          },
                          {
                            label: "Stock, delivery & returns",
                            value: () =>
                              "Check the retailer for current information",
                          },
                          {
                            label: "Price last checked",
                            value: () => "Unverified sample — not a live offer",
                          },
                          {
                            label: "Explore",
                            value: (p: Product) => (
                              <a
                                className="retailer-link"
                                href={outbound(p, undefined, "comparison")}
                                target="_blank"
                                rel="noopener noreferrer sponsored"
                              >
                                Visit {p.offers[0]?.retailer || "source"}{" "}
                                <ExternalLink size={14} />
                              </a>
                            ),
                          },
                        ].map((row) => (
                          <tr key={row.label}>
                            <th>{row.label}</th>
                            {compare.map((id) => {
                              const p = products.find((p) => p.id === id);
                              return p ? (
                                <td key={id}>{row.value(p)}</td>
                              ) : null;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="data-note">
                    Every specification and price above is sample data. Review
                    the exact configuration and current terms on the source
                    website before purchasing.
                  </p>
                </>
              ) : (
                <EmptyState
                  icon={Columns3}
                  title="Good choices deserve a closer look."
                  description="Select Compare on any product to see the details side by side. Your comparison is saved in this browser."
                />
              )}
            </>
          )}
          {page === "product" &&
            (activeProduct ? (
              <>
                <button
                  className="text-button back-button"
                  onClick={() => nav(result ? "/search" : "/")}
                >
                  <ArrowLeft size={16} /> Back to discoveries
                </button>
                <div className="detail-layout">
                  <div className="detail-photo">
                    <ProductImage product={activeProduct} large />
                    <span className="detail-image-note">
                      {activeProduct.imageKind === "category"
                        ? "Category photograph for illustration only"
                        : "Product image"}{" "}
                      · Demo catalog
                    </span>
                  </div>
                  <div className="detail-main">
                    <span className="section-kicker">
                      {activeProduct.brand}
                    </span>
                    <h1>{activeProduct.name}</h1>
                    <p>{activeProduct.description}</p>
                    <span className="variant-label">
                      {activeProduct.variant}
                    </span>
                    <div className="detail-price">
                      {money(activeProduct.price, activeProduct.currency)}
                      <span>Sample price · {activeProduct.currency}</span>
                    </div>
                    <p className="data-note">
                      A sample price for exploring this demo. Current pricing
                      and availability haven’t been verified.
                    </p>
                    <div className="detail-buttons">
                      <a
                        className="primary-button"
                        href={outbound(activeProduct, undefined, "detail")}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                      >
                        Visit{" "}
                        {activeProduct.offers[0]?.retailer || "product source"}
                        <ArrowUpRight size={17} />
                      </a>
                      <button
                        className={`secondary-button ${saved.includes(activeProduct.id) ? "selected" : ""}`}
                        onClick={() => toggleSave(activeProduct.id)}
                      >
                        <Heart
                          size={17}
                          fill={
                            saved.includes(activeProduct.id)
                              ? "currentColor"
                              : "none"
                          }
                        />
                        {saved.includes(activeProduct.id) ? "Saved" : "Save"}
                      </button>
                    </div>
                    <div className="detail-secondary">
                      <button
                        className="text-button"
                        onClick={() => toggleCompare(activeProduct.id)}
                      >
                        {compare.includes(activeProduct.id) ? (
                          <Check size={16} />
                        ) : (
                          <Columns3 size={16} />
                        )}{" "}
                        {compare.includes(activeProduct.id)
                          ? "Added to comparison"
                          : "Add to comparison"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => startWatch(activeProduct)}
                      >
                        <Bell size={16} /> Set a price target
                      </button>
                    </div>
                    <p className="affiliate-small">
                      We may earn a commission from eligible links when an
                      approved program is connected.{" "}
                      <button onClick={() => setModal("disclosure")}>
                        Learn more
                      </button>
                    </p>
                  </div>
                </div>
                <div className="detail-information">
                  <section>
                    <h2>A balanced view.</h2>
                    <div className="pros-cons">
                      <div>
                        <h3>What might work for you</h3>
                        {activeProduct.pros.map((p) => (
                          <p key={p}>
                            <Plus size={15} />
                            {p}
                          </p>
                        ))}
                      </div>
                      <div>
                        <h3>What to keep in mind</h3>
                        {activeProduct.cons.map((p) => (
                          <p key={p}>
                            <span className="minus-mark">−</span>
                            {p}
                          </p>
                        ))}
                      </div>
                    </div>
                    <p className="data-note">
                      Illustrative assessments based on sample catalog
                      attributes; not verified review analysis.
                    </p>
                  </section>
                  <section>
                    <h2>The finer details.</h2>
                    <dl className="specification-list">
                      {Object.entries(activeProduct.specs).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h2>Where to find it.</h2>
                    {activeProduct.offers.map((o) => (
                      <div className="retailer-row" key={o.id}>
                        <div>
                          <strong>{o.retailer}</strong>
                          <small>
                            Availability, delivery, warranty & returns: check
                            source
                          </small>
                        </div>
                        <div>
                          <strong>{money(o.price, o.currency)}</strong>
                          <small>Sample price</small>
                        </div>
                        <a
                          href={outbound(activeProduct, o.id, "detail")}
                          target="_blank"
                          rel="noopener noreferrer sponsored"
                          className="secondary-button"
                        >
                          View source <ArrowUpRight size={15} />
                        </a>
                      </div>
                    ))}
                  </section>
                  <section className="provenance">
                    <ShieldCheck size={23} />
                    <div>
                      <h3>Know what you’re looking at.</h3>
                      <p>
                        Source:{" "}
                        <a
                          href={activeProduct.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {activeProduct.source.name}
                        </a>
                        . Demo attributes and prices have not been checked live.
                        Customer ratings, review counts, historical prices, and
                        reliability evidence are unavailable.
                      </p>
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <EmptyState
                title="We couldn’t find that product."
                description="It may no longer be in the catalog. Explore the current collection to find something else."
              />
            ))}
          {page === "alerts" && (
            <>
              <PageIntro
                eyebrow="ON YOUR TERMS, AT YOUR PRICE"
                title="Good things are worth watching."
                description="Save a target price for products you’re considering. Your budget stays in your hands."
              />
              <div className="notice">
                <Bell size={19} />
                <div>
                  <strong>Your price wish list, for now.</strong>
                  <p>
                    Targets are saved in this browser. Live price monitoring and
                    notifications aren’t connected, so no alerts will be sent.
                  </p>
                </div>
              </div>
              {watches.length ? (
                <div className="watchlist">
                  {watches.map((w) => {
                    const p = products.find((p) => p.id === w.id);
                    return p ? (
                      <article className="watch-row" key={w.id}>
                        <button
                          className="watch-image"
                          onClick={() => nav(`/product/${p.id}`)}
                        >
                          <ProductImage product={p} />
                        </button>
                        <div className="watch-name">
                          <h3>{p.name}</h3>
                          <span>Sample price {money(p.price, p.currency)}</span>
                        </div>
                        <div className="watch-target">
                          <span>Your target</span>
                          <strong>{money(w.target, p.currency)}</strong>
                        </div>
                        <span className="status-pill">Not monitoring</span>
                        <button
                          className="text-button"
                          onClick={() => {
                            setWatchProduct(p);
                            setTarget(String(w.target));
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remove target for ${p.name}`}
                          onClick={() =>
                            setWatches((list) =>
                              list.filter((x) => x.id !== w.id),
                            )
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </article>
                    ) : null;
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Bell}
                  title="Your next find, at the right price."
                  description="Open a product and select Set a price target to keep a note of what you’d like to spend."
                />
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <PageIntro
                eyebrow="MAKE YOURSELF AT HOME"
                title="A little more personal."
                description="Your shopping preferences, your data, your choice."
              />
              <div className="settings-layout">
                <section className="settings-section">
                  <h2>Shopping preferences</h2>
                  <p>Used to tailor your next search.</p>
                  <label className="setting-field">
                    Preferred currency
                    <select
                      value={prefs.currency}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, currency: e.target.value }))
                      }
                    >
                      <option value="USD">USD — US Dollar</option>
                      <option value="AUD">AUD — Australian Dollar</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — British Pound</option>
                    </select>
                    <small>
                      The demo catalog uses USD. Other currencies need a
                      compatible product provider; we don’t invent exchange
                      rates.
                    </small>
                  </label>
                  <label className="setting-field">
                    Shopping location
                    <select
                      value={prefs.location}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, location: e.target.value }))
                      }
                    >
                      <option>United States</option>
                      <option>Australia</option>
                      <option>United Kingdom</option>
                      <option>European Union</option>
                    </select>
                    <small>
                      Saved for future retailer integrations. Local availability
                      is currently unverified.
                    </small>
                  </label>
                  <div className="setting-line">
                    <div>
                      <strong>Appearance</strong>
                      <p>A comfortable space, day or night.</p>
                    </div>
                    <div className="segmented">
                      <button
                        className={prefs.theme === "light" ? "active" : ""}
                        aria-pressed={prefs.theme === "light"}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, theme: "light" }))
                        }
                      >
                        <Sun size={15} /> Light
                      </button>
                      <button
                        className={prefs.theme === "dark" ? "active" : ""}
                        aria-pressed={prefs.theme === "dark"}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, theme: "dark" }))
                        }
                      >
                        <Moon size={15} /> Dark
                      </button>
                    </div>
                  </div>
                </section>
                <section className="settings-section">
                  <h2>Privacy & data</h2>
                  <div className="setting-line">
                    <div>
                      <strong>Optional usage analytics</strong>
                      <p>
                        Allow search and outbound-click events to help improve
                        recommendations. Off by default.
                      </p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={prefs.analyticsConsent}
                      aria-label="Optional usage analytics"
                      className={`toggle ${prefs.analyticsConsent ? "on" : ""}`}
                      onClick={() =>
                        setPrefs((p) => ({
                          ...p,
                          analyticsConsent: !p.analyticsConsent,
                        }))
                      }
                    >
                      <span />
                    </button>
                  </div>
                  <div className="setting-line">
                    <div>
                      <strong>Your shopping data</strong>
                      <p>
                        Saved products, comparisons, history, and preferences
                        stay in this browser unless you explicitly sync.
                      </p>
                    </div>
                    <button className="secondary-button" onClick={exportData}>
                      <Download size={15} /> Export
                    </button>
                  </div>
                  <div className="setting-line">
                    <div>
                      <strong>Start fresh</strong>
                      <p>Remove all Velora data stored in this browser.</p>
                    </div>
                    <button
                      className="text-button danger-text"
                      onClick={() => setModal("delete")}
                    >
                      Clear local data
                    </button>
                  </div>
                </section>
                <section className="settings-section">
                  <h2>Your account</h2>
                  <p>
                    {account?.authenticated
                      ? `Signed in as ${account.user?.displayName}.`
                      : "You’re shopping as a guest. Everything you need to explore is available without creating an account."}
                  </p>
                  {account?.syncAvailable && account.authenticated ? (
                    <div className="account-actions">
                      <button
                        className="primary-button"
                        disabled={syncing}
                        onClick={syncAccount}
                      >
                        {syncing ? "Syncing…" : "Sync this workspace"}
                        <CheckCheck size={16} />
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          if (account.state) {
                            setSaved(account.state.savedProductIds || []);
                            setCompare(
                              account.state.comparisonProductIds || [],
                            );
                            setPrefs(account.state.preferences || defaultPrefs);
                            setHistory(account.state.searchHistory || []);
                            notify("Loaded your synced workspace");
                          } else notify("No synced workspace found");
                        }}
                      >
                        Load synced workspace
                      </button>
                      <button
                        className="text-button danger-text"
                        onClick={async () => {
                          if (
                            window.confirm(
                              "Delete your cloud workspace? This permanently deletes your Velora account data, not your ChatGPT account.",
                            )
                          ) {
                            const r = await fetch("/api/account", {
                              method: "DELETE",
                            });
                            if (r.ok) {
                              setAccount((a) =>
                                a ? { ...a, state: undefined } : a,
                              );
                              notify("Cloud workspace deleted");
                            } else
                              notify(
                                "Unable to delete cloud workspace. Please try again.",
                              );
                          }
                        }}
                      >
                        Delete cloud workspace
                      </button>
                    </div>
                  ) : (
                    <p className="notice">
                      Cloud sync is not configured. Your browser workspace is
                      fully usable.
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setModal("account")}
                  >
                    Account details <ArrowRight size={15} />
                  </button>
                </section>
                <section className="settings-section">
                  <h2>Notifications</h2>
                  <p>
                    Price monitoring is not connected. No background checks or
                    notification emails are being sent.
                  </p>
                </section>
              </div>
            </>
          )}
          {![
            "discover",
            "categories",
            "search",
            "saved",
            "compare",
            "product",
            "alerts",
            "settings",
          ].includes(page) && (
            <EmptyState
              title="Let’s get you back on track."
              description="This page isn’t part of your shopping space."
            />
          )}
          <footer className="footer">
            <span>Thoughtful finds. Confident choices.</span>
            <div>
              <button onClick={() => setModal("disclosure")}>
                Affiliate disclosure
              </button>
              <span>·</span>
              <button onClick={() => setModal("method")}>
                How Velora works
              </button>
            </div>
            <span>© {new Date().getFullYear()} Velora</span>
          </footer>
        </main>
      </div>
      {compare.length > 0 && page !== "compare" && (
        <div className="comparison-tray">
          <Columns3 size={18} />
          <span>
            <strong>
              {compare.length} {compare.length === 1 ? "product" : "products"}
            </strong>{" "}
            to compare
          </span>
          <div className="tray-thumbnails">
            {compare.slice(0, 4).map((id) => {
              const p = products.find((p) => p.id === id);
              return p ? <img key={id} src={p.image} alt={p.name} /> : null;
            })}
          </div>
          <button className="primary-button" onClick={() => nav("/compare")}>
            Compare now <ArrowRight size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Clear comparison tray"
            onClick={() => setCompare([])}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === "method" && (
        <Modal title="Thoughtful by design." onClose={() => setModal(null)}>
          <p>
            Velora helps you narrow down products using the needs you share and
            the information actually available.
          </p>
          <ol className="method-list">
            <li>
              <strong>Your budget is a boundary.</strong>
              <p>
                Products above your maximum are excluded. We never quietly raise
                your budget.
              </p>
            </li>
            <li>
              <strong>Fit comes first.</strong>
              <p>
                We match your category and requested features to catalog
                attributes, then consider your selected priorities and sample
                price. We explain those matches without made-up quality scores.
              </p>
            </li>
            <li>
              <strong>The trade-offs stay visible.</strong>
              <p>
                Pros and cons come from catalog attributes. Missing review,
                warranty, delivery, and availability information stays marked as
                unverified.
              </p>
            </li>
          </ol>
          <div className="notice">
            <p>
              This version uses a sample catalog and a rule-based shopping
              assistant. A configurable AI provider can help interpret requests
              when connected. No live retailer research or review analysis is
              running.
            </p>
          </div>
        </Modal>
      )}
      {modal === "disclosure" && (
        <Modal
          title="A clear word about our links."
          onClose={() => setModal(null)}
        >
          <p>
            Velora is designed to earn a commission from eligible purchases
            through approved affiliate links, at no extra cost to you.
          </p>
          <p>
            Ordinary product URLs and affiliate URLs are stored separately.
            Affiliate links are only used when a valid program and tracking
            configuration have been provided. No affiliate partnership or
            commission is claimed in the demo.
          </p>
          <p>
            Recommendations are based on suitability and your budget. Commission
            rates never affect product ranking.
          </p>
          <p>
            Click analytics are optional and can be changed in Settings. An
            outbound click is not treated as a purchase or commission.
          </p>
          <button
            className="secondary-button"
            onClick={() => {
              setModal(null);
              nav("/settings");
            }}
          >
            Privacy settings <ArrowRight size={15} />
          </button>
        </Modal>
      )}
      {modal === "account" && (
        <Modal
          title="Your personal shopping space."
          onClose={() => setModal(null)}
        >
          <p>
            {account?.authenticated
              ? `Welcome, ${account.user?.displayName}. Your identity is provided by the hosting platform.`
              : "You’re currently shopping as a guest. Your saved finds, recent searches, and comparisons are stored in this browser."}
          </p>
          <div className="account-summary">
            <div>
              <strong>{saved.length}</strong>
              <span>Saved finds</span>
            </div>
            <div>
              <strong>{compare.length}</strong>
              <span>To compare</span>
            </div>
            <div>
              <strong>{history.length}</strong>
              <span>Recent searches</span>
            </div>
          </div>
          <p className="data-note">
            {account?.syncAvailable
              ? "Cloud storage is configured. You choose when to sync your workspace in Settings."
              : "Cloud sync is not configured. Guest shopping works without signing in."}
          </p>
          {!account?.authenticated && account?.identityAvailable && (
            <a
              className="primary-button"
              href="/signin-with-chatgpt?return_to=%2Fsettings"
              target="_top"
            >
              Sign in with ChatGPT <ArrowUpRight size={16} />
            </a>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              setModal(null);
              nav("/settings");
            }}
          >
            Manage your preferences <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal
          title="Clear this browser’s workspace?"
          onClose={() => setModal(null)}
        >
          <p>
            This removes your saved products, comparisons, price targets, search
            history, and preferences from this browser.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Keep my data
            </button>
            <button className="primary-button" onClick={clearLocal}>
              Clear local data
            </button>
          </div>
        </Modal>
      )}
      {watchProduct && (
        <Modal
          title="A price that works for you."
          onClose={() => setWatchProduct(null)}
        >
          <p>
            Set a target for <strong>{watchProduct.name}</strong>.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(target) > 0) {
                setWatches((list) => [
                  ...list.filter((w) => w.id !== watchProduct.id),
                  { id: watchProduct.id, target: Number(target) },
                ]);
                setWatchProduct(null);
                notify("Price target saved. Live monitoring is not connected.");
              }
            }}
          >
            <label className="setting-field">
              Target price ({watchProduct.currency})
              <input
                type="number"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                min="1"
                max="100000"
                required
              />
            </label>
            <p className="notice">
              This saves a price target only. No price checks or notifications
              will run until monitoring is connected.
            </p>
            <button className="primary-button" type="submit">
              Save my target <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
