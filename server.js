const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// تحميل المزودات
let wecima = null;
let fasel = null;
try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
} catch (e) { console.error("Providers Error:", e.message); }

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// --- صفحة التثبيت (Installer Page) ---
const INSTALL_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuvio Arabic Ultimate</title>
    <style>
        body {
            background-color: #0b0b0b;
            color: #e1e1e1;
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: #161616;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            text-align: center;
            max-width: 500px;
            width: 100%;
            border: 1px solid #333;
        }
        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #6a0dad, #a37dfc);
            border-radius: 50%;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 40px;
            font-weight: bold;
            color: white;
            box-shadow: 0 0 20px rgba(163, 125, 252, 0.4);
        }
        h1 { margin: 0 0 10px; color: #fff; font-size: 24px; }
        p { color: #888; margin-bottom: 30px; line-height: 1.5; }
        
        .btn {
            display: block;
            width: 100%;
            padding: 16px;
            margin: 10px 0;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.2s ease;
            border: none;
            cursor: pointer;
            box-sizing: border-box;
        }
        .btn-install {
            background: #a37dfc;
            color: #0b0b0b;
        }
        .btn-install:hover {
            background: #b595fd;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(163, 125, 252, 0.3);
        }
        .btn-copy {
            background: #2a2a2a;
            color: #ccc;
        }
        .btn-copy:hover {
            background: #333;
            color: #fff;
        }
        .features {
            text-align: left;
            margin-top: 30px;
            background: #111;
            padding: 15px;
            border-radius: 8px;
            font-size: 14px;
            color: #aaa;
        }
        .features div { margin-bottom: 8px; }
        .features span { color: #a37dfc; margin-right: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">NA</div>
        <h1>Nuvio Arabic Ultimate</h1>
        <p>The best Arabic content experience for Stremio. Powered by WeCima & FaselHD.</p>

        <a id="installBtn" href="#" class="btn btn-install">🚀 Install Addon</a>
        <button id="copyBtn" class="btn btn-copy" onclick="copyLink()">📋 Copy Manifest Link</button>

        <div class="features">
            <div><span>✓</span> Native Arabic Interface (TMDB)</div>
            <div><span>✓</span> FaselHD (1080p) + WeCima (Auto)</div>
            <div><span>✓</span> Proxy Support (Anti-Block)</div>
        </div>
    </div>

    <script>
        const host = window.location.host;
        const protocol = window.location.protocol;
        const manifestUrl = \`\${protocol}//\${host}/manifest.json\`;
        
        const stremioProto = protocol === 'https:' ? 'stremio:' : 'stremio:';
        const installUrl = \`\${stremioProto}//\${host}/manifest.json\`;

        document.getElementById('installBtn').href = installUrl;

        function copyLink() {
            navigator.clipboard.writeText(manifestUrl).then(() => {
                const btn = document.getElementById('copyBtn');
                const originalText = btn.innerText;
                btn.innerText = "✅ Copied!";
                btn.style.background = "#2ea043";
                btn.style.color = "white";
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.style.background = "#2a2a2a";
                    btn.style.color = "#ccc";
                }, 2000);
            });
        }
    </script>
</body>
</html>
`;

// --- تعريف الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.ultimate",
    version: "4.0.0",
    name: "Nuvio Arabic Ultimate",
    description: "Arabic Movies & Series (WeCima + FaselHD)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// --- 1. الكتالوج (عربي فقط) ---
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
    } catch (e) { return { metas: [] }; }
});

// --- 2. الستريم (البحث) ---
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

    // البحث في المزودات بالتوازي
    if (fasel) promises.push(fasel.getStream(queryName, type, season, episode).catch(e => null));
    if (wecima) promises.push(wecima.getStream(queryName, type, season, episode).catch(e => null));

    const results = await Promise.all(promises);
    results.forEach(res => { if (res) streams.push(res); });

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ No links found / Blocked (Check Proxy)",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// --- الروابط ---
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
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`🚀 Running on http://localhost:${port}`));
}
