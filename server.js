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
} catch (e) { console.error("Providers Error:", e.message); }

const app = express();
app.use(cors());

// مفتاح TMDB (يفضل استبداله بمفتاحك الخاص)
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.fixed",
    version: "6.0.0", // قمت بتغيير الإصدار لإجبار التحديث
    name: "Nuvio Arabic (Fixed)",
    description: "أفلام ومسلسلات عربية (Fix Catalogs)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية (Nuvio)" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية (Nuvio)" }
    ]
});

// --- الكتالوج (مع بيانات احتياطية) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`📂 Catalog Request: ${type} ${id}`);
    
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    
    let metas = [];

    try {
        const { data } = await axios.get(url, { timeout: 5000 });
        metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title || item.original_name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview,
            releaseInfo: (item.first_air_date || item.release_date || '').split('-')[0]
        }));
    } catch (e) { 
        console.error("TMDB Error:", e.message);
    }

    // 🔥 الحل الجذري: إذا فشل TMDB أو كان فارغاً، نضيف عناصر يدوية لتظهر القائمة
    if (metas.length === 0) {
        metas.push({
            id: "tmdb:155257", // مسلسل سفاح الجيزة كمثال
            type: "series",
            name: "سفاح الجيزة (تجريبي)",
            poster: "https://image.tmdb.org/t/p/w500/k0Y5P2jGg2VdY2u2K6i3q3.jpg",
            description: "هذا عنصر تجريبي يظهر لأن الاتصال بـ TMDB فشل. الرجاء التحقق من المفتاح."
        });
        metas.push({
            id: "tmdb:115998", // الحشاشين
            type: "series",
            name: "الحشاشين (تجريبي)",
            poster: "https://image.tmdb.org/t/p/w500/k0Y5P2jGg2VdY2u2K6i3q3.jpg", // صورة مؤقتة
            description: "عنصر احتياطي لضمان ظهور القائمة."
        });
    }

    return { metas };
});

// --- الستريم ---
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

    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
    } catch (e) { 
        // اسم احتياطي للتجربة
        if (id.includes("155257")) queryName = "سفاح الجيزة";
        else if (id.includes("115998")) queryName = "الحشاشين";
    }

    const streams = [];
    const promises = [];

    if (akwam) promises.push(akwam.getStream(queryName, type, season, episode).catch(e => null));
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => null));
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => null));

    const results = await Promise.all(promises);
    results.forEach(res => { if (res) streams.push(res); });

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ No links found / Try Proxy",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

app.get('/', (req, res) => {
    const installUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
    const stremioUrl = installUrl.replace(/^http/, 'stremio');
    res.send(`<a href="${stremioUrl}" style="font-size:2em;">Install Nuvio Arabic</a>`);
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
