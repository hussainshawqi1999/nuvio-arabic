const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// قائمة دومينات احتياطية
const DOMAINS = [
    "https://mycima.wecima.show",
    "https://wecima.show",
    "https://w.wecima.show"
];

// دالة لاختيار دومين عشوائي (لتوزيع الضغط)
const BASE_URL = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];

// إعداد "التمويه" - Headers تجعل السيرفر يظن أننا متصفح Chrome
const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'TE': 'trailers'
};

const client = wrapper(axios.create({
    jar: new CookieJar(),
    headers: STEALTH_HEADERS,
    timeout: 8000 // تقليل المهلة لعدم التعليق
}));

async function getStream(query, type, season, episode) {
    console.log(`🔍 WeCima Searching (${BASE_URL}): ${query}`);
    try {
        // 1. البحث
        const searchUrl = `${BASE_URL}/search/${encodeURIComponent(query)}`;
        const { data } = await client.get(searchUrl);
        const $ = cheerio.load(data);
        
        let pageUrl = null;
        
        // تحسين دقة البحث
        $('.GridItem').each((i, el) => {
            const title = $(el).find('strong.Title').text().trim();
            // نتأكد أن العنوان يحتوي على الاسم
            if (title.includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false; 
            }
        });

        if (!pageUrl) {
            console.log("❌ WeCima: No results found");
            return null;
        }

        // 2. معالجة المسلسلات
        let targetUrl = pageUrl;
        if (type === 'series') {
            const seriesRes = await client.get(pageUrl);
            const $$ = cheerio.load(seriesRes.data);
            
            // البحث عن الحلقة
            let epUrl = null;
            $$('.EpisodesList a').each((i, el) => {
                const text = $$(el).text(); 
                const nums = text.match(/\d+/g); 
                // مطابقة رقم الحلقة بدقة
                if (nums && nums.includes(episode.toString())) {
                    epUrl = $$(el).attr('href');
                    return false;
                }
            });

            if (!epUrl) {
                console.log("❌ WeCima: Episode not found");
                return null;
            }
            targetUrl = epUrl;
        }

        // 3. استخراج الرابط النهائي
        const pageRes = await client.get(targetUrl);
        const $$$ = cheerio.load(pageRes.data);
        
        // محاولة استخراج عدة مصادر
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url');
        const iframeSrc = $$$('iframe').attr('src');
        const finalUrl = watchUrl || iframeSrc;

        if (finalUrl) {
            return {
                name: "WeCima",
                title: `${query}\nS${season}E${episode}`,
                url: finalUrl,
                behaviorHints: { 
                    notWebReady: true,
                    proxyHeaders: { "User-Agent": STEALTH_HEADERS['User-Agent'] } // تمرير الهيدر للمشغل
                }
            };
        }
    } catch (e) { 
        console.log("⚠️ WeCima Blocked/Error:", e.message); 
    }
    return null;
}

module.exports = { getStream };
