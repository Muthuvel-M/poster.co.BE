import type { Product, ProductImage, ProductSize, Category, Size } from "@prisma/client";

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
  sizes: ApiProductSize[];
  images: ApiProductImage[];
};

export type ApiCategory = {
  key: string;
  label: string;
};

type ProductWithRelations = Product & {
  category: Category;
  sizes: ProductSize[];
  images: ProductImage[];
};

const NEUTRAL_PALETTE = { bg: "#eae6d7", fg: "#1a1410", accent: "#6b7280" };

export function displayPrice(sizes: ProductSize[]): number {
  const a5 = sizes.find((s) => s.size === "A5");
  const first = a5 ?? sizes[0];
  if (!first) return 0;
  return first.discountedPrice ?? first.price;
}

export function toApiProduct(product: ProductWithRelations): ApiProduct {
  const primary = product.images.sort((a, b) => a.sortOrder - b.sortOrder)[0];

  return {
    id: product.slug,
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
    sizes: product.sizes.map((s) => ({
      size: s.size,
      price: s.price,
      discountedPrice: s.discountedPrice,
    })),
    images: product.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({
        id: img.id,
        url: img.url,
        thumbUrl: img.thumbUrl,
        cardUrl: img.cardUrl,
        sortOrder: img.sortOrder,
      })),
  };
}

export function toApiCategories(categories: Category[]): ApiCategory[] {
  return categories
    .filter((c) => c.slug !== "general")
    .map((c) => ({ key: c.slug, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export { NEUTRAL_PALETTE };
