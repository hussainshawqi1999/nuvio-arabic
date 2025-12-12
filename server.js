const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// ==========================================
// 1. نظام التمويه المتقدم (Stealth System)
// ==========================================

// هذه الهيدرات توهم السيرفر بأن الطلب قادم من متصفح Chrome 123 على ويندوز
// بدلاً من سكربت Node.js
const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
};

// إنشاء "جرة كوكيز" لحفظ الجلسة (مهم جداً لتجاوز Cloudflare)
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    headers: STEALTH_HEADERS,
    timeout: 9000, // مهلة 9 ثواني (أقل من حد فيرسل الـ 10 ثواني)
    validateStatus: () => true // لا تفشل عند ظهور أخطاء 403/503 (لنتعامل معها يدوياً)
}));

// ==========================================
// 2. المزودات (Providers)
// ==========================================

// --- WeCima (وي سيما) ---
async function getWeCima(query, season, episode) {
    const BASE_URL = "https://mycima.wecima.show"; // تأكد أن هذا الدومين يعمل عندك
    console.log(`🕵️‍♂️ WeCima Hunting: ${query}`);

    try {
        // الخطوة 1: البحث مع هيدر Referer صحيح
        const searchUrl = `${BASE_URL}/search/${encodeURIComponent(query)}`;
        const res = await client.get(searchUrl, { 
            headers: { ...STEALTH_HEADERS, 'Referer': BASE_URL } 
        });

        // تحقق من الحظر
        if (res.status === 403 || res.status === 503) {
            console.log("❌ WeCima Blocked Vercel IP (Cloudflare Challenge)");
            return null;
        }

        const $ = cheerio.load(res.data);
        let pageUrl = null;
        
        $('.GridItem').each((i, el) => {
            const title = $(el).find('strong.Title').text().trim();
            if (title.includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false;
            }
        });

        if (!pageUrl) return null;

        // الخطوة 2: الدخول لصفحة المسلسل/الحلقة
        let targetUrl = pageUrl;
        if (season && episode) {
            // الدخول لصفحة المسلسل أولاً
            const seriesRes = await client.get(pageUrl, { 
                headers: { ...STEALTH_HEADERS, 'Referer': searchUrl } 
            });
            const $$ = cheerio.load(seriesRes.data);
            
            // البحث عن الحلقة
            const epLink = $$('.EpisodesList a').filter((i, el) => {
                const txt = $$(el).text();
                // بحث ذكي عن الرقم (مثلاً: "الحلقة 5" أو "5")
                const nums = txt.match(/\d+/g);
                return nums && nums.includes(episode.toString());
            }).first().attr('href');

            if (!epLink) return null;
            targetUrl = epLink;
        }

        // الخطوة 3: استخراج الفيديو
        const pageRes = await client.get(targetUrl, { 
            headers: { ...STEALTH_HEADERS, 'Referer': pageUrl } 
        });
        const $$$ = cheerio.load(pageRes.data);
        
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url') || $$$('iframe').attr('src');
        
        if (watchUrl) {
            return {
                name: "WeCima",
                title: `${query} \n ${season ? `S${season}E${episode}` : 'Movie'}`,
                url: watchUrl,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { console.log("⚠️ WeCima Error:", e.message); }
    return null;
}

// --- FaselHD (فاصل) ---
async function getFasel(query, season, episode) {
    const BASE_URL = "https://www.faselhds.biz";
    console.log(`🕵️‍♂️ Fasel Hunting: ${query}`);

    try {
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const res = await client.get(searchUrl, { 
            headers: { ...STEALTH_HEADERS, 'Referer': BASE_URL } 
        });

        if (res.status === 403) {
            console.log("❌ FaselHD Blocked Vercel IP");
            return null;
        }

        const $ = cheerio.load(res.data);
        const pageUrl = $('#postList .postDiv a').first().attr('href');
        
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        // منطق الحلقات في فاصل (غالباً تكون أزرار تحت المشغل)
        if (season && episode) {
             const pageRes = await client.get(pageUrl, { 
                 headers: { ...STEALTH_HEADERS, 'Referer': searchUrl } 
             });
             const $$ = cheerio.load(pageRes.data);
             const epLink = $$('#epAll a').filter((i, el) => $$(el).text().trim() == episode).attr('href');
             if (epLink) targetUrl = epLink;
        }

        const finalRes = await client.get(targetUrl, { 
            headers: { ...STEALTH_HEADERS, 'Referer': pageUrl } 
        });
        const $$$ = cheerio.load(finalRes.data);
        const iframe = $$$('iframe[name="player_iframe"]').attr('src');

        if (iframe) {
            return {
                name: "FaselHD",
                title: `${query} [1080p]`,
                url: iframe,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { console.log("⚠️ Fasel Error:", e.message); }
    return null;
}

// ==========================================
// 3. إعداد الإضافة (Stremio SDK)
// ==========================================

const builder = new addonBuilder({
    id: "org.nuvio.arabic.stealth",
    version: "3.5.0",
    name: "Nuvio Arabic (Stealth)",
    description: "أفلام ومسلسلات عربية (Vercel Edition)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// الكتالوج
builder.defineCatalogHandler(async ({ type, id }) => {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    try {
        const { data } = await axios.get(url, { timeout: 3000 });
        const metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title || item.original_name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// التشغيل
builder.defineStreamHandler(async ({ type, id }) => {
    let tmdbId = id.split(':')[1];
    let season = null;
    let episode = null;

    if (id.startsWith('tt')) return { streams: [] };

    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        tmdbId = parts[1];
        season = parseInt(parts[2]);
        episode = parseInt(parts[3]);
    }

    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔍 Searching: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    // تشغيل البحث بالتوازي (الأسرع يفوز)
    const [wecima, fasel] = await Promise.all([
        getWeCima(queryName, season, episode),
        getFasel(queryName, season, episode)
    ]);

    const streams = [];
    if (fasel) streams.push(fasel);
    if (wecima) streams.push(wecima);

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ Blocked by Cloudflare (Try Localhost)",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// صفحة الهبوط
const LANDING_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nuvio Arabic Stealth</title>
<style>
body{background:#0f0f13;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a1f;padding:40px;border-radius:15px;text-align:center;border:1px solid #333}
a{display:inline-block;background:#a37dfc;color:#fff;padding:12px 25px;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:20px}
</style>
</head>
<body>
<div class="box">
<h1>Nuvio Arabic (Vercel Edition)</h1>
<p>محاولة تخطي الحجب عبر التمويه</p>
<a id="install" href="#">Install Addon</a>
</div>
<script>
const proto = window.location.protocol.replace('http','stremio');
document.getElementById('install').href = \`\${proto}//\${window.location.host}/manifest.json\`;
</script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(LANDING_HTML));
app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(addonInterface.manifest);
});
app.get('/catalog/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.catalog(req.params);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(resp);
});
app.get('/stream/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.stream(req.params);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(resp);
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Running on ${port}`));
