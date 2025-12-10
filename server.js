const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const cors = require('cors');

const app = express();
app.use(cors());

const builder = new addonBuilder({
    id: "org.nuvio.arabic.debug",
    version: "1.0.0",
    name: "Nuvio Debug (Test)",
    description: "تجربة الاتصال فقط",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    catalogs: [
        { type: "movie", id: "debug.movies", name: "قائمة تجريبية" }
    ]
});

// كتالوج وهمي سريع
builder.defineCatalogHandler(({ type, id }) => {
    return Promise.resolve({
        metas: [
            {
                id: "tt1234567",
                type: "movie",
                name: "فيديو تجريبي (Test Video)",
                poster: "https://via.placeholder.com/300x450?text=Test+Video",
                description: "هذا فيديو لاختبار أن السيرفر يعمل."
            }
        ]
    });
});

// ستريم وهمي سريع
builder.defineStreamHandler(({ type, id }) => {
    return Promise.resolve({
        streams: [
            {
                title: "✅ Server Working (Click Me)",
                url: "https://www.w3schools.com/html/mov_bbb.mp4"
            }
        ]
    });
});

const addonInterface = builder.getInterface();

app.get('/', (req, res) => res.redirect('/manifest.json'));

app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // ضروري جداً
    res.json(addonInterface.manifest);
});

app.get('/catalog/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.catalog(req.params);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(resp);
});

app.get('/stream/:type/:id.json', async (req, res) => {
    const resp = await addonInterface.stream(req.params);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(resp);
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`Run on ${port}`));
}
