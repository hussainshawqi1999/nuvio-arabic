const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// --- صفحة الهبوط (Landing Page) ---
const LANDING_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuvio Arabic Installer</title>
    <style>
        body {
            background-color: #0f0f13;
            color: #ffffff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
        }
        .container {
            background: #1a1a1f;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            max-width: 400px;
            width: 90%;
            border: 1px solid #333;
        }
        h1 { margin-bottom: 10px; color: #a37dfc; }
        p { color: #aaa; margin-bottom: 30px; font-size: 0.9em; }
        .logo { width: 80px; margin-bottom: 20px; }
        
        .btn {
            display: block;
            width: 100%;
            padding: 15px;
            margin: 10px 0;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            font-size: 1.1em;
            transition: transform 0.2s, opacity 0.2s;
            cursor: pointer;
            border: none;
        }
        .btn-install {
            background: linear-gradient(135deg, #a37dfc, #7a4be0);
            color: white;
        }
        .btn-copy {
            background: #2b2b30;
            color: #ccc;
            font-size: 0.9em;
        }
        .btn:hover { opacity: 0.9; transform: translateY(-2px); }
        .footer { margin-top: 20px; font-size: 0.8em; color: #555; }
    </style>
</head>
<body>
    <div class="container">
        <img src="https://stremio.com/website/stremio-logo-small.png" alt="Stremio" class="logo">
        <h1>Nuvio Arabic Gold</h1>
        <p>أفضل محتوى عربي (WeCima + FaselHD) مباشرة في ستريميو.</p>

        <a id="installLink" href="#" class="btn btn-install">🚀 Install in Stremio</a>
        <button id="copyBtn" class="btn btn-copy" onclick="copyLink()">📋 Copy Link</button>

        <div class="footer">
            Version 2.0.5 • Powered by Vercel
        </div>
    </div>

    <script>
        // الحصول على الرابط الحالي
        const currentUrl = window.location.href; 
        const host = window.location.host;
        const protocol = window.location.protocol;

        // بناء رابط التثبيت (stremio://)
        // هذا يستبدل http بـ stremio و https بـ stremios
        const stremioProtocol = protocol === 'https:' ? 'stremio:' : 'stremio:';
        const manifestUrl = \`\${protocol}//\${host}/manifest.json\`;
        const installUrl = \`\${stremioProtocol}//\${host}/manifest.json\`;

        document.getElementById('installLink').href = installUrl;

        function copyLink() {
            navigator.clipboard.writeText(manifestUrl).then(() => {
                const btn = document.getElementById('copyBtn');
                btn.innerText = "✅ Copied!";
                setTimeout(() => btn.innerText = "📋 Copy Link", 2000);
            });
        }
    </script>
</body>
</html>
`;

// إعدادات البروكسي
const PROXY_URL = process.env.PROXY_URL || "";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const jar = new CookieJar();
const client = wrapper(axios.create({ jar, timeout: 15000 }));

// ... (باقي دوال السكرابينج fetchUrl, getWeCima, getFasel كما هي سابقاً بدون تغيير) ...
// لتوفير المساحة سأضع فقط التغيير في الأسفل، لكن يجب أن تبقي دوال السكرابينج موجودة

// دالة Fetch (ضعها هنا كما في الكود السابق)
async function fetchUrl(url, headers = {}) {
    let targetUrl = url;
    const requestHeaders = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...headers 
    };
    if (PROXY_URL) targetUrl = `${PROXY_URL}${encodeURIComponent(url)}`;
    try {
        const { data } = await client.get(targetUrl, { headers: requestHeaders });
        return data;
    } catch (e) { return null; }
}

// دالة WeCima (ضعها هنا كما في الكود السابق)
async function getWeCima(query, season, episode) {
    // ... نفس كود WeCima السابق ...
    try {
        const searchUrl = `https://mycima.wecima.show/search/${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;
        const $ = cheerio.load(html);
        let pageUrl = null;
        $('.GridItem').each((i, el) => {
            if ($(el).text().includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false;
            }
        });
        if (!pageUrl) return null;
        if (season && episode) {
            const seriesHtml = await fetchUrl(pageUrl);
            if (seriesHtml) {
                const $$ = cheerio.load(seriesHtml);
                const epLink = $$('.EpisodesList a').filter((i, el) => {
                    const txt = $$(el).text();
                    return txt.includes(episode.toString()) || txt.includes(`حلقة ${episode}`);
                }).attr('href');
                if (epLink) pageUrl = epLink;
            }
        }
        const pageHtml = await fetchUrl(pageUrl);
        if (!pageHtml) return null;
        const $$$ = cheerio.load(pageHtml);
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url') || $$$('iframe').attr('src');
        if (watchUrl) {
            return {
                name: "WeCima",
                title: `${query} \n ${season ? `S${season}E${episode}` : 'Movie'}`,
                url: watchUrl,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { }
    return null;
}

// دالة Fasel (ضعها هنا كما في الكود السابق)
async function getFasel(query, season, episode) {
    // ... نفس كود Fasel السابق ...
    try {
        const searchUrl = `https://www.faselhds.biz/?s=${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;
        const $ = cheerio.load(html);
        const pageUrl = $('#postList .postDiv a').first().attr('href');
        if (!pageUrl) return null;
        let targetUrl = pageUrl;
        if (season && episode) {
             const pageHtml = await fetchUrl(pageUrl);
             if (pageHtml) {
                 const $$ = cheerio.load(pageHtml);
                 const epLink = $$('#epAll a').filter((i, el) => $$(el).text().trim() == episode).attr('href');
                 if (epLink) targetUrl = epLink;
             }
        }
        const finalHtml = await fetchUrl(targetUrl);
        if (!finalHtml) return null;
        const $$$ = cheerio.load(finalHtml);
        const iframe = $$$('iframe[name="player_iframe"]').attr('src');
        if (iframe) {
            return {
                name: "FaselHD",
                title: `${query} [1080p]`,
                url: iframe,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { }
    return null;
}

// --- إعدادات الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.landing",
    version: "2.5.0",
    name: "Nuvio Arabic Gold",
    description: "Arabic Content via Proxy",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

builder.defineCatalogHandler(async ({ type, id }) => {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    try {
        const { data } = await axios.get(url);
        const metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

builder.defineStreamHandler(async ({ type, id }) => {
    let tmdbId = id.split(':')[1];
    let season = null;
    let episode = null;

    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        tmdbId = parts[1];
        season = parts[2];
        episode = parts[3];
    }

    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`);
        queryName = data.original_name || data.original_title || data.name || data.title;
    } catch (e) { return { streams: [] }; }

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
            title: "❌ No links found via Proxy",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// === التغيير هنا: عرض صفحة الويب بدلاً من التحويل المباشر ===
app.get('/', (req, res) => {
    res.send(LANDING_HTML);
});

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
else app.listen(port, () => console.log(`Run on ${port}`));
