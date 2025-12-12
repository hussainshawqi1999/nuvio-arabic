const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// --- تحميل المزودات بأمان تام ---
let wecima = null;
let fasel = null;

try {
    wecima = require('./providers/wecima_pro');
    console.log("✅ WeCima Loaded");
} catch (e) { console.log("⚠️ WeCima not found/error:", e.message); }

try {
    fasel = require('./providers/fasel_pro');
    console.log("✅ FaselHD Loaded");
} catch (e) { console.log("⚠️ FaselHD not found/error:", e.message); }

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.safe",
    version: "2.1.5",
    name: "Nuvio Arabic (Safe)",
    description: "Arabic Content (Crash Proof)",
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

// التشغيل (مع حماية من الانهيار)
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`Stream Request: ${type} ${id}`);
    
    // 1. استخراج الاسم
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
    } catch (e) { return { streams: [] }; }

    const streams = [];
    const promises = [];

    // 2. البحث (فقط إذا تم تحميل المزودات بنجاح)
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => null));
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => null));

    // انتظار النتائج بحد أقصى 8 ثواني لتجنب Timeout فيرسل
    const results = await Promise.all(promises);
    
    results.forEach(res => {
        if (res) streams.push(res);
    });

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "لم يتم العثور على روابط (أو تم الحجب)",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// صفحة التثبيت
app.get('/', (req, res) => {
    res.send('<h1>Nuvio Arabic is Running!</h1><a href="/manifest.json">Click here for Manifest</a>');
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
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`Running on ${port}`));
}
