const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://www.faselhds.biz";
const PROXY_URL = process.env.PROXY_URL || "";

async function fetchUrl(url) {
    const target = PROXY_URL ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
    try {
        const { data } = await axios.get(target);
        return data;
    } catch (e) { return null; }
}

async function getStream(query, type, season, episode) {
    try {
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const html = await fetchUrl(searchUrl);
        if (!html) return null;

        const $ = cheerio.load(html);
        const pageUrl = $('#postList .postDiv a').first().attr('href');
        
        if (!pageUrl) return null;

        let targetUrl = pageUrl;
        if (type === 'series') {
            const pageHtml = await fetchUrl(pageUrl);
            if (pageHtml) {
                const $$ = cheerio.load(pageHtml);
                const epLink = $$('#epAll a').filter((i, el) => $$(el).text().trim() == episode.toString()).attr('href');
                if (epLink) targetUrl = epLink;
            }
        }

        const finalHtml = await fetchUrl(targetUrl);
        if (!finalHtml) return null;
        
        const $$$ = cheerio.load(finalHtml);
        const iframeSrc = $$$('iframe[name="player_iframe"]').attr('src');

        if (iframeSrc) {
            return {
                name: "FaselHD",
                title: `${query} [1080p]`,
                url: iframeSrc,
                behaviorHints: { notWebReady: true }
            };
        }
    } catch (e) { }
    return null;
}
module.exports = { getStream };
