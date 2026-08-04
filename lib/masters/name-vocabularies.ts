// Hint vocabulary for the "did you mean?" chip on master Name fields that are
// NOT geography (those live in geo-names.ts, same contract, same rules).
//
// THESE LISTS ARE NOT DATA. Nothing here is ever written to the database, and
// nothing here is a validation whitelist — a name absent from these lists saves
// exactly as it always did. Their only job is to make the FIRST row typed into a
// thin or empty table land on the house spelling, which is precisely when the
// house spelling gets set, wrongly, forever.
//
// ── ONE LIST, ONE MASTER. NEVER A DEFAULT. ─────────────────────────────────
//
// This is the rule the whole module exists to enforce, and it is written in
// blood. The first generation of this feature (2026-07-25) had
// `buildWordDictionary(names, seed = MATERIAL_SEED_WORDS)` — a fibre vocabulary
// reachable from every screen that never named one. A Packing Accessories
// category name was duly "corrected" to COTTON (client 2026-07-28) and the whole
// feature was pulled two days later.
//
// The seed was the bug, not the suggestion. So:
//
//   • Every export below is imported by EXACTLY ONE screen. Adding a second
//     importer is the failure mode, not a shortcut — copy the list and name it
//     for its own master instead.
//   • There is no DEFAULT and no barrel object. A screen that wants a vocabulary
//     has to name it in an import, which is what makes "which words can reach
//     this field?" answerable by reading the file.
//   • ONE keyed map exists — CATEGORY_NAMES_BY_ITEM_CLASS, at the bottom — and
//     the rule it has to satisfy is the one above, not a ban on maps. Gen 1 was
//     dangerous because it FELL BACK: `seed = MATERIAL_SEED_WORDS` handed fibre
//     words to every screen that named nothing. That map has no fallback. An
//     item class it does not list resolves to [], so PACKING ACCESSORIES cannot
//     reach the yarn words — the key is not a convenience, it IS the scoping.
//     Read it through `categoryNameSeed()` and never index it directly.
//   • A master with no genuine real-world standard gets NO list. Rows-only is a
//     correct answer; an invented vocabulary is how gen 1 died. Bin, Count,
//     Gauge, Knitting Dia, Yarn Purity and every party master are deliberately
//     absent.
//
// Extend the lists by hand, freely. UPPERCASE (AGENTS.md "CAPITALS"),
// alphabetical within each group. Never list a MISSPELLING as an alternative —
// the whole job here is to be the dictionary. Two genuine names for one thing
// are fine where the trade really uses both; neither is a typo of the other, so
// each only ever answers someone already typing towards it.

/* ------------------------------------------------------------- materials */

/**
 * The seven item classes the system ships with (migration 0339 removed BUTTON
 * and EMBROIDERY ITEMS). A closed set the application itself reasons about —
 * `itemClassForm()` in material-types.ts switches on these — so offering them is
 * as safe as offering a country name, and the table is small enough that a typo
 * would otherwise sit unnoticed forever.
 *
 * Used by: item-class-master-screen.tsx
 */
export const ITEM_CLASS_NAMES: string[] = [
  "CAPITAL GOODS",
  "FABRIC",
  "GARMENTS",
  "GENERAL",
  "PACKING ACCESSORIES",
  "SEWING ACCESSORIES",
  "YARN",
];

/* YARN_FIBRE_NAMES — the textile-fibre list, THE 2026-07-28 ONE that broke a
 * Packing Accessories name by being reachable from a screen that never asked
 * for it — stood here. It was safe for exactly one reason: Yarn Compositions
 * was its only importer, and a Yarn Composition Name field is asking for a
 * fibre by definition. That master was withdrawn on 2026-08-01, so the list has
 * no screen left to be the answer for and went with it.
 *
 * If it comes back, it comes back WITH a single named screen. A fibre list kept
 * around "in case something needs it" is precisely the shape that broke a
 * Packing Accessories name the first time. */

/**
 * Units of measure. Both the spelled-out name and the trade short form appear
 * where the trade genuinely uses both (METRE / MTR) — neither is a typo of the
 * other, so each only answers someone already typing towards it.
 *
 * Used by: stock-unit-master-screen.tsx
 */
export const STOCK_UNIT_NAMES: string[] = [
  "BAG", "BALE", "BOX", "BUNDLE", "CARTON", "CENTIMETRE", "CONE",
  "DOZEN", "GRAM", "GROSS", "INCH", "KILOGRAM", "LITRE", "METRE",
  "MILLIMETRE", "NUMBER", "PACKET", "PAIR", "PIECE", "POUND", "REEL",
  "ROLL", "SET", "SHEET", "SPOOL", "SQUARE METRE", "TONNE", "YARD",
];

