const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const NodeCache = require('node-cache');
const axios = require('axios');

const app = express();
const parser = new Parser({
  customFields: {
    item: ['dc:creator', 'content:encoded']
  }
});

// キャッシュ設定 (30分)
const cache = new NodeCache({ stdTTL: 1800 });

app.use(cors());
app.use(express.json());

// イベント関連のキーワード
const eventKeywords = [
  'イベント', 'event', '開催', '展示', '展覧会', 'エキシビション', 'exhibition',
  'フェス', 'festival', 'ライブ', 'live', 'コンサート', 'concert',
  'ワークショップ', 'workshop', 'セミナー', 'seminar', '体験', 'experience',
  '限定', '期間限定', 'ポップアップ', 'popup', 'pop-up', 'キャンペーン', 'campaign',
  '発売', 'release', 'オープン', 'open', 'グランドオープン', 'grand opening',
  'コラボ', 'collaboration', '特別', 'special', 'フェア', 'fair'
];

// テキストがイベント関連かどうかを判定
function isEventRelated(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return eventKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// RSSフィードを取得する汎用関数
async function fetchRSSFeed(url, sourceName) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: sourceName,
      description: item.contentSnippet || item.description || '',
      isEvent: isEventRelated(item.title) || isEventRelated(item.contentSnippet || item.description)
    }));
  } catch (error) {
    console.error(`Error fetching ${sourceName}:`, error.message);
    return [];
  }
}

// FC東京のRSSを取得
async function fetchFCTokyoRSS() {
  try {
    const response = await axios.get('http://rss.phew.homeip.net/news.php');
    const feedParser = new Parser();
    const feed = await feedParser.parseString(response.data);
    
    // FC東京に関連する項目だけをフィルター
    const fcTokyoItems = feed.items.filter(item => 
      item.title && (item.title.includes('FC東京') || item.title.includes('FC Tokyo'))
    );
    
    return fcTokyoItems.map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: 'FC東京',
      description: item.contentSnippet || item.description || '',
      isEvent: isEventRelated(item.title) || isEventRelated(item.contentSnippet || item.description)
    }));
  } catch (error) {
    console.error('Error fetching FC Tokyo RSS:', error.message);
    return [];
  }
}

// PRTIMES 企業群のRSSを取得 (一覧表示)
async function fetchPRTimesCompanies() {
  const companyIds = [169497, 130855, 34897, 32114, 3710, 12471, 7414, 130313];
  const allItems = [];
  
  for (const id of companyIds) {
    try {
      const url = `https://prtimes.jp/companyrdf.php?company_id=${id}`;
      const feed = await parser.parseURL(url);
      
      const items = feed.items.map(item => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        source: 'PRTIMES',
        description: item.contentSnippet || item.description || '',
        isEvent: isEventRelated(item.title) || isEventRelated(item.contentSnippet || item.description)
      }));
      
      allItems.push(...items);
    } catch (error) {
      console.error(`Error fetching PRTIMES company ${id}:`, error.message);
    }
  }
  
  return allItems;
}

// GIZMODOのRSSを取得
async function fetchGizmodoRSS() {
  return await fetchRSSFeed('https://www.gizmodo.jp/index.xml', 'GIZMODO');
}

// OCEANSのRSSを取得 (Yahoo!ニュース経由)
async function fetchOCEANS() {
  return await fetchRSSFeed('https://news.yahoo.co.jp/rss/media/oceans/all.xml', 'OCEANS');
}

// ITmedia ビジネスオンラインのRSSを取得
async function fetchITmediaBusiness() {
  return await fetchRSSFeed('https://rss.itmedia.co.jp/rss/1.0/business.xml', 'ITmedia');
}

// GQ JAPANのRSSを取得 (Yahoo!ニュース経由)
async function fetchGQJapan() {
  return await fetchRSSFeed('https://news.yahoo.co.jp/rss/media/gqjapan/all.xml', 'GQ JAPAN');
}

// WIRED.jpのRSSを取得 (Yahoo!ニュース経由)
async function fetchWiredJP() {
  return await fetchRSSFeed('https://news.yahoo.co.jp/rss/media/wired/all.xml', 'WIRED.jp');
}

