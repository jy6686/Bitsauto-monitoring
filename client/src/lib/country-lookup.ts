
// Maps international dialing prefixes to country name + flag emoji
// Longer prefixes take priority over shorter ones (e.g. +1868 before +1)

const PREFIX_MAP: Record<string, { name: string; flag: string }> = {
  // North America (+1 NANP) — specific area codes first
  "1242": { name: "Bahamas", flag: "🇧🇸" },
  "1246": { name: "Barbados", flag: "🇧🇧" },
  "1264": { name: "Anguilla", flag: "🇦🇮" },
  "1268": { name: "Antigua & Barbuda", flag: "🇦🇬" },
  "1284": { name: "British Virgin Islands", flag: "🇻🇬" },
  "1340": { name: "US Virgin Islands", flag: "🇻🇮" },
  "1345": { name: "Cayman Islands", flag: "🇰🇾" },
  "1441": { name: "Bermuda", flag: "🇧🇲" },
  "1473": { name: "Grenada", flag: "🇬🇩" },
  "1649": { name: "Turks & Caicos", flag: "🇹🇨" },
  "1664": { name: "Montserrat", flag: "🇲🇸" },
  "1670": { name: "N. Mariana Islands", flag: "🇲🇵" },
  "1671": { name: "Guam", flag: "🇬🇺" },
  "1684": { name: "American Samoa", flag: "🇦🇸" },
  "1758": { name: "Saint Lucia", flag: "🇱🇨" },
  "1767": { name: "Dominica", flag: "🇩🇲" },
  "1784": { name: "St. Vincent & Grenadines", flag: "🇻🇨" },
  "1787": { name: "Puerto Rico", flag: "🇵🇷" },
  "1809": { name: "Dominican Republic", flag: "🇩🇴" },
  "1868": { name: "Trinidad & Tobago", flag: "🇹🇹" },
  "1869": { name: "St. Kitts & Nevis", flag: "🇰🇳" },
  "1876": { name: "Jamaica", flag: "🇯🇲" },
  "1939": { name: "Puerto Rico", flag: "🇵🇷" },
  "1":    { name: "USA / Canada", flag: "🇺🇸" },

  // Europe
  "7":    { name: "Russia / Kazakhstan", flag: "🇷🇺" },
  "20":   { name: "Egypt", flag: "🇪🇬" },
  "27":   { name: "South Africa", flag: "🇿🇦" },
  "30":   { name: "Greece", flag: "🇬🇷" },
  "31":   { name: "Netherlands", flag: "🇳🇱" },
  "32":   { name: "Belgium", flag: "🇧🇪" },
  "33":   { name: "France", flag: "🇫🇷" },
  "34":   { name: "Spain", flag: "🇪🇸" },
  "36":   { name: "Hungary", flag: "🇭🇺" },
  "39":   { name: "Italy", flag: "🇮🇹" },
  "40":   { name: "Romania", flag: "🇷🇴" },
  "41":   { name: "Switzerland", flag: "🇨🇭" },
  "43":   { name: "Austria", flag: "🇦🇹" },
  "44":   { name: "United Kingdom", flag: "🇬🇧" },
  "45":   { name: "Denmark", flag: "🇩🇰" },
  "46":   { name: "Sweden", flag: "🇸🇪" },
  "47":   { name: "Norway", flag: "🇳🇴" },
  "48":   { name: "Poland", flag: "🇵🇱" },
  "49":   { name: "Germany", flag: "🇩🇪" },
  "51":   { name: "Peru", flag: "🇵🇪" },
  "52":   { name: "Mexico", flag: "🇲🇽" },
  "53":   { name: "Cuba", flag: "🇨🇺" },
  "54":   { name: "Argentina", flag: "🇦🇷" },
  "55":   { name: "Brazil", flag: "🇧🇷" },
  "56":   { name: "Chile", flag: "🇨🇱" },
  "57":   { name: "Colombia", flag: "🇨🇴" },
  "58":   { name: "Venezuela", flag: "🇻🇪" },
  "60":   { name: "Malaysia", flag: "🇲🇾" },
  "61":   { name: "Australia", flag: "🇦🇺" },
  "62":   { name: "Indonesia", flag: "🇮🇩" },
  "63":   { name: "Philippines", flag: "🇵🇭" },
  "64":   { name: "New Zealand", flag: "🇳🇿" },
  "65":   { name: "Singapore", flag: "🇸🇬" },
  "66":   { name: "Thailand", flag: "🇹🇭" },
  "81":   { name: "Japan", flag: "🇯🇵" },
  "82":   { name: "South Korea", flag: "🇰🇷" },
  "84":   { name: "Vietnam", flag: "🇻🇳" },
  "86":   { name: "China", flag: "🇨🇳" },
  "90":   { name: "Turkey", flag: "🇹🇷" },
  "91":   { name: "India", flag: "🇮🇳" },
  "92":   { name: "Pakistan", flag: "🇵🇰" },
  "93":   { name: "Afghanistan", flag: "🇦🇫" },
  "94":   { name: "Sri Lanka", flag: "🇱🇰" },
  "95":   { name: "Myanmar", flag: "🇲🇲" },
  "98":   { name: "Iran", flag: "🇮🇷" },
  "212":  { name: "Morocco", flag: "🇲🇦" },
  "213":  { name: "Algeria", flag: "🇩🇿" },
  "216":  { name: "Tunisia", flag: "🇹🇳" },
  "218":  { name: "Libya", flag: "🇱🇾" },
  "220":  { name: "Gambia", flag: "🇬🇲" },
  "221":  { name: "Senegal", flag: "🇸🇳" },
  "222":  { name: "Mauritania", flag: "🇲🇷" },
  "223":  { name: "Mali", flag: "🇲🇱" },
  "224":  { name: "Guinea", flag: "🇬🇳" },
  "225":  { name: "Côte d'Ivoire", flag: "🇨🇮" },
  "226":  { name: "Burkina Faso", flag: "🇧🇫" },
  "227":  { name: "Niger", flag: "🇳🇪" },
  "228":  { name: "Togo", flag: "🇹🇬" },
  "229":  { name: "Benin", flag: "🇧🇯" },
  "230":  { name: "Mauritius", flag: "🇲🇺" },
  "231":  { name: "Liberia", flag: "🇱🇷" },
  "232":  { name: "Sierra Leone", flag: "🇸🇱" },
  "233":  { name: "Ghana", flag: "🇬🇭" },
  "234":  { name: "Nigeria", flag: "🇳🇬" },
  "235":  { name: "Chad", flag: "🇹🇩" },
  "236":  { name: "Central African Republic", flag: "🇨🇫" },
  "237":  { name: "Cameroon", flag: "🇨🇲" },
  "238":  { name: "Cape Verde", flag: "🇨🇻" },
  "239":  { name: "São Tomé & Príncipe", flag: "🇸🇹" },
  "240":  { name: "Equatorial Guinea", flag: "🇬🇶" },
  "241":  { name: "Gabon", flag: "🇬🇦" },
  "242":  { name: "Congo", flag: "🇨🇬" },
  "243":  { name: "DR Congo", flag: "🇨🇩" },
  "244":  { name: "Angola", flag: "🇦🇴" },
  "245":  { name: "Guinea-Bissau", flag: "🇬🇼" },
  "246":  { name: "British Indian Ocean Territory", flag: "🇮🇴" },
  "247":  { name: "Ascension Island", flag: "🇸🇭" },
  "248":  { name: "Seychelles", flag: "🇸🇨" },
  "249":  { name: "Sudan", flag: "🇸🇩" },
  "250":  { name: "Rwanda", flag: "🇷🇼" },
  "251":  { name: "Ethiopia", flag: "🇪🇹" },
  "252":  { name: "Somalia", flag: "🇸🇴" },
  "253":  { name: "Djibouti", flag: "🇩🇯" },
  "254":  { name: "Kenya", flag: "🇰🇪" },
  "255":  { name: "Tanzania", flag: "🇹🇿" },
  "256":  { name: "Uganda", flag: "🇺🇬" },
  "257":  { name: "Burundi", flag: "🇧🇮" },
  "258":  { name: "Mozambique", flag: "🇲🇿" },
  "260":  { name: "Zambia", flag: "🇿🇲" },
  "261":  { name: "Madagascar", flag: "🇲🇬" },
  "262":  { name: "Réunion / Mayotte", flag: "🇷🇪" },
  "263":  { name: "Zimbabwe", flag: "🇿🇼" },
  "264":  { name: "Namibia", flag: "🇳🇦" },
  "265":  { name: "Malawi", flag: "🇲🇼" },
  "266":  { name: "Lesotho", flag: "🇱🇸" },
  "267":  { name: "Botswana", flag: "🇧🇼" },
  "268":  { name: "Eswatini", flag: "🇸🇿" },
  "269":  { name: "Comoros", flag: "🇰🇲" },
  "290":  { name: "Saint Helena", flag: "🇸🇭" },
  "291":  { name: "Eritrea", flag: "🇪🇷" },
  "297":  { name: "Aruba", flag: "🇦🇼" },
  "298":  { name: "Faroe Islands", flag: "🇫🇴" },
  "299":  { name: "Greenland", flag: "🇬🇱" },
  "350":  { name: "Gibraltar", flag: "🇬🇮" },
  "351":  { name: "Portugal", flag: "🇵🇹" },
  "352":  { name: "Luxembourg", flag: "🇱🇺" },
  "353":  { name: "Ireland", flag: "🇮🇪" },
  "354":  { name: "Iceland", flag: "🇮🇸" },
  "355":  { name: "Albania", flag: "🇦🇱" },
  "356":  { name: "Malta", flag: "🇲🇹" },
  "357":  { name: "Cyprus", flag: "🇨🇾" },
  "358":  { name: "Finland", flag: "🇫🇮" },
  "359":  { name: "Bulgaria", flag: "🇧🇬" },
  "370":  { name: "Lithuania", flag: "🇱🇹" },
  "371":  { name: "Latvia", flag: "🇱🇻" },
  "372":  { name: "Estonia", flag: "🇪🇪" },
  "373":  { name: "Moldova", flag: "🇲🇩" },
  "374":  { name: "Armenia", flag: "🇦🇲" },
  "375":  { name: "Belarus", flag: "🇧🇾" },
  "376":  { name: "Andorra", flag: "🇦🇩" },
  "377":  { name: "Monaco", flag: "🇲🇨" },
  "378":  { name: "San Marino", flag: "🇸🇲" },
  "380":  { name: "Ukraine", flag: "🇺🇦" },
  "381":  { name: "Serbia", flag: "🇷🇸" },
  "382":  { name: "Montenegro", flag: "🇲🇪" },
  "385":  { name: "Croatia", flag: "🇭🇷" },
  "386":  { name: "Slovenia", flag: "🇸🇮" },
  "387":  { name: "Bosnia & Herzegovina", flag: "🇧🇦" },
  "389":  { name: "North Macedonia", flag: "🇲🇰" },
  "420":  { name: "Czech Republic", flag: "🇨🇿" },
  "421":  { name: "Slovakia", flag: "🇸🇰" },
  "423":  { name: "Liechtenstein", flag: "🇱🇮" },
  "500":  { name: "Falkland Islands", flag: "🇫🇰" },
  "501":  { name: "Belize", flag: "🇧🇿" },
  "502":  { name: "Guatemala", flag: "🇬🇹" },
  "503":  { name: "El Salvador", flag: "🇸🇻" },
  "504":  { name: "Honduras", flag: "🇭🇳" },
  "505":  { name: "Nicaragua", flag: "🇳🇮" },
  "506":  { name: "Costa Rica", flag: "🇨🇷" },
  "507":  { name: "Panama", flag: "🇵🇦" },
  "508":  { name: "Saint Pierre & Miquelon", flag: "🇵🇲" },
  "509":  { name: "Haiti", flag: "🇭🇹" },
  "590":  { name: "Guadeloupe / Saint Martin", flag: "🇬🇵" },
  "591":  { name: "Bolivia", flag: "🇧🇴" },
  "592":  { name: "Guyana", flag: "🇬🇾" },
  "593":  { name: "Ecuador", flag: "🇪🇨" },
  "594":  { name: "French Guiana", flag: "🇬🇫" },
  "595":  { name: "Paraguay", flag: "🇵🇾" },
  "596":  { name: "Martinique", flag: "🇲🇶" },
  "597":  { name: "Suriname", flag: "🇸🇷" },
  "598":  { name: "Uruguay", flag: "🇺🇾" },
  "599":  { name: "Netherlands Antilles", flag: "🇨🇼" },
  "670":  { name: "East Timor", flag: "🇹🇱" },
  "672":  { name: "Norfolk Island", flag: "🇳🇫" },
  "673":  { name: "Brunei", flag: "🇧🇳" },
  "674":  { name: "Nauru", flag: "🇳🇷" },
  "675":  { name: "Papua New Guinea", flag: "🇵🇬" },
  "676":  { name: "Tonga", flag: "🇹🇴" },
  "677":  { name: "Solomon Islands", flag: "🇸🇧" },
  "678":  { name: "Vanuatu", flag: "🇻🇺" },
  "679":  { name: "Fiji", flag: "🇫🇯" },
  "680":  { name: "Palau", flag: "🇵🇼" },
  "681":  { name: "Wallis & Futuna", flag: "🇼🇫" },
  "682":  { name: "Cook Islands", flag: "🇨🇰" },
  "683":  { name: "Niue", flag: "🇳🇺" },
  "685":  { name: "Samoa", flag: "🇼🇸" },
  "686":  { name: "Kiribati", flag: "🇰🇮" },
  "687":  { name: "New Caledonia", flag: "🇳🇨" },
  "688":  { name: "Tuvalu", flag: "🇹🇻" },
  "689":  { name: "French Polynesia", flag: "🇵🇫" },
  "690":  { name: "Tokelau", flag: "🇹🇰" },
  "691":  { name: "Micronesia", flag: "🇫🇲" },
  "692":  { name: "Marshall Islands", flag: "🇲🇭" },
  "850":  { name: "North Korea", flag: "🇰🇵" },
  "852":  { name: "Hong Kong", flag: "🇭🇰" },
  "853":  { name: "Macau", flag: "🇲🇴" },
  "855":  { name: "Cambodia", flag: "🇰🇭" },
  "856":  { name: "Laos", flag: "🇱🇦" },
  "880":  { name: "Bangladesh", flag: "🇧🇩" },
  "886":  { name: "Taiwan", flag: "🇹🇼" },
  "960":  { name: "Maldives", flag: "🇲🇻" },
  "961":  { name: "Lebanon", flag: "🇱🇧" },
  "962":  { name: "Jordan", flag: "🇯🇴" },
  "963":  { name: "Syria", flag: "🇸🇾" },
  "964":  { name: "Iraq", flag: "🇮🇶" },
  "965":  { name: "Kuwait", flag: "🇰🇼" },
  "966":  { name: "Saudi Arabia", flag: "🇸🇦" },
  "967":  { name: "Yemen", flag: "🇾🇪" },
  "968":  { name: "Oman", flag: "🇴🇲" },
  "970":  { name: "Palestine", flag: "🇵🇸" },
  "971":  { name: "UAE", flag: "🇦🇪" },
  "972":  { name: "Israel", flag: "🇮🇱" },
  "973":  { name: "Bahrain", flag: "🇧🇭" },
  "974":  { name: "Qatar", flag: "🇶🇦" },
  "975":  { name: "Bhutan", flag: "🇧🇹" },
  "976":  { name: "Mongolia", flag: "🇲🇳" },
  "977":  { name: "Nepal", flag: "🇳🇵" },
  "992":  { name: "Tajikistan", flag: "🇹🇯" },
  "993":  { name: "Turkmenistan", flag: "🇹🇲" },
  "994":  { name: "Azerbaijan", flag: "🇦🇿" },
  "995":  { name: "Georgia", flag: "🇬🇪" },
  "996":  { name: "Kyrgyzstan", flag: "🇰🇬" },
  "998":  { name: "Uzbekistan", flag: "🇺🇿" },
};

