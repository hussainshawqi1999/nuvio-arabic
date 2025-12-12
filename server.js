const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// --- إعدادات البروكسي ---
// هذا الرابط الذي أنشأته أنت
const PROXY_URL = process.env.PROXY_URL || "https://delicate-shadow-363f.hussainshawqi4.workers.dev/?url=";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// إعداد عميل Axios
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, timeout: 15000 }));

// --- دالة الطلب الذكية (تستخدم البروكسي) ---
async function fetchUrl(url, headers = {}) {
    let targetUrl = url;
    const requestHeaders = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...headers 
    };

    if (PROXY_URL) {
        targetUrl = `${PROXY_URL}${encodeURIComponent(url)}`;
    }

    try {
        const { data } = await client.get(targetUrl, { headers: requestHeaders });
        return data;
    } catch (e) {
        return null;
    }
}

// --- المصدر 1: WeCima ---
async function getWeCima(query, season, episode) {
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

// --- المصدر 2: FaselHD ---
async function getFasel(query, season, episode) {
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

// --- تعريف الإضافة (Builder) ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.gold",
    version: "2.5.0",
    name: "Nuvio Arabic Gold",
    description: "أفلام ومسلسلات عربية",
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
        const { data } = await axios.get(url);
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

    if (id.startsWith('tt')) {
        // لو جاء ID من IMDB نحاول البحث بالاسم لاحقاً (حالياً نتركه فارغاً)
        return { streams: [] }; 
    }

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
        console.log(`Searching: ${queryName}`);
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
            title: "❌ No links found (Try Localhost)",
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuvio Arabic</title>
    <style>
        body { background: #111; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { text-align: center; padding: 20px; background: #222; border-radius: 10px; }
        a { display: inline-block; background: #a37dfc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Nuvio Arabic Gold 🚀</h1>
        <p>مسلسلات وأفلام عربية (WeCima + FaselHD)</p>
        <a id="install" href="#">Install in Stremio</a>
    </div>
    <script>
        const proto = window.location.protocol.replace('http', 'stremio');
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
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`Run on ${port}`));
}
