import { prisma } from "./prisma.js";
import { SIZE_PRICE, type PosterSize } from "./pricing.js";

const SETTINGS_ID = "global";

export type SizePriceMap = Record<PosterSize, number>;

export const DEFAULT_SIZE_PRICE: SizePriceMap = {
  A4: SIZE_PRICE.A4,
  A5: SIZE_PRICE.A5,
  A6: SIZE_PRICE.A6,
};

export async function getSizePriceMap(): Promise<SizePriceMap> {
  const settings = await prisma.pricingSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) return DEFAULT_SIZE_PRICE;
  return {
    A4: settings.priceA4,
    A5: settings.priceA5,
    A6: settings.priceA6,
  };
}

export async function saveSizePriceMap(
  prices: SizePriceMap,
): Promise<SizePriceMap> {
  const saved = await prisma.pricingSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {
      priceA4: prices.A4,
      priceA5: prices.A5,
      priceA6: prices.A6,
    },
    create: {
      id: SETTINGS_ID,
      priceA4: prices.A4,
      priceA5: prices.A5,
      priceA6: prices.A6,
    },
  });

  return {
    A4: saved.priceA4,
    A5: saved.priceA5,
    A6: saved.priceA6,
  };
}
