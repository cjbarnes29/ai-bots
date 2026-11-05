/**
 * Markets and business categories for the Business Workforce.
 *
 * A market is plain data: adding a country is adding an entry here, not changing code. The UAE is the first one.
 * Region and category names are looked up in these fixed tables, so nothing a user or an agent types is ever placed into a
 * search query unchecked.
 */
export interface Region {
  id: string;
  name: string;
  /** The ISO 3166-2 code the map data uses for this area. */
  iso: string;
  aliases: string[];
}

export interface Market {
  code: string;
  name: string;
  /** ISO 3166-1 alpha-2, used to select the whole country. */
  countryIso: string;
  regions: Region[];
  languages: string[];
  phonePrefix: string;
  /** What a proposal is written in for this market. */
  proposalLanguage: "en";
  /** A reminder shown to the owner. Not legal advice. */
  regulatoryNote: string;
}

export const UAE: Market = {
  code: "AE",
  name: "United Arab Emirates",
  countryIso: "AE",
  regions: [
    { id: "abu-dhabi", name: "Abu Dhabi", iso: "AE-AZ", aliases: ["abudhabi", "abu dhabi", "auh"] },
    { id: "dubai", name: "Dubai", iso: "AE-DU", aliases: ["dxb"] },
    { id: "sharjah", name: "Sharjah", iso: "AE-SH", aliases: ["shj"] },
    { id: "ajman", name: "Ajman", iso: "AE-AJ", aliases: [] },
    { id: "umm-al-quwain", name: "Umm Al Quwain", iso: "AE-UQ", aliases: ["uaq", "umm al quwain"] },
    { id: "ras-al-khaimah", name: "Ras Al Khaimah", iso: "AE-RK", aliases: ["rak", "ras al khaimah"] },
    { id: "fujairah", name: "Fujairah", iso: "AE-FU", aliases: ["fuj"] },
  ],
  languages: ["en", "ar"],
  phonePrefix: "+971",
  proposalLanguage: "en",
  regulatoryNote:
    "Business contact details come from public map data. Before contacting anyone, check the UAE personal-data law (PDPL) and the telecom regulator's rules on unsolicited marketing. This tool never contacts anyone by itself.",
};

export const MARKETS: Record<string, Market> = { [UAE.code]: UAE };

/** Names a model naturally writes for the country code (seen in the first real run: "uae"). They mean the same market. */
const MARKET_ALIASES: Record<string, string> = { UAE: "AE", "UNITED ARAB EMIRATES": "AE", EMIRATES: "AE", "U.A.E.": "AE" };

export function getMarket(code: string): Market {
  const key = code.trim().toUpperCase();
  const m = MARKETS[MARKET_ALIASES[key] ?? key];
  if (!m) throw new Error(`Unknown market "${code}". Known markets: ${Object.keys(MARKETS).join(", ")}.`);
  return m;
}

/** null means the whole country. Throws a plain message for a name that is not in the table. */
export function resolveRegion(market: Market, input: string | undefined | null): Region | null {
  const wanted = (input ?? "").trim().toLowerCase();
  if (wanted === "" || wanted === "all" || wanted === "uae" || wanted === "country") return null;
  const hit = market.regions.find((r) => r.id === wanted || r.name.toLowerCase() === wanted || r.aliases.includes(wanted) || r.iso.toLowerCase() === wanted);
  if (!hit) throw new Error(`Unknown region "${input}" for ${market.name}. Use one of: ${market.regions.map((r) => r.name).join(", ")} (or leave it empty for the whole country).`);
  return hit;
}

/** A map-data tag, written key then value, from a fixed list (letters and underscores only). */
export type MapTag = readonly [key: string, value: string];

export interface Category {
  id: string;
  label: string;
  tags: MapTag[];
}

