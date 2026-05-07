"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, FileText, Image as ImageIcon, 
  Play, Pause, Plus, ChevronLeft, Settings, 
  Trash2, CheckCircle, Loader2, Download, Edit3, Clock
} from 'lucide-react';

// 模拟初始的测试数据
const MOCK_PROJECTS = [
  { id: 1, title: '苹果秋季发布会_片段1', date: '2023-10-24', duration: '03:12' },
  { id: 2, title: 'TED演讲_如何控制情绪', date: '2023-10-22', duration: '15:45' },
];

const MOCK_SUBTITLES = [
  { id: 1, start: 0, end: 3, en: "Welcome to today's special event.", zh: "欢迎来到今天的特别活动。" },
  { id: 2, start: 3, end: 6.5, en: "We have some incredible new products to share with you.", zh: "我们有一些令人难以置信的新产品要与大家分享。" },
  { id: 3, start: 6.5, end: 9, en: "Let's dive right in and take a look.", zh: "让我们直接开始看看吧。" },
  { id: 4, start: 9, end: 12, en: "The performance is simply astonishing.", zh: "这个性能简直令人震惊。" },
  { id: 5, start: 12, end: 15, en: "And it's all powered by our latest silicon.", zh: "而这一切都得益于我们最新的芯片。" }
];

