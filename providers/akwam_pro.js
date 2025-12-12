const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// الدومين الأساسي (يتغير أحياناً مثل ak.sv أو akwam.to)
const BASE_URL = "https://ak.sv";
const PROXY_URL = process.env.PROXY_URL || "";

// إعداد المتصفح
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': BASE_URL
    },
    timeout: 15000
}));

// دالة لجلب الرابط (مع دعم البروكسي)
async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try {
        const { data, request } = await client.get(target);
        return { data, finalUrl: request.res.responseUrl || url };
    } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    console.log(`🕵️‍♂️ Akwam Searching: ${query}`);
    try {
        // 1. البحث
        // البايثون: search_url = self.url + '/search?q='
        const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
        const resSearch = await fetchUrl(searchUrl);
        if (!resSearch) return null;

        const $ = cheerio.load(resSearch.data);
        let pageUrl = null;

        // استخراج أول نتيجة مطابقة
        // البايثون يستخدم Regex، هنا نستخدم Cheerio أدق
        $('.entry-box').each((i, el) => {
            const title = $(el).find('.entry-title a').text().trim();
            // في أكوام، الأفلام والمسلسلات تظهر معاً
            if (title.toLowerCase().includes(query.toLowerCase())) {
                pageUrl = $(el).find('.entry-title a').attr('href');
                return false; // Break
            }
        });

        if (!pageUrl) return null;

        // 2. معالجة المسلسلات (Series Handling)
        let targetUrl = pageUrl;
        if (type === 'series') {
            // الدخول لصفحة المسلسل للبحث عن الحلقة
            const resSeries = await fetchUrl(pageUrl);
            if (!resSeries) return null;
            const $$ = cheerio.load(resSeries.data);
            
            // البايثون: fetch_episodes -> parse regex
            // هنا نبحث عن مربعات الحلقات
            const epLink = $$('.entry-box').filter((i, el) => {
                const title = $$(el).find('.entry-title a').text();
                // البحث عن رقم الحلقة (مثلاً "الحلقة 5" أو "Episode 5")
                return title.includes(episode.toString());
            }).find('.entry-title a').attr('href');

            if (!epLink) return null;
            targetUrl = epLink;
        }

        // 3. اختيار الجودة (Quality Selection)
        // ندخل صفحة الفيلم/الحلقة
        const resPage = await fetchUrl(targetUrl);
        if (!resPage) return null;
        const $$$ = cheerio.load(resPage.data);

        // البايثون: يبحث عن tab-content quality ويأخذ الرابط
        // نفضل 1080p ثم 720p
        let qualityLink = null;
        let qualityLabel = "High";

        // ترتيب الأولويات
        const qualities = ['1080p', '720p', '480p'];
        
        for (const q of qualities) {
            // نبحث عن التبويب الذي يحتوي الجودة
            const link = $$$(`.quality-list:contains("${q}") a`).attr('href') || 
                         $$$(`a:contains("${q}")`).attr('href');
            
            if (link) {
                qualityLink = link;
                qualityLabel = q;
                break;
            }
        }

        // إذا لم نجد، نأخذ أول رابط تحميل متاح
        if (!qualityLink) {
            qualityLink = $$$('.link-show a').attr('href');
        }

        if (!qualityLink) return null;

        // 4. الرابط المباشر (Direct Link Extraction)
        // أكوام يستخدم صفحة وسيطة (Shortener/Gateway)
        const resGateway = await fetchUrl(qualityLink);
        if (!resGateway) return null;
        
        // في صفحة البوابة، يوجد زر "تحميل" ينقلنا للملف
        const $$$$ = cheerio.load(resGateway.data);
        const downloadPageLink = $$$$('.download-link').attr('href') || $$$$('a.link').attr('href');

        if (downloadPageLink) {
            // أحياناً يكون هذا الرابط هو المباشر، وأحياناً صفحة أخرى
            // في كود البايثون: get_direct_url -> parse RGX_DIRECT_URL
            
            // سنجرب الدخول عليه، وإذا كان ملف فيديو نرجعه
            // أو نرجع الرابط كما هو إذا كان مباشراً
            return {
                name: "Akwam",
                title: `${query} [${qualityLabel}]`,
                url: downloadPageLink,
                behaviorHints: { notWebReady: true }
            };
        }

    } catch (e) { console.log("Akwam Error:", e.message); }
    return null;
}

module.exports = { getStream };
