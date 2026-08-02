import { prisma } from "./prisma.js";
import {
  SIZE_PRICE,
  DEFAULT_COMBO_SETTINGS,
  type PosterSize,
  type ComboSettings,
  type SizePriceMap,
} from "./pricing.js";

const SETTINGS_ID = "global";

export const DEFAULT_SIZE_PRICE: SizePriceMap = {
  A4: SIZE_PRICE.A4,
  A5: SIZE_PRICE.A5,
  A6: SIZE_PRICE.A6,
};

export type FullPricingSettings = SizePriceMap & ComboSettings;

function fromRow(settings: {
  priceA4: number;
  priceA5: number;
  priceA6: number;
  shippingThreshold?: number | null;
  shippingCharge?: number | null;
  freeA6Threshold?: number | null;
  comboMixed?: number | null;
  comboMini?: number | null;
  a4Pack2?: number | null;
  a4Pack3?: number | null;
}): FullPricingSettings {
  return {
    A4: settings.priceA4,
    A5: settings.priceA5,
    A6: settings.priceA6,
    shippingThreshold:
      settings.shippingThreshold ?? DEFAULT_COMBO_SETTINGS.shippingThreshold,
    shippingCharge:
      settings.shippingCharge ?? DEFAULT_COMBO_SETTINGS.shippingCharge,
    freeA6Threshold:
      settings.freeA6Threshold ?? DEFAULT_COMBO_SETTINGS.freeA6Threshold,
    comboMixed: settings.comboMixed ?? DEFAULT_COMBO_SETTINGS.comboMixed,
    comboMini: settings.comboMini ?? DEFAULT_COMBO_SETTINGS.comboMini,
    a4Pack2: settings.a4Pack2 ?? DEFAULT_COMBO_SETTINGS.a4Pack2,
    a4Pack3: settings.a4Pack3 ?? DEFAULT_COMBO_SETTINGS.a4Pack3,
  };
}

export async function getFullPricingSettings(): Promise<FullPricingSettings> {
  const settings = await prisma.pricingSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) {
    return { ...DEFAULT_SIZE_PRICE, ...DEFAULT_COMBO_SETTINGS };
  }
  return fromRow(settings);
}

export async function getSizePriceMap(): Promise<SizePriceMap> {
  const full = await getFullPricingSettings();
  return { A4: full.A4, A5: full.A5, A6: full.A6 };
}

export async function getComboSettings(): Promise<ComboSettings> {
  const full = await getFullPricingSettings();
  return {
    shippingThreshold: full.shippingThreshold,
    shippingCharge: full.shippingCharge,
    freeA6Threshold: full.freeA6Threshold,
    comboMixed: full.comboMixed,
    comboMini: full.comboMini,
    a4Pack2: full.a4Pack2,
    a4Pack3: full.a4Pack3,
  };
}

export async function saveFullPricingSettings(
  input: Partial<FullPricingSettings>,
): Promise<FullPricingSettings> {
  const current = await getFullPricingSettings();
  const next: FullPricingSettings = {
    A4: input.A4 ?? current.A4,
    A5: input.A5 ?? current.A5,
    A6: input.A6 ?? current.A6,
    shippingThreshold: input.shippingThreshold ?? current.shippingThreshold,
    shippingCharge: input.shippingCharge ?? current.shippingCharge,
    freeA6Threshold: input.freeA6Threshold ?? current.freeA6Threshold,
    comboMixed: input.comboMixed ?? current.comboMixed,
    comboMini: input.comboMini ?? current.comboMini,
    a4Pack2: input.a4Pack2 ?? current.a4Pack2,
    a4Pack3: input.a4Pack3 ?? current.a4Pack3,
  };

  const saved = await prisma.pricingSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {
      priceA4: next.A4,
      priceA5: next.A5,
      priceA6: next.A6,
      shippingThreshold: next.shippingThreshold,
      shippingCharge: next.shippingCharge,
      freeA6Threshold: next.freeA6Threshold,
      comboMixed: next.comboMixed,
      comboMini: next.comboMini,
      a4Pack2: next.a4Pack2,
      a4Pack3: next.a4Pack3,
    },
    create: {
      id: SETTINGS_ID,
      priceA4: next.A4,
      priceA5: next.A5,
      priceA6: next.A6,
      shippingThreshold: next.shippingThreshold,
      shippingCharge: next.shippingCharge,
      freeA6Threshold: next.freeA6Threshold,
      comboMixed: next.comboMixed,
      comboMini: next.comboMini,
      a4Pack2: next.a4Pack2,
      a4Pack3: next.a4Pack3,
    },
  });

  return fromRow(saved);
}

/** @deprecated use saveFullPricingSettings */
export async function saveSizePriceMap(
  prices: SizePriceMap,
): Promise<SizePriceMap> {
  const saved = await saveFullPricingSettings(prices);
  return { A4: saved.A4, A5: saved.A5, A6: saved.A6 };
}

export type { PosterSize, SizePriceMap };
