// イベント情報取得API
// Railway/Render/Herokuにデプロイ可能

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
      prtimes: '/api/events/prtimes?companies=nanga,chums,patagonia',
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

    const feed = await parser.parseURL('http://feeds.gizmodo.jp/rss/gizmodo/index.xml');
    
    const events = feed.items
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

    cache.set('gizmodo', events);
    res.json(events);
  } catch (error) {
    console.error('GIZMODO fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch GIZMODO events' });
  }
});

// PRTIMES企業別イベント取得
app.get('/api/events/prtimes', async (req, res) => {
  try {
    const companies = req.query.companies ? req.query.companies.split(',') : [];
    
    if (companies.length === 0) {
      return res.status(400).json({ error: 'companies parameter required' });
    }

    const cacheKey = `prtimes_${companies.join('_')}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // PRTIMES企業ID マッピング
    const companyIds = {
      'snowpeak': '73237',
      'nanga': '00000',
      'chums': '00000',
      'patagonia': '00000',
      'coleman': '00000',
      'danner': '00000',
      'goldwin': '00000',
      'keen': '00000',
      'callaway': '00000'
    };

    const allEvents = [];

    for (const company of companies) {
      const companyId = companyIds[company.toLowerCase()];
      if (!companyId || companyId === '00000') continue;

      try {
        const rssUrl = `https://prtimes.jp/main/html/searchrlp/company_id/${companyId}/rss_company.xml`;
        const feed = await parser.parseURL(rssUrl);
        
        const events = feed.items
          .filter(item => isEventRelated(item))
          .map(item => ({
            id: item.guid || item.link,
            title: item.title,
            description: item.contentSnippet || item.content,
            url: item.link,
            publishDate: item.pubDate || item.isoDate,
            source: `PRTIMES - ${company}`,
            category: 'プレスリリース',
            imageUrl: extractImageUrl(item)
          }));

        allEvents.push(...events);
      } catch (err) {
        console.error(`Error fetching ${company}:`, err);
      }
    }

    allEvents.sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
    
    const limitedEvents = allEvents.slice(0, 50);
    cache.set(cacheKey, limitedEvents);
    
    res.json(limitedEvents);
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

    const [gizmodoEvents, prtimesEvents] = await Promise.all([
      fetchGizmodoEvents(),
      fetchPRTimesEvents(['snowpeak'])
    ]);

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

// ヘルパー関数
function isEventRelated(item) {
  const eventKeywords = [
    'イベント', 'キャンペーン', '開催', '発売', 'リリース',
    'オープン', '開業', '展示', 'セール', 'フェス', 'フェア',
    'ワークショップ', '体験', '限定', '新作', '登場'
  ];
  
  const text = `${item.title} ${item.contentSnippet || ''}`.toLowerCase();
  return eventKeywords.some(keyword => text.includes(keyword));
}

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

async function fetchPRTimesEvents(companies) {
  const companyIds = {
    'snowpeak': '73237',
    'nanga': '00000',
    'chums': '00000',
    'patagonia': '00000',
    'coleman': '00000'
  };

  const allEvents = [];

  for (const company of companies) {
    const companyId = companyIds[company.toLowerCase()];
    if (!companyId || companyId === '00000') continue;

    try {
      const rssUrl = `https://prtimes.jp/main/html/searchrlp/company_id/${companyId}/rss_company.xml`;
      const feed = await parser.parseURL(rssUrl);
      
      const events = feed.items
        .filter(item => isEventRelated(item))
        .map(item => ({
          id: item.guid || item.link,
          title: item.title,
          description: item.contentSnippet || item.content,
          url: item.link,
          publishDate: item.pubDate || item.isoDate,
          source: `PRTIMES - ${company}`,
          category: 'プレスリリース',
          imageUrl: extractImageUrl(item)
        }));

      allEvents.push(...events);
    } catch (err) {
      console.error(`Internal error fetching ${company}:`, err);
    }
  }

  return allEvents;
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Event Aggregator API running on port ${PORT}`);
  console.log(`📍 Access: http://localhost:${PORT}`);
});