/**
 * Physical parts of a garment. From the Component Master discussion in
 * doc/itemclass.md — "typing in the names of the pieces, such as Tops or
 * Bottoms".
 *
 * Used by: component-master-screen.tsx
 */
export const GARMENT_COMPONENT_NAMES: string[] = [
  "BACK PANEL", "BELT", "BOTTOM", "COLLAR", "CUFF", "FRONT PANEL",
  "HOOD", "LINING", "PLACKET", "POCKET", "PLACKET FACING", "RIB",
  "SHOULDER", "SLEEVE", "TOP", "WAISTBAND", "YOKE",
];

/**
 * Manufacturing and job-work processes.
 *
 * Used by: process-master-screen.tsx
 */
export const PROCESS_NAMES: string[] = [
  "BIO WASHING", "BLEACHING", "BRUSHING", "CHECKING", "COMPACTING",
  "CUTTING", "DYEING", "EMBROIDERY", "FINISHING", "FUSING", "IRONING",
  "KNITTING", "MERCERISING", "PACKING", "PEACHING", "PRINTING",
  "SINGEING", "SPINNING", "STITCHING", "SUBLIMATION", "TRIMMING",
  "WASHING", "WEAVING",
];

/* ------------------------------------------------------------ commercial */

/**
 * ISO 4217 English currency names, weighted to the currencies an Indian garment
 * exporter actually invoices in. Not the full 180 — a currency nobody trades in
 * is a candidate that can only ever produce a wrong guess.
 *
 * Used by: currency-master-screen.tsx
 */
export const CURRENCY_NAMES: string[] = [
  "AUSTRALIAN DOLLAR", "BAHRAINI DINAR", "BANGLADESHI TAKA", "BRAZILIAN REAL",
  "CANADIAN DOLLAR", "CHINESE YUAN", "DANISH KRONE", "EURO", "HONG KONG DOLLAR",
  "INDIAN RUPEE", "INDONESIAN RUPIAH", "JAPANESE YEN", "KENYAN SHILLING",
  "KUWAITI DINAR", "MALAYSIAN RINGGIT", "MEXICAN PESO", "NEW ZEALAND DOLLAR",
  "NORWEGIAN KRONE", "OMANI RIAL", "PAKISTANI RUPEE", "POUND STERLING",
  "QATARI RIYAL", "RUSSIAN ROUBLE", "SAUDI RIYAL", "SINGAPORE DOLLAR",
  "SOUTH AFRICAN RAND", "SOUTH KOREAN WON", "SRI LANKAN RUPEE",
  "SWEDISH KRONA", "SWISS FRANC", "THAI BAHT", "TURKISH LIRA",
  "UAE DIRHAM", "US DOLLAR", "VIETNAMESE DONG",
];

/**
 * Indian states and union territories, as the GSTIN state-code table spells
 * them (lib/validation/formats.ts decodes the same set from a GSTIN).
 *
 * Used by: state-master-screen.tsx
 */
export const STATE_NAMES: string[] = [
  "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM",
  "BIHAR", "CHANDIGARH", "CHHATTISGARH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "DELHI", "GOA", "GUJARAT",
  "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR", "JHARKHAND", "KARNATAKA",
  "KERALA", "LADAKH", "LAKSHADWEEP", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR",
  "MEGHALAYA", "MIZORAM", "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB",
  "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH",
  "UTTARAKHAND", "WEST BENGAL",
];

/**
 * Scheduled commercial banks operating in India, by their registered name.
 *
 * Used by: bank-master-screen.tsx
 */
export const BANK_NAMES: string[] = [
  "AXIS BANK", "BANDHAN BANK", "BANK OF BARODA", "BANK OF INDIA",
  "BANK OF MAHARASHTRA", "CANARA BANK", "CENTRAL BANK OF INDIA", "CITIBANK",
  "CITY UNION BANK", "DBS BANK INDIA", "DCB BANK", "FEDERAL BANK", "HDFC BANK",
  "HSBC BANK", "ICICI BANK", "IDBI BANK", "IDFC FIRST BANK", "INDIAN BANK",
  "INDIAN OVERSEAS BANK", "INDUSIND BANK", "JAMMU AND KASHMIR BANK",
  "KARNATAKA BANK", "KARUR VYSYA BANK", "KOTAK MAHINDRA BANK",
  "PUNJAB AND SIND BANK", "PUNJAB NATIONAL BANK", "RBL BANK",
  "SOUTH INDIAN BANK", "STANDARD CHARTERED BANK", "STATE BANK OF INDIA",
  "TAMILNAD MERCANTILE BANK", "UCO BANK", "UNION BANK OF INDIA",
  "YES BANK",
];

