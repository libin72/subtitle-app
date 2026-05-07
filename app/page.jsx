"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, FileText, Image as ImageIcon, 
  Play, Pause, Plus, ChevronLeft, Settings, 
  Trash2, CheckCircle, Loader2, Download, Edit3, Clock, Key, Link as LinkIcon, Mic, MessageSquare
} from 'lucide-react';

// 模拟初始测试数据
const MOCK_PROJECTS = [
  { id: 1, title: '苹果秋季发布会_片段1', date: '2023-10-24', duration: '03:12' },
];

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  
  // ================= API 配置状态 (双通道) =================
  const [audioBaseUrl, setAudioBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [audioKey, setAudioKey] = useState('');
  const [audioModel, setAudioModel] = useState('whisper-large-v3');
  
  const [textBaseUrl, setTextBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [textKey, setTextKey] = useState('');
  const [textModel, setTextModel] = useState('llama-3.3-70b-versatile');

  // 初始化时从本地读取配置
  useEffect(() => {
    if (localStorage.getItem('wx_audio_url')) setAudioBaseUrl(localStorage.getItem('wx_audio_url'));
    if (localStorage.getItem('wx_audio_key')) setAudioKey(localStorage.getItem('wx_audio_key'));
    if (localStorage.getItem('wx_audio_model')) setAudioModel(localStorage.getItem('wx_audio_model'));
    
    if (localStorage.getItem('wx_text_url')) setTextBaseUrl(localStorage.getItem('wx_text_url'));
    if (localStorage.getItem('wx_text_key')) setTextKey(localStorage.getItem('wx_text_key'));
    if (localStorage.getItem('wx_text_model')) setTextModel(localStorage.getItem('wx_text_model'));
  }, []);
  
  // ================= 业务状态 =================
  const [formData, setFormData] = useState({
    title: '新建音频字幕项目',
    audioFile: null, 
    audioName: '',
    audioUrl: '',
    audioDuration: 0,
    rawText: '',
    bgName: '',
    bgUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop'
  });

  const [subtitles, setSubtitles] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [processStep, setProcessStep] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const audioRef = useRef(null);

  // ================= 核心处理逻辑 (Whisper + LLM) =================
  useEffect(() => {
    if (currentView === 'processing' && !isProcessing) {
      const processVideo = async () => {
        setIsProcessing(true);
        try {
          if (!formData.audioFile) throw new Error("缺少音频文件！");
          
          // --- 第 1 步：调用 Whisper 接口进行高精度对齐 ---
          setProcessStep(1);
          const cleanAudioUrl = audioBaseUrl.trim().replace(/\/+$/, '');
          const whisperUrl = `${cleanAudioUrl}/audio/transcriptions`;
          
          const audioData = new FormData();
          audioData.append('file', formData.audioFile);
          audioData.append('model', audioModel.trim());
          audioData.append('response_format', 'verbose_json'); 
          audioData.append('timestamp_granularities[]', 'segment'); 
          audioData.append('timestamp_granularities[]', 'word'); // 强制请求词级时间戳，解决不同步核心
          
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
          
          // === 新增：精确同步与智能拆分逻辑 ===
          let finalSourceSegments = [];

          if (whisperResult.words && whisperResult.words.length > 0) {
              let currentSeg = null;
              whisperResult.words.forEach((w, idx) => {
                  // 过滤无时间的幻觉单词
                  if (typeof w.start !== 'number' || typeof w.end !== 'number') return;
                  
                  if (!currentSeg) currentSeg = { start: w.start, end: w.end, text: "" };
                  currentSeg.text += (currentSeg.text ? " " : "") + w.word.trim();
                  currentSeg.end = w.end; // 实时更新结束时间，确保毫秒级同步
                  
                  const wordCount = currentSeg.text.split(/\s+/).length;
                  const hasStrongPunctuation = /[.?!。？！]['"]*$/.test(w.word.trim());
                  const hasWeakPunctuation = /[,;，；]['"]*$/.test(w.word.trim());
                  const isLastWord = idx === whisperResult.words.length - 1;
                  
                  // 1. 强标点必断； 2. 弱标点超15词断； 3. 防溢出保底(无标点超25词)强制断； 4. 最后一句
                  if (hasStrongPunctuation || (hasWeakPunctuation && wordCount >= 15) || wordCount >= 25 || isLastWord) {
                      finalSourceSegments.push({ start: currentSeg.start, end: currentSeg.end, text: currentSeg.text.trim() });
                      currentSeg = null;
                  }
              });
          } else {
              // 降级兼容：接口不支持 word 时退回 segment 长度估算
              whisperResult.segments.forEach(seg => {
                  const words = seg.text.trim().split(/\s+/);
                  let chunks = [];
                  let currentChunk = [];
                  
                  words.forEach((w, idx) => {
                      currentChunk.push(w);
                      const wordCount = currentChunk.length;
                      const hasStrong = /[.?!。？！]['"]*$/.test(w);
                      const hasWeak = /[,;，；]['"]*$/.test(w);
                      if (hasStrong || (hasWeak && wordCount >= 15) || wordCount >= 25 || idx === words.length - 1) {
                          chunks.push(currentChunk.join(" "));
                          currentChunk = [];
                      }
                  });

                  const totalChars = chunks.reduce((acc, text) => acc + text.length, 0);
                  const duration = seg.end - seg.start;
                  let currentTime = seg.start;
                  chunks.forEach(chunkText => {
                      const chunkDuration = totalChars > 0 ? (chunkText.length / totalChars) * duration : 0;
                      finalSourceSegments.push({ start: currentTime, end: currentTime + chunkDuration, text: chunkText });
                      currentTime += chunkDuration;
                  });
              });
          }

          // --- 第 2 步：防漏翻机制 (打标签 ID + 强类型 JSON 返回) ---
          setProcessStep(2);
          const cleanTextUrl = textBaseUrl.trim().replace(/\/+$/, '');
          const chatUrl = `${cleanTextUrl}/chat/completions`;
          
          // 给每句话标上 ID，大模型将无法漏翻
          const inputMapping = finalSourceSegments.map((s, i) => ({ id: i, en: s.text }));
          
          const translationPrompt = `You are a professional subtitle translator.
          1. Correct any OCR/speech-recognition typos in the provided English text, referring to the RAW REFERENCE if given.
          2. Translate the corrected English into natural, concise Chinese.
          3. You MUST return a VALID JSON OBJECT containing an array named "subtitles".
          4. You MUST NOT skip any segment. Map each translation exactly to its input "id".

          RAW REFERENCE TEXT:
          ${formData.rawText ? formData.rawText : "None. Fix obvious grammar typos."}

          INPUT SEGMENTS TO TRANSLATE:
          ${JSON.stringify(inputMapping)}

          REQUIRED JSON OUTPUT FORMAT:
          {
            "subtitles": [
              { "id": 0, "en": "corrected english...", "zh": "中文翻译..." },
              { "id": 1, "en": "...", "zh": "..." }
            ]
          }`;

          const llmRes = await fetch(chatUrl, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${textKey}` 
            },
            body: JSON.stringify({
              model: textModel.trim(),
              messages: [{ role: 'user', content: translationPrompt }],
              temperature: 0.1,
              response_format: { type: "json_object" } // 强行锁死返回结构，杜绝乱码和截断
            })
          });

          if (!llmRes.ok) {
            const err = await llmRes.json().catch(()=>({}));
            throw new Error(`翻译纠错请求失败: ${err.error?.message || llmRes.status}`);
          }

          setProcessStep(3);
          const llmResult = await llmRes.json();
          const responseText = llmResult.choices[0].message.content;
          
          let translatedData = [];
          try {
             const parsed = JSON.parse(responseText);
             translatedData = parsed.subtitles || [];
          } catch (e) {
             console.error("JSON 解析失败:", responseText);
             throw new Error("大模型未返回合规的 JSON 数据，请重试。");
          }

          // --- 第 4 步：融合组装 (根据 ID 精确绑定，拒绝错位) ---
          setProcessStep(4);
          const finalSubtitles = finalSourceSegments.map((seg, i) => {
            const matchObj = translatedData.find(t => t.id === i) || {};
            return { 
              id: i + 1, 
              start: seg.start, 
              end: seg.end, 
              en: matchObj.en || seg.text, 
              zh: matchObj.zh || "（翻译丢失，请检查）" 
            };
          });

          setTimeout(() => {
            setSubtitles(finalSubtitles);
            setCurrentView('editor');
            setCurrentTime(0);
            setIsProcessing(false);
          }, 800);

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

  // ================= 播放器与拖动同步 =================
  useEffect(() => {
    if (currentView === 'editor' && audioRef.current) {
      if (isPlaying) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, currentView]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  // 用户拖动进度条事件
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleExport = () => {
    let srtContent = "";
    subtitles.forEach((sub, i) => {
      const formatSrtTime = (seconds) => {
        const pad = (num, size) => ('000' + num).slice(size * -1);
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
      };
      srtContent += `${i + 1}\n`;
      srtContent += `${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n`;
      srtContent += `${sub.en}\n${sub.zh}\n\n`;
    });
    
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formData.title || 'subtitle'}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // --- 视图渲染 ---

  const renderDashboard = () => (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white shadow-sm px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">控制台</h1>
          <p className="text-xs text-gray-500 mt-1">管理员工作台 <span className="text-blue-500 font-bold ml-1">(Whisper 专用版)</span></p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <button 
          onClick={() => setCurrentView('upload')}
          className="w-full bg-blue-600 text-white rounded-xl py-4 flex items-center justify-center space-x-2 font-medium shadow-md hover:bg-blue-700 active:scale-95 transition-all"
        >
          <Plus size={20} />
          <span>新建合成项目</span>
        </button>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 mb-4 uppercase tracking-wider">最近项目</h2>
          <div className="space-y-3">
            {MOCK_PROJECTS.map(proj => (
              <div key={proj.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:border-blue-300 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <FileAudio size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-800">{proj.title}</h3>
                    <p className="text-xs text-gray-400 mt-1">{proj.date} • {proj.duration}</p>
                  </div>
                </div>
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
        <button onClick={() => setCurrentView('dashboard')} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} className="text-gray-700" />
        </button>
        <h1 className="text-lg font-bold text-gray-800 ml-2">素材与系统配置</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-5 space-y-6 pb-24">
        {/* ================= 双通道 API 配置区 ================= */}
        <div className="space-y-4">
          
          {/* 通道1: Whisper */}
          <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-2">
            <label className="text-sm font-bold text-blue-900 flex items-center mb-3">
              <Mic size={16} className="mr-2 text-blue-500" />
              1. 语音对齐接口 (WhisperX 兼容)
            </label>
            <input 
              type="text" placeholder="Base URL (例: https://api.groq.com/openai/v1)" value={audioBaseUrl}
              onChange={(e) => { setAudioBaseUrl(e.target.value); localStorage.setItem('wx_audio_url', e.target.value); }}
              className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <div className="flex space-x-2">
              <input 
                type="password" placeholder="API Key" value={audioKey}
                onChange={(e) => { setAudioKey(e.target.value); localStorage.setItem('wx_audio_key', e.target.value); }}
                className="w-1/2 bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input 
                type="text" placeholder="模型 (如: whisper-large-v3)" value={audioModel}
                onChange={(e) => { setAudioModel(e.target.value); localStorage.setItem('wx_audio_model', e.target.value); }}
                className="w-1/2 bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* 通道2: LLM */}
          <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100 space-y-2">
            <label className="text-sm font-bold text-purple-900 flex items-center mb-3">
              <MessageSquare size={16} className="mr-2 text-purple-500" />
              2. 文本校对与翻译接口 (LLM 大语言模型)
            </label>
            <input 
              type="text" placeholder="Base URL (例: https://api.groq.com/openai/v1)" value={textBaseUrl}
              onChange={(e) => { setTextBaseUrl(e.target.value); localStorage.setItem('wx_text_url', e.target.value); }}
              className="w-full bg-white border border-purple-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none"
            />
            <div className="flex space-x-2">
              <input 
                type="password" placeholder="API Key" value={textKey}
                onChange={(e) => { setTextKey(e.target.value); localStorage.setItem('wx_text_key', e.target.value); }}
                className="w-1/2 bg-white border border-purple-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input 
                type="text" placeholder="模型 (如: llama-3.3-70b-versatile)" value={textModel}
                onChange={(e) => { setTextModel(e.target.value); localStorage.setItem('wx_text_model', e.target.value); }}
                className="w-1/2 bg-white border border-purple-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>
          </div>

        </div>

        {/* 1. 上传音频 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center">
            <span className="bg-gray-200 text-gray-700 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">1</span>
            主音频文件 (必填)
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl bg-white hover:bg-gray-50 p-6 flex flex-col items-center relative overflow-hidden group">
            {formData.audioName ? (
              <div className="text-center">
                <FileAudio size={32} className="text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{formData.audioName}</p>
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <Upload size={28} className="mx-auto mb-2" />
                <p className="text-sm">点击上传音频 (MP3/WAV)</p>
              </div>
            )}
            <input 
              type="file" accept="audio/*" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  const tempAudio = new Audio(url);
                  tempAudio.onloadedmetadata = () => {
                    setFormData(prev => ({...prev, audioFile: file, audioName: file.name, audioUrl: url, audioDuration: tempAudio.duration}));
                  };
                }
              }}
            />
          </div>
        </div>

        {/* 2. 英文原稿 (Prompt) */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center">
            <span className="bg-gray-200 text-gray-700 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">2</span>
            参考原稿 (选填，AI 将以此为准纠错)
          </label>
          <textarea 
            placeholder="如果包含专有名词，建议粘贴英文原稿。AI 会将音频时间轴自动吸附并对齐至原稿。"
            className="w-full h-20 p-3 text-sm border border-gray-300 rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500"
            value={formData.rawText}
            onChange={(e) => setFormData({...formData, rawText: e.target.value})}
          />
        </div>
      </main>

      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg shrink-0 z-20">
        <button 
          onClick={() => {
            if (!formData.audioFile) { alert("请先上传音频文件"); return; }
            if (!audioKey || !textKey) { alert("请完善上方 Whisper 和翻译大模型的 API 密钥！"); return; }
            setCurrentView('processing');
          }}
          className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold text-sm hover:bg-black shadow-md transition-all active:scale-[0.98]"
        >
          开始 WhisperX 高精度对齐
        </button>
      </div>
    </div>
  );

  const renderProcessing = () => {
    const steps = [
      "准备处理通道...",
      "1. Whisper(X) 引擎正在精准识别与时间对齐...",
      "2. 提取分段字幕...",
      "3. 正在呼叫大语言模型进行原稿校对与翻译...",
      "完成数据组合装载..."
    ];

    return (
      <div className="flex flex-col h-full bg-gray-900 justify-center items-center text-white p-8 relative overflow-hidden">
        <Loader2 size={48} className="animate-spin text-blue-400 mb-8" />
        <h2 className="text-xl font-bold mb-6">正在处理数据</h2>
        <div className="w-full space-y-4">
          {steps.map((text, idx) => {
            const isPast = processStep > idx;
            const isCurrent = processStep === idx;
            return (
              <div key={idx} className="flex items-center space-x-3 text-sm">
                {isPast ? <CheckCircle size={18} className="text-green-400 shrink-0" /> 
                 : isCurrent ? <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-white animate-spin shrink-0"></div> 
                 : <div className="w-4 h-4 rounded-full border-2 border-gray-600 shrink-0"></div>}
                <span className={`${isPast ? 'text-gray-400' : isCurrent ? 'text-white font-medium' : 'text-gray-600'}`}>{text}</span>
              </div>
            )
          })}
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);

    return (
      <div className="flex flex-col h-full bg-black relative">
        {/* 顶部栏 */}
        <header className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-4 bg-gradient-to-b from-black/80 to-transparent text-white">
          <button onClick={() => setCurrentView('dashboard')} className="p-2 rounded-full backdrop-blur-sm bg-black/40">
            <ChevronLeft size={20} />
          </button>
          <div className="text-sm font-medium">{formData.title}</div>
          <button onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-lg">
            <Download size={14} className="mr-1" /> 导出 SRT
          </button>
        </header>

        {/* 预览区 */}
        <div className="relative w-full h-[45%] bg-gray-900 flex flex-col justify-center overflow-hidden">
          <img src={formData.bgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover opacity-60" />
          <div className="relative z-10 w-full px-6 flex flex-col items-center justify-center text-center mt-auto mb-10 min-h-[80px]">
            {activeSubtitle ? (
              <div className="bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10 w-full max-w-[95%] transform transition-all">
                <p className="text-white font-bold text-lg mb-1 leading-tight drop-shadow-md">{activeSubtitle.en}</p>
                <p className="text-yellow-400 font-medium text-sm drop-shadow-md">{activeSubtitle.zh}</p>
              </div>
            ) : <div className="h-[60px]"></div>}
          </div>
        </div>

        {/* ================= 可拖动进度条与播放控制 ================= */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center space-x-3 text-white">
           <audio ref={audioRef} src={formData.audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
           <button onClick={() => setIsPlaying(!isPlaying)} className="w-10 h-10 rounded-full bg-blue-600 flex justify-center items-center hover:bg-blue-500 shrink-0">
             {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
           </button>
           <div className="flex-1 space-y-2">
             
             {/* 核心改动：原生的 input range 滑动条，支持拖拽 */}
             <input 
               type="range"
               min="0"
               max={formData.audioDuration || 1}
               step="0.01"
               value={currentTime}
               onChange={handleSeek}
               className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500 outline-none"
             />

             <div className="flex justify-between text-[10px] text-gray-400 font-mono">
               <span>{formatTime(currentTime)}</span>
               <span>{formData.audioDuration ? formatTime(formData.audioDuration) : '00:00.0'}</span>
             </div>
           </div>
        </div>

        {/* 编辑器 */}
        <div className="flex-1 bg-gray-50 overflow-y-auto pb-6 relative rounded-t-2xl -mt-2 z-10">
          <div className="sticky top-0 bg-gray-50/90 backdrop-blur-md px-4 py-3 border-b border-gray-200 flex justify-between items-center z-10">
            <h3 className="text-sm font-bold text-gray-700 flex items-center">
              <Edit3 size={16} className="mr-2 text-blue-500" />
              调整字幕内容
            </h3>
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">共 {subtitles.length} 句</span>
          </div>
          <div className="p-4 space-y-4">
            {subtitles.map((sub, index) => {
              const isActive = currentTime >= sub.start && currentTime <= sub.end;
              return (
                <div key={sub.id} className={`bg-white rounded-xl shadow-sm border transition-all ${isActive ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200'}`}>
                  <div className={`px-3 py-2 border-b flex justify-between items-center ${isActive ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center space-x-2 text-xs font-mono text-gray-600">
                      <Clock size={12} className={isActive ? 'text-blue-500' : 'text-gray-400'} />
                      <input type="number" step="0.1" value={sub.start.toFixed(1)} 
                        onChange={(e) => { const n=[...subtitles]; n[index].start=parseFloat(e.target.value)||0; setSubtitles(n); }}
                        className="w-12 bg-transparent border-b border-gray-300 text-center outline-none focus:border-blue-500" />
                      <span>-</span>
                      <input type="number" step="0.1" value={sub.end.toFixed(1)} 
                        onChange={(e) => { const n=[...subtitles]; n[index].end=parseFloat(e.target.value)||0; setSubtitles(n); }}
                        className="w-12 bg-transparent border-b border-gray-300 text-center outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="relative">
                      <span className="absolute left-0 top-1 text-[10px] font-bold text-gray-300">EN</span>
                      <textarea value={sub.en} onChange={(e) => { const n=[...subtitles]; n[index].en=e.target.value; setSubtitles(n); }}
                        className="w-full pl-6 text-sm font-medium text-gray-800 bg-transparent outline-none resize-none min-h-[40px]" />
                    </div>
                    <div className="w-full h-px bg-gray-100"></div>
                    <div className="relative">
                      <span className="absolute left-0 top-1 text-[10px] font-bold text-blue-200">中</span>
                      <textarea value={sub.zh} onChange={(e) => { const n=[...subtitles]; n[index].zh=e.target.value; setSubtitles(n); }}
                        className="w-full pl-6 text-sm font-medium text-gray-600 bg-transparent outline-none resize-none min-h-[40px]" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-200 flex items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-[400px] h-[100dvh] sm:h-[800px] bg-white sm:rounded-[2.5rem] shadow-2xl overflow-hidden relative border-[8px] border-gray-900/5">
        <div className="hidden sm:block absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-900/5 rounded-b-xl z-50 pointer-events-none"></div>
        {currentView === 'dashboard' && renderDashboard()}
        {currentView === 'upload' && renderUpload()}
        {currentView === 'processing' && renderProcessing()}
        {currentView === 'editor' && renderEditor()}
      </div>
    </div>
  );
}