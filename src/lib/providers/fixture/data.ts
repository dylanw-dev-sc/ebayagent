/**
 * FIXTURE DATA — synthetic sample listings for development, demos and tests.
 *
 * These are NOT real eBay listings. Titles, prices and item specifics are
 * invented to exercise the matching and pricing engines (aliases, brand-family
 * traps, size equivalents, faux materials, unknown shipping, duplicates…).
 * Prices are arbitrary test values, not market data. Fixture listings have no
 * eBay URL and are labeled "Fixture" everywhere in the UI.
 */

export type FixtureGarment = "tee" | "polo" | "shirt" | "jacket" | "blazer" | "coat";

export type FixtureShipping = { type: "free" } | { type: "fixed"; cost: string } | { type: "calculated" } | { type: "none" };

export interface FixtureItem {
  id: string;
  /** Scan "batch" in which this item first becomes visible (simulates new listings over time). */
  batch: number;
  title: string;
  ebayCategoryId: string;
  garment: FixtureGarment;
  color: string;
  price: string;
  currency?: string;
  shipping: FixtureShipping;
  conditionId: string;
  condition: string;
  /** Hours before the scan time that the item was "listed" (fixture timestamps are relative to each scan). */
  hoursAgo: number;
  auction?: boolean;
  /** Item specifics returned only by the detail call (like eBay getItem). */
  details?: { brand?: string; size?: string; sizeType?: string; material?: string; other?: Array<[string, string]> };
  /** Seller description, returned only by the detail call (like eBay getItem). */
  description?: string;
  /** Text printed on a care-label photo (rendered as an extra sample image; never read by the app). */
  labelText?: string;
  /** Later changes (e.g. a price drop) applied from a given batch onward. */
  revisions?: Array<{ batch: number; price?: string; shipping?: FixtureShipping }>;
}

const T = "15687"; // Men's T-Shirts
const P = "185101"; // Men's Polos
const CB = "57990"; // Men's Casual Button-Down Shirts
const D = "57991"; // Men's Dress Shirts
const J = "57988"; // Men's Coats, Jackets & Vests
const S = "3001"; // Men's Suits & Suit Separates (blazers, sport coats)

const NWT = { conditionId: "1000", condition: "New with tags" };
const NWOT = { conditionId: "1500", condition: "New without tags" };
const DEFECT = { conditionId: "1750", condition: "New with defects" };
const EXC = { conditionId: "2990", condition: "Pre-owned - Excellent" };
const GOOD = { conditionId: "3000", condition: "Pre-owned - Good" };
const FAIR = { conditionId: "3010", condition: "Pre-owned - Fair" };

