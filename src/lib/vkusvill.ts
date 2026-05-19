/**
 * ВкусВилл label generator — domain logic.
 *
 * The retailer ВкусВилл requires a custom 14-digit CODE128 barcode that
 * encodes the production date as MMDD (NOT DDMM) appended to a 10-digit
 * product prefix. The human-readable date on the label is still printed
 * as DD.MM.YYYY — only the barcode reverses MM/DD.
 *
 * Source: separate single-page app maintained for ВкусВилл at
 *   shk.vkusvill / 192.168.242.111 (Downloads/Vkusvill in the company
 *   workspace). The rule lives in app.js → buildCode().
 *
 * This module exposes the rule + a product catalogue and a function to
 * synthesise a "Product"-shaped object that /api/render can render
 * through the normal 70×90 mm pipeline.
 */
export type VkusvillProductConfig = {
  /** Stable id for select dropdown / cache keys. */
  id: string;
  /** 10-digit prefix that prefixes the date in the CODE128 barcode. */
  prefix: string;
  /** Human-readable product name printed on the label. */
  name: string;
  /** ВкусВилл internal article — printed on the label as a big SKU number,
   *  same slot the standard Rezograf labels use for their SKU. */
  sku: string;
  /** Net weight string (printed below the name, e.g. "100 г"). */
  weight: string;
  /** Shelf life in months — used to compute «Годен до» from the mfg date. */
  shelfLifeMonths: number;
  /** Optional storage condition / composition / nutritional info. */
  storageCond?: string;
  composition?: string;
  nutritionalInfo?: string;
  /** State standard / TU / СТО reference printed as a separate row. Most
   *  ВкусВилл SKUs ship under a СТО code; this is what BarTender used to
   *  put on the label as a small line below the storage block. */
  certCode?: string;
  /** Manufacturer block override; defaults to the standard Sibirsky Kedr text. */
  manufacturer?: string;
};

export const VKUSVILL_PRODUCTS: VkusvillProductConfig[] = [
  {
    id: "orehi-kedrovye-100",
    prefix: "8536000010",
    name: "Орехи кедровые очищенные",
    sku: "6509",
    weight: "100 г",
    shelfLifeMonths: 12,
    composition: "Ядро кедрового ореха",
    storageCond:
      "Хранить при температуре от +4 до +20 °С и относительной влажности воздуха не более 75%.",
    certCode: "СТО 97585510-049-2022",
  },
];

/**
 * Build the 14-digit ВкусВилл CODE128 barcode for the given production date.
 * Format: PREFIX(10) + MM(2) + DD(2). Month first, day second — confirmed
 * by ВкусВилл's intake system.
 */
export function buildVkusvillBarcode(date: Date, prefix: string): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${prefix}${mm}${dd}`;
}

/**
 * Add `months` to the given date, clamping the day to the last day of the
 * resulting month so e.g. 31 March + 1 month doesn't roll over to 1 May.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setDate(1);
  d.setMonth(targetMonth);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), daysInTarget));
  return d;
}

/**
 * Format a Date as DD.MM.YYYY for the human-readable label fields.
 */
export function formatLabelDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * Build a Product-shaped object ready to hand to /api/render via the
 * `productOverride` body field. The render route treats this exactly
 * like a DB-loaded product — none of these fields require DB ids.
 *
 * Mirrors the Product schema in prisma/schema.prisma. Extra fields the
 * renderer doesn't consume (createdAt, updatedAt, …) are left out.
 */
export function buildVkusvillRenderProduct(
  cfg: VkusvillProductConfig,
  mfgDate: Date,
) {
  return {
    id: `vkusvill-${cfg.id}`,
    name: cfg.name,
    sku: cfg.sku,
    sku2: null,
    composition: cfg.composition ?? null,
    weight: cfg.weight,
    nutritionalInfo: cfg.nutritionalInfo ?? null,
    storageCond: cfg.storageCond ?? null,
    barcodeEan13: buildVkusvillBarcode(mfgDate, cfg.prefix),
    btwFilePath: null,
    certCode: cfg.certCode ?? null,
    quantity: null,
    boxWeight: null,
    sponsorText: null,
    manufacturer: cfg.manufacturer ?? null,
    extraText: null,
    isExport: false,
    templateId: null,
    template: null,
    category: null,
    subcategory: null,
  };
}
