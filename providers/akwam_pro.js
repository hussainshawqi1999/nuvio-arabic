const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// الدومين الأساسي (يتغير باستمرار، تأكد منه)
const BASE_URL = "https://ak.sv";
const PROXY_URL = process.env.PROXY_URL || "";

const client = wrapper(axios.create({
    jar: new CookieJar(),
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': BASE_URL
    },
    timeout: 15000,
    maxRedirects: 5 // السماح بالتوجيهات
}));

// دالة جلب مع دعم البروكسي
async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try {
        // request.res.responseUrl مهم جداً لمعرفة الرابط النهائي بعد التحويل
        const response = await client.get(target);
        return { 
            data: response.data, 
            finalUrl: response.request.res.responseUrl || url 
        };
    } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    console.log(`🕵️‍♂️ Akwam Searching: ${query}`);
    try {
        // 1. البحث
        const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
        const res1 = await fetchUrl(searchUrl);
        if (!res1) return null;

        const $ = cheerio.load(res1.data);
        let pageUrl = null;

        // مطابقة العنوان
        $('.entry-box').each((i, el) => {
            const title = $(el).find('.entry-title a').text().trim();
            if (title.toLowerCase().includes(query.toLowerCase())) {
                pageUrl = $(el).find('.entry-title a').attr('href');
                return false;
            }
        });

        if (!pageUrl) return null;

        // 2. إذا مسلسل، ابحث عن الحلقة
        let targetUrl = pageUrl;
        if (type === 'series') {
            const res2 = await fetchUrl(pageUrl);
            if (!res2) return null;
            const $$ = cheerio.load(res2.data);
            
            // في أكوام الحلقات تكون مربعات
            const epLink = $$('.entry-box').filter((i, el) => {
                const title = $$(el).find('.entry-title a').text();
                // نبحث عن الرقم ككلمة مستقلة أو "الحلقة X"
                return title.includes(episode.toString());
            }).find('.entry-title a').attr('href');

            if (!epLink) return null;
            targetUrl = epLink;
        }

        // 3. صفحة الجودة (Extraction Logic like Python)
        const res3 = await fetchUrl(targetUrl);
        if (!res3) return null;
        const $$$ = cheerio.load(res3.data);

        // منطق البايثون: البحث عن رابط الجودة الذي يحتوي على /link/
        // RGX_DL_URL = r'https?://(\w*\.*\w+\.\w+/link/\d+)'
        let linkUrl = null;
        let qualityLabel = "High";

        // نفضل 1080 ثم 720
        const qualities = ['1080p', '720p', '480p'];
        for (const q of qualities) {
            // نبحث في التبويبات أو الروابط المباشرة
            const href = $$$(`a:contains("${q}")`).attr('href');
            if (href && href.includes('/link/')) {
                linkUrl = href;
                qualityLabel = q;
                break;
            }
        }
        
        // fallback
        if (!linkUrl) linkUrl = $$$('a[href*="/link/"]').first().attr('href');

        if (!linkUrl) return null;

        // 4. فك الرابط المختصر (Shortened URL)
        // Python: get(link_url) -> parse RGX_SHORTEN_URL (.../download/...)
        const res4 = await fetchUrl(linkUrl);
        if (!res4) return null;
        
        // البحث عن رابط التحميل في الصفحة
        const $$$$ = cheerio.load(res4.data);
        const downloadUrl = $$$$('a[href*="/download/"]').attr('href');

        if (!downloadUrl) return null;

        // 5. الرابط المباشر النهائي (Direct URL)
        // Python: get(download_url) -> parse RGX_DIRECT_URL
        // في الواقع، الدخول على رابط /download/ في أكوام يقوم بتوجيهك (Redirect) للرابط المباشر
        const res5 = await fetchUrl(downloadUrl);
        
        // هنا نستخدم finalUrl الذي يوفره axios بعد التوجيه
        const finalDirectLink = res5.finalUrl;

        // تحقق بسيط أن الرابط ليس صفحة html
        if (finalDirectLink && !finalDirectLink.includes('/download/')) {
            return {
                name: "Akwam",
                title: `${query} [${qualityLabel}]`,
                url: finalDirectLink,
                behaviorHints: { notWebReady: true }
            };
        }

    } catch (e) { console.log("Akwam Error:", e.message); }
    return null;
}

module.exports = { getStream };
