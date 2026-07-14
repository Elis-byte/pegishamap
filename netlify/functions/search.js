/**
 * PegishaMap — Netlify Serverless Function
 * Endpoint: /.netlify/functions/search?rad=X&place=Y
 *
 * Does two things on every call:
 *  1. Fetches live restaurant data from koshernear.me
 *  2. Fetches the live CRC approved agency list from crckosher.org
 *  3. Cross-references and returns only CRC-approved results
 *
 * This means:
 *  - New restaurants appear automatically (live API)
 *  - Supervision approval changes are reflected automatically (live CRC page)
 *  - No CORS issues (server-side fetch, not browser fetch)
 *  - No third-party proxy needed
 */

const https = require('https');
const http  = require('http');

// ── Fetch helper ──────────────────────────────────────────────────────────────
function fetchUrl(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'PegishaMap/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Parse CRC agency list from live page ──────────────────────────────────────
async function fetchCRCAgencies() {
  try {
    const html = await fetchUrl('https://consumer.crckosher.org/acceptable-kashrus-agencies/?country=USA', 8000);

    // Extract text between "Export PDF" marker and end of content
    const exportIdx = html.indexOf('Export PDF');
    if (exportIdx === -1) return null;
    const relevant = html.slice(exportIdx);

    // Strip HTML tags and decode entities
    const text = relevant
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    // Extract agency names — lines that are not addresses, phones, URLs, headers
    const skipPatterns = [
      /^PO Box/i, /^P\.O\./i, /^Phone:/i, /^www\./i, /^http/i,
      /^Recommended/i, /^Conditionally/i, /^Not Recommended/i,
      /^\d/, // starts with digit (address)
      /@/, // email
      /\d{5}/, // zip code in address
    ];
    const skipWords = new Set([
      'Export PDF','Submit','Enter at least 3 characters','Filter by Country',
      'View All','Argentina','Aruba','Australia','Bahamas','Belgium','Canada',
      'England','France','India','Israel','Italy','Mexico','Panama','Philippines',
      'Puerto Rico','Singapore','South Africa','Switzerland','Ukraine',
      'United Arab Emirates','USA','Vietnam','California','Colorado','Connecticut',
      'Florida','Georgia','Illinois','Indiana','Kansas','Louisiana','Maine',
      'Maryland','Massachusetts','Michigan','Minnesota','Missouri','Montana',
      'Nebraska','New Jersey','New York','North Carolina','Ohio','Oregon',
      'Pennsylvania','Rhode Island','South Carolina','Tennessee','Texas',
      'Virginia','Washington','Wisconsin',
    ]);

    const agencies = new Set();
    text.split('\n').forEach(line => {
      const l = line.trim();
      if (!l || l.length < 3 || l.length > 100) return;
      if (skipWords.has(l)) return;
      if (skipPatterns.some(p => p.test(l))) return;
      agencies.add(l);
    });

    return agencies.size > 20 ? agencies : null; // sanity check
  } catch (e) {
    console.error('CRC fetch failed:', e.message);
    return null;
  }
}

// ── Hardcoded fallback CRC list (used if live fetch fails) ────────────────────
const CRC_FALLBACK = new Set([
  "Kosher Supervision of America","KSA","Kehilla Kosher","Heart-K",
  "Rabbinical Council of California","RCC","Truly Kosher Certification","TK Kosher",
  "Vaad of Northern California","Sunrise Kosher","Earth Kosher Certification Agency",
  "EarthKosher","Earth Kosher","Vaad Hakashrus of Denver","Scroll K","Scroll-K",
  "Vaad Hakashrus of Greater Waterbury",
  "Diamond-K","Orthodox Rabbinical Board","ORB","Sunshine State Kosher",
  "Gesher K","Gesher-K","Florida-K","Florida-K Kashrus Service","Florida K",
  "RCF","Rabbinate of Central & North Florida","Kosher Miami",
  "Vaad HaKashrus of Miami-Dade","Miami Kosher","Orthodox Vaad of Orlando",
  "Vaad Hakashrus of Atlanta","Kosher Atlanta","Kosher Savannah",
  "Texas K","Blue Ribbon Kosher","BRK","Midwest Kosher",
  "cRc","CRC","Chicago Rabbinical Council","cRc Kosher","cRc Chicago Rabbinical Council",
  "Indianapolis Beth Din","Lubavitch of Indiana","Indianapolis Beth Din, Lubavitch of Indiana",
  "Vaad Hakashrus of Kansas City","Louisiana Kashrut Committee","Louisiana Kashrut Committee - Chabad",
  "Vaad HaKashrus of Eastern Canada and Maine",
  "Star D","Star-D","Star-K","Star K","Star-S","Star S",
  "Star D Kosher Supervision","Star-K Kosher Certification",
  "Rabbinical Council of Greater Washington","Capital K","CapitolK","RCGW",
  "Vaad Harabonim of New England","KVH","Massachusetts Kosher Commission",
  "Council of Orthodox Rabbis of Greater Detroit",
  "Minnesota Kosher","MNK","United Mehadrin Kosher","UMK","Minnesota Kosher (MNK)",
  "Vaad Hoeir of St. Louis","OV Kosher","Vaad HaKashrus of Montana","Montana Kosher",
  "Jersey Shore Orthodox Rabbinate","JSOR","Jersey Shore Orthodox Rabbinate (JSOR)",
  "Vaad Hakashruth of Raritan Valley","Vaad of Raritan Valley",
  "Kashrus Council of Lakewood","KCL",
  "Kehillos Chareidim of Lakewood & Central Jersey",
  "Kehillos Chareidim of Lakewood & Central Jersey (KCL)",
  "Kashrus Council of Lakewood,NJ",
  "Chelkas Hakashrus of Zichron Yaakov","Chelkas Hakashrus",
  "Vaad Harabonim of Metro West","Metro West Vaad","Vaad of Metro West",
  "Passaic-Clifton Kashrus","Passaic Clifton","Passaic Clifton Kashrus (PCK)",
  "KOF-K","Kof-K","KOF K","Kof K",
  "Vaad Harabanim of Bergen County","RCBC",
  "Rabbinical Council of Bergen County (RCBC)",
  "Vaad Harabanim - Rab Council of Bergen Cnty",
  "Vaad Hakashrus of the Capital District",
  "OK Kosher","OK Kosher Certification","O-K",
  "Rabbi Yechiel Babad","Tartikover Rav","Rabbi Babad - Tartikov",
  "Rabbi Shlomo Zvi Stern","Debrecener Rav",
  "Rabbi Aaron Teitelbaum","Rabbi Nuchem Efraim Teitelbaum","Volover Rav",
  "Vaad Hakashrus Belz","Belz","Belz USA","Vaad Hakashrus Belz USA",
  "Vaad Harabanim of Flatbush","Flatbush Vaad",
  "Vaad Hakashrus of Flatbush","Vaad Harabanim Flatbush",
  "Vaad Hakashrus Mishmeres L'Mishmeres",
  "Kehilah Kashrus","Kehilah Kashrus (A Flatbush Comm. Kashrus Org.)",
  "Kehilah Kashrus (Flatbush Community Kashrus Organization)",
  "Kehilah Kashrus A Flatbush Comm Kashrus Org",
  "Tarnopol Kashrus","Beth Din Minchas Chinuch",
  "Vaad Hakashrus Crown Heights","CHK",
  "Beth Din of Crown Heights Vaad Hakashrus",
  "Beth Din of Crown Heights Vaad Hakashrus (CHK)",
  "Vaad Hakashrus Crown Heights Inc",
  "Beth Din Hameyuchud L'inyonei Kashrus",
  "Vaad Hakashrus of Five Towns and Far Rockaway",
  "Five Towns Vaad","Five Towns",
  "Vaad of the Five Towns and Far Rockaway",
  "Vaad Harabonim of Queens","Queens Vaad",
  "Vaad Harabonim of Queens (VHQ)",
  "Vaad Hakashrus of Buffalo","Vaad Hakashrus of Mechon L'Hoyroa",
  "Rabbi Menachem Meir Weissmandel","Rabbi Chaim Meir Wagshal","Weissmandl",
  "New Square Beth Din","New Square","New Square Beth Din of Kashrus",
  "Khal Adath Jeshurun","KAJ","Breuer's","Khal Adath Jeshurun (Breuer's)",
  "Orthodox Union","OU","OU Kosher","O-U","Orthodox Union Kosher (OU)",
  "Rochester Kehillah Kosher","RKK","Rochester Kehillah Kosher RKK",
  "Rabbi Aaron Mendelson","Rabbi Yechiel Steinmetz",
  "Rabbi Asher Schechter","Rabbi Mehlman","Rabbi Yisrael P. Gornish",
  "Rabbi Shmuel Berger (the Mishkoltz Rav)",
  "Cincinnati Vaad Hoier","Cincinnati Kosher","Central Kosher",
  "Cincinnati Vaad Hoier, Cincinnati & Central Kosher",
  "Cleveland Kosher","Vaad Harabbonim Hachareidis Kashrus Cleveland","Ches Kosher",
  "Vaad Harabbonim Hachareidis Kashrus Cleveland, OH",
  "Oregon Kosher","Lancaster County Kosher","Keystone-K","Keystone K",
  "Keystone-K Philadelphia",
  "Rhode Island Kosher","RI Kosher","Vaad Hakashrus of Charleston",
  "Dallas Kosher","Vaad Hakashrus of Dallas",
  "Dallas Kosher (Vaad Hakashrus of Dallas)",
  "Houston Kashruth Association","Mehadrin Kashrus of Texas (MKT)",
  "Vaad Hakashrus of Tidewater",
  "Vaad HaRabanim of Greater Seattle","Seattle Vaad",
  "Kosher Supervisors of Wisconsin",
  "Central Rabbinical Congress (CRC)",
  "Vaad Harabonim of Riverdale",
  "Vaad of South Shore","KVH",
  "Va'ad Hakashruth of Westchester","Vaad Hakashrus of Fairfield County",
  "Cong. Nachlas Aron Volove",
]);

// ── Match supervision against CRC list ────────────────────────────────────────
function isCRC(supervision, crcSet) {
  if (!supervision) return false;
  const s = supervision.trim();
  if (!s || /check at/i.test(s)) return false;
  if (crcSet.has(s)) return true;
  const sl = s.toLowerCase();
  for (const a of crcSet) {
    if (a.length < 3) continue;
    const al = a.toLowerCase();
    if (sl.includes(al) || al.includes(sl)) return true;
  }
  return false;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  try {
    const params = event.queryStringParameters || {};
    const rad   = encodeURIComponent(params.rad   || '25');
    const place = encodeURIComponent(params.place || '');

    if (!params.place) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'place is required' }) };
    }

    // Fetch restaurant data and CRC list in parallel
    const [restaurantRaw, crcAgencies] = await Promise.all([
      fetchUrl(`https://api.koshernear.me/api/search/location?rad=${rad}&place=${place}`, 10000),
      fetchCRCAgencies(),
    ]);

    const data = JSON.parse(restaurantRaw);
    const crcSet = crcAgencies || CRC_FALLBACK;

    // Filter to CRC-approved only
    const approved = (data.hits || []).filter(h => isCRC(h.supervision, crcSet));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hits: approved,
        total_raw: data.hits?.length || 0,
        total_approved: approved.length,
        crc_source: crcAgencies ? 'live' : 'fallback',
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (e) {
    console.error('Function error:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
