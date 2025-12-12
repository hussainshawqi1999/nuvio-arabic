const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const BASE_URL = "https://wecima.ac";
const PROXY_URL = process.env.PROXY_URL || "";

const client = wrapper(axios.create({
    jar: new CookieJar(),
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
}));

async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try { const { data } = await client.get(target); return data; } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    try {
        const html = await fetchUrl(`${BASE_URL}/search/${encodeURIComponent(query)}`);
        if (!html) return null;
        const $ = cheerio.load(html);
        let pageUrl = null;
        $('.GridItem').each((i, el) => {
            if ($(el).text().includes(query)) { pageUrl = $(el).find('a').attr('href'); return false; }
        });
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        if (type === 'series') {
            const sHtml = await fetchUrl(pageUrl);
            if (sHtml) {
                const $$ = cheerio.load(sHtml);
                const ep = $$('.EpisodesList a').filter((i,el) => $$(el).text().includes(episode)).attr('href');
                if (ep) targetUrl = ep;
            }
        }

        const pHtml = await fetchUrl(targetUrl);
        if (!pHtml) return null;
        const $$$ = cheerio.load(pHtml);
        const watch = $$$('.WatchServersList ul li').first().attr('data-url');
        if (watch) return { name: "WeCima", title: `${query} ${season?`S${season}E${episode}`:''}`, url: watch, behaviorHints: { notWebReady: true } };
    } catch (e) {}
    return null;
}
module.exports = { getStream };
