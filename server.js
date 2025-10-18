const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const NodeCache = require('node-cache');
const axios = require('axios');
const cheerio = require('cheerio');

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

// FC東京のニュースをスクレイピング
async function fetchFCTokyoRSS() {
  try {
    const response = await axios.get('https://www.fctokyo.co.jp/news/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    const items = [];
    
    // より具体的なセレクターでニュース項目を取得
    // FC東京のニュースリストの構造に合わせて調整
    const newsSelectors = [
      '.p-news__list li',
      '.p-news__item',
      '.news-list li',
      'article.news-item',
      'main .list li'
    ];
    
    let $newsItems = $();
    for (const selector of newsSelectors) {
      $newsItems = $(selector);
      if ($newsItems.length > 0) {
        console.log(`✅ FC Tokyo: Using selector "${selector}", found ${$newsItems.length} items`);
        break;
      }
    }
    
    // セレクターで見つからない場合、テキストベースで抽出
    if ($newsItems.length === 0) {
      console.log('⚠️  FC Tokyo: Using text-based extraction');
      
      const pageText = $('body').text();
      const lines = pageText.split('\n');
      
      let currentDate = '';
      let currentCategory = '';
      let currentTitle = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 日付行を検出 (例: 2025.10.17)
        const dateMatch = line.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
        if (dateMatch) {
          currentDate = line;
          continue;
        }
        
        // カテゴリ行を検出 (例: [イベント])
        const categoryMatch = line.match(/^\[([^\]]+)\]$/);
        if (categoryMatch) {
          currentCategory = categoryMatch[1];
          continue;
        }
        
        // タイトル行を検出 (日付とカテゴリの後)
        if (currentDate && currentCategory && line.length > 10 && !line.match(/^-+$/) && !line.match(/^\d{4}\.\d{1,2}\.\d{1,2}$/)) {
          currentTitle = line;
          
          // 日付を解析
          const [, year, month, day] = currentDate.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
          const pubDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).toISOString();
          
          items.push({
            title: `[${currentCategory}] ${currentTitle}`,
            link: `https://www.fctokyo.co.jp/news/`,
            pubDate: pubDate,
            source: 'FC東京',
            description: `${currentCategory} ${currentTitle}`,
            isEvent: isEventRelated(currentTitle) || currentCategory.includes('イベント')
          });
          
          // リセット
          currentDate = '';
          currentCategory = '';
          currentTitle = '';
          
          // 最大30件まで
          if (items.length >= 30) break;
        }
      }
    } else {
      // セレクターで見つかった場合の処理
      $newsItems.each((index, element) => {
        if (index >= 30) return false; // 最大30件
        
        const $elem = $(element);
        
        // 日付を取得
        const dateText = $elem.find('time, .date, [class*="date"]').first().text().trim();
        
        // カテゴリを取得
        const categoryText = $elem.find('.category, [class*="category"], span').first().text().trim();
        
        // タイトル(リンク)を取得
        const $link = $elem.find('a').first();
        const title = $link.text().trim();
        const link = $link.attr('href');
        
        // 日付とタイトルが両方ある場合のみ追加
        if (dateText && title && dateText.match(/\d{4}\.\d{1,2}\.\d{1,2}/)) {
          // 日付を解析
          const dateMatch = dateText.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
          if (dateMatch) {
            const [, year, month, day] = dateMatch;
            const pubDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).toISOString();
            
            // 相対URLを絶対URLに変換
            const absoluteLink = link && link.startsWith('http') 
              ? link 
              : `https://www.fctokyo.co.jp${link || '/news/'}`;
            
            items.push({
              title: categoryText ? `[${categoryText}] ${title}` : title,
              link: absoluteLink,
              pubDate: pubDate,
              source: 'FC東京',
              description: categoryText ? `${categoryText} ${title}` : title,
              isEvent: isEventRelated(title) || (categoryText && categoryText.includes('イベント'))
            });
          }
        }
      });
    }
    
    console.log(`✅ FC Tokyo: Extracted ${items.length} news items`);
    
    // 日付でソート (新しい順)
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    return items.slice(0, 30);
    
  } catch (error) {
    console.error('❌ Error fetching FC Tokyo news:', error.message);
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
      name: '都立公園',
      link: 'https://www.tokyo-park.or.jp/event_search/index.html',
      description: '都立公園のイベント情報'
    },
    {
      name: 'ライズ',
      link: 'https://www.rise.sc/eventnews/',
      description: 'ライズのイベント情報'
    },
    {
      name: '渋谷ヒカリエ',
      link: 'https://www.hikarie.jp/event/',
      description: '渋谷ヒカリエのイベント情報'
    },
    {
      name: '渋谷パルコ',
      link: 'https://shibuya.parco.jp/event/',
      description: '渋谷パルコのイベント情報'
    },
    {
      name: 'JPタワー',
      link: 'https://marunouchi.jp-kitte.jp/event/eventnews.jsp?cat=1',
      description: 'JPタワーのイベント情報'
    },
    {
      name: '表参道ヒルズ',
      link: 'https://www.omotesandohills.com/events/',
      description: '表参道ヒルズのイベント情報'
    },
    {
      name: '六本木ヒルズ',
      link: 'https://www.roppongihills.com/events/events_list.html',
      description: '六本木ヒルズのイベント情報'
    },
    {
      name: 'スカイツリー',
      link: 'https://www.tokyo-solamachi.jp/event/list/',
      description: 'スカイツリーのイベント情報'
    },
    {
      name: 'ダイバーシティ',
      link: 'https://mitsui-shopping-park.com/divercity-tokyo/event/',
      description: 'ダイバーシティのイベント情報'
    },
    {
      name: 'アウトドア',
      link: 'https://gear.camplog.jp/%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88/2025outdoorevent/#google_vignette',
      description: 'アウトドアイベント情報'
    }
  ];
}

// 全てのイベント情報を取得
async function getAllEvents() {
  const cacheKey = 'all_events';
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    console.log('📦 Returning cached data');
    return cachedData;
  }

  console.log('🔄 Fetching fresh data...');
  
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

  console.log(`✅ Total events: ${allEvents.length}`);
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