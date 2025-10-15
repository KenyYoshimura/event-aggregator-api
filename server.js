// イベント情報取得API
const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const NodeCache = require('node-cache');

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
    version: '1.0.0',
    endpoints: {
      gizmodo: '/api/events/gizmodo',
      prtimes: '/api/events/prtimes',
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

// すべてのイベント取得
app.get('/api/events/all', async (req, res) => {
  try {
    const cached = cache.get('all_events');
    if (cached) {
      return res.json(cached);
    }

    const gizmodoEvents = await fetchGizmodoEvents();
    const prtimesEvents = await fetchPRTimesEvents();

    const allEvents = [...gizmodoEvents, ...prtimesEvents]
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

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Event Aggregator API running on port ${PORT}`);
  console.log(`📍 Access: http://localhost:${PORT}`);
});