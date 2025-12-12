const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');

// تحميل المزودات
let wecima = null;
let fasel = null;
let akwam = null; // الجديد

try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
    akwam = require('./providers/akwam_pro'); // استيراد أكوام
} catch (e) { console.error("Providers Error:", e.message); }

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// --- صفحة التثبيت (Installer) ---
const INSTALL_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuvio Arabic Ultimate</title>
    <style>
        body { background: #0b0b0b; color: #e1e1e1; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .container { background: #161616; padding: 40px; border-radius: 12px; text-align: center; max-width: 500px; width: 100%; border: 1px solid #333; }
        h1 { color: #a37dfc; margin-bottom: 10px; }
        .btn { display: block; width: 100%; padding: 15px; margin: 10px 0; border-radius: 8px; text-decoration: none; font-weight: bold; background: #a37dfc; color: #000; }
        .features span { color: #a37dfc; margin-right: 5px; }
        .features { text-align: left; margin-top: 20px; color: #aaa; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Nuvio Arabic Ultimate</h1>
        <p>Akwam + WeCima + FaselHD</p>
        <a id="installBtn" href="#" class="btn">🚀 Install Addon</a>
        <div class="features">
            <div><span>✓</span> Akwam (Direct Links)</div>
            <div><span>✓</span> FaselHD (1080p)</div>
            <div><span>✓</span> WeCima (Auto)</div>
        </div>
    </div>
    <script>
        const installUrl = window.location.href.replace(/^http/, 'stremio') + 'manifest.json';
        document.getElementById('installBtn').href = installUrl;
    </script>
</body>
</html>
`;

// --- إعداد الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.akwam",
    version: "4.5.0",
    name: "Nuvio Arabic (Akwam Edition)",
    description: "Arabic Content (Akwam + WeCima + FaselHD)",
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

// الستريم (البحث في 3 مصادر)
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

    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    const streams = [];
    const promises = [];

    // إضافة المصادر الثلاثة
    if (akwam) promises.push(akwam.getStream(queryName, type, season, episode).catch(e => null));
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => null));
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => null));

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

// الروابط
app.get('/', (req, res) => res.send(INSTALL_PAGE));
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
