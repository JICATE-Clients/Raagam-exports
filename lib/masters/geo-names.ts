// Hint vocabulary for the "did you mean?" chip on the Country / Port /
// Destination master Name fields (see name-dictionary.ts).
//
// THESE LISTS ARE NOT DATA. Nothing here is ever written to the database, and
// nothing here is a validation whitelist — a name absent from these lists saves
// exactly as it always did. Their only job is to make the FIRST row typed into
// an empty table land on the right spelling: `countries`, `ports` and
// `destinations` all ship empty (migrations 0232 / 0233 / 0234 seed no rows),
// so a dictionary built from saved rows alone would say nothing on day one —
// which is precisely when the house spellings get set, wrongly, forever.
//
// Extend them by hand, freely. Uppercase (AGENTS.md "CAPITALS"), alphabetical.
// Never list a MISSPELLING as an alternative — the whole job here is to be the
// dictionary. Two genuine names for one place are fine where the trade really
// uses both (CHITTAGONG / CHATTOGRAM): neither is a typo of the other, so each
// only ever answers someone already typing towards it.

/** ISO 3166 English short names. The whole world, because a buyer can be
 *  anywhere and the operator types the country before anyone has curated one. */
export const COUNTRY_NAMES: string[] = [
  "AFGHANISTAN", "ALBANIA", "ALGERIA", "ANDORRA", "ANGOLA", "ANTIGUA AND BARBUDA",
  "ARGENTINA", "ARMENIA", "ARUBA", "AUSTRALIA", "AUSTRIA", "AZERBAIJAN",
  "BAHAMAS", "BAHRAIN", "BANGLADESH", "BARBADOS", "BELARUS", "BELGIUM", "BELIZE",
  "BENIN", "BERMUDA", "BHUTAN", "BOLIVIA", "BOSNIA AND HERZEGOVINA", "BOTSWANA",
  "BRAZIL", "BRUNEI", "BULGARIA", "BURKINA FASO", "BURUNDI",
  "CAMBODIA", "CAMEROON", "CANADA", "CAPE VERDE", "CAYMAN ISLANDS",
  "CENTRAL AFRICAN REPUBLIC", "CHAD", "CHILE", "CHINA", "COLOMBIA", "COMOROS",
  "CONGO", "COSTA RICA", "COTE D IVOIRE", "CROATIA", "CUBA", "CURACAO", "CYPRUS",
  "CZECH REPUBLIC",
  "DEMOCRATIC REPUBLIC OF THE CONGO", "DENMARK", "DJIBOUTI", "DOMINICA",
  "DOMINICAN REPUBLIC",
  "ECUADOR", "EGYPT", "EL SALVADOR", "EQUATORIAL GUINEA", "ERITREA", "ESTONIA",
  "ESWATINI", "ETHIOPIA",
  "FIJI", "FINLAND", "FRANCE", "FRENCH POLYNESIA",
  "GABON", "GAMBIA", "GEORGIA", "GERMANY", "GHANA", "GIBRALTAR", "GREECE",
  "GREENLAND", "GRENADA", "GUATEMALA", "GUINEA", "GUINEA BISSAU", "GUYANA",
  "HAITI", "HONDURAS", "HONG KONG", "HUNGARY",
  "ICELAND", "INDIA", "INDONESIA", "IRAN", "IRAQ", "IRELAND", "ISRAEL", "ITALY",
  "JAMAICA", "JAPAN", "JORDAN",
  "KAZAKHSTAN", "KENYA", "KIRIBATI", "KUWAIT", "KYRGYZSTAN",
  "LAOS", "LATVIA", "LEBANON", "LESOTHO", "LIBERIA", "LIBYA", "LIECHTENSTEIN",
  "LITHUANIA", "LUXEMBOURG",
  "MACAU", "MADAGASCAR", "MALAWI", "MALAYSIA", "MALDIVES", "MALI", "MALTA",
  "MARSHALL ISLANDS", "MAURITANIA", "MAURITIUS", "MEXICO", "MICRONESIA",
  "MOLDOVA", "MONACO", "MONGOLIA", "MONTENEGRO", "MOROCCO", "MOZAMBIQUE",
  "MYANMAR",
  "NAMIBIA", "NAURU", "NEPAL", "NETHERLANDS", "NEW CALEDONIA", "NEW ZEALAND",
  "NICARAGUA", "NIGER", "NIGERIA", "NORTH KOREA", "NORTH MACEDONIA", "NORWAY",
  "OMAN",
  "PAKISTAN", "PALAU", "PALESTINE", "PANAMA", "PAPUA NEW GUINEA", "PARAGUAY",
  "PERU", "PHILIPPINES", "POLAND", "PORTUGAL", "PUERTO RICO",
  "QATAR",
  "REUNION", "ROMANIA", "RUSSIA", "RWANDA",
  "SAINT KITTS AND NEVIS", "SAINT LUCIA", "SAINT VINCENT AND THE GRENADINES",
  "SAMOA", "SAN MARINO", "SAO TOME AND PRINCIPE", "SAUDI ARABIA", "SENEGAL",
  "SERBIA", "SEYCHELLES", "SIERRA LEONE", "SINGAPORE", "SLOVAKIA", "SLOVENIA",
  "SOLOMON ISLANDS", "SOMALIA", "SOUTH AFRICA", "SOUTH KOREA", "SOUTH SUDAN",
  "SPAIN", "SRI LANKA", "SUDAN", "SURINAME", "SWEDEN", "SWITZERLAND", "SYRIA",
  "TAIWAN", "TAJIKISTAN", "TANZANIA", "THAILAND", "TIMOR LESTE", "TOGO", "TONGA",
  "TRINIDAD AND TOBAGO", "TUNISIA", "TURKEY", "TURKMENISTAN", "TUVALU",
  "UGANDA", "UKRAINE", "UNITED ARAB EMIRATES", "UNITED KINGDOM",
  "UNITED STATES OF AMERICA", "URUGUAY", "UZBEKISTAN",
  "VANUATU", "VATICAN CITY", "VENEZUELA", "VIETNAM",
  "YEMEN",
  "ZAMBIA", "ZIMBABWE",
];

