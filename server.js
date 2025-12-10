const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// استيراد المزودات (تأكد أن الملفات موجودة في مجلد providers)
// نستخدم try-catch لتجنب انهيار السيرفر إذا كان الملف ناقصاً
let wecima = null;
let fasel = null;
try {
    wecima = require('./providers/wecima_pro');
    fasel = require('./providers/fasel_pro');
} catch (e) {
    console.error("⚠️ Error loading providers:", e.message);
}

const app = express();
app.use(cors());

// مفتاح TMDB (استخدمنا المفتاح العام الموجود في ملفاتك)
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

const builder = new addonBuilder({
    id: "org.nuvio.arabic.gold",
    version: "2.0.1", // تحديث النسخة
    name: "Nuvio Arabic (Gold)",
    description: "أفضل محتوى عربي (WeCima + FaselHD)",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "series", id: "ar.series", name: "مسلسلات عربية" },
        { type: "movie", id: "ar.movies", name: "أفلام عربية" }
    ]
});

// 1. الكتالوج (جلب المحتوى العربي فقط من TMDB)
builder.defineCatalogHandler(async ({ type, id }) => {
    const tmdbType = type === 'series' ? 'tv' : 'movie';
    // طلب المحتوى الذي لغته الأصلية عربية (ar)
    const url = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${TMDB_KEY}&with_original_language=ar&sort_by=popularity.desc&page=1`;
    
    try {
        const { data } = await axios.get(url);
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

// 2. التشغيل (البحث في المصادر العربية)
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`🚀 Requesting stream for: ${type} ${id}`);
    
    let tmdbId = id;
    let season = 1;
    let episode = 1;

    // استخراج معرف TMDB وتفاصيل الحلقة
    if (id.startsWith('tmdb:')) {
        tmdbId = id.split(':')[1];
    } 
    
    // دعم معرفات IMDB (tt...) بتحويلها لـ TMDB (اختياري، للتبسيط سنعتمد على الاسم)
    
    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        tmdbId = parts[1]; // في حالة tmdb:123:1:1
        season = parseInt(parts[2]);
        episode = parseInt(parts[3]);
    }

    // جلب الاسم العربي للبحث
    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        // نجلب التفاصيل باللغة العربية
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`;
        const { data } = await axios.get(url);
        queryName = data.original_name || data.original_title || data.name || data.title;
        console.log(`🔎 Searching for: ${queryName} (S${season} E${episode})`);
    } catch (e) { 
        console.error("TMDB Details Error:", e.message);
        return { streams: [] }; 
    }

    const streams = [];

    // محاولة الجلب من المزودات (بشكل متوازي لسرعة أكبر)
    const promises = [];

    // 1. فاصل إعلاني (جودة عالية)
    if (fasel) {
        promises.push(fasel.getStream(queryName, type, season, episode).then(stream => {
            if (stream) streams.push(stream);
        }).catch(e => console.error("Fasel Error:", e.message)));
    }

    // 2. وي سيما (مكتبة ضخمة)
    if (wecima) {
        promises.push(wecima.getStream(queryName, type, season, episode).then(stream => {
            if (stream) streams.push(stream);
        }).catch(e => console.error("WeCima Error:", e.message)));
    }

    await Promise.all(promises);

    // ترتيب النتائج (نفضل 1080p)
    streams.sort((a, b) => (b.title.includes('1080') ? 1 : 0) - (a.title.includes('1080') ? 1 : 0));

    return { streams };
});

const addonInterface = builder.getInterface();

// إعدادات Express لـ Vercel
app.get('/', (req, res) => {
    res.redirect('/manifest.json');
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

// هذا الجزء هو الأهم لـ Vercel Serverless Function
const port = process.env.PORT || 7000;

// إذا كنا في بيئة Vercel، نقوم بتصدير التطبيق بدلاً من تشغيله
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // إذا كنا محلياً، نقوم بتشغيل السيرفر
    app.listen(port, () => {
        console.log(`🚀 Nuvio Arabic running on http://localhost:${port}`);
    });
}