// WWDJAPANのRSSを取得
async function fetchWWDJapan() {
  return await fetchRSSFeed('https://www.wwdjapan.com/feed/', 'WWDJAPAN');
}

// FASHION PRESSのRSSを取得
async function fetchFashionPress() {
  return await fetchRSSFeed('http://www.fashion-press.net/news/line.rss', 'FASHION PRESS');
}

// JFAのRSSを取得
async function fetchJFA() {
  return await fetchRSSFeed('https://www.jfa.jp/feed.rss', 'JFA');
}

// 商業施設のリンク集
function getFacilitiesLinks() {
  return [
    {
      name: '六本木ヒルズ',
      link: 'https://www.roppongihills.com/events/',
      description: '六本木ヒルズのイベント情報'
    },
    {
      name: '麻布台ヒルズ',
      link: 'https://www.azabudai-hills.com/events/',
      description: '麻布台ヒルズのイベント情報'
    },
    {
      name: '東京スカイツリー',
      link: 'https://www.tokyo-skytree.jp/event/',
      description: '東京スカイツリーのイベント情報'
    },
    {
      name: '二子玉川ライズ',
      link: 'https://www.rise.sc/event/',
      description: '二子玉川ライズのイベント情報'
    },
    {
      name: '表参道ヒルズ',
      link: 'https://www.omotesandohills.com/events/',
      description: '表参道ヒルズのイベント情報'
    }
  ];
}

// 全てのイベント情報を取得
async function getAllEvents() {
  const cacheKey = 'all_events';
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    console.log('Returning cached data');
    return cachedData;
  }

  console.log('Fetching fresh data...');
  
  const [
    gizmodo,
    prTimesCompanies,
    oceans,
    itmediaBusiness,
    gqJapan,
    wiredJP,
    wwdJapan,
    fashionPress,
    jfa,
    fcTokyo
  ] = await Promise.all([
    fetchGizmodoRSS(),
    fetchPRTimesCompanies(),
    fetchOCEANS(),
    fetchITmediaBusiness(),
    fetchGQJapan(),
    fetchWiredJP(),
    fetchWWDJapan(),
    fetchFashionPress(),
    fetchJFA(),
    fetchFCTokyoRSS()
  ]);

  const allEvents = [
    ...gizmodo,
    ...prTimesCompanies,
    ...oceans,
    ...itmediaBusiness,
    ...gqJapan,
    ...wiredJP,
    ...wwdJapan,
    ...fashionPress,
    ...jfa,
    ...fcTokyo
  ];

  // 日付でソート (新しい順)
  allEvents.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  cache.set(cacheKey, allEvents);
  return allEvents;
}

// エンドポイント: 全てのイベント
app.get('/api/events/all', async (req, res) => {
  try {
    const events = await getAllEvents();
    res.json({
      success: true,
      count: events.length,
      events: events
    });
  } catch (error) {
    console.error('Error in /api/events/all:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events'
    });
  }
});

// エンドポイント: イベント関連のみ
app.get('/api/events/filtered', async (req, res) => {
  try {
    const allEvents = await getAllEvents();
    const eventOnly = allEvents.filter(item => item.isEvent);
    
    res.json({
      success: true,
      count: eventOnly.length,
      events: eventOnly
    });
  } catch (error) {
    console.error('Error in /api/events/filtered:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filtered events'
    });
  }
});

// エンドポイント: 商業施設のリンク集
app.get('/api/events/facilities', async (req, res) => {
  try {
    const facilities = getFacilitiesLinks();
    res.json({
      success: true,
      count: facilities.length,
      facilities: facilities
    });
  } catch (error) {
    console.error('Error in /api/events/facilities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch facilities'
    });
  }
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ルートエンドポイント
app.get('/', (req, res) => {
  res.json({
    message: 'Event Aggregator API',
    endpoints: {
      all: '/api/events/all',
      filtered: '/api/events/filtered',
      facilities: '/api/events/facilities',
      health: '/health'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Endpoints available:`);
  console.log(`   - GET /api/events/all`);
  console.log(`   - GET /api/events/filtered`);
  console.log(`   - GET /api/events/facilities`);
  console.log(`   - GET /health`);
});