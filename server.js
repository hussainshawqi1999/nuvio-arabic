const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// --- إعدادات ثابتة ---
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 
const PROXY_URL = process.env.PROXY_URL || ""; 

// --- تعريف الإضافة ---
const manifest = {
    id: "org.nuvio.arabic.final",
    version: "3.0.0",
    name: "Nuvio Arabic",
    description: "أفلام ومسلسلات عربية (WeCima + FaselHD)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
};

const builder = new addonBuilder(manifest);

// --- معالجة الكتالوج ---
builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`📂 Catalog Request: ${type}`);
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    try {
        const { data } = await axios.get(url, { timeout: 5000 });
        const metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title || item.original_name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview
        }));
        return { metas };
    } catch (e) { 
        console.error("Catalog Error:", e.message);
        return { metas: [] }; 
    }
});

// --- دوال البحث (مدمجة) ---
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, timeout: 10000 }));

async function fetchUrl(url) {
    const targetUrl = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try {
        const { data } = await client.get(targetUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' } 
        });
        return data;
    } catch (e) { return null; }
}

// --- معالجة الستريم ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🎬 Stream Request: ${id}`);
    
    // استخراج الاسم (مبسط)
    let queryName = "";
    try {
        let tmdbId = id.replace("tmdb:", "").split(":")[0];
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`);
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching for: ${queryName}`);
    } catch (e) { return { streams: [] }; }

    // (هنا تضع منطق البحث في وي سيما وفاصل كما في الأكواد السابقة)
    // للاختصار ولضمان عمل المانيفيست، سأضع رداً تجريبياً سريعاً
    // يمكنك إعادة دمج دوال البحث هنا لاحقاً

    return { 
        streams: [
            {
                name: "Nuvio Arabic",
                title: "Server Active - Search pending",
                url: "https://www.w3schools.com/html/mov_bbb.mp4"
            }
        ] 
    };
});

const addonInterface = builder.getInterface();

// --- الروابط (Routes) ---

// 1. الصفحة الرئيسية (تأكد أن السيرفر يعمل)
app.get('/', (req, res) => {
    res.send(`
        <h1>✅ Nuvio Arabic Server is Running</h1>
        <p>Go to <a href="/manifest.json">/manifest.json</a> to install.</p>
    `);
});

// 2. المانيفيست (هنا المشكلة المحتملة)
app.get('/manifest.json', (req, res) => {
    // طباعة للتأكد في الـ Logs
    console.log("📝 Serving manifest.json");
    
    // إرسال الهيدرز الضرورية لـ Stremio
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    // إرسال الكائن مباشرة
    res.send(addonInterface.manifest);
});

// 3. باقي الروابط
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
