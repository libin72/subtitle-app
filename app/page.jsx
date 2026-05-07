"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, FileText, Image as ImageIcon, 
  Play, Pause, Plus, ChevronLeft, Settings, 
  Trash2, CheckCircle, Loader2, Download, Edit3, Clock, Key, Link as LinkIcon, Mic, MessageSquare,
  Eye, RefreshCw, ImagePlus
} from 'lucide-react';

// ================= 图片丝滑渐变组件 (16:9 满宽无留白) =================
const CrossfadeImage = ({ src }) => {
  const [images, setImages] = useState([src]);

  useEffect(() => {
    if (src && src !== images[images.length - 1]) {
      setImages((prev) => [...prev.slice(-1), src]);
    }
  }, [src]);

  return (
    <div className="relative w-full aspect-video flex-shrink-0 bg-gray-900 overflow-hidden shadow-2xl">
      {images.map((imgSrc, idx) => (
        <img
          key={`${imgSrc}-${idx}`}
          src={imgSrc}
          alt="Visual Context"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out ${
            idx === images.length - 1 ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
};

// 模拟初始测试数据
const MOCK_PROJECTS = [
  { id: 1, title: '苹果秋季发布会_片段1', date: '2023-10-24', duration: '03:12' },
];

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  
  // API 配置
  const [audioBaseUrl, setAudioBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [audioKey, setAudioKey] = useState('');
  const [audioModel, setAudioModel] = useState('whisper-large-v3');
  const [textBaseUrl, setTextBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [textKey, setTextKey] = useState('');
  const [textModel, setTextModel] = useState('llama-3.3-70b-versatile');

  useEffect(() => {
    if (localStorage.getItem('wx_audio_url')) setAudioBaseUrl(localStorage.getItem('wx_audio_url'));
    if (localStorage.getItem('wx_audio_key')) setAudioKey(localStorage.getItem('wx_audio_key'));
    if (localStorage.getItem('wx_audio_model')) setAudioModel(localStorage.getItem('wx_audio_model'));
    if (localStorage.getItem('wx_text_url')) setTextBaseUrl(localStorage.getItem('wx_text_url'));
    if (localStorage.getItem('wx_text_key')) setTextKey(localStorage.getItem('wx_text_key'));
    if (localStorage.getItem('wx_text_model')) setTextModel(localStorage.getItem('wx_text_model'));
  }, []);
  
  const [formData, setFormData] = useState({
    title: '新建音频字幕项目',
    audioFile: null, 
    audioName: '',
    audioUrl: '',
    audioDuration: 0,
    rawText: '',
    logoName: 'Default KidNuz Cover',
    logoUrl: 'https://m.media-amazon.com/images/I/410dAIOIeIL._SL10_UR1600,800_CR200,50,1200,630_CLa|1200,630|410dAIOIeIL.jpg|0,0,1200,630+82,82,465,465_PJAdblSocialShare-Gradientoverlay-largeasin-0to70,TopLeft,0,0_PJAdblSocialShare-AudibleLogo-Large,TopLeft,600,270_OU01_ZBLISTENING ON,617,216,52,500,AudibleSansMd,30,255,255,255_PJAdblSocialShare-PodcastIcon-Small,TopLeft,1094,50.jpg'
  });

  const [subtitles, setSubtitles] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  // 处理进度反馈
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStep, setProcessStep] = useState(0);
  const [processMsg, setProcessMsg] = useState("");
  
  const [newsDate, setNewsDate] = useState('');
  const audioRef = useRef(null);

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };

  // 将 URL 转换为 Blob URL 以缓存图片，防黑屏
  const fetchToBlobUrl = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fetch failed');
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch(e) {
      console.warn("图片本地化缓存失败，使用原直链:", url);
      return url; 
    }
  };

  // ================= 核心处理逻辑 =================
  useEffect(() => {
    if (currentView === 'processing' && !isProcessing) {
      const processVideo = async () => {
        setIsProcessing(true);
        try {
          if (!formData.audioFile) throw new Error("缺少音频文件！");
          
          // --- 第 1 步：Whisper 对齐 ---
          setProcessStep(1);
          setProcessMsg("1. 正在进行高精度音频识别与对齐...");
          const cleanAudioUrl = audioBaseUrl.trim().replace(/\/+$/, '');
          const whisperUrl = `${cleanAudioUrl}/audio/transcriptions`;
          
          const audioData = new FormData();
          audioData.append('file', formData.audioFile);
          audioData.append('model', audioModel.trim());
          audioData.append('response_format', 'verbose_json'); 
          audioData.append('timestamp_granularities[]', 'segment'); 
          audioData.append('timestamp_granularities[]', 'word'); 
          
          const whisperRes = await fetch(whisperUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${audioKey}` },
            body: audioData
          });

          if (!whisperRes.ok) {
            const err = await whisperRes.json().catch(()=>({}));
            throw new Error(`Whisper 识别失败: ${err.error?.message || whisperRes.status}`);
          }
          
          const whisperResult = await whisperRes.json();
          if (!whisperResult.segments) throw new Error("接口未返回时间轴数据。");
          
          // === 精确同步与智能拆分逻辑 (修复U.S.断句) ===
          setProcessMsg("正在分析断句与优化词轴...");
          let finalSourceSegments = [];

          if (whisperResult.words && whisperResult.words.length > 0) {
              let currentSeg = null;
              whisperResult.words.forEach((w, idx) => {
                  if (typeof w.start !== 'number' || typeof w.end !== 'number') return;
                  if (!currentSeg) currentSeg = { start: w.start, end: w.end, text: "" };
                  
                  const wordStr = w.word.trim();
                  currentSeg.text += (currentSeg.text ? " " : "") + wordStr;
                  currentSeg.end = w.end; 
                  
                  const wordCount = currentSeg.text.split(/\s+/).length;
                  const isLastWord = idx === whisperResult.words.length - 1;

                  // 排除标准缩写的句号误判
                  const isAbbr = /^(U\.S\.|U\.K\.|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|Inc\.|Ltd\.|A\.M\.|P\.M\.|e\.g\.|i\.e\.|vs\.|St\.|Gov\.|Sen\.|Rep\.|Gen\.|Col\.|Capt\.|Lt\.|Sgt\.|Cpl\.|Pvt\.|Jan\.|Feb\.|Mar\.|Apr\.|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.|Mon\.|Tue\.|Wed\.|Thu\.|Fri\.|Sat\.|Sun\.)$/i.test(wordStr) || /^[A-Za-z]\.$/i.test(wordStr);
                  
                  const hasStrongPunctuation = !isAbbr && /[.?!。？！]['"]*$/.test(wordStr);
                  const hasWeakPunctuation = /[,;，；]['"]*$/.test(wordStr);
                  
                  if (hasStrongPunctuation || (hasWeakPunctuation && wordCount >= 8) || wordCount >= 15 || isLastWord) {
                      finalSourceSegments.push({ start: currentSeg.start, end: currentSeg.end, text: currentSeg.text.trim() });
                      currentSeg = null;
                  }
              });
          } else {
              // Fallback
              whisperResult.segments.forEach(seg => {
                  finalSourceSegments.push({ start: seg.start, end: seg.end, text: seg.text.trim() });
              });
          }

          // --- 第 2 步：分批无损翻译与日期、场景提取 ---
          setProcessStep(2);
          const cleanTextUrl = textBaseUrl.trim().replace(/\/+$/, '');
          const chatUrl = `${cleanTextUrl}/chat/completions`;
          
          const inputMapping = finalSourceSegments.map((s, i) => ({ id: i, en: s.text }));
          let translatedData = [];
          let extractedDateStr = "";
          
          // 限制每批20句，坚决杜绝翻译丢失
          const chunkSize = 20; 
          const totalChunks = Math.ceil(inputMapping.length / chunkSize);

          for (let i = 0; i < inputMapping.length; i += chunkSize) {
            setProcessMsg(`2. LLM 大语言模型翻译中 (第 ${Math.floor(i/chunkSize)+1}/${totalChunks} 批)...`);
            const chunk = inputMapping.slice(i, i + chunkSize);
            
            const isFirstChunk = i === 0;
            const translationPrompt = `You are a professional subtitle translator and visual director.
            1. Correct any OCR/speech typos in the English text using the RAW REFERENCE.
            2. Translate the corrected English into natural Chinese.
            ${isFirstChunk ? '3. EXTRACTION: Extract the broadcast date if mentioned (e.g. "Today is Wednesday, October 11th") and translate it to Chinese format (e.g. "10月11日 星期三"). Else, return "".' : '3. EXTRACTION: return empty string "".'}
            4. VISUAL CONTEXT & STORY GROUPING: 
               - Categorize 'type' as: "intro" (welcome), "transition" (music/pause), "news" (content), or "quiz".
               - For all segments belonging to the SAME news story, provide EXACTLY the same 1-3 word English 'keyword' (e.g., "space rocket"). Do not change the keyword within the same story.
               - For "intro", "transition", and "quiz", leave keyword empty ("").
            5. Return a VALID JSON OBJECT. Do NOT skip any segment.

            RAW REFERENCE: ${formData.rawText ? formData.rawText.substring(0, 1000) : "None."}
            INPUT SEGMENTS: ${JSON.stringify(chunk)}

            JSON FORMAT:
            {
              "extractedDate": "...",
              "subtitles": [
                { "id": 0, "en": "...", "zh": "...", "type": "intro", "keyword": "" }
              ]
            }`;

            const llmRes = await fetch(chatUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${textKey}` },
              body: JSON.stringify({
                model: textModel.trim(),
                messages: [{ role: 'user', content: translationPrompt }],
                temperature: 0.1,
                response_format: { type: "json_object" } 
              })
            });

            if (!llmRes.ok) throw new Error(`翻译请求失败: ${llmRes.status}`);
            
            const llmResult = await llmRes.json();
            const responseText = llmResult.choices[0].message.content;
            
            try {
               const parsed = JSON.parse(responseText);
               translatedData = translatedData.concat(parsed.subtitles || []);
               if (isFirstChunk && parsed.extractedDate) {
                 extractedDateStr = parsed.extractedDate;
               }
            } catch (e) {
               console.error("JSON 解析失败:", responseText);
            }
          }

          setNewsDate(extractedDateStr || getFormattedDate());

          // --- 第 3 步：组装、智能断点锁定与预加载图片 ---
          setProcessStep(3);
          setProcessMsg("3. 正在缓存云端配图资源与同步媒体池...");
          
          // 提前加载公共图片
          const logoBlob = await fetchToBlobUrl(formData.logoUrl);
          const quizBlob = await fetchToBlobUrl('https://eflideas.com/wp-content/uploads/2021/02/quiz-5858940_1920.jpg');
          const imageCache = {};

          let finalSubtitles = [];
          let currentBlockId = 0;
          let lastTypeKw = "";
          let isQuizActive = false;

          for (let i = 0; i < finalSourceSegments.length; i++) {
            const seg = finalSourceSegments[i];
            const matchObj = translatedData.find(t => t.id === i) || {};
            
            let enText = matchObj.en || seg.text;
            let zhText = matchObj.zh || "（翻译解析错误）";
            let type = matchObj.type || 'news';
            let keyword = matchObj.keyword || '';

            // 强制 Quiz 锚点识别 (一旦提到 kidnuz quiz，后面全锁定为 Quiz)
            if (enText.toLowerCase().includes("kidnuz quiz") || enText.toLowerCase().includes("today's quiz")) {
                isQuizActive = true;
            }
            if (isQuizActive) {
                type = 'quiz';
                keyword = '';
            }

            // 确定背景图片
            let imageUrl = logoBlob;
            if (type === 'quiz') {
                imageUrl = quizBlob;
            } else if (type === 'news' && keyword) {
                if (!imageCache[keyword]) {
                    // 使用大模型提炼的关键词生成 16:9 无水印图片并缓存 Blob
                    const targetPrompt = encodeURIComponent(keyword + ' news photography');
                    const imgUrl = `https://image.pollinations.ai/prompt/${targetPrompt}?width=1280&height=720&nologo=true`;
                    imageCache[keyword] = await fetchToBlobUrl(imgUrl);
                }
                imageUrl = imageCache[keyword];
            }

            // 生成区块 ID 逻辑：确保同一个新闻主题在一块
            const tk = type + keyword;
            if (tk !== lastTypeKw) {
                 currentBlockId++;
                 lastTypeKw = tk;
            }

            finalSubtitles.push({ 
              id: i + 1, 
              start: seg.start, 
              end: seg.end, 
              en: enText, 
              zh: zhText,
              type: type,
              keyword: keyword,
              image: imageUrl,
              blockId: currentBlockId
            });
          }

          setTimeout(() => {
            setSubtitles(finalSubtitles);
            setCurrentView('editor');
            setCurrentTime(0);
            setIsProcessing(false);
          }, 500);

        } catch (error) {
          console.error("处理失败:", error);
          alert(`合成失败！\n\n【错误详情】:\n${error.message}`);
          setIsProcessing(false);
          setCurrentView('upload');
        }
      };

      processVideo();
    }
  }, [currentView, isProcessing]);

  // ================= 播放器与进度条 =================
  useEffect(() => {
    if ((currentView === 'editor' || currentView === 'preview') && audioRef.current) {
      if (isPlaying) audioRef.current.play();
      else audioRef.current.pause();
    }
  }, [isPlaying, currentView]);

  const handleTimeUpdate = () => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); };
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  };
  const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.floor((s%1)*10)}`;

  // 导出 SRT
  const handleExport = () => {
    let srt = "";
    subtitles.forEach((sub, i) => {
      const pad = (n, s) => ('000'+n).slice(s*-1);
      const fmt = (sec) => `${pad(Math.floor(sec/3600),2)}:${pad(Math.floor((sec%3600)/60),2)}:${pad(Math.floor(sec%60),2)},${pad(Math.floor((sec%1)*1000),3)}`;
      srt += `${i + 1}\n${fmt(sub.start)} --> ${fmt(sub.end)}\n${sub.en}\n${sub.zh}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formData.title}.srt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // 替换特定区块的图片
  const handleReplaceBlockImage = (blockId, file) => {
    if (!file) return;
    const newBlobUrl = URL.createObjectURL(file);
    setSubtitles(prev => prev.map(sub => sub.blockId === blockId ? { ...sub, image: newBlobUrl } : sub));
  };

  // --- 视图渲染 ---

  const renderDashboard = () => (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white shadow-sm px-6 py-5 flex justify-between items-center">
        <div><h1 className="text-xl font-bold text-gray-800">控制台</h1><p className="text-xs text-gray-500 mt-1">管理员工作台 (Whisper 版)</p></div>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <button onClick={() => setCurrentView('upload')} className="w-full bg-blue-600 text-white rounded-xl py-4 flex items-center justify-center space-x-2 font-medium shadow-md hover:bg-blue-700 transition-all"><Plus size={20} /><span>新建合成项目</span></button>
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 mb-4 uppercase tracking-wider">最近项目</h2>
          <div className="space-y-3">
            {MOCK_PROJECTS.map(proj => (
              <div key={proj.id} className="bg-white p-4 rounded-xl shadow-sm border flex items-center justify-between cursor-pointer hover:border-blue-300">
                <div className="flex items-center space-x-4"><div className="bg-blue-100 p-3 rounded-lg"><FileAudio size={20} className="text-blue-600" /></div><div><h3 className="font-medium text-gray-800">{proj.title}</h3><p className="text-xs text-gray-400 mt-1">{proj.date} • {proj.duration}</p></div></div>
                <ChevronLeft size={16} className="text-gray-400 rotate-180" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );

  const renderUpload = () => (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white px-4 py-4 flex items-center shadow-sm relative z-10 shrink-0">
        <button onClick={() => setCurrentView('dashboard')} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ChevronLeft size={24} className="text-gray-700" /></button>
        <h1 className="text-lg font-bold text-gray-800 ml-2">素材与系统配置</h1>
      </header>
      <main className="flex-1 overflow-y-auto p-5 space-y-6 pb-24">
        {/* API 配置区 */}
        <div className="space-y-4">
          <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-2">
            <label className="text-sm font-bold text-blue-900 flex items-center mb-3"><Mic size={16} className="mr-2 text-blue-500" />1. 语音对齐接口</label>
            <input type="text" placeholder="Base URL" value={audioBaseUrl} onChange={(e) => { setAudioBaseUrl(e.target.value); localStorage.setItem('wx_audio_url', e.target.value); }} className="w-full border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
            <div className="flex space-x-2">
              <input type="password" placeholder="API Key" value={audioKey} onChange={(e) => { setAudioKey(e.target.value); localStorage.setItem('wx_audio_key', e.target.value); }} className="w-1/2 border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
              <input type="text" placeholder="模型" value={audioModel} onChange={(e) => { setAudioModel(e.target.value); localStorage.setItem('wx_audio_model', e.target.value); }} className="w-1/2 border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100 space-y-2">
            <label className="text-sm font-bold text-purple-900 flex items-center mb-3"><MessageSquare size={16} className="mr-2 text-purple-500" />2. 翻译与校对接口</label>
            <input type="text" placeholder="Base URL" value={textBaseUrl} onChange={(e) => { setTextBaseUrl(e.target.value); localStorage.setItem('wx_text_url', e.target.value); }} className="w-full border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
            <div className="flex space-x-2">
              <input type="password" placeholder="API Key" value={textKey} onChange={(e) => { setTextKey(e.target.value); localStorage.setItem('wx_text_key', e.target.value); }} className="w-1/2 border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
              <input type="text" placeholder="模型" value={textModel} onChange={(e) => { setTextModel(e.target.value); localStorage.setItem('wx_text_model', e.target.value); }} className="w-1/2 border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
          </div>
        </div>
        
        {/* 音频与原稿 */}
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl bg-white hover:bg-gray-50 p-6 flex flex-col items-center relative overflow-hidden">
            {formData.audioName ? <div className="text-center"><FileAudio size={32} className="text-green-500 mx-auto mb-2" /><p className="text-sm font-medium text-gray-700">{formData.audioName}</p></div> : <div className="text-center text-gray-500"><Upload size={28} className="mx-auto mb-2" /><p className="text-sm">点击上传主音频</p></div>}
            <input type="file" accept="audio/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => {
              const file = e.target.files[0];
              if (file) { const url = URL.createObjectURL(file); const temp = new Audio(url); temp.onloadedmetadata = () => setFormData(prev => ({...prev, audioFile: file, audioName: file.name, audioUrl: url, audioDuration: temp.duration})); }
            }} />
          </div>
          <textarea placeholder="参考原稿 (选填，提取日期和纠错)" className="w-full h-20 p-3 text-sm border rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500" value={formData.rawText} onChange={(e) => setFormData({...formData, rawText: e.target.value})} />
        </div>
      </main>
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg shrink-0 z-20">
        <button onClick={() => {
            if (!formData.audioFile) { alert("请上传音频！"); return; }
            if (!audioKey || !textKey) { alert("请完善API Key！"); return; }
            setCurrentView('processing');
          }}
          className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-black shadow-md transition-all active:scale-[0.98]">
          构建与处理场景
        </button>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="flex flex-col h-full bg-gray-900 justify-center items-center text-white p-8 relative">
      <Loader2 size={48} className="animate-spin text-blue-400 mb-8" />
      <h2 className="text-xl font-bold mb-4">正在自动化作业</h2>
      <p className="text-sm text-yellow-400 bg-yellow-400/10 px-4 py-2 rounded-lg text-center max-w-full break-words">{processMsg}</p>
    </div>
  );

  // ================= 全新：区块化的后台编辑器 =================
  const renderEditor = () => {
    // 整理 Block 数据
    const blocksMap = {};
    subtitles.forEach(sub => {
       if (!blocksMap[sub.blockId]) {
           blocksMap[sub.blockId] = { id: sub.blockId, type: sub.type, keyword: sub.keyword, image: sub.image, subs: [] };
       }
       blocksMap[sub.blockId].subs.push(sub);
    });
    const blocks = Object.values(blocksMap);

    return (
      <div className="flex flex-col h-full bg-gray-50 relative">
        <header className="bg-white border-b px-4 py-3 flex justify-between items-center shrink-0 z-10 shadow-sm">
          <button onClick={() => setCurrentView('dashboard')} className="p-2 rounded-full hover:bg-gray-100"><ChevronLeft size={20} className="text-gray-700" /></button>
          <div className="text-sm font-bold text-gray-800 flex items-center"><Edit3 size={16} className="mr-2 text-blue-500" />剧本与媒体池</div>
          <button onClick={handleExport} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center">
            <Download size={14} className="mr-1" /> SRT
          </button>
        </header>

        {/* 媒体轨道与播放控制 */}
        <div className="bg-gray-900 px-4 py-4 flex items-center space-x-3 text-white shrink-0 z-10 shadow-md">
           <button onClick={() => setIsPlaying(!isPlaying)} className="w-12 h-12 rounded-full bg-blue-600 flex justify-center items-center hover:bg-blue-500 shrink-0 shadow-lg transition-transform active:scale-95">
             {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
           </button>
           <div className="flex-1 space-y-2">
             <input type="range" min="0" max={formData.audioDuration || 1} step="0.01" value={currentTime} onChange={handleSeek} className="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-400 outline-none" />
             <div className="flex justify-between text-[11px] text-gray-400 font-mono font-medium">
               <span>{formatTime(currentTime)}</span><span>{formData.audioDuration ? formatTime(formData.audioDuration) : '00:00.0'}</span>
             </div>
           </div>
        </div>

        {/* 区块列表区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 bg-gray-100">
          {blocks.map((block) => (
            <div key={block.id} className="bg-white rounded-2xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] border border-gray-200 overflow-hidden flex flex-col md:flex-row">
               {/* 左侧：画面预览与替换 */}
               <div className="md:w-2/5 lg:w-1/3 bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200 p-4 flex flex-col items-center">
                  <div className="w-full aspect-video bg-black rounded-xl overflow-hidden mb-3 relative shadow-sm border border-gray-200">
                     <img src={block.image} className="w-full h-full object-cover" alt="Block Preview" />
                     {block.type === 'quiz' && <div className="absolute top-2 left-2 bg-purple-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-bold">QUIZ</div>}
                     {block.type === 'news' && <div className="absolute top-2 left-2 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-bold">NEWS</div>}
                  </div>
                  <div className="text-xs font-bold text-gray-700 w-full text-center truncate mb-3">
                    {block.type === 'news' ? `主题: ${block.keyword}` : block.type.toUpperCase()}
                  </div>
                  <label className="w-full mt-auto flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 py-2 rounded-lg cursor-pointer text-xs font-semibold transition-colors shadow-sm active:scale-95">
                     <ImagePlus size={14} className="mr-2 text-gray-500" /> 上传替换配图
                     <input type="file" accept="image/*" className="hidden" onChange={(e)=>handleReplaceBlockImage(block.id, e.target.files[0])} />
                  </label>
               </div>
               
               {/* 右侧：字幕切片 */}
               <div className="md:w-3/5 lg:w-2/3 bg-white p-3 space-y-3 max-h-[350px] overflow-y-auto">
                  {block.subs.map((sub) => {
                     const idx = subtitles.findIndex(s => s.id === sub.id);
                     const isActive = currentTime >= sub.start && currentTime <= sub.end;
                     return (
                        <div key={sub.id} className={`rounded-xl border transition-all ${isActive ? 'border-blue-400 bg-blue-50/30 shadow-inner' : 'border-gray-100 bg-gray-50'}`}>
                          <div className={`px-3 py-1.5 border-b border-gray-100 flex justify-between items-center ${isActive ? 'bg-blue-100/50' : 'bg-gray-100/50'}`}>
                            <div className="flex items-center space-x-2 text-[11px] font-mono font-medium text-gray-500">
                              <Clock size={12} className={isActive ? 'text-blue-500' : 'text-gray-400'} />
                              <input type="number" step="0.1" value={sub.start.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].start=parseFloat(e.target.value)||0; setSubtitles(n); }} className="w-12 bg-transparent text-center outline-none focus:text-blue-600 focus:border-b focus:border-blue-300" />
                              <span>-</span>
                              <input type="number" step="0.1" value={sub.end.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].end=parseFloat(e.target.value)||0; setSubtitles(n); }} className="w-12 bg-transparent text-center outline-none focus:text-blue-600 focus:border-b focus:border-blue-300" />
                            </div>
                          </div>
                          <div className="p-2 space-y-1.5">
                            <div className="flex">
                              <span className="text-[9px] font-bold text-gray-300 w-6 pt-1">EN</span>
                              <textarea value={sub.en} onChange={(e) => { const n=[...subtitles]; n[idx].en=e.target.value; setSubtitles(n); }} className="flex-1 text-sm font-medium text-gray-800 bg-transparent outline-none resize-none min-h-[36px]" />
                            </div>
                            <div className="w-full h-px bg-gray-200/50"></div>
                            <div className="flex">
                              <span className="text-[9px] font-bold text-blue-300 w-6 pt-1">中</span>
                              <textarea value={sub.zh} onChange={(e) => { const n=[...subtitles]; n[idx].zh=e.target.value; setSubtitles(n); }} className="flex-1 text-sm font-medium text-gray-600 bg-transparent outline-none resize-none min-h-[36px]" />
                            </div>
                          </div>
                        </div>
                     )
                  })}
               </div>
            </div>
          ))}
        </div>

        {/* 底部悬浮按钮 */}
        <div className="absolute bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 p-4 shrink-0 z-20 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)]">
          <button onClick={() => setCurrentView('preview')} className="w-full bg-black text-white rounded-xl py-3.5 font-bold text-sm flex justify-center items-center shadow-xl hover:bg-gray-800 transition-all active:scale-[0.98]">
            <Eye size={18} className="mr-2 text-yellow-400" /> 进入全屏播报演示
          </button>
        </div>
      </div>
    );
  };

  // ================= 终极：全屏成品预览视图 =================
  const renderPreview = () => {
    const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
    const targetImage = activeSubtitle ? activeSubtitle.image : formData.logoUrl; 
    
    return (
      <div className="relative flex flex-col h-full w-full bg-black overflow-hidden cursor-pointer" onClick={() => setIsPlaying(!isPlaying)}>
        <button onClick={(e) => { e.stopPropagation(); setCurrentView('editor'); }} className="absolute top-6 left-4 z-20 p-2.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors backdrop-blur-md">
          <ChevronLeft size={24} />
        </button>

        {/* 顶部标题区 */}
        <div className="flex-none pt-12 pb-4 flex flex-col items-center justify-center text-white px-6 text-center z-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-2 font-sans">KidNuz</h1>
          <p className="text-base sm:text-lg font-medium opacity-95 text-yellow-400">{newsDate || getFormattedDate()}</p>
        </div>

        {/* A/B 分区 */}
        <div className="flex-1 flex flex-col w-full z-10 overflow-hidden">
          <div className="w-full flex-shrink-0">
             <CrossfadeImage src={targetImage} />
          </div>
          <div className="flex-1 w-full px-6 pt-6 pb-12 overflow-y-auto flex flex-col justify-start">
            {activeSubtitle ? (
              <div className="w-full bg-white/5 backdrop-blur-md p-5 rounded-2xl border border-white/10">
                <p className="text-white font-semibold text-xl leading-relaxed drop-shadow-md mb-3 text-left">{activeSubtitle.en}</p>
                <p className="text-yellow-400 font-bold text-lg leading-relaxed drop-shadow-md text-left">{activeSubtitle.zh}</p>
              </div>
            ) : null}
          </div>
        </div>

        {!isPlaying && (
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/10 rounded-full p-6 backdrop-blur-sm"><Play size={64} fill="currentColor" className="text-white opacity-80 ml-2" /></div>
          </div>
        )}

        {/* 进度条 */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800 z-20">
          <div className="h-full bg-yellow-400/80 transition-all duration-100 ease-linear" style={{ width: `${(currentTime / (formData.audioDuration || 1)) * 100}%` }}></div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-200 flex items-center justify-center p-0 sm:p-4">
      <audio ref={audioRef} src={formData.audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
      <div className="w-full max-w-[400px] h-[100dvh] sm:h-[800px] bg-white sm:rounded-[2.5rem] shadow-2xl overflow-hidden relative border-[8px] border-gray-900/5">
        <div className="hidden sm:block absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-900/5 rounded-b-xl z-50 pointer-events-none"></div>
        {currentView === 'dashboard' && renderDashboard()}
        {currentView === 'upload' && renderUpload()}
        {currentView === 'processing' && renderProcessing()}
        {currentView === 'editor' && renderEditor()}
        {currentView === 'preview' && renderPreview()}
      </div>
    </div>
  );
}