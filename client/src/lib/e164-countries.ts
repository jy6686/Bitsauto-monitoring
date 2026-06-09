// E.164 country prefix registry — used for governance rule destination picker
// and analytics destination grouping (LPM resolver)

export interface CountryEntry {
  prefix: string;
  name: string;
  flag: string;
}

export const E164_COUNTRIES: CountryEntry[] = [
  { prefix: '1',   name: 'United States / Canada', flag: '🇺🇸' },
  { prefix: '7',   name: 'Russia',                 flag: '🇷🇺' },
  { prefix: '20',  name: 'Egypt',                  flag: '🇪🇬' },
  { prefix: '27',  name: 'South Africa',            flag: '🇿🇦' },
  { prefix: '30',  name: 'Greece',                  flag: '🇬🇷' },
  { prefix: '31',  name: 'Netherlands',             flag: '🇳🇱' },
  { prefix: '32',  name: 'Belgium',                 flag: '🇧🇪' },
  { prefix: '33',  name: 'France',                  flag: '🇫🇷' },
  { prefix: '34',  name: 'Spain',                   flag: '🇪🇸' },
  { prefix: '36',  name: 'Hungary',                 flag: '🇭🇺' },
  { prefix: '39',  name: 'Italy',                   flag: '🇮🇹' },
  { prefix: '40',  name: 'Romania',                 flag: '🇷🇴' },
  { prefix: '41',  name: 'Switzerland',             flag: '🇨🇭' },
  { prefix: '43',  name: 'Austria',                 flag: '🇦🇹' },
  { prefix: '44',  name: 'United Kingdom',          flag: '🇬🇧' },
  { prefix: '45',  name: 'Denmark',                 flag: '🇩🇰' },
  { prefix: '46',  name: 'Sweden',                  flag: '🇸🇪' },
  { prefix: '47',  name: 'Norway',                  flag: '🇳🇴' },
  { prefix: '48',  name: 'Poland',                  flag: '🇵🇱' },
  { prefix: '49',  name: 'Germany',                 flag: '🇩🇪' },
  { prefix: '501', name: 'Belize',                  flag: '🇧🇿' },
  { prefix: '502', name: 'Guatemala',               flag: '🇬🇹' },
  { prefix: '503', name: 'El Salvador',             flag: '🇸🇻' },
  { prefix: '504', name: 'Honduras',                flag: '🇭🇳' },
  { prefix: '505', name: 'Nicaragua',               flag: '🇳🇮' },
  { prefix: '506', name: 'Costa Rica',              flag: '🇨🇷' },
  { prefix: '507', name: 'Panama',                  flag: '🇵🇦' },
  { prefix: '509', name: 'Haiti',                   flag: '🇭🇹' },
  { prefix: '51',  name: 'Peru',                    flag: '🇵🇪' },
  { prefix: '52',  name: 'Mexico',                  flag: '🇲🇽' },
  { prefix: '53',  name: 'Cuba',                    flag: '🇨🇺' },
  { prefix: '54',  name: 'Argentina',               flag: '🇦🇷' },
  { prefix: '55',  name: 'Brazil',                  flag: '🇧🇷' },
  { prefix: '56',  name: 'Chile',                   flag: '🇨🇱' },
  { prefix: '57',  name: 'Colombia',                flag: '🇨🇴' },
  { prefix: '58',  name: 'Venezuela',               flag: '🇻🇪' },
  { prefix: '591', name: 'Bolivia',                 flag: '🇧🇴' },
  { prefix: '592', name: 'Guyana',                  flag: '🇬🇾' },
  { prefix: '593', name: 'Ecuador',                 flag: '🇪🇨' },
  { prefix: '594', name: 'French Guiana',           flag: '🇬🇫' },
  { prefix: '595', name: 'Paraguay',                flag: '🇵🇾' },
  { prefix: '596', name: 'Martinique',              flag: '🇲🇶' },
  { prefix: '597', name: 'Suriname',                flag: '🇸🇷' },
  { prefix: '598', name: 'Uruguay',                 flag: '🇺🇾' },
  { prefix: '599', name: 'Caribbean Netherlands',   flag: '🇧🇶' },
  { prefix: '60',  name: 'Malaysia',                flag: '🇲🇾' },
  { prefix: '61',  name: 'Australia',               flag: '🇦🇺' },
  { prefix: '62',  name: 'Indonesia',               flag: '🇮🇩' },
  { prefix: '63',  name: 'Philippines',             flag: '🇵🇭' },
  { prefix: '64',  name: 'New Zealand',             flag: '🇳🇿' },
  { prefix: '65',  name: 'Singapore',               flag: '🇸🇬' },
  { prefix: '66',  name: 'Thailand',                flag: '🇹🇭' },
  { prefix: '81',  name: 'Japan',                   flag: '🇯🇵' },
  { prefix: '82',  name: 'South Korea',             flag: '🇰🇷' },
  { prefix: '84',  name: 'Vietnam',                 flag: '🇻🇳' },
  { prefix: '86',  name: 'China',                   flag: '🇨🇳' },
  { prefix: '90',  name: 'Turkey',                  flag: '🇹🇷' },
  { prefix: '91',  name: 'India',                   flag: '🇮🇳' },
  { prefix: '92',  name: 'Pakistan',                flag: '🇵🇰' },
  { prefix: '93',  name: 'Afghanistan',             flag: '🇦🇫' },
  { prefix: '94',  name: 'Sri Lanka',               flag: '🇱🇰' },
  { prefix: '95',  name: 'Myanmar',                 flag: '🇲🇲' },
  { prefix: '98',  name: 'Iran',                    flag: '🇮🇷' },
  { prefix: '212', name: 'Morocco',                 flag: '🇲🇦' },
  { prefix: '213', name: 'Algeria',                 flag: '🇩🇿' },
  { prefix: '216', name: 'Tunisia',                 flag: '🇹🇳' },
  { prefix: '218', name: 'Libya',                   flag: '🇱🇾' },
  { prefix: '220', name: 'Gambia',                  flag: '🇬🇲' },
  { prefix: '221', name: 'Senegal',                 flag: '🇸🇳' },
  { prefix: '222', name: 'Mauritania',              flag: '🇲🇷' },
  { prefix: '223', name: 'Mali',                    flag: '🇲🇱' },
  { prefix: '224', name: 'Guinea',                  flag: '🇬🇳' },
  { prefix: '225', name: 'Ivory Coast',             flag: '🇨🇮' },
  { prefix: '226', name: 'Burkina Faso',            flag: '🇧🇫' },
  { prefix: '227', name: 'Niger',                   flag: '🇳🇪' },
  { prefix: '228', name: 'Togo',                    flag: '🇹🇬' },
  { prefix: '229', name: 'Benin',                   flag: '🇧🇯' },
  { prefix: '230', name: 'Mauritius',               flag: '🇲🇺' },
  { prefix: '231', name: 'Liberia',                 flag: '🇱🇷' },
  { prefix: '232', name: 'Sierra Leone',            flag: '🇸🇱' },
  { prefix: '233', name: 'Ghana',                   flag: '🇬🇭' },
  { prefix: '234', name: 'Nigeria',                 flag: '🇳🇬' },
  { prefix: '235', name: 'Chad',                    flag: '🇹🇩' },
  { prefix: '236', name: 'Central African Republic',flag: '🇨🇫' },
  { prefix: '237', name: 'Cameroon',                flag: '🇨🇲' },
  { prefix: '238', name: 'Cape Verde',              flag: '🇨🇻' },
  { prefix: '239', name: 'São Tomé and Príncipe',   flag: '🇸🇹' },
  { prefix: '240', name: 'Equatorial Guinea',       flag: '🇬🇶' },
  { prefix: '241', name: 'Gabon',                   flag: '🇬🇦' },
  { prefix: '242', name: 'Republic of Congo',       flag: '🇨🇬' },
  { prefix: '243', name: 'DR Congo',                flag: '🇨🇩' },
  { prefix: '244', name: 'Angola',                  flag: '🇦🇴' },
  { prefix: '245', name: 'Guinea-Bissau',           flag: '🇬🇼' },
  { prefix: '246', name: 'British Indian Ocean Ter.',flag: '🇮🇴' },
  { prefix: '247', name: 'Ascension Island',        flag: '🇦🇨' },
  { prefix: '248', name: 'Seychelles',              flag: '🇸🇨' },
  { prefix: '249', name: 'Sudan',                   flag: '🇸🇩' },
  { prefix: '250', name: 'Rwanda',                  flag: '🇷🇼' },
  { prefix: '251', name: 'Ethiopia',                flag: '🇪🇹' },
  { prefix: '252', name: 'Somalia',                 flag: '🇸🇴' },
  { prefix: '253', name: 'Djibouti',                flag: '🇩🇯' },
  { prefix: '254', name: 'Kenya',                   flag: '🇰🇪' },
  { prefix: '255', name: 'Tanzania',                flag: '🇹🇿' },
  { prefix: '256', name: 'Uganda',                  flag: '🇺🇬' },
  { prefix: '257', name: 'Burundi',                 flag: '🇧🇮' },
  { prefix: '258', name: 'Mozambique',              flag: '🇲🇿' },
  { prefix: '260', name: 'Zambia',                  flag: '🇿🇲' },
  { prefix: '261', name: 'Madagascar',              flag: '🇲🇬' },
  { prefix: '262', name: 'Reunion',                 flag: '🇷🇪' },
  { prefix: '263', name: 'Zimbabwe',                flag: '🇿🇼' },
  { prefix: '264', name: 'Namibia',                 flag: '🇳🇦' },
  { prefix: '265', name: 'Malawi',                  flag: '🇲🇼' },
  { prefix: '266', name: 'Lesotho',                 flag: '🇱🇸' },
  { prefix: '267', name: 'Botswana',                flag: '🇧🇼' },
  { prefix: '268', name: 'Eswatini',                flag: '🇸🇿' },
  { prefix: '269', name: 'Comoros',                 flag: '🇰🇲' },
  { prefix: '291', name: 'Eritrea',                 flag: '🇪🇷' },
  { prefix: '355', name: 'Albania',                 flag: '🇦🇱' },
  { prefix: '358', name: 'Finland',                 flag: '🇫🇮' },
  { prefix: '359', name: 'Bulgaria',                flag: '🇧🇬' },
  { prefix: '370', name: 'Lithuania',               flag: '🇱🇹' },
  { prefix: '371', name: 'Latvia',                  flag: '🇱🇻' },
  { prefix: '372', name: 'Estonia',                 flag: '🇪🇪' },
  { prefix: '380', name: 'Ukraine',                 flag: '🇺🇦' },
  { prefix: '381', name: 'Serbia',                  flag: '🇷🇸' },
  { prefix: '385', name: 'Croatia',                 flag: '🇭🇷' },
  { prefix: '386', name: 'Slovenia',                flag: '🇸🇮' },
  { prefix: '420', name: 'Czech Republic',          flag: '🇨🇿' },
  { prefix: '421', name: 'Slovakia',                flag: '🇸🇰' },
  { prefix: '880', name: 'Bangladesh',              flag: '🇧🇩' },
  { prefix: '886', name: 'Taiwan',                  flag: '🇹🇼' },
  { prefix: '960', name: 'Maldives',                flag: '🇲🇻' },
  { prefix: '961', name: 'Lebanon',                 flag: '🇱🇧' },
  { prefix: '962', name: 'Jordan',                  flag: '🇯🇴' },
  { prefix: '963', name: 'Syria',                   flag: '🇸🇾' },
  { prefix: '964', name: 'Iraq',                    flag: '🇮🇶' },
  { prefix: '965', name: 'Kuwait',                  flag: '🇰🇼' },
  { prefix: '966', name: 'Saudi Arabia',            flag: '🇸🇦' },
  { prefix: '967', name: 'Yemen',                   flag: '🇾🇪' },
  { prefix: '968', name: 'Oman',                    flag: '🇴🇲' },
  { prefix: '970', name: 'Palestine',               flag: '🇵🇸' },
  { prefix: '971', name: 'UAE',                     flag: '🇦🇪' },
  { prefix: '972', name: 'Israel',                  flag: '🇮🇱' },
  { prefix: '973', name: 'Bahrain',                 flag: '🇧🇭' },
  { prefix: '974', name: 'Qatar',                   flag: '🇶🇦' },
  { prefix: '975', name: 'Bhutan',                  flag: '🇧🇹' },
  { prefix: '976', name: 'Mongolia',                flag: '🇲🇳' },
  { prefix: '977', name: 'Nepal',                   flag: '🇳🇵' },
  { prefix: '992', name: 'Tajikistan',              flag: '🇹🇯' },
  { prefix: '993', name: 'Turkmenistan',            flag: '🇹🇲' },
  { prefix: '994', name: 'Azerbaijan',              flag: '🇦🇿' },
  { prefix: '995', name: 'Georgia',                 flag: '🇬🇪' },
  { prefix: '996', name: 'Kyrgyzstan',              flag: '🇰🇬' },
  { prefix: '998', name: 'Uzbekistan',              flag: '🇺🇿' },
];

// Pre-sorted by prefix length desc for fast LPM resolution (longest wins)
const _LPM_SORTED = [...E164_COUNTRIES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Longest-prefix-match: given a destination string (e.g. "923", "92", "971"),
 * return the matching CountryEntry or null.
 *
 * "923"  → Pakistan  (prefix "92")
 * "971"  → UAE       (prefix "971")
 * "8801" → Bangladesh (prefix "880")
 */
export function resolveDestination(prefix: string): CountryEntry | null {
  const digits = prefix.replace(/\D/g, '');
  if (!digits) return null;
  for (const c of _LPM_SORTED) {
    if (digits.startsWith(c.prefix)) return c;
  }
  return null;
}

/** Convenience: returns just the country name string or null */
export function resolveCountryName(prefix: string): string | null {
  return resolveDestination(prefix)?.name ?? null;
}

/**
 * Search countries by name or prefix for the picker combobox.
 * If query is empty, returns the first `limit` countries.
 */
export function searchCountries(query: string, limit = 12): CountryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return E164_COUNTRIES.slice(0, limit);
  return E164_COUNTRIES.filter(
    c => c.name.toLowerCase().includes(q) || c.prefix.startsWith(q),
  ).slice(0, limit);
}
