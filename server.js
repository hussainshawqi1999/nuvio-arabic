const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// استدعاء البروكسي من إعدادات فيرسل
const PROXY_URL = process.env.PROXY_URL || ""; // سيأخذ الرابط الذي وضعته
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c"; 

// إعداد عميل Axios
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, timeout: 15000 }));

// --- دالة الطلب الذكية (تستخدم البروكسي إذا وجد) ---
async function fetchUrl(url, headers = {}) {
    let targetUrl = url;
    const requestHeaders = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...headers 
    };

    if (PROXY_URL) {
        // نمرر الرابط عبر البروكسي الخاص بك
        targetUrl = `${PROXY_URL}${encodeURIComponent(url)}`;
        console.log(`🛡️ Proxy Request: ${url}`);
    } else {
        console.log(`🌍 Direct Request: ${url}`);
    }

    try {
        const { data } = await client.get(targetUrl, { headers: requestHeaders });
        return data;
    } catch (e) {
        console.error(`❌ Request Failed (${url}):`, e.message);
        return null;
    }
}

// --- المصدر 1: WeCima ---
async function getWeCima(query, season, episode) {
    try {
        const searchUrl = `https://mycima.wecima.show/search/${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;
        
        const $ = cheerio.load(html);
        let pageUrl = null;
        
        // البحث عن العنوان المطابق
        $('.GridItem').each((i, el) => {
            if ($(el).text().includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false;
            }
        });

        if (!pageUrl) return null;

        // اذا مسلسل، نبحث عن الحلقة
        if (season && episode) {
            const seriesHtml = await fetchUrl(pageUrl);
            if (seriesHtml) {
                const $$ = cheerio.load(seriesHtml);
                // البحث في قائمة الحلقات
                const epLink = $$('.EpisodesList a').filter((i, el) => {
                    const txt = $$(el).text();
                    return txt.includes(episode.toString()) || txt.includes(`حلقة ${episode}`);
                }).attr('href');
                
                if (epLink) pageUrl = epLink;
            }
        }

        // استخراج الرابط النهائي
        const pageHtml = await fetchUrl(pageUrl);
        if (!pageHtml) return null;
        
        const $$$ = cheerio.load(pageHtml);
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url') || $$$('iframe').attr('src');
        
        if (watchUrl) {
            return {
                name: "WeCima",
                title: `${query} \n ${season ? `S${season}E${episode}` : 'Movie'}`,
                url: watchUrl,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { console.log("WeCima Error"); }
    return null;
}

// --- المصدر 2: FaselHD ---
async function getFasel(query, season, episode) {
    try {
        const searchUrl = `https://www.faselhds.biz/?s=${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;

        const $ = cheerio.load(html);
        const pageUrl = $('#postList .postDiv a').first().attr('href');
        
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        // منطق الحلقات في فاصل (مبسط)
        if (season && episode) {
             const pageHtml = await fetchUrl(pageUrl);
             if (pageHtml) {
                 const $$ = cheerio.load(pageHtml);
                 const epLink = $$('#epAll a').filter((i, el) => $$(el).text().trim() == episode).attr('href');
                 if (epLink) targetUrl = epLink;
             }
        }

        const finalHtml = await fetchUrl(targetUrl);
        if (!finalHtml) return null;
        
        const $$$ = cheerio.load(finalHtml);
        const iframe = $$$('iframe[name="player_iframe"]').attr('src');

        if (iframe) {
            return {
                name: "FaselHD",
                title: `${query} [1080p]`,
                url: iframe,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { console.log("Fasel Error"); }
    return null;
}

// --- إعدادات الإضافة ---
const builder = new addonBuilder({
    id: "org.nuvio.arabic.proxy",
    version: "1.0.5",
    name: "Nuvio Arabic",
    description: "Arabic Content (Proxy Enabled)",
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
        const { data } = await axios.get(url);
        const metas = data.results.map(item => ({
            id: `tmdb:${item.id}`,
            type: type,
            name: item.name || item.title,
            poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
            description: item.overview
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// التشغيل
builder.defineStreamHandler(async ({ type, id }) => {
    let tmdbId = id.split(':')[1];
    let season = null;
    let episode = null;

    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        tmdbId = parts[1];
        season = parts[2];
        episode = parts[3];
    }

    // جلب الاسم
    let queryName = "";
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&language=ar-SA`);
        queryName = data.original_name || data.original_title || data.name || data.title;
    } catch (e) { return { streams: [] }; }

    console.log(`🔍 Seeking: ${queryName}`);

    // البحث في المصادر بالتوازي
    const [wecima, fasel] = await Promise.all([
        getWeCima(queryName, season, episode),
        getFasel(queryName, season, episode)
    ]);

    const streams = [];
    if (fasel) streams.push(fasel);
    if (wecima) streams.push(wecima);

    if (streams.length === 0) {
        streams.push({
            name: "Info",
            title: "❌ No links found via Proxy",
            url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        });
    }

    return { streams };
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`Run on ${port}`));
}