// Normalize a phone number to its E.164 digit string (strip +, leading 00)
function normalizeDigits(number: string): string {
  const trimmed = number.trim();
  if (trimmed.startsWith("+")) return trimmed.slice(1);
  if (trimmed.startsWith("00")) return trimmed.slice(2);
  return trimmed;
}

export type CountryInfo = { name: string; flag: string };

/**
 * Resolve a phone number string to a country name and flag.
 * Tries prefixes from longest (4 digits) to shortest (1 digit).
 * Returns null for local/unknown numbers.
 *
 * Special-case: if the number starts with "1" but is longer than 11 digits
 * (US/Canada NANP = 1 + 10 digits = 11 total), the "1" is a routing prefix,
 * not a country code — strip it and re-match so e.g. "1923XXXXXXXX" resolves
 * to Pakistan (+92) instead of USA/Canada (+1).
 */
export function lookupCountry(number: string): CountryInfo | null {
  if (!number) return null;
  const digits = normalizeDigits(number);

  // If starts with "1" and longer than 11 digits, it's a routing prefix — try
  // matching the remainder first (covers 1+92, 1+44, 1+971, etc.)
  const candidates: string[] = [];
  if (digits.startsWith("1") && digits.length > 11) {
    candidates.push(digits.slice(1));
  }
  candidates.push(digits);

  for (const d of candidates) {
    for (const len of [4, 3, 2, 1]) {
      const prefix = d.slice(0, len);
      if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix];
    }
  }
  return null;
}

/**
 * Returns a short formatted label: "🇵🇰 Pakistan"
 */
export function countryLabel(number: string): string {
  const info = lookupCountry(number);
  return info ? `${info.flag} ${info.name}` : "Unknown";
}
