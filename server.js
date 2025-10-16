const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const NodeCache = require('node-cache');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ['dc:date', 'dcDate'],
      ['pubDate', 'pubDate'],
      ['media:thumbnail', 'thumbnail'],
      ['media:content', 'mediaContent']
    ]
  }
});

// キャッシュ設定(1時間)
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());

// ヘルスチェック
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Event Aggregator API',
    version: '2.0.0',
    endpoints: {
      gizmodo: '/api/events/gizmodo',
      prtimes: '/api/events/prtimes',
      facilities: '/api/events/facilities',
      all: '/api/events/all'
    }
  });
});

// GIZMODOのイベント情報取得
app.get('/api/events/gizmodo', async (req, res) => {
  try {
    const cached = cache.get('gizmodo');
    if (cached) {
      return res.json(cached);
    }

    const events = await fetchGizmodoEvents();
    cache.set('gizmodo', events);
    res.json(events);
  } catch (error) {
    console.error('GIZMODO fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch GIZMODO events' });
  }
});

// PRTIMESのイベント情報取得
app.get('/api/events/prtimes', async (req, res) => {
  try {
    const cached = cache.get('prtimes');
    if (cached) {
      return res.json(cached);
    }

    const events = await fetchPRTimesEvents();
    cache.set('prtimes', events);
    res.json(events);
  } catch (error) {
    console.error('PRTIMES fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch PRTIMES events' });
  }
});

// 商業施設のイベント情報取得
app.get('/api/events/facilities', async (req, res) => {
  try {
    const cached = cache.get('facilities');
    if (cached) {
      return res.json(cached);
    }

    const events = await fetchFacilitiesEvents();
    cache.set('facilities', events);
    res.json(events);
  } catch (error) {
    console.error('Facilities fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch facilities events' });
  }
});

// すべてのイベント取得
app.get('/api/events/all', async (req, res) => {
  try {
    const cached = cache.get('all_events');
    if (cached) {
      return res.json(cached);
    }

    const gizmodoEvents = await fetchGizmodoEvents();
    const prtimesEvents = await fetchPRTimesEvents();
    const facilitiesEvents = await fetchFacilitiesEvents();

    const allEvents = [...gizmodoEvents, ...prtimesEvents, ...facilitiesEvents]
      .sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate))
      .slice(0, 100);

    cache.set('all_events', allEvents);
    res.json(allEvents);
  } catch (error) {
    console.error('All events fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ヘルパー関数: イベント関連かチェック
function isEventRelated(item) {
  const eventKeywords = [
    'イベント', 'キャンペーン', '開催', '発売', 'リリース',
    'オープン', '開業', '展示', 'セール', 'フェス', 'フェア',
    'ワークショップ', '体験', '限定', '新作', '登場'
  ];
  
  const text = `${item.title} ${item.contentSnippet || ''}`.toLowerCase();
  return eventKeywords.some(keyword => text.includes(keyword));
}

// ヘルパー関数: 画像URL抽出
function extractImageUrl(item) {
  if (item.enclosure && item.enclosure.url) {
    return item.enclosure.url;
  }
  if (item.thumbnail && item.thumbnail.url) {
    return item.thumbnail.url;
  }
  
  const content = item.content || item['content:encoded'] || '';
  const imgMatch = content.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch) {
    return imgMatch[1];
  }
  
  return null;
}

// GIZMODO取得関数
async function fetchGizmodoEvents() {
  try {
    const feed = await parser.parseURL('http://feeds.gizmodo.jp/rss/gizmodo/index.xml');
    return feed.items
      .filter(item => isEventRelated(item))
      .map(item => ({
        id: item.guid || item.link,
        title: item.title,
        description: item.contentSnippet || item.content,
        url: item.link,
        publishDate: item.pubDate || item.isoDate,
        source: 'GIZMODO',
        category: 'テック',
        imageUrl: extractImageUrl(item)
      }))
      .slice(0, 20);
  } catch (error) {
    console.error('GIZMODO internal fetch error:', error);
    return [];
  }
}

// PRTIMES取得関数
async function fetchPRTimesEvents() {
  try {
    const feed = await parser.parseURL('https://prtimes.jp/index.rdf');
    return feed.items
      .filter(item => isEventRelated(item))
      .map(item => ({
        id: item.guid || item.link,
        title: item.title,
        description: item.contentSnippet || item.content,
        url: item.link,
        publishDate: item.pubDate || item.isoDate,
        source: 'PRTIMES',
        category: 'プレスリリース',
        imageUrl: extractImageUrl(item)
      }))
      .slice(0, 30);
  } catch (error) {
    console.error('PRTIMES fetch error:', error);
    return [];
  }
}

// 商業施設イベント取得関数
async function fetchFacilitiesEvents() {
  const allEvents = [];
  
  // 各施設は簡易実装(リンクのみ)
  allEvents.push({
    id: 'roppongi-hills',
    title: '六本木ヒルズ - イベント情報',
    description: '六本木ヒルズで開催中・開催予定のイベント情報',
    url: 'https://www.roppongihills.com/events/',
    publishDate: new Date().toISOString(),
    source: '六本木ヒルズ',
    category: 'イベント',
    imageUrl: null
  });
  
  allEvents.push({
    id: 'azabudai-hills',
    title: '麻布台ヒルズ - イベント情報',
    description: '麻布台ヒルズで開催中・開催予定のイベント情報',
    url: 'https://www.azabudai-hills.com/events/',
    publishDate: new Date().toISOString(),
    source: '麻布台ヒルズ',
    category: 'イベント',
    imageUrl: null
  });
  
  allEvents.push({
    id: 'skytree',
    title: '東京スカイツリー - イベント情報',
    description: '東京スカイツリーで開催中・開催予定のイベント情報',
    url: 'https://www.tokyo-skytree.jp/event/',
    publishDate: new Date().toISOString(),
    source: '東京スカイツリー',
    category: 'イベント',
    imageUrl: null
  });
  
  allEvents.push({
    id: 'futakotamagawa-rise',
    title: '二子玉川ライズ - イベント情報',
    description: '二子玉川ライズで開催中・開催予定のイベント情報',
    url: 'https://www.rise.sc/event/',
    publishDate: new Date().toISOString(),
    source: '二子玉川ライズ',
    category: 'イベント',
    imageUrl: null
  });
  
  allEvents.push({
    id: 'omotesando-hills',
    title: '表参道ヒルズ - イベント情報',
    description: '表参道ヒルズで開催中・開催予定のイベント情報',
    url: 'https://www.omotesandohills.com/events/',
    publishDate: new Date().toISOString(),
    source: '表参道ヒルズ',
    category: 'イベント',
    imageUrl: null
  });
  
  return allEvents;
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Event Aggregator API running on port ${PORT}`);
  console.log(`📍 Access: http://localhost:${PORT}`);
});