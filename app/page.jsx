"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, Play, Pause, ChevronLeft, 
  CheckCircle, Loader2, Download, Edit3, Clock, 
  Mic, MessageSquare, ImagePlus, Scissors, Trash2, ArrowUp, Eye, Image as ImageIcon
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
    <div className="relative w-full aspect-video flex-shrink-0 bg-gray-900 overflow-hidden shadow-xl border-y border-white/10">
      {images.map((imgSrc, idx) => (
        <img
          key={`${imgSrc}-${idx}`}
          src={imgSrc}
          alt="Visual Context"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
            idx === images.length - 1 ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
};

export default function App() {
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
    logoUrl: 'https://m.media-amazon.com/images/I/410dAIOIeIL._SL10_UR1600,800_CR200,50,1200,630_CLa|1200,630|410dAIOIeIL.jpg|0,0,1200,630+82,82,465,465_PJAdblSocialShare-Gradientoverlay-largeasin-0to70,TopLeft,0,0_PJAdblSocialShare-AudibleLogo-Large,TopLeft,600,270_OU01_ZBLISTENING ON,617,216,52,500,AudibleSansMd,30,255,255,255_PJAdblSocialShare-PodcastIcon-Small,TopLeft,1094,50.jpg'
  });

  // 核心数据状态
  const [subtitles, setSubtitles] = useState([]);
  const [blocks, setBlocks] = useState([]); // 存储手动切分的片段 { id, title, image }
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState("");
  const [newsDate, setNewsDate] = useState('');
  
  const audioRef = useRef(null);

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };

  // 将 URL 转换为 Blob URL 以缓存图片防闪烁
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

  // ================= 处理合成逻辑 =================
  const startProcessing = async () => {
    if (!formData.audioFile) return alert("请上传音频文件！");
    if (!audioKey || !textKey) return alert("请完善 API 密钥！");
    
    setIsProcessing(true);
    setSubtitles([]);
    setBlocks([]);
    
    try {
      // --- 第 1 步：Whisper 对齐 ---
      setProcessMsg("1. 正在进行高精度音频识别与对齐...");
      const whisperUrl = `${audioBaseUrl.trim().replace(/\/+$/, '')}/audio/transcriptions`;
      
      const audioData = new FormData();
      audioData.append('file', formData.audioFile);
      audioData.append('model', audioModel.trim());
      audioData.append('response_format', 'verbose_json'); 
      audioData.append('timestamp_granularities[]', 'segment'); 
      
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
      
      // === 稳健的断句算法 (按段落等比切割，彻底修复音画不同步和U.S.断句) ===
      setProcessMsg("正在分析断句与优化词轴...");
      let finalSourceSegments = [];

      whisperResult.segments.forEach(seg => {
        const text = seg.text.trim();
        const words = text.split(/\s+/);
        
        if (words.length <= 15) {
            finalSourceSegments.push({ start: seg.start, end: seg.end, text: text });
        } else {
            let chunks = [];
            let currentChunk = [];
            words.forEach((w, idx) => {
                currentChunk.push(w);
                const wordCount = currentChunk.length;
                // 正则排除英文缩写造成的误判
                const isAbbr = /^(U\.S\.|U\.K\.|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|Inc\.|Ltd\.|A\.M\.|P\.M\.|e\.g\.|i\.e\.|vs\.|St\.|Gov\.|Sen\.|Rep\.|Gen\.|Col\.|Capt\.|Lt\.|Sgt\.|Cpl\.|Pvt\.|Jan\.|Feb\.|Mar\.|Apr\.|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.|Mon\.|Tue\.|Wed\.|Thu\.|Fri\.|Sat\.|Sun\.)$/i.test(w) || /^[A-Za-z]\.$/i.test(w);
                const hasStrong = !isAbbr && /[.?!。？！]['"]*$/.test(w);
                const hasWeak = /[,;，；]['"]*$/.test(w);
                
                if (hasStrong || (hasWeak && wordCount >= 8) || wordCount >= 15 || idx === words.length - 1) {
                    chunks.push(currentChunk.join(" "));
                    currentChunk = [];
                }
            });

            const totalChars = chunks.reduce((acc, c) => acc + c.length, 0);
            const duration = seg.end - seg.start;
            let currentT = seg.start;

            chunks.forEach(chunkText => {
                const chunkDuration = totalChars > 0 ? (chunkText.length / totalChars) * duration : 0;
                finalSourceSegments.push({ start: currentT, end: currentT + chunkDuration, text: chunkText });
                currentT += chunkDuration;
            });
        }
      });

      // --- 第 2 步：分批无损翻译与日期提取 ---
      const chatUrl = `${textBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
      const inputMapping = finalSourceSegments.map((s, i) => ({ id: i, en: s.text }));
      let translatedData = [];
      let extractedDateStr = "";
      
      const chunkSize = 20; 
      const totalChunks = Math.ceil(inputMapping.length / chunkSize);

      for (let i = 0; i < inputMapping.length; i += chunkSize) {
        setProcessMsg(`2. 翻译校对中 (第 ${Math.floor(i/chunkSize)+1}/${totalChunks} 批)...`);
        const chunk = inputMapping.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;
        
        const translationPrompt = `You are a professional subtitle translator.
        1. Correct OCR/speech typos in English using the RAW REFERENCE.
        2. Translate English to natural Chinese.
        ${isFirstChunk ? '3. Extract broadcast date if mentioned (e.g. "Wednesday, Oct 11th") to Chinese format (e.g. "10月11日 星期三"). Else return "".' : '3. extractedDate MUST be "".'}
        4. Return a JSON OBJECT with exactly ${chunk.length} items in 'subtitles'. Do NOT skip any.

        RAW REFERENCE: ${formData.rawText ? formData.rawText.substring(0, 800) : "None."}
        INPUT: ${JSON.stringify(chunk)}

        JSON FORMAT:
        {
          "extractedDate": "...",
          "subtitles": [ { "id": 0, "en": "...", "zh": "..." } ]
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

        if (!llmRes.ok) throw new Error(`翻译失败: ${llmRes.status}`);
        
        const llmResult = await llmRes.json();
        try {
           const parsed = JSON.parse(llmResult.choices[0].message.content);
           translatedData = translatedData.concat(parsed.subtitles || []);
           if (isFirstChunk && parsed.extractedDate) extractedDateStr = parsed.extractedDate;
        } catch (e) {
           console.error("JSON 解析失败");
        }
      }

      setNewsDate(extractedDateStr || getFormattedDate());

      // --- 第 3 步：初始化单个默认块 ---
      setProcessMsg("3. 正在组装项目...");
      const defaultLogoBlob = await fetchToBlobUrl(formData.logoUrl);
      const initialBlockId = 'block-0';
      
      setBlocks([{
        id: initialBlockId,
        title: '新闻开场 (Intro)',
        image: defaultLogoBlob
      }]);

      let finalSubtitles = finalSourceSegments.map((seg, i) => {
        const matchObj = translatedData.find(t => t.id === i) || {};
        return { 
          id: i, 
          start: seg.start, 
          end: seg.end, 
          en: matchObj.en || seg.text, 
          zh: matchObj.zh || "（翻译丢失，请重试）",
          blockId: initialBlockId
        };
      });

      setTimeout(() => {
        setSubtitles(finalSubtitles);
        setCurrentTime(0);
        setIsProcessing(false);
      }, 500);

    } catch (error) {
      console.error("处理失败:", error);
      alert(`合成失败！\n\n【错误详情】:\n${error.message}`);
      setIsProcessing(false);
    }
  };

  // ================= 手动区块切分逻辑 =================
  
  // 在指定字幕ID下方拆分出新区块
  const handleSplitAfter = (subId, currentBlockId) => {
    const newBlockId = 'block-' + Date.now();
    
    // 1. 插入新 Block
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === currentBlockId);
        const newBlocks = [...prev];
        newBlocks.splice(idx + 1, 0, { 
            id: newBlockId, 
            title: `新闻片段 ${newBlocks.length + 1}`, 
            image: formData.logoUrl // 默认用全局logo
        });
        return newBlocks;
    });
    
    // 2. 将该 ID 之后且属于原 Block 的字幕划入新 Block
    setSubtitles(prev => {
        let passedSplitPoint = false;
        return prev.map(sub => {
            if (sub.id === subId) {
                passedSplitPoint = true;
                return sub;
            }
            if (passedSplitPoint && sub.blockId === currentBlockId) {
                return { ...sub, blockId: newBlockId };
            }
            return sub;
        });
    });
  };

  // 向上合并区块
  const handleMergeUp = (blockId) => {
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === blockId);
        if (idx <= 0) return prev;
        const targetBlockId = prev[idx - 1].id;
        
        // 更新字幕归属
        setSubtitles(subs => subs.map(sub => sub.blockId === blockId ? { ...sub, blockId: targetBlockId } : sub));
        
        const newBlocks = [...prev];
        newBlocks.splice(idx, 1);
        return newBlocks;
    });
  };

  // 替换区块图片
  const handleReplaceBlockImage = (blockId, file) => {
    if (!file) return;
    const newBlobUrl = URL.createObjectURL(file);
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, image: newBlobUrl } : b));
  };

  // 修改区块标题
  const handleRenameBlock = (blockId, newTitle) => {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, title: newTitle } : b));
  };

  // ================= 播放器与辅助功能 =================
  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.play();
      else audioRef.current.pause();
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); };
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  };
  const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.floor((s%1)*10)}`;

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

  // ================= 视图渲染 =================

  // 渲染左侧手机预览画面
  const renderPhoneScreen = () => {
    if (isProcessing) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-white p-6">
          <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
          <p className="text-sm font-medium">{processMsg}</p>
        </div>
      );
    }

    if (subtitles.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-gray-500 p-6 text-center space-y-4">
          <ImageIcon size={48} className="opacity-50" />
          <p className="text-sm">在右侧工作区上传音频并处理，即可在此处实时预览全屏播报效果</p>
        </div>
      );
    }

    const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
    let targetImage = formData.logoUrl;
    if (activeSubtitle) {
        const b = blocks.find(blk => blk.id === activeSubtitle.blockId);
        if (b) targetImage = b.image;
    }

    return (
      <div className="relative flex flex-col h-full w-full bg-black overflow-hidden cursor-pointer" onClick={() => setIsPlaying(!isPlaying)}>
        {/* 顶部标题区 */}
        <div className="flex-none pt-16 pb-4 flex flex-col items-center justify-center text-white px-6 text-center z-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2 font-sans">KidNuz</h1>
          <p className="text-sm font-medium opacity-95 text-yellow-400">{newsDate || getFormattedDate()}</p>
        </div>

        {/* A/B 分区 */}
        <div className="flex-1 flex flex-col w-full z-10 overflow-hidden">
          <div className="w-full flex-shrink-0">
             <CrossfadeImage src={targetImage} />
          </div>
          <div className="flex-1 w-full px-5 pt-6 pb-12 overflow-y-auto flex flex-col justify-start">
            {activeSubtitle ? (
              <div className="w-full bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10">
                <p className="text-white font-semibold text-lg leading-relaxed drop-shadow-md mb-2 text-left">{activeSubtitle.en}</p>
                <p className="text-yellow-400 font-bold text-[15px] leading-relaxed drop-shadow-md text-left">{activeSubtitle.zh}</p>
              </div>
            ) : null}
          </div>
        </div>

        {!isPlaying && (
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/10 rounded-full p-6 backdrop-blur-sm"><Play size={48} fill="currentColor" className="text-white opacity-80 ml-2" /></div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800 z-20">
          <div className="h-full bg-yellow-400 transition-all duration-100 ease-linear" style={{ width: `${(currentTime / (formData.audioDuration || 1)) * 100}%` }}></div>
        </div>
      </div>
    );
  };

  // 渲染右侧工作区
  const renderWorkspace = () => {
    if (subtitles.length === 0) {
      // 初始上传配置面板
      return (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
          <div className="p-8 max-w-3xl mx-auto w-full space-y-8 flex-1">
            <div className="border-b border-gray-200 pb-4">
              <h1 className="text-2xl font-bold text-gray-800">构建新闻项目</h1>
              <p className="text-sm text-gray-500 mt-2">支持大文件解析，手动切分片段并独立配图。</p>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                <label className="text-sm font-bold text-gray-800 flex items-center"><Mic size={16} className="mr-2 text-blue-500" />Whisper 语音解析接口</label>
                <input type="text" value={audioBaseUrl} onChange={e => setAudioBaseUrl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex space-x-2">
                  <input type="password" placeholder="API Key" value={audioKey} onChange={e => setAudioKey(e.target.value)} className="w-1/2 border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="text" placeholder="Model" value={audioModel} onChange={e => setAudioModel(e.target.value)} className="w-1/2 border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                <label className="text-sm font-bold text-gray-800 flex items-center"><MessageSquare size={16} className="mr-2 text-purple-500" />LLM 文本纠错翻译接口</label>
                <input type="text" value={textBaseUrl} onChange={e => setTextBaseUrl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-purple-500" />
                <div className="flex space-x-2">
                  <input type="password" placeholder="API Key" value={textKey} onChange={e => setTextKey(e.target.value)} className="w-1/2 border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-purple-500" />
                  <input type="text" placeholder="Model" value={textModel} onChange={e => setTextModel(e.target.value)} className="w-1/2 border rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
              <div>
                <label className="text-sm font-bold text-gray-800 mb-2 block">1. 上传主音频 (必须)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:bg-gray-100 p-8 flex flex-col items-center relative overflow-hidden transition-colors">
                  {formData.audioName ? 
                    <div className="text-center"><FileAudio size={40} className="text-blue-500 mx-auto mb-3" /><p className="font-medium text-gray-700">{formData.audioName}</p></div> : 
                    <div className="text-center text-gray-500"><Upload size={40} className="mx-auto mb-3 text-gray-400" /><p>点击此处上传播报音频 (MP3/WAV)</p></div>
                  }
                  <input type="file" accept="audio/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) { const url = URL.createObjectURL(file); const temp = new Audio(url); temp.onloadedmetadata = () => setFormData(prev => ({...prev, audioFile: file, audioName: file.name, audioUrl: url, audioDuration: temp.duration})); }
                  }} />
                </div>
              </div>

              <div>
                <label className="text-sm font-bold text-gray-800 mb-2 block">2. 粘贴参考原稿 (用于纠错及提取日期)</label>
                <textarea className="w-full h-24 p-3 text-sm border border-gray-300 rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" value={formData.rawText} onChange={e => setFormData({...formData, rawText: e.target.value})} placeholder="在此粘贴原版英文文本..."></textarea>
              </div>
            </div>
            
            <button onClick={startProcessing} disabled={isProcessing} className="w-full bg-black text-white rounded-xl py-4 font-bold text-lg hover:bg-gray-800 transition-all shadow-lg flex items-center justify-center disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin mr-2" /> : <Play className="mr-2" size={20} />}
              {isProcessing ? "处理中..." : "开始解析与构建项目"}
            </button>
          </div>
        </div>
      );
    }

    // 后台手动切分编辑器
    return (
      <div className="flex-1 flex flex-col bg-gray-100 relative overflow-hidden">
        {/* 控制条 */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center space-x-4 shrink-0 shadow-sm z-10">
           <button onClick={() => setIsPlaying(!isPlaying)} className="w-12 h-12 rounded-full bg-blue-600 flex justify-center items-center hover:bg-blue-500 text-white shrink-0 shadow-md">
             {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
           </button>
           <div className="flex-1 space-y-1.5">
             <input type="range" min="0" max={formData.audioDuration || 1} step="0.01" value={currentTime} onChange={handleSeek} className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600" />
             <div className="flex justify-between text-xs text-gray-500 font-mono font-medium">
               <span>{formatTime(currentTime)}</span><span>{formData.audioDuration ? formatTime(formData.audioDuration) : '00:00.0'}</span>
             </div>
           </div>
           <button onClick={handleExport} className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center shadow-md">
            <Download size={16} className="mr-2" /> 导出 SRT
          </button>
        </div>

        {/* 区块列表 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
          {blocks.map((block, bIdx) => {
            const blockSubs = subtitles.filter(s => s.blockId === block.id);
            if (blockSubs.length === 0) return null; // Hide empty blocks safely
            
            return (
              <div key={block.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col 2xl:flex-row">
                 {/* 侧边：配图上传区 */}
                 <div className="w-full 2xl:w-[320px] bg-gray-50 border-b 2xl:border-b-0 2xl:border-r border-gray-200 p-5 flex flex-col shrink-0">
                    <div className="flex items-center justify-between mb-4">
                       <input 
                         type="text" 
                         value={block.title} 
                         onChange={(e) => handleRenameBlock(block.id, e.target.value)} 
                         className="font-bold text-lg text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none w-2/3 px-1"
                       />
                       {bIdx > 0 && (
                         <button onClick={() => handleMergeUp(block.id)} title="与上一个片段合并" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                           <ArrowUp size={18} />
                         </button>
                       )}
                    </div>
                    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative shadow-inner border border-gray-200 mb-4 group">
                       <img src={block.image} className="w-full h-full object-cover" alt="Block Cover" />
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <span className="text-white font-medium text-sm drop-shadow-md">点击下方按钮更换</span>
                       </div>
                    </div>
                    <label className="w-full flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:text-blue-600 hover:border-blue-400 py-2.5 rounded-xl cursor-pointer text-sm font-semibold transition-colors shadow-sm">
                       <ImagePlus size={16} className="mr-2" /> 上传专属片段配图
                       <input type="file" accept="image/*" className="hidden" onChange={(e)=>handleReplaceBlockImage(block.id, e.target.files[0])} />
                    </label>
                 </div>
                 
                 {/* 主体：字幕编辑区 */}
                 <div className="flex-1 p-5 bg-white max-h-[500px] overflow-y-auto space-y-3 relative">
                    {blockSubs.map((sub, sIdx) => {
                       const idx = subtitles.findIndex(s => s.id === sub.id);
                       const isActive = currentTime >= sub.start && currentTime <= sub.end;
                       const isLastOverall = idx === subtitles.length - 1;

                       return (
                          <div key={sub.id}>
                            <div className={`rounded-xl border transition-all duration-200 ${isActive ? 'border-blue-400 bg-blue-50 shadow-md ring-2 ring-blue-100' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                              <div className={`px-4 py-2 border-b flex justify-between items-center rounded-t-xl ${isActive ? 'bg-blue-100/40 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                                <div className="flex items-center space-x-2 text-xs font-mono font-medium text-gray-500">
                                  <Clock size={14} className={isActive ? 'text-blue-500' : 'text-gray-400'} />
                                  <input type="number" step="0.1" value={sub.start.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].start=parseFloat(e.target.value)||0; setSubtitles(n); }} className="w-14 bg-transparent text-center outline-none focus:text-blue-600 focus:border-b focus:border-blue-300 transition-colors" />
                                  <span>→</span>
                                  <input type="number" step="0.1" value={sub.end.toFixed(1)} onChange={(e) => { const n=[...subtitles]; n[idx].end=parseFloat(e.target.value)||0; setSubtitles(n); }} className="w-14 bg-transparent text-center outline-none focus:text-blue-600 focus:border-b focus:border-blue-300 transition-colors" />
                                </div>
                              </div>
                              <div className="p-3 space-y-2">
                                <div className="flex items-start">
                                  <span className="text-[10px] font-bold text-gray-400 w-8 pt-1">EN</span>
                                  <textarea value={sub.en} onChange={(e) => { const n=[...subtitles]; n[idx].en=e.target.value; setSubtitles(n); }} className="flex-1 text-sm font-medium text-gray-900 bg-transparent outline-none resize-none min-h-[40px] leading-relaxed" />
                                </div>
                                <div className="w-full h-px bg-gray-100"></div>
                                <div className="flex items-start">
                                  <span className="text-[10px] font-bold text-blue-400 w-8 pt-1">中</span>
                                  <textarea value={sub.zh} onChange={(e) => { const n=[...subtitles]; n[idx].zh=e.target.value; setSubtitles(n); }} className="flex-1 text-sm font-medium text-gray-700 bg-transparent outline-none resize-none min-h-[40px] leading-relaxed" />
                                </div>
                              </div>
                            </div>

                            {/* 手动切分按钮 (悬浮于两句之间) */}
                            {!isLastOverall && (
                              <div className="flex justify-center my-1 relative group py-1">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-gray-200 group-hover:border-blue-300 transition-colors"></div></div>
                                <button onClick={() => handleSplitAfter(sub.id, block.id)} className="relative bg-white border border-gray-200 text-gray-500 group-hover:text-blue-600 group-hover:border-blue-400 group-hover:shadow-sm text-xs px-3 py-1 rounded-full font-medium transition-all flex items-center opacity-0 group-hover:opacity-100">
                                  <Scissors size={12} className="mr-1.5" /> 在此向下拆分新片段
                                </button>
                              </div>
                            )}
                          </div>
                       )
                    })}
                 </div>
              </div>
            )
          })}
        </div>
      </div>
    );
  };

  // 全局渲染主骨架：左右双栏 MacBook 级布局
  return (
    <div className="flex h-screen w-screen bg-gray-900 text-gray-800 font-sans overflow-hidden">
      <audio ref={audioRef} src={formData.audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
      
      {/* ================= 左侧：模拟手机实时预览区域 ================= */}
      <div className="w-[450px] h-full p-8 flex flex-col items-center justify-center shrink-0 border-r border-white/10 bg-black/40 relative">
         <div className="absolute top-6 left-8 text-white/50 text-xs font-bold tracking-widest flex items-center">
            <Eye size={14} className="mr-2" /> LIVE PREVIEW
         </div>
         {/* 手机外壳 */}
         <div className="w-[375px] h-[812px] bg-black rounded-[3rem] border-[14px] border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col ring-1 ring-white/10">
            {/* 刘海屏 */}
            <div className="absolute top-0 inset-x-0 h-6 bg-gray-800 rounded-b-2xl w-1/2 mx-auto z-50"></div>
            {renderPhoneScreen()}
         </div>
      </div>

      {/* ================= 右侧：宽屏工作台区域 ================= */}
      <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
         {renderWorkspace()}
      </div>
    </div>
  );
}