const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://www.faselhds.biz";

async function getStream(query, type, season, episode) {
    try {
        const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
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

        let targetUrl = pageUrl;
        if (type === 'series') {
            const pageRes = await axios.get(pageUrl);
            const $$ = cheerio.load(pageRes.data);
            
            const epLink = $$('#epAll a').filter((i, el) => {
                return $(el).text().trim() == episode.toString();
            }).attr('href');

            if (!epLink) return null;
            targetUrl = epLink;
        }

        const finalRes = await axios.get(targetUrl);
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

    } catch (e) { }
    return null;
}
module.exports = { getStream };