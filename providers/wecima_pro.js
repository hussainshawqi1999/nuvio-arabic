const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const BASE_URL = "https://wecima.ac"; // الدومين الجديد
const PROXY_URL = process.env.PROXY_URL || ""; 

const client = wrapper(axios.create({
    jar: new CookieJar(),
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': BASE_URL
    },
    timeout: 15000
}));

// دالة لجلب الرابط عبر البروكسي إذا لزم الأمر
async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try {
        const { data } = await client.get(target);
        return data;
    } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    try {
        // 1. البحث
        const searchUrl = `${BASE_URL}/search/${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;
        
        const $ = cheerio.load(html);
        let pageUrl = null;
        
        $('.GridItem').each((i, el) => {
            const title = $(el).find('strong.Title').text().trim();
            if (title.includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false; 
            }
        });

        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        if (type === 'series') {
            const seriesHtml = await fetchUrl(pageUrl);
            if (seriesHtml) {
                const $$ = cheerio.load(seriesHtml);
                const epUrl = $$('.EpisodesList a').filter((i, el) => {
                    const text = $$(el).text(); 
                    const nums = text.match(/\d+/g); 
                    return text.includes(episode.toString()) || (nums && nums.includes(episode.toString()));
                }).first().attr('href');

                if (epUrl) targetUrl = epUrl;
            }
        }

        const pageHtml = await fetchUrl(targetUrl);
        if (!pageHtml) return null;
        
        const $$$ = cheerio.load(pageHtml);
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url');
        const iframeSrc = $$$('iframe').attr('src');
        const finalUrl = watchUrl || iframeSrc;

        if (finalUrl) {
            return {
                name: "WeCima",
                title: `${query} \n S${season}E${episode}`,
                url: finalUrl,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { }
    return null;
}
module.exports = { getStream };