/** "All small businesses": a broad, fixed set of everyday business types. Each maps to map-data tags. */
export const CATEGORIES: Category[] = [
  { id: "food", label: "Restaurants, cafes and takeaways", tags: [["amenity", "restaurant"], ["amenity", "cafe"], ["amenity", "fast_food"], ["shop", "bakery"], ["shop", "confectionery"]] },
  { id: "beauty", label: "Salons, barbers and beauty", tags: [["shop", "hairdresser"], ["shop", "beauty"], ["shop", "massage"]] },
  { id: "health", label: "Clinics, dentists and pharmacies", tags: [["amenity", "dentist"], ["amenity", "clinic"], ["amenity", "doctors"], ["amenity", "pharmacy"]] },
  { id: "fitness", label: "Gyms and fitness", tags: [["leisure", "fitness_centre"], ["leisure", "sports_centre"]] },
  { id: "auto", label: "Car repair, tyres and car wash", tags: [["shop", "car_repair"], ["shop", "tyres"], ["amenity", "car_wash"], ["shop", "car"]] },
  { id: "fashion", label: "Clothing, shoes and accessories", tags: [["shop", "clothes"], ["shop", "shoes"], ["shop", "jewelry"], ["shop", "bag"], ["shop", "tailor"]] },
  { id: "electronics", label: "Electronics and mobile phones", tags: [["shop", "electronics"], ["shop", "mobile_phone"], ["shop", "computer"]] },
  { id: "home", label: "Furniture, home and hardware", tags: [["shop", "furniture"], ["shop", "doityourself"], ["shop", "hardware"], ["shop", "interior_decoration"]] },
  { id: "grocery", label: "Grocery and convenience", tags: [["shop", "convenience"], ["shop", "greengrocer"], ["shop", "butcher"]] },
  { id: "gifts", label: "Gifts, flowers and stationery", tags: [["shop", "gift"], ["shop", "florist"], ["shop", "stationery"], ["shop", "books"]] },
  { id: "realestate", label: "Real estate agencies", tags: [["office", "estate_agent"]] },
  { id: "professional", label: "Law, accounting and consulting", tags: [["office", "lawyer"], ["office", "accountant"], ["office", "consulting"], ["office", "insurance"]] },
  { id: "education", label: "Schools, training and tutoring", tags: [["amenity", "language_school"], ["amenity", "driving_school"], ["amenity", "music_school"], ["amenity", "kindergarten"], ["amenity", "training"]] },
  { id: "travel", label: "Travel agencies and tour operators", tags: [["shop", "travel_agency"], ["office", "travel_agent"]] },
  { id: "trades", label: "Contractors and trades", tags: [["craft", "carpenter"], ["craft", "electrician"], ["craft", "plumber"], ["craft", "painter"], ["office", "construction_company"]] },
  { id: "cleaning", label: "Laundry and cleaning", tags: [["shop", "laundry"], ["shop", "dry_cleaning"], ["office", "cleaning"]] },
  { id: "pets", label: "Pet shops and veterinarians", tags: [["shop", "pet"], ["amenity", "veterinary"]] },
  { id: "hospitality", label: "Guest houses and small hotels", tags: [["tourism", "guest_house"], ["tourism", "hostel"], ["tourism", "apartment"]] },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** "all" (or empty) is every category above. */
export function resolveCategories(input: string | undefined | null): Category[] {
  const wanted = (input ?? "all").trim().toLowerCase();
  if (wanted === "" || wanted === "all") return CATEGORIES;
  const hit = CATEGORIES.find((c) => c.id === wanted);
  if (!hit) throw new Error(`Unknown category "${input}". Use one of: ${CATEGORY_IDS.join(", ")}, or all.`);
  return [hit];
}

export const categoryLabel = (id: string): string => CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** Which category a place belongs to, from its map-data tags (first match in the table). */
export function categoryOf(tags: Record<string, string | undefined>): string {
  for (const c of CATEGORIES) if (c.tags.some(([k, v]) => tags[k] === v)) return c.id;
  return "other";
}