export const FIXTURE_ITEMS: FixtureItem[] = [
  // ---------------------------------------------------------------- Shirts (T-shirts & polos)
  { id: "FX-101", batch: 1, title: "Sunspel Classic Crew Neck T-Shirt Navy Size L", ebayCategoryId: T, garment: "tee", color: "#2b3a55", price: "38.00", shipping: { type: "fixed", cost: "5.00" }, ...NWT, hoursAgo: 3, details: { brand: "Sunspel", size: "L", material: "100% Cotton" }, revisions: [{ batch: 2, price: "32.00" }] },
  { id: "FX-102", batch: 1, title: "John Smedley Knitted Polo Shirt Mens XL Navy", ebayCategoryId: P, garment: "polo", color: "#1f2a3c", price: "95.00", shipping: { type: "free" }, ...EXC, hoursAgo: 5, details: { brand: "John Smedley", size: "XL", material: "100% Merino Wool" } },
  { id: "FX-103", batch: 1, title: "Brunello Cucinelli Crew Neck Tee Grey Size L", ebayCategoryId: T, garment: "tee", color: "#9a9a96", price: "145.00", shipping: { type: "fixed", cost: "8.00" }, ...GOOD, hoursAgo: 7, details: { brand: "Brunello Cucinelli", size: "L" }, description: "Great condition, worn twice. Measurements in photos. Smoke-free home.", labelText: "100% COTTON|MADE IN ITALY" },
  { id: "FX-104", batch: 1, title: "Loro Piana Polo Shirt Size Large Ivory", ebayCategoryId: P, garment: "polo", color: "#e8e0cf", price: "210.00", shipping: { type: "free" }, ...EXC, hoursAgo: 9, details: { brand: "Loro Piana", size: "L", material: "70% Cotton 30% Silk" } },
  // Keyword search for "Ralph Lauren Purple Label" returns this (all four words appear), but it is Black Label in purple — phrase matching rejects it.
  { id: "FX-105", batch: 1, title: "Ralph Lauren Black Label Purple Dress Shirt Size L", ebayCategoryId: D, garment: "shirt", color: "#5b3f78", price: "64.00", shipping: { type: "fixed", cost: "6.00" }, ...GOOD, hoursAgo: 4, details: { brand: "Ralph Lauren Black Label", size: "L", material: "100% Cotton" } },
  { id: "FX-106", batch: 1, title: "Ralph Lauren Purple Label Pique Polo Shirt Made in Italy XL", ebayCategoryId: P, garment: "polo", color: "#4a3b6b", price: "120.00", shipping: { type: "fixed", cost: "7.50" }, ...EXC, hoursAgo: 12, details: { brand: "Ralph Lauren Purple Label", size: "XL", material: "100% Cotton" } },
  // Not returned by a "Ralph Lauren Purple Label" keyword search; kept for direct matcher tests.
  { id: "FX-107", batch: 1, title: "The North Face Purple Label Field Polo Shirt Size L", ebayCategoryId: P, garment: "polo", color: "#6b6f4a", price: "55.00", shipping: { type: "free" }, ...GOOD, hoursAgo: 14, details: { brand: "The North Face", size: "L", material: "Cotton/Polyester" } },
  { id: "FX-108", batch: 1, title: "Tom Ford Henley T-Shirt Size M", ebayCategoryId: T, garment: "tee", color: "#151515", price: "130.00", shipping: { type: "free" }, ...NWOT, hoursAgo: 16, details: { brand: "Tom Ford", size: "M", material: "Lyocell" } },
  { id: "FX-109", batch: 1, title: "Acne Studios Logo Print T-Shirt Size XL", ebayCategoryId: T, garment: "tee", color: "#d9c7b8", price: "48.00", shipping: { type: "fixed", cost: "6.00" }, ...GOOD, hoursAgo: 18, details: { brand: "Acne Studios", size: "XL", material: "65% Polyester 35% Cotton" } },
  { id: "FX-110", batch: 1, title: "Golden Bear Jack Nicklaus Golf Polo Shirt XL", ebayCategoryId: P, garment: "polo", color: "#b8a24a", price: "18.00", shipping: { type: "fixed", cost: "5.00" }, ...GOOD, hoursAgo: 20, details: { brand: "Golden Bear", size: "XL", material: "100% Polyester" } },
  { id: "FX-111", batch: 1, title: "Norse Projects Niels Standard Tee Size Large", ebayCategoryId: T, garment: "tee", color: "#7f8f86", price: "35.00", shipping: { type: "fixed", cost: "5.50" }, ...EXC, hoursAgo: 22, labelText: "100% ORGANIC COTTON|MADE IN PORTUGAL" },
  { id: "FX-112", batch: 1, title: "Drake's Jersey Pocket T-Shirt L", ebayCategoryId: T, garment: "tee", color: "#c9b48f", price: "45.00", shipping: { type: "calculated" }, ...EXC, hoursAgo: 25, details: { brand: "Drake's", size: "L", material: "100% Cotton" } },
  { id: "FX-113", batch: 1, title: "Sunspel Riviera Polo Shirt Size Large Tall", ebayCategoryId: P, garment: "polo", color: "#f0efe9", price: "52.00", shipping: { type: "free" }, ...GOOD, hoursAgo: 27, details: { brand: "Sunspel", size: "L", sizeType: "Tall", material: "100% Cotton" } },
  { id: "FX-114", batch: 1, title: "A.P.C. Jimmy T-Shirt White Size XL", ebayCategoryId: T, garment: "tee", color: "#f4f3ee", price: "40.00", shipping: { type: "none" }, ...NWT, hoursAgo: 30, details: { brand: "A.P.C.", size: "XL", material: "100% Cotton" } },

  // ---------------------------------------------------------------- Button-down shirts
  { id: "FX-201", batch: 1, title: "Kiton Napoli Handmade Button Down Shirt Size L", ebayCategoryId: CB, garment: "shirt", color: "#a9c4dd", price: "185.00", shipping: { type: "free" }, ...EXC, hoursAgo: 2, details: { brand: "Kiton", size: "L", material: "100% Linen" } },
  { id: "FX-202", batch: 1, title: "Finamore Napoli Dress Shirt 16.5 / 35", ebayCategoryId: D, garment: "shirt", color: "#dfe9f2", price: "75.00", shipping: { type: "fixed", cost: "6.00" }, ...EXC, hoursAgo: 6, details: { brand: "Finamore", size: "16.5/35", material: "100% Cotton" } },
  { id: "FX-203", batch: 1, title: "Gitman Vintage Oxford Cloth Button Down Shirt Large Made in USA", ebayCategoryId: CB, garment: "shirt", color: "#c5d6e6", price: "62.00", shipping: { type: "fixed", cost: "5.00" }, ...GOOD, hoursAgo: 8, details: { brand: "Gitman Vintage", size: "L", material: "100% Cotton" } },
  { id: "FX-204", batch: 1, title: "Eton Contemporary Fit Twill Dress Shirt Size XL", ebayCategoryId: D, garment: "shirt", color: "#ffffff", price: "58.00", shipping: { type: "free" }, ...NWOT, hoursAgo: 10, details: { brand: "Eton", size: "XL", material: "100% Cotton" } },
  { id: "FX-205", batch: 1, title: "Isaia Button Down Sport Shirt Blue Check", ebayCategoryId: CB, garment: "shirt", color: "#5b7fa6", price: "95.00", shipping: { type: "fixed", cost: "8.00" }, ...GOOD, hoursAgo: 11, details: { brand: "Isaia", material: "Cotton" } },
  { id: "FX-206", batch: 1, title: "Officine Generale Benoit Shirt Japanese Cotton Size L", ebayCategoryId: CB, garment: "shirt", color: "#8c9a7e", price: "88.00", shipping: { type: "fixed", cost: "6.00" }, ...EXC, hoursAgo: 13, details: { brand: "Officine Générale", size: "L", material: "100% Cotton" } },
  { id: "FX-207", batch: 1, title: "Todd Snyder Camp Collar Shirt XXL", ebayCategoryId: CB, garment: "shirt", color: "#c96f4a", price: "49.00", shipping: { type: "free" }, ...GOOD, hoursAgo: 15, details: { brand: "Todd Snyder", size: "XXL", material: "Silk/Linen" } },
  { id: "FX-208", batch: 1, title: "Saint Laurent Paris Western Shirt Size 40", ebayCategoryId: CB, garment: "shirt", color: "#3c2f2f", price: "260.00", shipping: { type: "fixed", cost: "12.00" }, ...EXC, hoursAgo: 17, details: { brand: "Saint Laurent", size: "40", material: "100% Cotton" } },
  { id: "FX-209", batch: 1, title: "Zegna Button Up Shirt Size L Light Blue", ebayCategoryId: CB, garment: "shirt", color: "#b9d0e6", price: "70.00", shipping: { type: "fixed", cost: "6.00" }, ...EXC, hoursAgo: 19, details: { brand: "Ermenegildo Zegna", size: "L", material: "100% Cotton" } },
  { id: "FX-210", batch: 1, title: "Z Zegna Slim Fit Button Down Shirt L", ebayCategoryId: CB, garment: "shirt", color: "#e3e7ea", price: "29.00", shipping: { type: "fixed", cost: "5.00" }, ...GOOD, hoursAgo: 21, details: { brand: "Z Zegna", size: "L", material: "100% Cotton" } },
  { id: "FX-211", batch: 1, title: "RRL Double RL Indigo Chambray Work Shirt Size L", ebayCategoryId: CB, garment: "shirt", color: "#3e5a7a", price: "125.00", shipping: { type: "fixed", cost: "9.00" }, ...EXC, hoursAgo: 23, details: { brand: "RRL", size: "L", material: "100% Cotton" } },
  // Fabric appears only in the description; "poly mailer" and "other cashmere sweaters" must not count.
  { id: "FX-213", batch: 1, title: "Boglioli Button Down Shirt Size XL Navy", ebayCategoryId: CB, garment: "shirt", color: "#2f3d55", price: "68.00", shipping: { type: "fixed", cost: "6.00" }, ...EXC, hoursAgo: 27, details: { brand: "Boglioli", size: "XL" }, description: "Pre-owned Boglioli shirt in excellent condition, no flaws. Fabric: 100% linen. Ships in a poly mailer. Check out my other cashmere sweaters!" },
  { id: "FX-212", batch: 1, title: "Brunello Cucinelli Slim Fit Button Down Shirt L", ebayCategoryId: CB, garment: "shirt", color: "#e9e4d8", price: "160.00", shipping: { type: "free" }, ...EXC, hoursAgo: 26, details: { brand: "Brunello Cucinelli", size: "L", material: "Cotton" } },

  // ---------------------------------------------------------------- Jackets & outerwear
  { id: "FX-301", batch: 1, title: "Valstar Valstarino Suede Bomber Jacket Size IT 54", ebayCategoryId: J, garment: "coat", color: "#8a5a3c", price: "340.00", shipping: { type: "fixed", cost: "15.00" }, ...EXC, hoursAgo: 1, details: { brand: "Valstar", size: "IT 54", material: "100% Suede" } },
  { id: "FX-302", batch: 1, title: "Isaia Sport Coat 44R Brown Herringbone", ebayCategoryId: S, garment: "blazer", color: "#6e5a46", price: "650.00", shipping: { type: "free" }, ...EXC, hoursAgo: 4, details: { brand: "Isaia", size: "44", sizeType: "Regular", material: "90% Wool 10% Cashmere" } },
  { id: "FX-303", batch: 1, title: "Boglioli K Jacket Unstructured Blazer 40R", ebayCategoryId: S, garment: "blazer", color: "#3f4e5e", price: "220.00", shipping: { type: "fixed", cost: "12.00" }, ...GOOD, hoursAgo: 6, details: { brand: "Boglioli", size: "40R", material: "100% Wool" } },
  { id: "FX-304", batch: 1, title: "Belstaff Trialmaster Waxed Jacket Size XL", ebayCategoryId: J, garment: "coat", color: "#4b4a3a", price: "280.00", shipping: { type: "fixed", cost: "14.00" }, ...GOOD, hoursAgo: 8, details: { brand: "Belstaff", size: "XL", material: "100% Cotton" } },
  { id: "FX-305", batch: 1, title: "Schott NYC 613 Perfecto Motorcycle Jacket 44", ebayCategoryId: J, garment: "coat", color: "#1b1b1b", price: "395.00", shipping: { type: "fixed", cost: "20.00" }, ...EXC, hoursAgo: 10, details: { brand: "Schott", size: "44", material: "Leather" } },
  { id: "FX-306", batch: 1, title: "Herno Down Puffer Jacket Size 54", ebayCategoryId: J, garment: "coat", color: "#2c3e50", price: "310.00", shipping: { type: "free" }, ...EXC, hoursAgo: 12, details: { brand: "Herno", size: "54", material: "100% Polyamide" } },
  { id: "FX-307", batch: 1, title: "Suitsupply Lazio Blazer in Loro Piana Wool 44R", ebayCategoryId: S, garment: "blazer", color: "#4d5866", price: "140.00", shipping: { type: "fixed", cost: "12.00" }, ...EXC, hoursAgo: 14, details: { brand: "Suitsupply", size: "44R", material: "100% Wool" } },
  { id: "FX-308", batch: 1, title: "Valstar for Todd Snyder Suede Field Jacket 44R", ebayCategoryId: J, garment: "coat", color: "#9c7a54", price: "420.00", shipping: { type: "free" }, ...EXC, hoursAgo: 16, details: { brand: "Valstar", size: "44R", material: "100% Suede" } },
  { id: "FX-309", batch: 1, title: "Private White V.C. Ventile Harrington Jacket 44R Made in England", ebayCategoryId: J, garment: "coat", color: "#56604b", price: "330.00", shipping: { type: "fixed", cost: "15.00" }, ...NWOT, hoursAgo: 18, details: { brand: "Private White V.C.", size: "44R", material: "100% Cotton" } },
  { id: "FX-310", batch: 1, title: "Baracuta G9 Harrington Jacket Navy 44 Long", ebayCategoryId: J, garment: "coat", color: "#22304a", price: "120.00", shipping: { type: "fixed", cost: "10.00" }, ...GOOD, hoursAgo: 20, details: { brand: "Baracuta", size: "44L", material: "Cotton/Polyester" } },
  { id: "FX-311", batch: 1, title: "Kiton Cashmere Sport Coat 44 Regular Faux Suede Elbow Patches", ebayCategoryId: S, garment: "blazer", color: "#7b6a58", price: "890.00", shipping: { type: "free" }, ...EXC, hoursAgo: 22, details: { brand: "Kiton", size: "44 Regular", material: "100% Cashmere" } },
  { id: "FX-312", batch: 1, title: "Dehen 1920 Varsity Jacket Wool Leather Sleeves 44R", ebayCategoryId: J, garment: "coat", color: "#5a1f24", price: "290.00", shipping: { type: "fixed", cost: "15.00" }, ...EXC, hoursAgo: 24, details: { brand: "Dehen", size: "44R", material: "Wool / Leather" } },
  { id: "FX-313", batch: 1, title: "Aspesi Field Jacket Size XL Olive", ebayCategoryId: J, garment: "coat", color: "#5f6648", price: "160.00", shipping: { type: "fixed", cost: "12.00" }, ...GOOD, hoursAgo: 26, details: { brand: "Aspesi", size: "XL", material: "100% Polyester" } },
  { id: "FX-314", batch: 1, title: "Herno Suede-Look Bomber Jacket 44R", ebayCategoryId: J, garment: "coat", color: "#a08060", price: "150.00", shipping: { type: "free" }, ...GOOD, hoursAgo: 28, details: { brand: "Herno", size: "44R", material: "Microsuede" } },
  { id: "FX-315", batch: 1, title: "Berluti Lambskin Leather Jacket 44R", ebayCategoryId: J, garment: "coat", color: "#3b2a22", price: "1150.00", shipping: { type: "free" }, ...DEFECT, hoursAgo: 30, details: { brand: "Berluti", size: "44R", material: "Lambskin Leather" } },
  { id: "FX-316", batch: 1, title: "Corneliani Wool Sport Coat 44R Charcoal", ebayCategoryId: S, garment: "blazer", color: "#3a3d42", price: "180.00", currency: "EUR", shipping: { type: "fixed", cost: "25.00" }, ...EXC, hoursAgo: 32, details: { brand: "Corneliani", size: "44R", material: "100% Wool" } },
  { id: "FX-317", batch: 1, title: "Incotex Wool Trousers Size 34", ebayCategoryId: S, garment: "blazer", color: "#59574f", price: "65.00", shipping: { type: "fixed", cost: "8.00" }, ...GOOD, hoursAgo: 34, details: { brand: "Incotex", size: "34", material: "100% Wool" } },
  { id: "FX-318", batch: 1, title: "Boglioli Linen Blazer 44R Unstructured", ebayCategoryId: S, garment: "blazer", color: "#c8b994", price: "90.00", shipping: { type: "fixed", cost: "12.00" }, ...GOOD, hoursAgo: 36, auction: true, details: { brand: "Boglioli", size: "44R", material: "100% Linen" } },
  { id: "FX-319", batch: 1, title: "Barena Venezia Overshirt Jacket Size 54", ebayCategoryId: J, garment: "coat", color: "#6d5f4b", price: "135.00", shipping: { type: "fixed", cost: "11.00" }, ...FAIR, hoursAgo: 38, details: { brand: "Barena", size: "54", material: "100% Wool" } },
  { id: "FX-320", batch: 1, title: "Golden Bear Sportswear Varsity Jacket 44R Made in USA", ebayCategoryId: J, garment: "coat", color: "#1d3b2a", price: "210.00", shipping: { type: "fixed", cost: "14.00" }, ...EXC, hoursAgo: 40, details: { brand: "Golden Bear", size: "44R", material: "Wool / Leather" } },

  // ---------------------------------------------------------------- Batch 2 (appear on the second fixture scan)
  { id: "FX-401", batch: 2, title: "Loro Piana Cashmere Bomber Jacket 44R", ebayCategoryId: J, garment: "coat", color: "#8b7d6b", price: "1250.00", shipping: { type: "free" }, ...EXC, hoursAgo: 2, details: { brand: "Loro Piana", size: "44R", material: "100% Cashmere" } },
  { id: "FX-402", batch: 2, title: "Sunspel Merino Wool Crew Neck T-Shirt XL", ebayCategoryId: T, garment: "tee", color: "#46505a", price: "42.00", shipping: { type: "fixed", cost: "5.00" }, ...NWOT, hoursAgo: 3, details: { brand: "Sunspel", size: "XL", material: "100% Merino Wool" } },
  { id: "FX-403", batch: 2, title: "AMI Paris Ami de Coeur T-Shirt Size L", ebayCategoryId: T, garment: "tee", color: "#f2efe8", price: "55.00", shipping: { type: "fixed", cost: "6.00" }, ...EXC, hoursAgo: 4, details: { brand: "AMI Paris", size: "L", material: "100% Cotton" } },

  // ---------------------------------------------------------------- Batch 3
  { id: "FX-501", batch: 3, title: "Brunello Cucinelli Suede Bomber Jacket 44R", ebayCategoryId: J, garment: "coat", color: "#7a5b40", price: "980.00", shipping: { type: "free" }, ...EXC, hoursAgo: 1, details: { brand: "Brunello Cucinelli", size: "44R", material: "100% Suede" } },
  { id: "FX-502", batch: 3, title: "Drakes Brushed Cotton Button Down Shirt XL", ebayCategoryId: CB, garment: "shirt", color: "#b5a27f", price: "95.00", shipping: { type: "fixed", cost: "7.00" }, ...GOOD, hoursAgo: 2, details: { brand: "Drake's", size: "XL", material: "100% Cotton" } },
];

export const FIXTURE_MAX_BATCH = Math.max(...FIXTURE_ITEMS.map((i) => i.batch));
