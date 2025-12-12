const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const BASE_URL = "https://wecima.ac";
const PROXY_URL = process.env.PROXY_URL || "";

const client = wrapper(axios.create({
    jar: new CookieJar(),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' },
    timeout: 15000
}));

async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try { const { data } = await client.get(target); return data; } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    try {
        const searchUrl = `${BASE_URL}/search/${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;
        
        const $ = cheerio.load(html);
        let pageUrl = null;
        $('.GridItem').each((i, el) => {
            if ($(el).text().includes(query)) { pageUrl = $(el).find('a').attr('href'); return false; }
        });
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        if (type === 'series') {
            const seriesHtml = await fetchUrl(pageUrl);
            if (seriesHtml) {
                const $$ = cheerio.load(seriesHtml);
                const epUrl = $$('.EpisodesList a').filter((i, el) => {
                    return $$(el).text().includes(episode.toString());
                }).first().attr('href');
                if (epUrl) targetUrl = epUrl;
            }
        }

        const pageHtml = await fetchUrl(targetUrl);
        if (!pageHtml) return null;
        const $$$ = cheerio.load(pageHtml);
        const watchUrl = $$$('.WatchServersList ul li').first().attr('data-url') || $$$('iframe').attr('src');
        
        if (watchUrl) return { name: "WeCima", title: `${query}\nS${season}E${episode}`, url: watchUrl, behaviorHints: { notWebReady: true } };
    } catch (e) { }
    return null;
}
module.exports = { getStream };
