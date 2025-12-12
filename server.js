const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');

// تحميل المزودات بأمان (حتى لو فشلت، السيرفر سيعمل)
let providers = {};
try {
    providers.wecima = require('./providers/wecima_pro');
    providers.fasel = require('./providers/fasel_pro');
    providers.akwam = require('./providers/akwam_pro');
} catch (e) { console.error("⚠️ Warning: Some providers missing:", e.message); }

const app = express();
app.use(cors());

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// --- إعداد الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.rescue",
    version: "5.0.5", // تغيير الإصدار لإجبار التحديث
    name: "Nuvio Arabic (القائمة الإجبارية)",
    description: "أفلام ومسلسلات عربية (Fix Catalogs)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// --- الكتالوج (مع نظام الطوارئ) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`📂 طلب القائمة: ${type}`);
    
    let metas = [];
    
    // المحاولة 1: جلب البيانات الحقيقية من TMDB
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        // لاحظ: قللنا الترتيب والفلترة لتسريع الاستجابة
        const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&page=1`;
        
        const { data } = await axios.get(url, { timeout: 4000 }); // مهلة 4 ثواني
        
        if (data && data.results) {
            metas = data.results.map(item => ({
                id: `tmdb:${item.id}`,
                type: type,
                name: item.name || item.title || item.original_name,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview || "لا يوجد وصف",
            }));
        }
    } catch (e) {
        console.error("❌ فشل TMDB:", e.message);
    }

    // المحاولة 2 (الطوارئ): إذا كانت القائمة فارغة، أضف عنصراً يدوياً
    // هذا يضمن ظهور الفئة في ستريميو حتى لو فشل الاتصال
    if (metas.length === 0) {
        console.log("⚠️ تفعيل وضع الطوارئ للقائمة");
        metas.push({
            id: "tmdb:155257", // معرف حقيقي لمسلسل "سفاح الجيزة"
            type: "series",
            name: "سفاح الجيزة (وضع الطوارئ)",
            poster: "https://image.tmdb.org/t/p/w500/k0Y5P2jGg2VdY2u2K6i3q3.jpg",
            description: "ظهر هذا العنصر لأن الاتصال بـ TMDB فشل. لكن الإضافة تعمل! اضغط للمشاهدة."
        });
    }

    return { metas: metas };
});

// --- الستريم (البحث في المصادر) ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 طلب تشغيل: ${id}`);
    
    // استخراج ID واسم المسلسل
    let tmdbId = id;
    let season = 1; 
    let episode = 1;
    
    if (id.includes(":")) {
        const parts = id.replace("tmdb:", "").split(":");
        tmdbId = parts[0];
        if (parts.length > 1) { season = parts[1]; episode = parts[2]; }
    }

    // جلب الاسم (أو استخدام اسم افتراضي للتجربة)
    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`, { timeout: 3000 });
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 البحث عن: ${queryName}`);
    } catch (e) {
        // اسم احتياطي لو فشل TMDB
        if (id.includes("155257")) queryName = "سفاح الجيزة";
    }

    if (!queryName) return { streams: [] };

    // البحث في المزودات المتوفرة
    const promises = [];
    if (providers.akwam) promises.push(providers.akwam.getStream(queryName, type, season, episode).catch(e=>null));
    if (providers.fasel) promises.push(providers.fasel.getStream(queryName, type, season, episode).catch(e=>null));
    if (providers.wecima) promises.push(providers.wecima.getStream(queryName, type, season, episode).catch(e=>null));

    const results = await Promise.all(promises);
    const streams = results.filter(s => s); // تصفية النتائج الفارغة

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ لم يتم العثور على روابط / محجوب",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const addonInterface = builder.getInterface();

// صفحة التثبيت
app.get('/', (req, res) => {
    res.send('<h1>Nuvio Arabic Rescue 🚑</h1><a href="/manifest.json" style="font-size:20px">Click to Install</a>');
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
    app.listen(port, () => console.log(`Run on ${port}`));
}