/**
 * Ports a garment exporter actually names on a shipping document — the Indian
 * ports and ICDs goods leave from, and the discharge ports of the buying
 * markets. Deliberately NOT every port in the world: this list is read on every
 * keystroke, and a long tail of berths nobody here ships to only makes wrong
 * suggestions more likely.
 *
 * Air and sea both appear, because the Port master covers both (its Type field
 * is Air / Sea / Sea-Air).
 */
export const PORT_NAMES: string[] = [
  // India — sea
  "CHENNAI", "COCHIN", "ENNORE", "HALDIA", "KANDLA", "KOLKATA", "KRISHNAPATNAM",
  "MANGALORE", "MORMUGAO", "MUNDRA", "NHAVA SHEVA", "PARADIP", "PIPAVAV",
  "PORT BLAIR", "TUTICORIN", "VISAKHAPATNAM",
  // India — air / ICD
  "AHMEDABAD", "BENGALURU", "COIMBATORE", "DELHI", "HYDERABAD", "JAIPUR",
  "LUDHIANA", "MUMBAI", "TIRUPUR",
  // Middle East / Africa
  "ABU DHABI", "AQABA", "DAMMAM", "DAR ES SALAAM", "DOHA", "DUBAI", "DURBAN",
  "JEBEL ALI", "JEDDAH", "MOMBASA", "PORT SAID", "SALALAH", "SHARJAH", "SOKHNA",
  // Europe
  "AARHUS", "ALGECIRAS", "AMSTERDAM", "ANTWERP", "BARCELONA", "BREMERHAVEN",
  "COPENHAGEN", "DUBLIN", "FELIXSTOWE", "GDANSK", "GENOA", "GOTHENBURG",
  "HAMBURG", "HELSINKI", "ISTANBUL", "LE HAVRE", "LISBON", "LIVERPOOL",
  "LONDON GATEWAY", "MARSEILLE", "PIRAEUS", "ROTTERDAM", "SOUTHAMPTON",
  "VALENCIA", "ZEEBRUGGE",
  // Americas
  "BALTIMORE", "BUENOS AIRES", "CALLAO", "CHARLESTON", "HOUSTON", "LONG BEACH",
  "LOS ANGELES", "MANZANILLO", "MIAMI", "MONTREAL", "NEW YORK", "NORFOLK",
  "OAKLAND", "PANAMA CITY", "SANTOS", "SAVANNAH", "SEATTLE", "TORONTO",
  "VANCOUVER", "VERACRUZ",
  // Asia / Pacific
  "BANGKOK", "BUSAN", "CHATTOGRAM", "CHITTAGONG", "COLOMBO", "HAIPHONG",
  "HO CHI MINH CITY", "HONG KONG", "INCHEON", "JAKARTA", "KAOHSIUNG",
  "KARACHI", "KEELUNG", "LAEM CHABANG", "MANILA", "MELBOURNE", "NINGBO",
  "OSAKA", "PENANG", "PORT KLANG", "QINGDAO", "SHANGHAI", "SHENZHEN",
  "SINGAPORE", "SYDNEY", "TOKYO", "XIAMEN", "YANGON", "YOKOHAMA",
];
