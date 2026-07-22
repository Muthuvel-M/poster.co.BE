import type { Category, Product, ProductSize, Size } from "@prisma/client";
import { CATALOG_CATEGORIES } from "./catalog.js";

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

export function displayPrice(sizes: ProductSize[]): number {
  const a5 = sizes.find((s) => s.size === "A5");
  const first = a5 ?? sizes[0];
  if (!first) return 0;
  return first.discountedPrice ?? first.price;
}

export function toApiProduct(product: ProductWithCategory): ApiProduct {
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
    price: displayPrice(product.sizes),
    category: product.category.name,
    categoryKey: product.category.slug,
    description: product.description,
    stock: product.stock,
    status: product.status,
    imageUrl: primary?.cardUrl ?? primary?.url,
    thumbUrl: primary?.thumbUrl,
    cardUrl: primary?.cardUrl,
    fullUrl: primary?.url,
    sizes: product.sizes.map((s) => ({
      size: s.size,
      price: s.price,
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
    .filter((c) => order.has(c.slug))
    .map((c) => ({ key: c.slug, label: c.name }))
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

export { NEUTRAL_PALETTE };
