import React, { useState, useMemo } from 'react';
import { Search, Download, ExternalLink, ThumbsUp, Bookmark, AlertCircle, Loader2, User, Key, ArrowUpDown, ArrowUp, ArrowDown, Sparkles, X, Lightbulb } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  url: string;
  likes_count: number;
  stocks_count?: number;
  created_at: string;
  tags: Array<{ name: string }>;
}

interface Stats {
  totalLgtm: number;
  totalStock: number;
  count: number;
}

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

const App = () => {
  const [userId, setUserId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ totalLgtm: 0, totalStock: 0, count: 0 });
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'created_at', direction: 'desc' });

  // AI機能用のState
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiNextTopics, setAiNextTopics] = useState<string | null>(null); // 新機能: 記事ネタ提案
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSuggestingTopics, setIsSuggestingTopics] = useState(false);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [titleSuggestions, setTitleSuggestions] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');

  const callGemini = async (prompt: string): Promise<string> => {
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。');
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Gemini API request failed');
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "AIからの応答がありませんでした。";
    } catch (err) {
      console.error("Gemini API Error:", err);
      if (err instanceof Error) {
        throw err;
      }
      throw new Error("AI生成中にエラーが発生しました。");
    }
  };

  const fetchArticles = async () => {
    setLoading(true);
    setError(null);
    setArticles([]);
    // ユーザー変更時にAI結果をリセット
    setAiAnalysis(null);
    setAiNextTopics(null);
    setTitleSuggestions({});
    
    try {
      const headers: Record<string, string> = {};
      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      const encodedUserId = encodeURIComponent(userId);
      const response = await fetch(`https://qiita.com/api/v2/items?page=1&per_page=100&query=user:${encodedUserId}`, {
        headers: headers
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('API制限に達しました。しばらく待つか、APIトークンを設定してください。');
        } else if (response.status === 404) {
          throw new Error('ユーザーが見つかりませんでした。');
        } else {
          throw new Error(`エラーが発生しました: ${response.statusText}`);
        }
      }

      const data: Article[] = await response.json();
      setArticles(data);

      const totalLgtm = data.reduce((sum: number, item: Article) => sum + item.likes_count, 0);
      
      setStats({
        totalLgtm,
        totalStock: data.reduce((sum: number, item: Article) => sum + (item.stocks_count || 0), 0),
        count: data.length
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // 1. ユーザーの傾向分析を実行
  const handleAnalyzeProfile = async () => {
    if (articles.length === 0) return;
    if (!apiKey) {
      setError('Gemini APIキーが設定されていません。');
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    
    try {
      const articlesSummary = articles.slice(0, 30).map((a: Article) => `- タイトル: ${a.title} (タグ: ${a.tags.map((t: { name: string }) => t.name).join(', ')})`).join('\n');
      
      const prompt = `
        あなたは技術記事の分析官です。以下のQiita記事リスト（タイトルとタグ）を元に、このエンジニアの技術的な強み、主に関心を持っている技術領域、記事の傾向を分析してください。
        また、どのような読者層（初心者向け、上級者向け、特定の技術スタック利用者など）に価値を提供しているかも含めて、300文字程度の日本語で要約してください。
        Markdown形式ではなくプレーンテキストで、丁寧な口調（ですます調）で出力してください。

        記事リスト:
        ${articlesSummary}
      `;

      const result = await callGemini(prompt);
      setAiAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 2. 次の記事ネタを提案 (新機能)
  const handleSuggestNextTopics = async () => {
    if (articles.length === 0) return;
    if (!apiKey) {
      setError('Gemini APIキーが設定されていません。');
      return;
    }
    setIsSuggestingTopics(true);
    setError(null);

    try {
      const articlesSummary = articles.slice(0, 40).map((a: Article) => `- ${a.title}`).join('\n');

      const prompt = `
        あなたはテックブログの編集者です。
        以下の過去の執筆記事リストに基づいて、この著者が次に書くべき「おすすめの記事テーマ」を3つ提案してください。

        【提案の指針】
        1. 著者の得意な技術領域（AWS, Vue.js, Pythonなど）を深掘りするもの
        2. 著者の傾向に関連する、最近のトレンド技術を取り入れたもの
        3. 過去の記事の続編として需要がありそうなもの

        出力形式：
        各アイデアについて「タイトル案」と「なぜおすすめか（1行解説）」をセットにして、Markdownのリスト形式で出力してください。

        過去の記事リスト:
        ${articlesSummary}
      `;

      const result = await callGemini(prompt);
      setAiNextTopics(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsSuggestingTopics(false);
    }
  };

  // 3. タイトル改善案を提案
  const handleSuggestTitle = async (articleId: string, currentTitle: string) => {
    if (titleSuggestions[articleId]) {
      const newSuggestions = { ...titleSuggestions };
      delete newSuggestions[articleId];
      setTitleSuggestions(newSuggestions);
      return;
    }

    if (!apiKey) {
      setError('Gemini APIキーが設定されていません。');
      return;
    }

    setSuggestingId(articleId);
    
    try {
      const prompt = `
        以下のQiita記事のタイトルを、よりエンジニアが読みたくなる、LGTMが集まりやすいキャッチーなタイトルにリライトしてください。
        元の内容を歪めない範囲で、インパクトのある言葉や、ベネフィットが伝わる表現を使ってください。
        3つの案を箇条書き（・で始まる）で提案してください。余計な前置きは不要です。

        元のタイトル: ${currentTitle}
      `;

      const result = await callGemini(prompt);
      setTitleSuggestions(prev => ({ ...prev, [articleId]: result }));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'タイトル改善案の取得に失敗しました。');
    } finally {
      setSuggestingId(null);
    }
  };

  // 初回ロード時は実行しない（初期表示をブランクにするため）
  // useEffect(() => {
  //   fetchArticles();
  // }, []);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const sortedArticles = useMemo(() => {
    let sortableItems = [...articles];
    if (sortConfig.key !== null) {
      sortableItems.sort((a: Article, b: Article) => {
        let aValue: any = a[sortConfig.key as keyof Article];
        let bValue: any = b[sortConfig.key as keyof Article];

        if (sortConfig.key === 'created_at') {
           aValue = new Date(a.created_at).getTime();
           bValue = new Date(b.created_at).getTime();
        }
        
        if (typeof aValue === 'string') {
            return sortConfig.direction === 'asc' 
                ? aValue.localeCompare(bValue as string) 
                : (bValue as string).localeCompare(aValue);
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [articles, sortConfig]);

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={14} className="text-gray-400" />;
    if (sortConfig.direction === 'asc') return <ArrowUp size={14} className="text-green-600" />;
    return <ArrowDown size={14} className="text-green-600" />;
  };

  const handleDownloadCSV = () => {
    if (sortedArticles.length === 0) return;

    const headers = ['タイトル', 'URL', 'LGTM数', '作成日', 'タグ'];
    const csvContent = [
      headers.join(','),
      ...sortedArticles.map((article: Article) => {
        const title = `"${article.title.replace(/"/g, '""')}"`;
        const url = article.url;
        const lgtm = article.likes_count;
        const date = new Date(article.created_at).toLocaleDateString();
        const tags = `"${article.tags.map((t: { name: string }) => t.name).join(' ')}"`;
        return [title, url, lgtm, date, tags].join(',');
      })
    ].join('\n');

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${userId}_qiita_articles.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // メモリリークを防ぐためにURLを解放
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
            <span className="bg-green-500 text-white p-1 rounded">Qiita</span>
            記事アナリティクス
          </h1>
          <p className="text-slate-500 text-sm mb-6">
            指定したユーザーの公開記事一覧とLGTM数を取得します。<br/>
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                  <User size={16} /> Qiita ユーザーID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="flex-1 p-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="例: Junpei_Takagi"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                  <Key size={16} /> Qiita APIトークン (任意)
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    className="flex-1 p-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="未入力でも利用可能 (制限あり)"
                  />
                  <button
                    onClick={fetchArticles}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                    取得
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                <Sparkles size={16} /> Gemini APIキー (AI機能用)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full p-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                placeholder="Gemini APIキーを入力してください（AI機能を使用する場合）"
              />
              <p className="text-xs text-gray-500">
                AI機能（プロフィール分析、記事ネタ提案、タイトル改善）を使用する場合は、Google Gemini APIキーが必要です。
              </p>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
            <AlertCircle className="text-red-500 mt-0.5" size={20} />
            <div>
              <h3 className="font-bold text-red-800">エラーが発生しました</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Stats & Content */}
        {!loading && articles.length > 0 && (
          <div className="space-y-6">
            
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <p className="text-sm text-gray-500">取得記事数</p>
                <p className="text-2xl font-bold text-slate-800">{stats.count} <span className="text-sm font-normal text-gray-400">items</span></p>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <p className="text-sm text-gray-500 flex items-center gap-1"><ThumbsUp size={14}/> 総LGTM数</p>
                <p className="text-2xl font-bold text-green-600">{stats.totalLgtm.toLocaleString()}</p>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <p className="text-sm text-gray-500 flex items-center gap-1"><Bookmark size={14}/> 平均LGTM/記事</p>
                <p className="text-2xl font-bold text-blue-600">
                  {stats.count > 0 ? (stats.totalLgtm / stats.count).toFixed(1) : 0}
                </p>
              </div>
            </div>

            {/* AI Features Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Feature 1: Profile Analysis */}
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl shadow-sm border border-purple-100 p-6 relative overflow-hidden flex flex-col h-full">
                 <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                   <Sparkles size={120} className="text-purple-500" />
                 </div>
                 
                 <div className="relative z-10 flex-1">
                   <div className="flex justify-between items-start mb-4">
                     <h2 className="text-lg font-bold text-purple-900 flex items-center gap-2">
                       <Sparkles size={20} className="text-purple-600" />
                       AI プロフィール分析
                     </h2>
                     {!aiAnalysis && (
                       <button 
                         onClick={handleAnalyzeProfile}
                         disabled={isAnalyzing}
                         className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70 shadow-sm"
                       >
                         {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                         分析する
                       </button>
                     )}
                   </div>

                   {isAnalyzing && <div className="text-purple-700 text-sm animate-pulse">データを分析中...</div>}

                   {aiAnalysis ? (
                     <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 border border-purple-100 text-slate-700 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                       {aiAnalysis}
                     </div>
                   ) : (
                      !isAnalyzing && (
                        <p className="text-sm text-purple-700/70 leading-relaxed">
                           Gemini AIがあなたの記事タイトルやタグを読み込み、エンジニアとしての技術的強みや関心領域を要約して教えてくれます。
                        </p>
                      )
                   )}
                 </div>
              </div>

              {/* Feature 2: Next Topic Suggestions */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl shadow-sm border border-amber-100 p-6 relative overflow-hidden flex flex-col h-full">
                 <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                   <Lightbulb size={120} className="text-amber-500" />
                 </div>
                 
                 <div className="relative z-10 flex-1">
                   <div className="flex justify-between items-start mb-4">
                     <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                       <Lightbulb size={20} className="text-amber-600" />
                       次の記事ネタ提案
                     </h2>
                     {!aiNextTopics && (
                       <button 
                         onClick={handleSuggestNextTopics}
                         disabled={isSuggestingTopics}
                         className="bg-amber-600 hover:bg-amber-700 text-white text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70 shadow-sm"
                       >
                         {isSuggestingTopics ? <Loader2 className="animate-spin" size={16} /> : <Lightbulb size={16} />}
                         アイデアを出す
                       </button>
                     )}
                   </div>

                   {isSuggestingTopics && <div className="text-amber-700 text-sm animate-pulse">トレンドと思考を巡らせ中...</div>}

                   {aiNextTopics ? (
                     <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 border border-amber-100 text-slate-700 text-sm leading-relaxed whitespace-pre-wrap shadow-sm markdown-body">
                       {aiNextTopics}
                     </div>
                   ) : (
                      !isSuggestingTopics && (
                        <p className="text-sm text-amber-700/70 leading-relaxed">
                           執筆履歴とトレンドに基づいて、次に書くべき「おすすめ記事テーマ」を3つ提案します。ネタ切れの際にご活用ください。
                        </p>
                      )
                   )}
                 </div>
              </div>
            
            </div>

            {/* Controls */}
            <div className="flex justify-end">
              <button
                onClick={handleDownloadCSV}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-green-600 bg-white border border-gray-300 hover:border-green-500 px-4 py-2 rounded-lg transition-all"
              >
                <Download size={16} />
                CSVダウンロード
              </button>
            </div>

            {/* Articles List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm">
                      <th className="p-4 font-medium w-16 text-center">No.</th>
                      <th 
                        className="p-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors group"
                        onClick={() => handleSort('title')}
                      >
                        <div className="flex items-center gap-1">
                          記事タイトル
                          {getSortIcon('title')}
                        </div>
                      </th>
                      <th 
                        className="p-4 font-medium w-32 cursor-pointer hover:bg-gray-100 transition-colors group"
                        onClick={() => handleSort('created_at')}
                      >
                        <div className="flex items-center gap-1">
                          投稿日
                          {getSortIcon('created_at')}
                        </div>
                      </th>
                      <th 
                        className="p-4 font-medium w-24 text-center cursor-pointer hover:bg-gray-100 transition-colors group"
                        onClick={() => handleSort('likes_count')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          LGTM
                          {getSortIcon('likes_count')}
                        </div>
                      </th>
                      <th className="p-4 font-medium w-32 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedArticles.map((article, index) => (
                      <React.Fragment key={article.id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 text-center text-gray-400 text-sm">{index + 1}</td>
                          <td className="p-4">
                            <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-800 hover:text-green-600 block mb-1">
                              {article.title}
                            </a>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {article.tags.map((tag: { name: string }) => (
                                <span key={tag.name} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-4 text-sm text-gray-500 whitespace-nowrap">
                            {new Date(article.created_at).toLocaleDateString()}
                          </td>
                          <td className="p-4 text-center">
                            <span className="inline-flex items-center gap-1 font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">
                              <ThumbsUp size={12} /> {article.likes_count}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <a 
                                href={article.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-green-600 inline-block p-2 rounded-full hover:bg-green-50"
                                title="Qiitaで開く"
                              >
                                <ExternalLink size={18} />
                              </a>
                              <button
                                onClick={() => handleSuggestTitle(article.id, article.title)}
                                className={`p-2 rounded-full transition-colors ${
                                  titleSuggestions[article.id] 
                                    ? 'text-purple-600 bg-purple-100' 
                                    : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'
                                }`}
                                title="AIでタイトル改善案を作成"
                              >
                                {suggestingId === article.id ? <Loader2 size={18} className="animate-spin text-purple-600" /> : <Sparkles size={18} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {/* AI Suggestion Row */}
                        {titleSuggestions[article.id] && (
                          <tr className="bg-purple-50/50">
                            <td colSpan={5} className="p-4 pl-16">
                              <div className="bg-white rounded-lg border border-purple-100 p-4 shadow-sm relative">
                                <button 
                                  onClick={() => {
                                    const newSuggestions = { ...titleSuggestions };
                                    delete newSuggestions[article.id];
                                    setTitleSuggestions(newSuggestions);
                                  }}
                                  className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                                >
                                  <X size={16} />
                                </button>
                                <h4 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                                  <Sparkles size={12} /> Gemini Title Suggestions
                                </h4>
                                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                  {titleSuggestions[article.id]}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && articles.length === 0 && !error && (
          <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-200 border-dashed">
            <Search size={48} className="mx-auto mb-4 opacity-20" />
            <p>記事が見つかりません。ユーザーIDを確認してください。</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
