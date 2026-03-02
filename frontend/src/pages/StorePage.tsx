import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RedirectToSignUp, useUser } from '@clerk/clerk-react';
import {
  ArrowRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { LuCrown } from 'react-icons/lu';
import Header from '../components/Header';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';

type Store = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  website?: string | null;
  is_verified?: boolean | null;
};

type PublicStockItem = {
  stock: {
    id: number;
    created_at?: string | null;
    product_reference: string;
    quantity: number;
    weight: number | null;
    image_url: string | null;
    product_stripe_id: string | null;
    bought?: number | null;
  };
  product: {
    id: string;
    name: string | null;
    description: string | null;
    images?: string[] | null;
  } | null;
  unit_price: number | null;
};

function ProductImageCarousel({
  images,
  alt,
  badge,
}: {
  images: string[];
  alt: string;
  badge?: ReactNode;
}) {
  const normalized = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of images) {
      const s = String(raw || '').trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }, [images]);

  const [index, setIndex] = useState(0);
  const [brokenByIndex, setBrokenByIndex] = useState<Record<number, true>>({});

  useEffect(() => {
    setIndex(0);
    setBrokenByIndex({});
  }, [normalized.join('|')]);

  useEffect(() => {
    if (normalized.length === 0) return;
    const safeIndex = Math.max(
      0,
      Math.min(index, Math.max(0, normalized.length - 1))
    );
    if (!brokenByIndex[safeIndex]) {
      if (safeIndex !== index) setIndex(safeIndex);
      return;
    }
    for (let step = 1; step < normalized.length; step++) {
      const cand = (safeIndex + step) % normalized.length;
      if (!brokenByIndex[cand]) {
        setIndex(cand);
        return;
      }
    }
    if (safeIndex !== index) setIndex(safeIndex);
  }, [index, brokenByIndex, normalized]);

  const count = normalized.length;
  const anyValid = count > 0 && normalized.some((_, i) => !brokenByIndex[i]);
  const canNavigate = count > 1 && anyValid;
  const currentSrc = anyValid ? normalized[index] : '';

  const goPrev = () => {
    if (!canNavigate) return;
    for (let step = 1; step <= count; step++) {
      const cand = (index - step + count) % count;
      if (!brokenByIndex[cand]) {
        setIndex(cand);
        return;
      }
    }
  };

  const goNext = () => {
    if (!canNavigate) return;
    for (let step = 1; step <= count; step++) {
      const cand = (index + step) % count;
      if (!brokenByIndex[cand]) {
        setIndex(cand);
        return;
      }
    }
  };

  return (
    <div className='w-full aspect-[3/4] bg-gray-100 overflow-hidden relative'>
      {currentSrc ? (
        <img
          src={currentSrc}
          alt={alt}
          className='w-full h-full object-cover'
          onError={() => setBrokenByIndex(prev => ({ ...prev, [index]: true }))}
          loading='lazy'
        />
      ) : (
        <div className='absolute inset-0 flex items-center justify-center text-sm text-gray-400'>
          Aucune image
        </div>
      )}

      {badge ? <div className='absolute top-2 left-2'>{badge}</div> : null}

      {canNavigate ? (
        <>
          <button
            type='button'
            onClick={goPrev}
            className='absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/95 border border-gray-200 shadow-sm flex items-center justify-center text-gray-800 hover:bg-white'
            aria-label='Image précédente'
          >
            <ChevronLeft className='w-5 h-5' aria-hidden='true' />
          </button>
          <button
            type='button'
            onClick={goNext}
            className='absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/95 border border-gray-200 shadow-sm flex items-center justify-center text-gray-800 hover:bg-white'
            aria-label='Image suivante'
          >
            <ChevronRight className='w-5 h-5' aria-hidden='true' />
          </button>
          <div className='absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white/95 border border-gray-200 shadow-sm rounded-full px-2 py-1'>
            {normalized.map((_, i) => {
              const active = i === index;
              const broken = Boolean(brokenByIndex[i]);
              return (
                <button
                  key={i}
                  type='button'
                  onClick={() => {
                    if (broken) return;
                    setIndex(i);
                  }}
                  aria-label={`Aller à l'image ${i + 1}`}
                  className={`h-2 w-2 rounded-full ${
                    broken
                      ? 'bg-gray-200'
                      : active
                        ? 'bg-indigo-600'
                        : 'bg-gray-300'
                  }`}
                />
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function StorePage() {
  const navigate = useNavigate();
  const { storeName } = useParams();
  const { user, isLoaded, isSignedIn } = useUser();

  const storeSlug = String(storeName || '').trim();

  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [items, setItems] = useState<PublicStockItem[]>([]);
  const { toast, showToast } = useToast();
  const [redirectToSignUp, setRedirectToSignUp] = useState(false);
  const [addingItemId, setAddingItemId] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [itemsPerPage, setItemsPerPage] = useState<number>(12);
  const [page, setPage] = useState<number>(1);
  const [filterField, setFilterField] = useState<
    'reference' | 'titre' | 'description'
  >('reference');
  const [filterTerm, setFilterTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<
    'best_sellers' | 'recent' | 'price_asc' | 'price_desc'
  >('recent');

  const apiBase = useMemo(
    () => import.meta.env.VITE_API_URL || 'http://localhost:5000',
    []
  );

  const visibleItems = useMemo(
    () => items.filter(it => Number(it.stock?.quantity || 0) > 0),
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = String(filterTerm || '')
      .trim()
      .toLowerCase();
    if (!q) return visibleItems;
    return visibleItems.filter(it => {
      if (filterField === 'reference') {
        const ref = String(it.stock?.product_reference || '')
          .trim()
          .toLowerCase();
        return ref.includes(q);
      }
      if (filterField === 'titre') {
        const title = String(it.product?.name || '')
          .trim()
          .toLowerCase();
        return title.includes(q);
      }
      const desc = String(it.product?.description || '')
        .trim()
        .toLowerCase();
      return desc.includes(q);
    });
  }, [filterField, filterTerm, visibleItems]);

  const sortedItems = useMemo(() => {
    const getBought = (it: PublicStockItem) => {
      const v = Number((it.stock as any)?.bought || 0);
      return Number.isFinite(v) && v > 0 ? v : 0;
    };
    const getCreatedTs = (it: PublicStockItem) => {
      const raw = String((it.stock as any)?.created_at || '').trim();
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };
    const getId = (it: PublicStockItem) => {
      const v = Number((it.stock as any)?.id || 0);
      return Number.isFinite(v) ? v : 0;
    };
    const getPrice = (it: PublicStockItem) => {
      const v = Number((it as any)?.unit_price);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const arr = filteredItems.slice();
    arr.sort((a, b) => {
      if (sortBy === 'best_sellers') {
        const diff = getBought(b) - getBought(a);
        if (diff !== 0) return diff;
      } else if (sortBy === 'recent') {
        const diff = getCreatedTs(b) - getCreatedTs(a);
        if (diff !== 0) return diff;
      } else if (sortBy === 'price_asc' || sortBy === 'price_desc') {
        const pa = getPrice(a);
        const pb = getPrice(b);
        if (pa == null && pb == null) {
        } else if (pa == null) {
          return 1;
        } else if (pb == null) {
          return -1;
        } else {
          const diff = sortBy === 'price_asc' ? pa - pb : pb - pa;
          if (diff !== 0) return diff;
        }
      }

      const createdDiff = getCreatedTs(b) - getCreatedTs(a);
      if (createdDiff !== 0) return createdDiff;
      return getId(b) - getId(a);
    });
    return arr;
  }, [filteredItems, sortBy]);

  const safePageSize = Math.max(1, itemsPerPage);
  const totalProducts = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  useEffect(() => {
    setPage(1);
  }, [filterField, filterTerm, itemsPerPage, sortBy, storeSlug]);

  const paginatedItems = useMemo(() => {
    if (totalProducts === 0) return [];
    const start = (currentPage - 1) * safePageSize;
    return sortedItems.slice(start, start + safePageSize);
  }, [currentPage, safePageSize, sortedItems, totalProducts]);

  const mostPopularStockId = useMemo(() => {
    let bestId: number | null = null;
    let bestBought = 0;
    for (const it of visibleItems) {
      const bought = Number((it.stock as any)?.bought || 0);
      if (Number.isFinite(bought) && bought > bestBought) {
        bestBought = bought;
        bestId = it.stock.id;
      }
    }
    return bestBought > 0 ? bestId : null;
  }, [visibleItems]);

  useEffect(() => {
    if (visibleItems.length === 0) return;
    setQuantities(prev => {
      let changed = false;
      const next = { ...prev };
      for (const it of visibleItems) {
        if (typeof next[it.stock.id] !== 'number') {
          next[it.stock.id] = 1;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleItems]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      setStore(null);
      setItems([]);

      if (!storeSlug) {
        setError('Boutique manquante');
        setLoading(false);
        return;
      }

      try {
        const [storeResp, stockResp] = await Promise.all([
          fetch(`${apiBase}/api/stores/${encodeURIComponent(storeSlug)}`),
          fetch(
            `${apiBase}/api/stores/${encodeURIComponent(storeSlug)}/stock/public`
          ),
        ]);

        const storeJson = await storeResp.json().catch(() => null as any);
        const stockJson = await stockResp.json().catch(() => null as any);

        if (!storeResp.ok) {
          throw new Error(
            storeJson?.error || 'Erreur lors du chargement de la boutique'
          );
        }
        if (!stockResp.ok) {
          throw new Error(
            stockJson?.error || 'Erreur lors du chargement des articles'
          );
        }

        if (cancelled) return;

        setStore(storeJson?.store || null);
        setItems(Array.isArray(stockJson?.items) ? stockJson.items : []);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.message || 'Erreur interne';
        setError(typeof msg === 'string' ? msg : 'Erreur interne');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, storeSlug]);

  const handleReloadStoreItems = async () => {
    if (!storeSlug) return;
    setReloading(true);
    setError(null);
    try {
      const [storeResp, stockResp] = await Promise.all([
        fetch(`${apiBase}/api/stores/${encodeURIComponent(storeSlug)}`),
        fetch(
          `${apiBase}/api/stores/${encodeURIComponent(storeSlug)}/stock/public`
        ),
      ]);

      const storeJson = await storeResp.json().catch(() => null as any);
      const stockJson = await stockResp.json().catch(() => null as any);

      if (!storeResp.ok) {
        throw new Error(
          storeJson?.error || 'Erreur lors du chargement de la boutique'
        );
      }
      if (!stockResp.ok) {
        throw new Error(
          stockJson?.error || 'Erreur lors du chargement des articles'
        );
      }

      setStore(storeJson?.store || null);
      setItems(Array.isArray(stockJson?.items) ? stockJson.items : []);
    } catch (e: any) {
      const msg = e?.message || 'Erreur interne';
      setError(typeof msg === 'string' ? msg : 'Erreur interne');
    } finally {
      setReloading(false);
    }
  };

  const formatEur = (value: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);

  const cloudBase = (
    import.meta.env.VITE_CLOUDFRONT_URL ||
    'https://d1tmgyvizond6e.cloudfront.net'
  ).replace(/\/+$/, '');
  const storeLogo = store?.id ? `${cloudBase}/images/${store.id}` : undefined;

  if (redirectToSignUp) {
    return <RedirectToSignUp />;
  }

  const resolveStripeCustomerId = async () => {
    const direct = String(
      (user?.publicMetadata as any)?.stripe_id || ''
    ).trim();
    if (direct) return direct;

    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) throw new Error('Email manquant');

    const detailsResp = await fetch(
      `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
        email
      )}`
    );
    if (detailsResp.ok) {
      const json = await detailsResp.json().catch(() => null as any);
      const stripeId = String(json?.customer?.id || '').trim();
      if (stripeId) return stripeId;
    }
    if (detailsResp.status !== 404) {
      const json = await detailsResp.json().catch(() => null as any);
      const msg =
        json?.error ||
        json?.message ||
        'Erreur lors de la récupération du client';
      throw new Error(msg);
    }

    const fullName =
      String(user?.fullName || '').trim() ||
      String(user?.firstName || '').trim() ||
      'Client';
    const createResp = await fetch(`${apiBase}/api/stripe/create-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fullName,
        email,
        clerkUserId: user?.id,
      }),
    });
    const createJson = await createResp.json().catch(() => null as any);
    if (!createResp.ok) {
      const msg =
        createJson?.error ||
        createJson?.message ||
        'Erreur lors de la création du client';
      throw new Error(msg);
    }
    const stripeId = String(createJson?.stripeId || '').trim();
    if (!stripeId) throw new Error('stripeId manquant');
    return stripeId;
  };

  const handleAddToCart = async (it: PublicStockItem, quantity: number) => {
    if (!isLoaded) {
      showToast('Chargement du compte...', 'info');
      return;
    }
    if (!isSignedIn) {
      setRedirectToSignUp(true);
      return;
    }
    if (!store?.id) {
      showToast('Boutique invalide', 'error');
      return;
    }
    if (
      !Number.isFinite(quantity) ||
      Math.floor(quantity) !== quantity ||
      quantity < 1
    ) {
      showToast('Quantité invalide', 'error');
      return;
    }
    if (it.unit_price == null || !(it.unit_price > 0)) {
      showToast('Prix indisponible', 'error');
      return;
    }

    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) {
      showToast('Email manquant', 'error');
      return;
    }

    const title =
      String(it.product?.name || '').trim() || it.stock.product_reference;
    const reference = String(it.stock.product_reference || '').trim();
    if (!reference) {
      showToast('Référence invalide', 'error');
      return;
    }

    setAddingItemId(it.stock.id);
    try {
      const stripeCustomerId = await resolveStripeCustomerId();
      const productStripeId =
        String(it.stock.product_stripe_id || '').trim() ||
        String(it.product?.id || '').trim() ||
        undefined;

      const summaryResp = await fetch(
        `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(
          stripeCustomerId
        )}`
      );
      if (summaryResp.ok) {
        const summaryJson = await summaryResp.json().catch(() => null as any);
        const groups = Array.isArray(summaryJson?.itemsByStore)
          ? summaryJson.itemsByStore
          : [];
        const groupForStore = groups.find(
          (g: any) => g?.store?.id && store?.id && g.store.id === store.id
        );
        const items = Array.isArray(groupForStore?.items)
          ? groupForStore.items
          : [];
        const refKey = String(reference || '')
          .trim()
          .toLowerCase();
        const existing = items.find((c: any) => {
          const r = String(c?.product_reference || '')
            .trim()
            .toLowerCase();
          return r === refKey;
        });
        if (existing?.id) {
          const existingQtyRaw = Number(existing?.quantity);
          const existingQty =
            Number.isFinite(existingQtyRaw) && existingQtyRaw > 0
              ? Math.floor(existingQtyRaw)
              : 1;
          const nextQty = existingQty + quantity;
          const updateResp = await fetch(
            `${apiBase}/api/carts/${encodeURIComponent(String(existing.id))}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quantity: nextQty }),
            }
          );
          const updateJson = await updateResp.json().catch(() => null as any);
          if (!updateResp.ok) {
            showToast(
              updateJson?.message ||
                updateJson?.error ||
                'Erreur lors de la mise à jour du panier',
              'error'
            );
            return;
          }
          showToast('Quantité mise à jour', 'success');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cart:updated'));
          }
          return;
        }
      }

      const resp = await fetch(`${apiBase}/api/carts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: store.id,
          product_reference: reference,
          value: it.unit_price,
          customer_stripe_id: stripeCustomerId,
          description: title,
          quantity,
          weight:
            typeof it.stock.weight === 'number' ? it.stock.weight : undefined,
          product_stripe_id: productStripeId,
        }),
      });
      const json = await resp.json().catch(() => null as any);
      if (resp.status === 409) {
        showToast(
          json?.message || 'Cette référence existe déjà dans un autre panier',
          'error'
        );
        return;
      }
      if (!resp.ok) {
        showToast(
          json?.message || json?.error || "Erreur lors de l'ajout au panier",
          'error'
        );
        return;
      }
      showToast('Ajouté au panier', 'success');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cart:updated'));
      }
    } catch (e: any) {
      showToast(e?.message || "Erreur lors de l'ajout au panier", 'error');
    } finally {
      setAddingItemId(prev => (prev === it.stock.id ? null : prev));
    }
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          visible={(toast as any).visible !== false}
        />
      )}
      <Header />
      <div className='w-full mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {loading ? (
          <div className='min-h-[50vh] flex items-center justify-center'>
            <div className='text-center'>
              <div className='animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-3'></div>
              <p className='text-gray-600'>Chargement de la boutique...</p>
            </div>
          </div>
        ) : error ? (
          <div className='w-full bg-white rounded-lg shadow border p-6'>
            <div className='max-w-6xl mx-auto'>
              <div className='text-lg font-semibold text-gray-900 mb-2'>
                Impossible d’afficher la boutique
              </div>
              <div className='text-sm text-gray-700'>{error}</div>
            </div>
          </div>
        ) : (
          <>
            <div className='sm:hidden mb-4'>
              <button
                onClick={() => {
                  const url = `/checkout/${encodeURIComponent(storeSlug)}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className='w-full inline-flex items-center justify-center px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700'
              >
                Procéder au paiement
                <ArrowRight className='w-3 h-3 ml-2' />
              </button>
            </div>
            <div className='w-full bg-white rounded-lg shadow p-6'>
              <div className='max-w-6xl mx-auto'>
                <div className='flex items-start justify-between gap-4 mb-6'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-3'>
                      {storeLogo ? (
                        <img
                          src={storeLogo}
                          alt={store?.name || 'Boutique'}
                          className='w-10 h-10 rounded-md object-cover border border-gray-200 bg-white'
                          onError={e => {
                            (e.currentTarget as any).style.display = 'none';
                          }}
                        />
                      ) : null}
                      <div className='min-w-0'>
                        <h1 className='text-2xl font-bold text-gray-900 truncate'>
                          {store?.name || storeSlug}
                        </h1>
                        {store?.description || store?.is_verified ? (
                          <div className='mt-1'>
                            {store?.description ? (
                              <p
                                className='text-gray-600'
                                title={store.description}
                              >
                                {store.description}
                              </p>
                            ) : null}
                            {store?.is_verified ? (
                              <div
                                title="Le SIRET de la boutique a été vérifié via l'INSEE"
                                className='inline-flex items-center gap-1 mt-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium size-fit'
                              >
                                <BadgeCheck className='w-3 h-3' /> Boutique
                                Vérifiée
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const url = `/checkout/${encodeURIComponent(storeSlug)}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className='hidden sm:inline-flex items-center px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700'
                  >
                    Procéder au paiement
                    <ArrowRight className='w-3 h-3 sm:w-4 sm:h-4 ml-2' />
                  </button>
                </div>

                <div>
                  <div className='flex items-center gap-3 mb-4'>
                    <h2 className='text-lg font-semibold text-gray-900'>
                      Articles
                    </h2>
                    <button
                      type='button'
                      onClick={handleReloadStoreItems}
                      disabled={reloading}
                      className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                    >
                      <RefreshCw
                        className={`w-4 h-4 mr-1 ${reloading ? 'animate-spin' : ''}`}
                      />
                      <span>Recharger</span>
                    </button>
                  </div>

                  {visibleItems.length === 0 ? (
                    <div className='text-sm text-gray-600'>
                      Aucun article disponible pour le moment.
                    </div>
                  ) : (
                    <div>
                      <div className='mb-4 flex flex-wrap items-center gap-2'>
                        <div className='flex items-center space-x-2 flex-wrap'>
                          <span className='text-sm text-gray-700'>
                            Filtrer par
                          </span>
                          <select
                            value={filterField}
                            onChange={e => {
                              const v = e.target.value as
                                | 'reference'
                                | 'titre'
                                | 'description';
                              setFilterField(v);
                              setPage(1);
                            }}
                            className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          >
                            <option value='reference'>Référence</option>
                            <option value='titre'>Titre</option>
                            <option value='description'>Description</option>
                          </select>
                          <input
                            type='text'
                            value={filterTerm}
                            onChange={e => {
                              setFilterTerm(e.target.value);
                              setPage(1);
                            }}
                            placeholder='Saisir…'
                            className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          />
                        </div>

                        <div className='flex items-center space-x-2 flex-wrap'>
                          <span className='text-sm text-gray-700'>
                            Trier par
                          </span>
                          <select
                            value={sortBy}
                            onChange={e => {
                              const v = e.target.value as
                                | 'best_sellers'
                                | 'recent'
                                | 'price_asc'
                                | 'price_desc';
                              setSortBy(v);
                              setPage(1);
                            }}
                            className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          >
                            <option value='best_sellers'>
                              Meilleures ventes
                            </option>
                            <option value='recent'>Plus récents</option>
                            <option value='price_asc'>Prix croissant</option>
                            <option value='price_desc'>Prix décroissant</option>
                          </select>
                        </div>
                      </div>

                      {sortedItems.length === 0 ? (
                        <div className='text-sm text-gray-600'>
                          Aucun résultat.
                        </div>
                      ) : (
                        <>
                          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'>
                            {paginatedItems.map(it => {
                              const stripeImages =
                                Array.isArray(it.product?.images) &&
                                it.product!.images
                                  ? it.product!.images
                                  : [];
                              const stockImages = String(
                                it.stock?.image_url || ''
                              )
                                .split(',')
                                .map(s => s.trim())
                                .filter(Boolean);
                              const images = [...stripeImages, ...stockImages];

                              const title =
                                String(it.product?.name || '').trim() ||
                                it.stock.product_reference;
                              const desc = String(
                                it.product?.description || ''
                              ).trim();
                              const selectedQty = quantities[it.stock.id] ?? 1;
                              const canAdd = addingItemId !== it.stock.id;
                              const isPopular =
                                mostPopularStockId === it.stock.id;

                              return (
                                <div
                                  key={it.stock.id}
                                  className='rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm hover:shadow transition-shadow'
                                >
                                  <ProductImageCarousel
                                    images={images}
                                    alt={title}
                                    badge={
                                      isPopular ? (
                                        <span className='inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-semibold text-red-600 shadow'>
                                          <LuCrown className='h-3.5 w-3.5' />
                                          <span>Populaire</span>
                                        </span>
                                      ) : undefined
                                    }
                                  />
                                  <div className='p-3'>
                                    <div className='flex items-start justify-between gap-3'>
                                      <div className='min-w-0'>
                                        <div className='text-sm font-semibold text-gray-900 truncate'>
                                          {title}
                                        </div>
                                        <div className='text-xs text-gray-500 mt-0.5 truncate'>
                                          Réf: {it.stock.product_reference}
                                        </div>
                                      </div>
                                      <div className='text-right shrink-0'>
                                        <div className='text-sm font-semibold text-gray-900'>
                                          {it.unit_price != null
                                            ? formatEur(it.unit_price)
                                            : 'Prix indisponible'}
                                        </div>
                                      </div>
                                    </div>

                                    <div className='text-xs text-gray-700 mt-2 line-clamp-2'>
                                      {desc ? desc : 'Aucune description.'}
                                    </div>

                                    <div className='mt-3 flex items-center justify-between gap-2'>
                                      <div className='text-xs text-gray-700'>
                                        Qté
                                      </div>
                                      <div className='flex items-center gap-1'>
                                        <button
                                          type='button'
                                          onClick={() =>
                                            setQuantities(prev => {
                                              const current =
                                                prev[it.stock.id] ?? 1;
                                              const next = Math.max(
                                                1,
                                                current - 1
                                              );
                                              return {
                                                ...prev,
                                                [it.stock.id]: next,
                                              };
                                            })
                                          }
                                          disabled={!canAdd}
                                          className='h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60'
                                          aria-label='Diminuer la quantité'
                                        >
                                          -
                                        </button>
                                        <input
                                          type='number'
                                          inputMode='numeric'
                                          min={1}
                                          step={1}
                                          value={selectedQty}
                                          onChange={e => {
                                            const raw = e.target.value;
                                            const next = Math.max(
                                              1,
                                              Math.floor(Number(raw || 1))
                                            );
                                            setQuantities(prev => ({
                                              ...prev,
                                              [it.stock.id]: next,
                                            }));
                                          }}
                                          disabled={!canAdd}
                                          className='h-8 w-14 rounded-md border border-gray-200 px-2 text-sm text-gray-900'
                                        />
                                        <button
                                          type='button'
                                          onClick={() =>
                                            setQuantities(prev => {
                                              const current =
                                                prev[it.stock.id] ?? 1;
                                              const next = Math.max(
                                                1,
                                                current + 1
                                              );
                                              return {
                                                ...prev,
                                                [it.stock.id]: next,
                                              };
                                            })
                                          }
                                          disabled={!canAdd}
                                          className='h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60'
                                          aria-label='Augmenter la quantité'
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>

                                    <div className='mt-3'>
                                      <button
                                        onClick={() =>
                                          handleAddToCart(it, selectedQty)
                                        }
                                        disabled={addingItemId === it.stock.id}
                                        className='w-full inline-flex items-center justify-center px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60'
                                      >
                                        {addingItemId === it.stock.id
                                          ? 'Ajout...'
                                          : 'Ajouter au panier'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className='mt-4 flex flex-wrap items-center justify-between gap-2'>
                            <div className='flex items-center gap-2'>
                              <label className='text-sm text-gray-700'>
                                Cartes
                              </label>
                              <select
                                value={itemsPerPage}
                                onChange={e => {
                                  const v = parseInt(e.target.value, 10);
                                  const next =
                                    Number.isFinite(v) && v > 0 ? v : 12;
                                  setItemsPerPage(next);
                                  setPage(1);
                                }}
                                className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-28'
                              >
                                <option value={12}>12</option>
                                <option value={24}>24</option>
                                <option value={48}>48</option>
                                <option value={96}>96</option>
                              </select>
                            </div>

                            <div className='flex flex-wrap items-center gap-2'>
                              <div className='text-sm text-gray-600'>
                                Page {currentPage} / {totalPages} —{' '}
                                {totalProducts} produit
                                {totalProducts > 1 ? 's' : ''}
                              </div>
                              <div className='flex items-center space-x-2'>
                                <button
                                  type='button'
                                  onClick={() =>
                                    setPage(p => Math.max(1, p - 1))
                                  }
                                  disabled={currentPage <= 1}
                                  className={`px-3 py-1 text-sm rounded-md border ${
                                    currentPage <= 1
                                      ? 'bg-gray-100 text-gray-400 border-gray-200'
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  Précédent
                                </button>
                                <button
                                  type='button'
                                  onClick={() =>
                                    setPage(p => Math.min(totalPages, p + 1))
                                  }
                                  disabled={currentPage >= totalPages}
                                  className={`px-3 py-1 text-sm rounded-md border ${
                                    currentPage >= totalPages
                                      ? 'bg-gray-100 text-gray-400 border-gray-200'
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  Suivant
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