/**
 * Standard chart-of-accounts groups.
 *
 * Used by: account-group-master-screen.tsx
 */
export const ACCOUNT_GROUP_NAMES: string[] = [
  "BANK ACCOUNTS", "CAPITAL ACCOUNT", "CASH IN HAND", "CURRENT ASSETS",
  "CURRENT LIABILITIES", "DEPOSITS", "DIRECT EXPENSES", "DIRECT INCOME",
  "DUTIES AND TAXES", "FIXED ASSETS", "INDIRECT EXPENSES", "INDIRECT INCOME",
  "INVESTMENTS", "LOANS AND ADVANCES", "MISCELLANEOUS EXPENSES",
  "PROVISIONS", "PURCHASE ACCOUNTS", "RESERVES AND SURPLUS",
  "SALES ACCOUNTS", "SECURED LOANS", "SUNDRY CREDITORS", "SUNDRY DEBTORS",
  "SUSPENSE ACCOUNT", "UNSECURED LOANS",
];

/**
 * Compliance and sustainability certifications an apparel exporter is audited
 * against. Short forms only where the short form IS the registered name (GOTS,
 * BSCI) — nobody writes these out.
 *
 * Used by: certification-master-screen.tsx
 */
export const CERTIFICATION_NAMES: string[] = [
  "BSCI", "BLUESIGN", "FAIRTRADE", "GLOBAL RECYCLED STANDARD", "GOTS",
  "HIGG INDEX", "ISO 9001", "ISO 14001", "OEKO-TEX STANDARD 100",
  "ORGANIC CONTENT STANDARD", "RECYCLED CLAIM STANDARD",
  "RESPONSIBLE DOWN STANDARD", "RESPONSIBLE WOOL STANDARD", "SA 8000",
  "SEDEX", "SMETA", "WRAP", "ZDHC",
];

/** Sales / marketing zones. Used by: zone-master-screen.tsx */
export const ZONE_NAMES: string[] = [
  "CENTRAL", "EAST", "NORTH", "NORTH EAST", "SOUTH", "WEST",
];

/* ------------------------------------------------------------------- HR */

/**
 * Statutory and customary leave types under Indian labour law.
 *
 * Used by: leave-type-master-screen.tsx
 */
export const LEAVE_TYPE_NAMES: string[] = [
  "BEREAVEMENT LEAVE", "CASUAL LEAVE", "COMPENSATORY OFF", "EARNED LEAVE",
  "LEAVE WITHOUT PAY", "MATERNITY LEAVE", "MARRIAGE LEAVE", "PATERNITY LEAVE",
  "PRIVILEGE LEAVE", "SICK LEAVE",
];

/** Earnings heads on a payslip. Used by: allowance-master-screen.tsx */
export const ALLOWANCE_NAMES: string[] = [
  "ATTENDANCE BONUS", "CITY COMPENSATORY ALLOWANCE", "CONVEYANCE ALLOWANCE",
  "DEARNESS ALLOWANCE", "EDUCATION ALLOWANCE", "HOUSE RENT ALLOWANCE",
  "INCENTIVE", "LEAVE TRAVEL ALLOWANCE", "MEDICAL ALLOWANCE",
  "NIGHT SHIFT ALLOWANCE", "OVERTIME ALLOWANCE", "PRODUCTION INCENTIVE",
  "SHIFT ALLOWANCE", "SPECIAL ALLOWANCE", "WASHING ALLOWANCE",
];

/** Deduction heads on a payslip. Used by: deduction-master-screen.tsx */
export const DEDUCTION_NAMES: string[] = [
  "ADVANCE RECOVERY", "CANTEEN DEDUCTION", "EMPLOYEE STATE INSURANCE",
  "INCOME TAX", "LABOUR WELFARE FUND", "LOAN RECOVERY", "LOSS OF PAY",
  "PROFESSIONAL TAX", "PROVIDENT FUND", "TDS", "UNIFORM DEDUCTION",
];

/**
 * Job titles on a garment-unit payroll.
 *
 * Used by: designation-master-screen.tsx
 */
