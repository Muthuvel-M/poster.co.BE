import type { Category, Product, ProductSize, Size } from "./db.js";
import { CATALOG_CATEGORIES } from "./catalog.js";
import { SIZE_PRICE, type SizePriceMap } from "./pricing.js";

export type ApiProductSize = {
  size: Size;
  price: number;
  discountedPrice: number | null;
};

export type ApiProductImage = {
  id: string;
  url: string;
  thumbUrl: string;
  cardUrl: string;
  sortOrder: number;
};

export type ApiProduct = {
  id: string;
  dbId: string;
  slug: string;
  title: string;
  subtitle: string;
  year: number;
  artist: string;
  price: number;
  category: string;
  categoryKey: string;
  description: string;
  stock: number;
  status: Product["status"];
  isBundle?: boolean;
  imageUrl?: string;
  thumbUrl?: string;
  cardUrl?: string;
  fullUrl?: string;
  sizes: ApiProductSize[];
  images: ApiProductImage[];
};

export type ApiCategory = {
  key: string;
  label: string;
};

type ProductWithCategory = Product & {
  category: Category;
};

const NEUTRAL_PALETTE = { bg: "#eae6d7", fg: "#1a1410", accent: "#6b7280" };

export function displayPrice(
  sizes: ProductSize[],
  global?: SizePriceMap,
): number {
  const a5 = sizes.find((s) => s.size === "A5");
  if (a5) {
    if (a5.discountedPrice != null) return a5.discountedPrice;
    if (global) return global.A5;
    return a5.price ?? SIZE_PRICE.A5;
  }
  const first = sizes[0];
  if (!first) return global?.A5 ?? SIZE_PRICE.A5;
  if (first.discountedPrice != null) return first.discountedPrice;
  if (global) return global[first.size] ?? SIZE_PRICE[first.size];
  return first.price ?? SIZE_PRICE[first.size];
}

export function toApiProduct(
  product: ProductWithCategory,
  globalPrice?: SizePriceMap,
): ApiProduct {
  const images = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const primary = images[0];

  return {
    id: product.slug,
    dbId: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle ?? product.category.name,
    year: product.year ?? new Date(product.createdAt).getFullYear(),
    artist: product.artist ?? product.category.name,
    price: displayPrice(product.sizes, globalPrice),
    category: product.category.name,
    categoryKey: product.category.slug,
    description: product.description,
    stock: product.stock,
    status: product.status,
    isBundle: product.isBundle ?? false,
    imageUrl: primary?.cardUrl ?? primary?.url,
    thumbUrl: primary?.thumbUrl,
    cardUrl: primary?.cardUrl,
    fullUrl: primary?.url,
    sizes: product.sizes.map((s) => ({
      size: s.size,
      price: globalPrice?.[s.size] ?? s.price,
      discountedPrice: s.discountedPrice ?? null,
    })),
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      thumbUrl: img.thumbUrl,
      cardUrl: img.cardUrl,
      sortOrder: img.sortOrder,
    })),
  };
}

export function toApiCategories(categories: Category[]): ApiCategory[] {
  const order = new Map<string, number>(
    CATALOG_CATEGORIES.map((c, i) => [c.slug, i]),
  );
  return categories
    .map((c) => ({ key: c.slug, label: c.name }))
    .sort(
      (a, b) =>
        (order.get(a.key) ?? 1000) - (order.get(b.key) ?? 1000) ||
        a.label.localeCompare(b.label),
    );
}

export { NEUTRAL_PALETTE };