export default function App() {
  // 视图状态: 'dashboard', 'upload', 'processing', 'editor'
  const [currentView, setCurrentView] = useState('dashboard');
  
  // 上传表单状态
  const [formData, setFormData] = useState({
    title: '新建音频字幕项目',
    audioName: '',
    audioUrl: '',
    audioDuration: 0,
    audioBase64: '', // 重新启用 Base64
    audioMimeType: '',
    textName: '',
    rawText: '',
    bgName: '',
    bgUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop'
  });

  // 编辑器状态
  const [subtitles, setSubtitles] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [processStep, setProcessStep] = useState(0);

  const audioRef = useRef(null);

  // API Retry Logic (网络请求防抖与重试) - 增强了错误捕获
  const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          // 尝试获取后端的详细错误信息
          let errMsg = `HTTP 请求失败 (状态码: ${res.status})`;
          try {
            const errData = await res.json();
            if(errData.error) errMsg += ` - ${errData.error}`;
          } catch(parseErr) {
            // 如果后端返回的不是 JSON（比如 Vercel 报错页面），则读取文本
            const errText = await res.text();
            if(errText) errMsg += `\n详情: ${errText.substring(0, 100)}...`;
          }
          throw new Error(errMsg);
        }
        return await res.json();
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise(r => setTimeout(r, delays[i]));
      }
    }
  };

  // 真实的AI处理流程与精确时间对齐 (绕过 Vercel 防火墙，前端直连)
  useEffect(() => {
    if (currentView === 'processing') {
      const processVideo = async () => {
        try {
          setProcessStep(0);
          setProcessStep(1);
          
          // 👉 核心修改 1：请在这里填入您真实的 Google API Key
          // 因为是您自用的工作台，把 Key 放在这里是最稳妥防 Vercel 拦截的方案
          const apiKey = "YOUR_API_KEY"; 
          
          if (!apiKey || apiKey === "YOUR_API_KEY") {
             throw new Error("请在 App.jsx 的 processVideo 函数中填入您的 Gemini API Key！");
          }

          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`; 
          
          const prompt = `I am providing an audio file and its English transcript. 
          Transcript: ${formData.rawText}

          Task:
          1. Segment the transcript into logical subtitle sentences (roughly 5-12 words each).
          2. Listen to the audio to determine the PRECISE start and end times (in seconds) for each segment.
          3. Translate each segment into natural Chinese.
          4. Return ONLY a valid JSON array. Do not output any other text or markdown.`;

          // 直接将原始文本和音频的 base64 编码发给 Google，绕过 Vercel 后端限制
          const payload = {
            contents: [{ 
              parts: [
                { text: prompt },
                ...(formData.audioBase64 ? [{ inlineData: { mimeType: formData.audioMimeType || "audio/mp3", data: formData.audioBase64 } }] : [])
              ] 
            }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    start: { type: "NUMBER" },
                    end: { type: "NUMBER" },
                    en: { type: "STRING" },
                    zh: { type: "STRING" }
                  }
                }
              }
            }
          };

          const data = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!data || !data.candidates || !data.candidates[0]) {
             throw new Error("Google AI 返回了异常的数据结构。");
          }

          setProcessStep(2);
          
          // 解析 Google 直接返回的数据
          const segmentsText = data.candidates[0].content.parts[0].text;
          const segments = JSON.parse(segmentsText);
          
          setProcessStep(3);
          
          // 使用大模型听取音频后返回的精确时间
          const newSubtitles = segments.map((seg, i) => {
            return { 
              id: i + 1, 
              // 确保时间是有效数字，处理可能出现的边缘情况
              start: typeof seg.start === 'number' ? seg.start : 0, 
              end: typeof seg.end === 'number' ? seg.end : 0, 
              en: seg.en || "", 
              zh: seg.zh || "" 
            };
          });

          setTimeout(() => {
            setSubtitles(newSubtitles);
            setCurrentView('editor');
            setCurrentTime(0);
          }, 1000);

        } catch (error) {
          console.error("处理失败详细信息:", error);
          // 使用更详细的错误提示反馈
          alert(`处理失败！\n\n【错误详情】:\n${error.message}\n\n👉【排查建议】:\n1. 确保已在 Vercel 设置 GEMINI_API_KEY，并且设置后点击了 "Redeploy" 重新部署。\n2. 检查音频文件是否过大 (Vercel 免费版限制约 4.5MB)。\n3. 前往 Vercel 后台 -> "Logs" 标签页查看后端完整报错。`);
          setCurrentView('upload');
        }
      };

      processVideo();
    }
  }, [currentView, formData]);

  // 真实的播放器控制
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

  // 导出 SRT 功能
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

  // 工具函数：格式化时间
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // --- 视图组件 ---

  const renderDashboard = () => (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white shadow-sm px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">控制台</h1>
          <p className="text-xs text-gray-500 mt-1">管理员专属合成工具</p>
        </div>
        <button className="p-2 rounded-full hover:bg-gray-100">
          <Settings size={20} className="text-gray-600" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <button 
          onClick={() => setCurrentView('upload')}
          className="w-full bg-indigo-600 text-white rounded-xl py-4 flex items-center justify-center space-x-2 font-medium shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
        >
          <Plus size={20} />
          <span>新建合成项目</span>
        </button>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 mb-4 uppercase tracking-wider">最近项目</h2>
          <div className="space-y-3">
            {MOCK_PROJECTS.map(proj => (
              <div key={proj.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:border-indigo-300 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className="bg-indigo-100 p-3 rounded-lg">
                    <FileAudio size={20} className="text-indigo-600" />
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
      <header className="bg-white px-4 py-4 flex items-center shadow-sm relative z-10">
        <button onClick={() => setCurrentView('dashboard')} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} className="text-gray-700" />
        </button>
        <h1 className="text-lg font-bold text-gray-800 ml-2">上传素材</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6 pb-24">
        {/* 项目名称 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">项目名称</label>
          <input 
            type="text" 
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>

        {/* 1. 上传音频 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center">
            <span className="bg-indigo-100 text-indigo-700 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">1</span>
            主音频文件 (必填)
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl bg-white hover:bg-gray-50 transition-colors p-6 flex flex-col items-center justify-center relative overflow-hidden group">
            {formData.audioName ? (
              <div className="text-center">
                <FileAudio size={32} className="text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{formData.audioName}</p>
                <p className="text-xs text-gray-400 mt-1">点击重新上传</p>
              </div>
            ) : (
              <div className="text-center text-gray-500 group-hover:text-indigo-500">
                <Upload size={28} className="mx-auto mb-2" />
                <p className="text-sm">点击上传音频 (MP3/WAV)</p>
              </div>
            )}
            <input 
              type="file" 
              accept="audio/*" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  const tempAudio = new Audio(url);
                  tempAudio.onloadedmetadata = () => {
                    setFormData(prev => ({...prev, audioName: file.name, audioUrl: url, audioDuration: tempAudio.duration}));
                  };
                  
                  // 重新启用：将音频文件读取为 Base64 以供后端发送给 AI
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const base64String = event.target.result.split(',')[1];
                    setFormData(prev => ({
                      ...prev, 
                      audioBase64: base64String, 
                      audioMimeType: file.type || 'audio/mp3'
                    }));
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </div>
        </div>

        {/* 2. 上传英文字幕 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center">
            <span className="bg-indigo-100 text-indigo-700 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">2</span>
            英文字稿/字幕 (必填)
          </label>
          <div className="border border-gray-300 rounded-xl bg-white overflow-hidden flex flex-col">
            <textarea 
              placeholder="请粘贴英文原稿，或上传TXT文件。AI将自动进行断句和翻译..."
              className="w-full h-24 p-4 text-sm resize-none outline-none"
              value={formData.rawText || ''}
              onChange={(e) => setFormData({...formData, rawText: e.target.value})}
            ></textarea>
            <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 flex justify-between items-center relative">
               <span className="text-xs text-gray-500">或上传TXT文件</span>
               <button className="text-indigo-600 text-sm font-medium flex items-center">
                 <FileText size={16} className="mr-1"/> 浏览文件
               </button>
               <input 
                  type="file" 
                  accept=".txt,.srt" 
                  className="absolute right-0 top-0 w-1/2 h-full opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        setFormData({...formData, textName: file.name, rawText: event.target.result});
                      };
                      reader.readAsText(file);
                    }
                  }}
                />
            </div>
          </div>
          {formData.textName && <p className="text-xs text-green-600 mt-1">已选择: {formData.textName}</p>}
        </div>

        {/* 3. 背景设置 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center">
            <span className="bg-indigo-100 text-indigo-700 w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">3</span>
            视频背景 (可选)
          </label>
          <div className="flex space-x-4 h-24">
            <div className="w-1/3 rounded-lg overflow-hidden relative border border-gray-200 shadow-sm">
               <img src={formData.bgUrl} alt="bg" className="w-full h-full object-cover" />
            </div>
            <div className="w-2/3 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center bg-white relative cursor-pointer hover:bg-gray-50">
               <ImageIcon size={24} className="text-gray-400 mb-1" />
               <span className="text-xs text-gray-500">更换背景图</span>
               <input 
                 type="file" 
                 accept="image/*" 
                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                 onChange={(e) => {
                   const file = e.target.files[0];
                   if (file) {
                     setFormData({...formData, bgName: file.name, bgUrl: URL.createObjectURL(file)});
                   }
                 }}
               />
            </div>
          </div>
        </div>
      </main>

      {/* 底部按钮悬浮 */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => {
            if (!formData.audioUrl || !formData.rawText) {
              if (!formData.audioUrl) console.warn("需要上传音频");
              return; 
            }
            setCurrentView('processing');
          }}
          className="w-full bg-indigo-600 text-white rounded-xl py-3.5 font-semibold text-sm flex justify-center items-center shadow-lg hover:bg-indigo-700"
        >
          开始 AI 智能合成
        </button>
      </div>
    </div>
  );

  const renderProcessing = () => {
    const steps = [
      "上传并解析文件...",
      "AI 深度听取音频并提取音素特征...",
      "原文断句与毫秒级时间轴精准对齐...",
      "大模型智能中英双语翻译..."
    ];

    return (
      <div className="flex flex-col h-full bg-indigo-600 justify-center items-center text-white p-8 relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 opacity-10">
           <div className="absolute top-10 left-10 w-32 h-32 rounded-full bg-white blur-2xl animate-pulse"></div>
           <div className="absolute bottom-20 right-10 w-48 h-48 rounded-full bg-indigo-300 blur-3xl animate-pulse delay-700"></div>
        </div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-xs">
          <Loader2 size={48} className="animate-spin text-indigo-200 mb-8" />
          
          <h2 className="text-xl font-bold mb-6">AI 正在处理中</h2>
          
          <div className="w-full space-y-4">
            {steps.map((text, idx) => {
              const isPast = processStep > idx;
              const isCurrent = processStep === idx;
              return (
                <div key={idx} className="flex items-center space-x-3 text-sm">
                  {isPast ? (
                    <CheckCircle size={18} className="text-green-400" />
                  ) : isCurrent ? (
                    <div className="w-4 h-4 rounded-full border-2 border-indigo-300 border-t-white animate-spin"></div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-indigo-400 opacity-50"></div>
                  )}
                  <span className={`${isPast ? 'text-indigo-200 line-through opacity-80' : isCurrent ? 'text-white font-medium' : 'text-indigo-300 opacity-50'}`}>
                    {text}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-12 w-full bg-indigo-800 rounded-full h-1.5 overflow-hidden">
             <div 
               className="bg-white h-full transition-all duration-300 ease-out" 
               style={{ width: `${(processStep / steps.length) * 100}%` }}
             ></div>
          </div>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    // 找出当前时间对应的字幕
    const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);

    return (
      <div className="flex flex-col h-full bg-black relative">
        {/* 顶部栏 (透明悬浮) */}
        <header className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-4 bg-gradient-to-b from-black/60 to-transparent text-white">
          <button onClick={() => setCurrentView('dashboard')} className="p-2 rounded-full backdrop-blur-sm bg-black/20">
            <ChevronLeft size={20} />
          </button>
          <div className="text-sm font-medium">{formData.title}</div>
          <button onClick={handleExport} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-lg">
            <Download size={14} className="mr-1" /> 导出 SRT
          </button>
        </header>

        {/* 上半部：合成预览区 (16:9 或 自适应) */}
        <div className="relative w-full h-[45%] bg-gray-900 flex flex-col justify-center overflow-hidden">
          {/* 背景图 */}
          <img src={formData.bgUrl} alt="Background" className="absolute inset-0 w-full h-full object-cover opacity-60" />
          
          {/* 实时字幕叠加 */}
          <div className="relative z-10 w-full px-6 flex flex-col items-center justify-center text-center mt-auto mb-10 min-h-[80px]">
            {activeSubtitle ? (
              <div className="bg-black/40 backdrop-blur-sm p-3 rounded-xl border border-white/10 w-full max-w-[90%] transform transition-all">
                <p className="text-white font-bold text-lg mb-1 leading-tight shadow-sm drop-shadow-md">
                  {activeSubtitle.en}
                </p>
                <p className="text-yellow-400 font-medium text-sm drop-shadow-md">
                  {activeSubtitle.zh}
                </p>
              </div>
            ) : (
              <div className="opacity-0 h-[60px]"></div>
            )}
          </div>
        </div>

        {/* 播放控制与进度条 */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center space-x-3 text-white">
           <audio 
             ref={audioRef} 
             src={formData.audioUrl} 
             onTimeUpdate={handleTimeUpdate}
             onEnded={() => setIsPlaying(false)}
             className="hidden"
           />
           <button 
             onClick={() => setIsPlaying(!isPlaying)}
             className="w-10 h-10 rounded-full bg-indigo-600 flex justify-center items-center hover:bg-indigo-500 active:scale-95 transition-transform shrink-0"
           >
             {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
           </button>
           <div className="flex-1 space-y-1">
             <div className="relative w-full h-2 bg-gray-700 rounded-full overflow-hidden">
               <div 
                 className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full"
                 style={{ width: `${(currentTime / (formData.audioDuration || 16)) * 100}%` }}
               ></div>
             </div>
             <div className="flex justify-between text-[10px] text-gray-400 font-mono">
               <span>{formatTime(currentTime)}</span>
               <span>{formData.audioDuration ? formatTime(formData.audioDuration) : '00:00.0'}</span>
             </div>
           </div>
        </div>

        {/* 下半部：时间轴与字幕编辑器 */}
        <div className="flex-1 bg-gray-50 overflow-y-auto pb-6 relative rounded-t-2xl -mt-2 z-10">
          <div className="sticky top-0 bg-gray-50/90 backdrop-blur-md px-4 py-3 border-b border-gray-200 flex justify-between items-center z-10">
            <h3 className="text-sm font-bold text-gray-700 flex items-center">
              <Edit3 size={16} className="mr-2 text-indigo-500" />
              调整字幕对齐与翻译
            </h3>
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">共 {subtitles.length} 句</span>
          </div>
          
          <div className="p-4 space-y-4">
            {subtitles.map((sub, index) => {
              const isActive = currentTime >= sub.start && currentTime <= sub.end;
              return (
                <div 
                  key={sub.id} 
                  className={`bg-white rounded-xl shadow-sm border transition-all duration-200 overflow-hidden ${
                    isActive ? 'border-indigo-500 shadow-indigo-100/50 ring-2 ring-indigo-500/20' : 'border-gray-200'
                  }`}
                >
                  {/* 时间控制区 */}
                  <div className={`px-3 py-2 border-b flex justify-between items-center ${isActive ? 'bg-indigo-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center space-x-2 text-xs font-mono text-gray-600">
                      <Clock size={12} className={isActive ? 'text-indigo-500' : 'text-gray-400'} />
                      <input 
                        type="number"
                        step="0.1"
                        value={sub.start.toFixed(1)} 
                        onChange={(e) => {
                          const newSubs = [...subtitles];
                          newSubs[index].start = parseFloat(e.target.value) || 0;
                          setSubtitles(newSubs);
                        }}
                        className="w-12 bg-transparent border-b border-gray-300 text-center outline-none focus:border-indigo-500"
                      />
                      <span>-</span>
                      <input 
                        type="number"
                        step="0.1"
                        value={sub.end.toFixed(1)} 
                        onChange={(e) => {
                          const newSubs = [...subtitles];
                          newSubs[index].end = parseFloat(e.target.value) || 0;
                          setSubtitles(newSubs);
                        }}
                        className="w-12 bg-transparent border-b border-gray-300 text-center outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex space-x-2">
                       <button className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  
                  {/* 文字编辑区 */}
                  <div className="p-3 space-y-2">
                    <div className="relative">
                      <span className="absolute left-0 top-1 text-[10px] font-bold text-gray-300 uppercase">EN</span>
                      <textarea 
                        value={sub.en}
                        onChange={(e) => {
                          const newSubs = [...subtitles];
                          newSubs[index].en = e.target.value;
                          setSubtitles(newSubs);
                        }}
                        className="w-full pl-6 text-sm font-medium text-gray-800 bg-transparent outline-none resize-none leading-relaxed min-h-[40px] focus:bg-gray-50 rounded"
                      />
                    </div>
                    <div className="w-full h-px bg-gray-100"></div>
                    <div className="relative">
                      <span className="absolute left-0 top-1 text-[10px] font-bold text-indigo-200 uppercase">中</span>
                      <textarea 
                        value={sub.zh}
                        onChange={(e) => {
                          const newSubs = [...subtitles];
                          newSubs[index].zh = e.target.value;
                          setSubtitles(newSubs);
                        }}
                        className="w-full pl-6 text-sm font-medium text-gray-600 bg-transparent outline-none resize-none leading-relaxed min-h-[40px] focus:bg-indigo-50/50 rounded"
                      />
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
    // 模拟移动端竖屏外壳
    <div className="min-h-screen bg-gray-200 flex items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-[400px] h-[100dvh] sm:h-[800px] bg-white sm:rounded-[2.5rem] shadow-2xl overflow-hidden relative border-[8px] border-gray-900/5">
        
        {/* 顶部刘海模拟 (仅在桌面端装饰) */}
        <div className="hidden sm:block absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-900/5 rounded-b-xl z-50 pointer-events-none"></div>

        {currentView === 'dashboard' && renderDashboard()}
        {currentView === 'upload' && renderUpload()}
        {currentView === 'processing' && renderProcessing()}
        {currentView === 'editor' && renderEditor()}
        
      </div>
    </div>
  );
}