export const DESIGNATION_NAMES: string[] = [
  "ACCOUNTANT", "CHECKER", "CUTTING MASTER", "FLOOR INCHARGE",
  "GENERAL MANAGER", "HELPER", "IRONING OPERATOR", "LINE SUPERVISOR",
  "MANAGER", "MERCHANDISER", "PACKING OPERATOR", "PATTERN MASTER",
  "PRODUCTION MANAGER", "QUALITY INSPECTOR", "QUALITY MANAGER",
  "SEWING OPERATOR", "STORE KEEPER", "SUPERVISOR", "TAILOR", "TRAINEE",
];

/**
 * Departments in a vertically integrated garment unit.
 *
 * Used by: department-master-screen.tsx
 */
export const DEPARTMENT_NAMES: string[] = [
  "ACCOUNTS", "ADMINISTRATION", "COMPLIANCE", "CUTTING", "DESIGN", "DYEING",
  "EMBROIDERY", "FINISHING", "HUMAN RESOURCES", "INDUSTRIAL ENGINEERING",
  "IRONING", "KNITTING", "LOGISTICS", "MAINTENANCE", "MERCHANDISING",
  "PACKING", "PRINTING", "PRODUCTION", "PURCHASE", "QUALITY ASSURANCE",
  "SAMPLING", "SEWING", "STORES",
];

/** Payroll classes. Used by: employee-category-master-screen.tsx */
export const EMPLOYEE_CATEGORY_NAMES: string[] = [
  "APPRENTICE", "CASUAL", "CONTRACT", "PERMANENT", "PROBATIONER",
  "STAFF", "TRAINEE", "WORKER",
];

/* -------------------------------------------------------------- quality */

/**
 * Where on the garment (or in the process) a defect is grouped. The DETAIL
 * under each group is site-specific and deliberately gets no vocabulary.
 *
 * Used by: defect-group-master-screen.tsx
 */
export const DEFECT_GROUP_NAMES: string[] = [
  "CUTTING DEFECT", "EMBROIDERY DEFECT", "FABRIC DEFECT", "FINISHING DEFECT",
  "IRONING DEFECT", "MEASUREMENT DEFECT", "PACKING DEFECT", "PRINTING DEFECT",
  "SHADE VARIATION", "STITCHING DEFECT", "TRIMS DEFECT", "WASHING DEFECT",
];


/* ------------------------------------------- material categories, by class */

/**
 * Category names, KEYED BY ITEM CLASS CODE — the one keyed map in this file.
 *
 * Why keyed rather than seven separate exports: the Category master asks for a
 * name whose meaning depends entirely on the class chosen two fields earlier.
 * Under YARN the field means "which fibre"; under PACKING ACCESSORIES it means
 * "which packing item". One screen, several vocabularies, chosen by data the
 * operator has already entered — so the choice belongs in a lookup, not in seven
 * imports and a switch that says the same thing longer.
 *
 * WHAT MAKES THIS SAFE, given the history at the top of this file: there is no
 * fallback. `categoryNameSeed()` returns [] for any code not listed here, and
 * for null. The 2026-07-28 failure was a DEFAULT — a fibre list reachable from a
 * screen that named nothing — and it is not representable through this door: a
 * PACKING category resolves to PACK, PACK resolves to the packing list, and the
 * yarn words are unreachable from it. That is also the condition the withdrawn
 * YARN_FIBRE_NAMES tombstone above set for a fibre list ever coming back: with a
 * single named screen. This is that screen.
 *
 * ALL SEVEN CLASSES, at the client's request (2026-08-04). The first cut covered
 * only YARN / FABRIC / SEW / PACK, on the argument that CAPITAL GOODS, GENERAL
 * and GARMENTS are house conventions rather than trade standards. The client
 * asked for the other three anyway, which is theirs to decide — and the danger
 * that argument was guarding against is CROSS-CLASS leakage, which the keying
 * already makes impossible. What is left is a within-class wrong guess, and a
 * wrong chip is one the operator ignores: nothing here is ever written to the
 * database, a name absent from these lists saves exactly as before, and the
 * strip never edits the typed text on its own.
 *
 * So read the last three as a STARTING POINT to be corrected against the real
 * stores, not as a standard being handed down. If a name here is not what the
 * floor calls it, change it — that is what these lists are for.
 *
 * WHY THESE ARE HAND-WRITTEN, since it will be asked again: no free dictionary
 * or API knows this trade. Measured against Datamuse (2026-08-04, the best of
 * the free general-English options): `viscos` returns VISCOUS, VISCUS, VISCO,
 * DISCOS — and never VISCOSE, so it would "correct" a fibre to a real English
 * word that is the wrong material. `cot*` ranks COTTON ninth, behind COTERIE,
 * COTILLION and COTERMINOUS. And none of them hold a compound trade name at all
 * — no COTTON SLUB, no POLYCOTTON, no CVC. A general dictionary is good at plain
 * English spelling and actively wrong here, with the added problem that its word
 * list is not yours to fix.
 *
 * Used by: category-master-screen.tsx
 */
