const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');

// تحميل المزودات
let wecima = null;
let fasel = null;
let akwam = null;

try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
    akwam = require('./providers/akwam_pro');
    console.log("✅ Providers Loaded Successfully");
} catch (e) { console.error("⚠️ Providers Error:", e.message); }

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// --- إعداد الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.akwam",
    version: "5.0.0",
    name: "Nuvio Arabic Ultimate",
    description: "Akwam (Python Logic) + WeCima + FaselHD",
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
        const { data } = await axios.get(url, { timeout: 5000 });
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

// الستريم
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 Request: ${id}`);
    
    let tmdbId = id;
    let season = 1;
    let episode = 1;

    if (id.startsWith('tmdb:')) tmdbId = id.split(':')[1];
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
        console.log(`🔎 Searching: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    const streams = [];
    const promises = [];

    // البحث في المزودات (مع معالجة الأخطاء لكل واحد)
    if (akwam) promises.push(akwam.getStream(queryName, type, season, episode).catch(e => console.log('Akwam Fail:', e.message)));
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => console.log('Fasel Fail:', e.message)));
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => console.log('WeCima Fail:', e.message)));

    const results = await Promise.all(promises);
    results.forEach(res => { if (res) streams.push(res); });

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ No links found / Blocked",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// صفحة التثبيت
app.get('/', (req, res) => {
    const installUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
    const stremioUrl = installUrl.replace(/^http/, 'stremio');
    res.send(`
        <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px">
            <h1>Nuvio Arabic (Akwam Edition)</h1>
            <a href="${stremioUrl}" style="background:#a37dfc;color:#fff;padding:15px;text-decoration:none;border-radius:5px">🚀 Install in Stremio</a>
        </body>
    `);
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(addonInterface.manifest);
});
app.get('/catalog/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.catalog(req.params);
    res.json(resp);
});
app.get('/stream/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.stream(req.params);
    res.json(resp);
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Run on ${port}`));
