/** Fixed storefront categories — keep in sync with admin UI. */
export const CATALOG_CATEGORIES = [
  { name: "Superheroes", slug: "superheroes" },
  { name: "Anime", slug: "anime" },
  { name: "Actors", slug: "actors" },
  { name: "Sports", slug: "sports" },
  { name: "Cars and Bikes", slug: "cars-and-bikes" },
  { name: "Motivational", slug: "motivational" },
  { name: "Aesthetic", slug: "aesthetic" },
  { name: "TV Shows", slug: "tv-shows" },
] as const;

export type CatalogCategorySlug =
  (typeof CATALOG_CATEGORIES)[number]["slug"];

export function isCatalogCategorySlug(
  slug: string,
): slug is CatalogCategorySlug {
  return CATALOG_CATEGORIES.some((c) => c.slug === slug);
}
