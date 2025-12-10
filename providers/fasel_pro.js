const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://www.faselhds.biz";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer': BASE_URL,
    'Origin': BASE_URL
};

async function getStream(query, type, season, episode) {
    try {
        // 1. البحث
        const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}`, { headers: HEADERS, timeout: 8000 });
        const $ = cheerio.load(data);
        
        let pageUrl = null;
        $('#postList .postDiv').each((i, el) => {
            const title = $(el).find('.postTitle h3').text().trim();
            if (title.includes(query)) {
                pageUrl = $(el).find('a').attr('href');
                return false;
            }
        });

        if (!pageUrl) return null;

        // 2. المسلسلات
        let targetUrl = pageUrl;
        if (type === 'series') {
            const pageRes = await axios.get(pageUrl, { headers: HEADERS });
            const $$ = cheerio.load(pageRes.data);
            
            const epLink = $$('#epAll a').filter((i, el) => {
                return $(el).text().trim() == episode.toString();
            }).attr('href');

            if (!epLink) return null;
            targetUrl = epLink;
        }

        // 3. استخراج الرابط
        const finalRes = await axios.get(targetUrl, { headers: HEADERS });
        const $$$ = cheerio.load(finalRes.data);
        const iframeSrc = $$$('iframe[name="player_iframe"]').attr('src');

        if (iframeSrc) {
            return {
                name: "FaselHD (HQ)",
                title: `${query} [1080p]`,
                url: iframeSrc,
                behaviorHints: { notWebReady: true }
            };
        }

    } catch (e) { console.log("⚠️ Fasel Error:", e.message); }
    return null;
}

module.exports = { getStream };