const CATEGORY_NAMES_BY_ITEM_CLASS: Record<string, string[]> = {
  /* Fibres, blends, and the spinning forms the trade buys by. The COMPOUNDS
   * matter more than the bare fibres: COTTON is typed once and then exists
   * forever, so from that day on the only useful thing to offer someone typing
   * COTTON is the next free name containing it. */
  YARN: [
    "ACRYLIC", "AIR JET YARN", "BAMBOO", "BCI COTTON", "CARDED COTTON",
    "CASHMERE", "COMBED COTTON", "COMPACT YARN", "CORE SPUN YARN", "COTTON",
    "COTTON LYCRA", "COTTON MODAL", "COTTON POLYESTER", "COTTON SLUB",
    "COTTON VISCOSE", "CVC", "DYED MELANGE", "DYED YARN", "ELASTANE",
    "FANCY YARN", "GREY MELANGE", "GREY YARN", "HEMP", "INJECTED SLUB",
    "JUTE", "LINEN", "LYCRA", "LYOCELL", "MELANGE", "MERCERISED YARN",
    "MODAL", "NEPS YARN", "NYLON", "OPEN END YARN", "ORGANIC COTTON",
    "PIMA COTTON", "POLY LYCRA", "POLY VISCOSE", "POLYCOTTON", "POLYESTER",
    "RAMIE", "RAYON", "RECYCLED COTTON", "RECYCLED POLYESTER",
    "RING SPUN YARN", "ROTOR YARN", "SILK", "SLUB", "SPANDEX", "SPUN YARN",
    "SUPIMA COTTON", "TENCEL", "TEXTURISED YARN", "TWISTED YARN", "VISCOSE",
    "VISCOSE LYCRA", "VORTEX YARN", "WOOL", "ZERO TWIST YARN",
  ],
  /* Knit structures first — that is what this floor runs — then the wovens, then
   * the pieces cut as a category in their own right (their COLLAR and ROPE rows
   * are both real). INTERLOCK is listed and INTARLOCK is not: a misspelling is
   * never an alternative here, and the twin already in the table is exactly what
   * the warning half of the strip is for. */
  FABRIC: [
    "1X1 RIB", "2X1 RIB", "2X2 RIB", "AIRTEX", "BIRDSEYE", "CANVAS",
    "CHAMBRAY", "COLLAR", "CORDUROY", "CUFF", "DENIM", "DOBBY",
    "DOUBLE JERSEY", "DRILL", "FLANNEL", "FLEECE", "FRENCH TERRY",
    "GABARDINE", "HONEYCOMB", "INTERLOCK", "JACQUARD", "LOOP KNIT",
    "LYCRA RIB", "MESH", "MICRO MESH", "OXFORD", "PIQUE", "PLAIN JERSEY",
    "POLAR FLEECE", "PONTE ROMA", "POPLIN", "RIB", "RIPSTOP", "ROPE",
    "SATEEN", "SATIN", "SEERSUCKER", "SHEETING", "SINGLE JERSEY",
    "SLUB JERSEY", "TAFFETA", "TERRY", "THERMAL", "TIPPING", "TWILL",
    "VOILE", "WAFFLE", "WELT",
  ],
  /* Trims that go INTO the garment. Label, tape and zipper each come in kinds
   * the trade orders separately, so each kind earns its own name. */
  SEW: [
    "BEADS", "BUCKLE", "BUTTON", "CARE LABEL", "CORD", "CORD STOPPER",
    "D RING", "DRAWCORD", "DRAWSTRING", "ELASTIC", "ELASTIC TAPE",
    "EMBROIDERY THREAD", "EYELET", "FUSING", "HERRINGBONE TAPE",
    "HOOK AND EYE", "INTERLINING", "LABEL", "LACE", "MAIN LABEL",
    "METAL BUTTON", "METAL ZIPPER", "MOTIF", "NYLON ZIPPER", "PADDING",
    "PATCH", "PIPING", "PRINTED LABEL", "RIVET", "SEQUINS", "SEWING THREAD",
    "SHOULDER PAD", "SIZE LABEL", "SNAP BUTTON", "STRING", "TAPE", "TOGGLE",
    "TWILL BINDING", "TWILL TAPE", "VELCRO", "WASH CARE LABEL",
    "WOVEN LABEL", "ZIPPER",
  ],
  /* Materials the finished garment is packed IN. */
  PACK: [
    "BACK BOARD", "BARCODE STICKER", "BOPP TAPE", "BUTTER PAPER",
    "BUTTERFLY CLIP", "CARTON", "CARTON STICKER", "CLIP", "COLLAR BONE",
    "COLLAR INSERT", "CORRUGATED BOX", "GUM TAPE", "HANG TAG", "HANGER",
    "INNER CARTON", "MASTER CARTON", "PLASTIC CLIP", "POLY BAG", "PP BAG",
    "PRICE TAG", "SAFETY STICKER", "SHIPPING MARK STICKER", "SILICA GEL",
    "SIZE STICKER", "STRAP", "TAG PIN", "TAGS", "TISSUE PAPER",
  ],
  /* Garment types — the closest of the last three to a real standard, since
   * these are what buyers order by. A house that calls a TANK TOP a VEST should
   * still change it here rather than argue with the chip. */
  GAR: [
    "BLAZER", "BLOUSE", "BOXER", "CAMISOLE", "CAPRI", "CARDIGAN", "DRESS",
    "DUNGAREE", "HOODIE", "JACKET", "JEGGING", "JOGGER", "JUMPSUIT",
    "KURTA", "LEGGING", "NIGHTWEAR", "PAJAMA", "PANT", "POLO SHIRT",
    "PULLOVER", "ROMPER", "SHIRT", "SHORTS", "SKIRT", "SLEEPSUIT",
    "SWEATSHIRT", "SWIMWEAR", "T SHIRT", "TANK TOP", "THERMAL WEAR",
    "TIGHTS", "TRACK PANT", "TRACKSUIT", "TROUSER", "UNDERWEAR", "VEST",
    "WAISTCOAT",
  ],
  /* General stores — what a factory buys that never becomes part of a garment.
   * House conventions; correct these against the actual store. */
  GEN: [
    "ADHESIVE", "CLEANING MATERIAL", "COMPUTER CONSUMABLES",
    "ELECTRICAL ITEMS", "FIRE SAFETY ITEMS", "FIRST AID ITEMS", "FURNITURE",
    "GARDEN ITEMS", "HARDWARE ITEMS", "HOUSEKEEPING ITEMS", "LUBRICANTS",
    "PAINT", "PLUMBING ITEMS", "PRINTING MATERIAL", "SAFETY EQUIPMENT",
    "SANITARY ITEMS", "STATIONERY", "TOOLS", "UNIFORM",
    "WATER TREATMENT CHEMICALS",
  ],
  /* Capital goods — machines and assets, not consumables. House conventions;
   * correct these against the actual asset register. */
  CAP: [
    "AIR COMPRESSOR", "BOILER", "COMPUTER HARDWARE", "CUTTING MACHINE",
    "DG SET", "DYEING MACHINE", "EMBROIDERY MACHINE",
    "FABRIC INSPECTION MACHINE", "FURNITURE AND FIXTURES", "GENERATOR",
    "IRONING EQUIPMENT", "KNITTING MACHINE", "LABORATORY EQUIPMENT",
    "MACHINE SPARES", "MACHINERY ITEMS", "MATERIAL HANDLING EQUIPMENT",
    "NEEDLE DETECTOR", "OFFICE EQUIPMENT", "OVERLOCK MACHINE",
    "PACKING MACHINE", "POWER BACKUP", "SEWING MACHINE", "SPARE PARTS",
    "STEAM IRON", "TOOLS AND DIES", "VEHICLE", "WASHING MACHINE",
  ],
};

/**
 * The vocabulary for one item class, or NONE.
 *
 * Always read the map through here. Returning [] for an unlisted or missing code
 * is the entire safety property — an unknown class must offer nothing, never
 * "whatever the first list happens to be". All seven shipped classes are listed
 * today, so [] now means "a class this build has never heard of", which is
 * precisely when guessing would be worst.
 */
export function categoryNameSeed(itemClassCode: string | null | undefined): string[] {
  if (!itemClassCode) return [];
  return CATEGORY_NAMES_BY_ITEM_CLASS[itemClassCode.trim().toUpperCase()] ?? [];
}
