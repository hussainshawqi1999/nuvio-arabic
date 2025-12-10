const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// محاولة استيراد المزودات بأمان
let wecima = null;
let fasel = null;
try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
} catch (e) {
    console.error("⚠️ Provider import error:", e.message);
}

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.fast",
    version: "2.0.5", 
    name: "Nuvio Arabic (Fast)",
    description: "مسلسلات وأفلام عربية (Fast Timeout)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// 1. الكتالوج
builder.defineCatalogHandler(async ({ type, id }) => {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    
    try {
        const { data } = await axios.get(url, { timeout: 5000 }); // مهلة قصيرة للكتالوج
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

// دالة مساعدة لعمل timeout لأي Promise
const withTimeout = (millis, promise) => {
    const timeout = new Promise((resolve, reject) =>
        setTimeout(() => resolve(null), millis) // يرجع null إذا انتهى الوقت
    );
    return Promise.race([promise, timeout]);
};

// 2. التشغيل (مع حماية الزمن)
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 Requesting: ${type} ${id}`);
    
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
        // نعطي مهلة 3 ثواني فقط لجلب الاسم
        const { data } = await axios.get(url, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching: ${queryName}`);
    } catch (e) { 
        return { streams: [] }; 
    }

    const streams = [];

    // نجهز وعود البحث (Search Promises)
    const searchPromises = [];

    // إضافة فاصل إعلاني (مع مهلة داخلية 6 ثواني)
    if (fasel) {
        searchPromises.push(
            withTimeout(6000, fasel.getStream(queryName, type, season, episode))
                .then(res => res ? streams.push(res) : console.log("Fasel timed out or failed"))
                .catch(e => console.log("Fasel Error"))
        );
    }

    // إضافة وي سيما (مع مهلة داخلية 6 ثواني)
    if (wecima) {
        searchPromises.push(
            withTimeout(6000, wecima.getStream(queryName, type, season, episode))
                .then(res => res ? streams.push(res) : console.log("WeCima timed out or failed"))
                .catch(e => console.log("WeCima Error"))
        );
    }

    // ننتظر الجميع بحد أقصى 7 ثواني (أقل من حد فيرسل الـ 10 ثواني)
    await Promise.all(searchPromises);

    // إذا لم نجد أي روابط، نضيف رابط "وهمي" ليخبر المستخدم
    if (streams.length === 0) {
        streams.push({
            name: "Nuvio Arabic",
            title: "No streams found / Blocked by Vercel",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // رابط يوتيوب عشوائي
            behaviorHints: { notWebReady: true }
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
    app.listen(port, () => console.log(`🚀 Running on ${port}`));
}
