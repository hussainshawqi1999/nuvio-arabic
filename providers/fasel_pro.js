const axios = require('axios');
const cheerio = require('cheerio');
const BASE_URL = "https://www.faselhds.biz";
const PROXY_URL = process.env.PROXY_URL || "";

async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try { const { data } = await axios.get(target); return data; } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    try {
        const html = await fetchUrl(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
        if (!html) return null;
        const $ = cheerio.load(html);
        const pageUrl = $('#postList .postDiv a').first().attr('href');
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        if (type === 'series') {
            const pHtml = await fetchUrl(pageUrl);
            if (pHtml) {
                const $$ = cheerio.load(pHtml);
                const ep = $$('#epAll a').filter((i,el) => $$(el).text().trim() == episode).attr('href');
                if (ep) targetUrl = ep;
            }
        }

        const fHtml = await fetchUrl(targetUrl);
        if (!fHtml) return null;
        const $$$ = cheerio.load(fHtml);
        const iframe = $$$('iframe[name="player_iframe"]').attr('src');
        if (iframe) return { name: "FaselHD", title: `${query}`, url: iframe, behaviorHints: { notWebReady: true } };
    } catch (e) {}
    return null;
}
module.exports = { getStream };
