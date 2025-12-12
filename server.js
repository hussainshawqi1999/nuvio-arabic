const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');

// استيراد المزودات بأمان
let wecima = null;
let fasel = null;
try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
} catch (e) { console.error("Error loading providers:", e.message); }

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// --- 1. إعداد الإضافة والقوائم العربية ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.ultimate",
    version: "4.0.0",
    name: "Nuvio Arabic Ultimate",
    description: "مسلسلات وأفلام عربية (WeCima + FaselHD)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// معالج القوائم (الذي كان يسبب الخطأ سابقاً)
builder.defineCatalogHandler(async ({ type, id }) => {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    try {
        const { data } = await axios.get(url, { timeout: 5000 });
        const metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title || item.original_name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview,
            releaseInfo: (item.first_air_date || item.release_date || '').split('-')[0]
        }));
        return { metas };
    } catch (e) { 
        console.error("Catalog Error:", e.message);
        return { metas: [] }; 
    }
});

// معالج الستريم (البحث وجلب الروابط)
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 Stream Request: ${id}`);
    
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

    // جلب الاسم العربي
    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    const streams = [];
    const promises = [];

    // البحث في المزودات (إذا كانت محملة)
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => null));
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => null));

    // انتظار النتائج بحد أقصى لتجنب Timeout
    const results = await Promise.all(promises);
    results.forEach(res => { if (res) streams.push(res); });

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ No links / Blocked (Try Proxy)",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

// بناء الواجهة
const addonInterface = builder.getInterface();

// --- 2. إعدادات سيرفر Express ---

// صفحة التثبيت الجميلة
app.get('/', (req, res) => {
    const installUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
    const stremioUrl = installUrl.replace(/^http/, 'stremio');
    
    res.send(`
    <html>
    <head><title>Nuvio Arabic</title><style>body{background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px}a{background:#6a0dad;color:#fff;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:1.2em}p{color:#aaa;margin-bottom:30px}</style></head>
    <body>
        <h1>Nuvio Arabic Ultimate 🚀</h1>
        <p>مسلسلات وأفلام عربية (WeCima + FaselHD)</p>
        <a href="${stremioUrl}">📲 Install in Stremio</a>
        <br><br>
        <p style="font-size:0.8em">Manifest: ${installUrl}</p>
    </body>
    </html>
    `);
});

// رابط المانيفيست (مهم جداً)
app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(addonInterface.manifest);
});

// روابط الكتالوج والستريم
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

// تشغيل السيرفر
const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`🚀 Running on port ${port}`));
}
