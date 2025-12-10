const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// تحميل المزودات
let wecima = require('./providers/wecima_pro');
let fasel = require('./providers/fasel_pro');

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.v3",
    version: "2.1.0",
    name: "Nuvio Arabic (Stealth)",
    description: "مسلسلات وأفلام عربية (Stealth Mode)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// الكتالوج (TMDB)
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
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// دالة المهلة الزمنية
const withTimeout = (millis, promise) => {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(null), millis))
    ]);
};

// التشغيل
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 Request: ${type} ${id}`);
    
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
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`;
        const { data } = await axios.get(url, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching Name: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    const streams = [];
    const promises = [];

    // طلب الروابط مع مهلة 5 ثواني فقط لكل مصدر
    promises.push(withTimeout(5000, fasel.getStream(queryName, type, season, episode)));
    promises.push(withTimeout(5000, wecima.getStream(queryName, type, season, episode)));

    const results = await Promise.all(promises);
    
    results.forEach(res => {
        if (res) streams.push(res);
    });

    // === رابط الاختبار (سيظهر دائماً للتأكد أن الإضافة تعمل) ===
    if (streams.length === 0) {
        streams.push({
            name: "Server Status",
            title: "⚠️ No Links Found / Blocked \n Click to test connection",
            url: "https://www.w3schools.com/html/mov_bbb.mp4", // فيديو تجريبي صغير
            behaviorHints: { notWebReady: false }
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();
app.get('/', (req, res) => res.redirect('/manifest.json'));
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(resp);
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`🚀 Running on ${port}`));
}
