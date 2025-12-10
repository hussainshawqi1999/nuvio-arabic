const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const wecima = require('./providers/wecima_pro');
const fasel = require('./providers/fasel_pro');

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.gold",
    version: "2.0.0",
    name: "Nuvio Arabic (Gold)",
    description: "مسلسلات وأفلام عربية (FaselHD + WeCima)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية رائجة" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية حديثة" }
    ]
});

// 1. الكتالوج (فلترة المحتوى العربي فقط)
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
            description: item.overview,
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// 2. التشغيل (دمج المصادر)
builder.defineStreamHandler(async ({ type, id }) => {
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
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`;
        const { data } = await axios.get(url);
        queryName = data.original_name || data.original_title || data.name || data.title;
    } catch (e) { return { streams: [] }; }

    console.log(`🔎 Searching: ${queryName} S${season}E${episode}`);

    const streams = [];

    // المصدر 1: فاصل إعلاني
    try {
        const faselLink = await fasel.getStream(queryName, type, season, episode);
        if (faselLink) streams.push(faselLink);
    } catch (e) { console.log("Fasel Error"); }

    // المصدر 2: وي سيما
    try {
        const wecimaLink = await wecima.getStream(queryName, type, season, episode);
        if (wecimaLink) streams.push(wecimaLink);
    } catch (e) { console.log("WeCima Error"); }

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

// إعداد خاص لـ Vercel
const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`🚀 Addon running on port ${port}`));
}