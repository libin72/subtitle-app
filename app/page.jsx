"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, Play, Pause, ChevronLeft, 
  CheckCircle, Loader2, Download, Edit3, Clock, 
  Mic, MessageSquare, ImagePlus, Scissors, ArrowUp, Eye, Image as ImageIcon, Video
} from 'lucide-react';

// ================= 图片丝滑渐变组件 =================
const CrossfadeImage = ({ src }) => {
  const [images, setImages] = useState([src]);

  useEffect(() => {
    if (src && src !== images[images.length - 1]) {
      setImages((prev) => [...prev.slice(-1), src]);
    }
  }, [src]);

  return (
    <div className="relative w-full h-full flex-shrink-0 bg-gray-950 overflow-hidden shadow-xl">
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

// ================= 中文字幕智能动态切片辅助函数 (已修复孤立标点问题) =================
const splitChineseText = (text) => {
  if (!text) return [];
  const chunks = [];
  let currentChunk = "";
  
  for (let i = 0; i < text.length; i++) {
      const char = text[i];
      currentChunk += char;
      const remaining = text.length - 1 - i;
      
      const isStrong = /[。？！”’\n]/.test(char);
      const isWeak = /[，；、]/.test(char);
      const isLast = i === text.length - 1;
      
      let shouldSplit = false;
      if (isLast) {
          shouldSplit = true;
      } else if (currentChunk.length >= 30) {
          shouldSplit = true;
      } else if (isStrong && remaining >= 5) {
          shouldSplit = true;
      } else if (isWeak && currentChunk.length >= 15 && remaining >= 5) {
          shouldSplit = true;
      }
      
      if (shouldSplit) {
          const pureText = currentChunk.replace(/[\s。？！”’，；、·]/g, '');
          if (pureText.length > 0) {
              chunks.push(currentChunk.trim());
          } else if (chunks.length > 0) {
              chunks[chunks.length - 1] += currentChunk.trim();
          } else {
              chunks.push(currentChunk.trim());
          }
          currentChunk = "";
      }
  }
  
  if (currentChunk.trim().length > 0) {
      const pureText = currentChunk.replace(/[\s。？！”’，；、·]/g, '');
      if (pureText.length > 0) {
          chunks.push(currentChunk.trim());
      } else if (chunks.length > 0) {
          chunks[chunks.length - 1] += currentChunk.trim();
      }
  }
  return chunks;
};

// ================= 辅助函数：延时等待 =================
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  // API 配置
  const [audioBaseUrl, setAudioBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [audioKey, setAudioKey] = useState('');
  const [audioModel, setAudioModel] = useState('whisper-large-v3');
  
  // 将文本翻译接口默认替换为 DeepSeek
  const [textBaseUrl, setTextBaseUrl] = useState('https://api.deepseek.com/v1');
  const [textKey, setTextKey] = useState('');
  const [textModel, setTextModel] = useState('deepseek-chat');

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
    rawText: ''
  });

  const [sentences, setSentences] = useState([]);
  const [blocks, setBlocks] = useState([]); 
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState("");
  const [newsDate, setNewsDate] = useState('');
  
  // 视频导出状态
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  
  const audioRef = useRef(null);
  const exportCanvasRef = useRef(null);
  const imageElementCache = useRef({}); 

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };

  // 预加载图片到缓存中
  useEffect(() => {
    blocks.forEach(b => {
        if (b.image && !imageElementCache.current[b.image]) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = b.image;
            imageElementCache.current[b.image] = img;
        }
    });
  }, [blocks]);

  // ================= 核心处理逻辑 =================
  const startProcessing = async () => {
    if (!formData.audioFile) return alert("请上传音频文件！");
    if (!audioKey || !textKey) return alert("请完善 API 密钥！");
    
    setIsProcessing(true);
    setSentences([]);
    setBlocks([]);
    
    try {
      setProcessMsg("1. 正在进行高精度音频识别与对齐...");
      const whisperUrl = `${audioBaseUrl.trim().replace(/\/+$/, '')}/audio/transcriptions`;
      const audioData = new FormData();
      audioData.append('file', formData.audioFile);
      audioData.append('model', audioModel.trim());
      audioData.append('response_format', 'verbose_json'); 
      audioData.append('timestamp_granularities[]', 'word'); 
      
      const whisperRes = await fetch(whisperUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${audioKey}` },
        body: audioData
      });

      if (!whisperRes.ok) throw new Error(`Whisper 识别失败: ${whisperRes.status}`);
      const whisperResult = await whisperRes.json();
      
      let allWords = [];
      if (whisperResult.words && whisperResult.words.length > 0) {
          allWords = whisperResult.words;
      } else if (whisperResult.segments) {
          whisperResult.segments.forEach(seg => {
              const words = seg.text.trim().split(/\s+/);
              const totalChars = words.reduce((acc, w) => acc + w.length, 0);
              const duration = seg.end - seg.start;
              let t = seg.start;
              words.forEach(w => {
                  const wDur = totalChars > 0 ? (w.length / totalChars) * duration : 0;
                  allWords.push({ word: w, start: t, end: t + wDur });
                  t += wDur;
              });
          });
      } else {
          throw new Error("接口未返回时间轴数据。");
      }
      
      setProcessMsg("正在智能合成整句并划定显示切片...");
      let parsedSentences = [];
      let currentSentence = { id: 0, blockId: 'block-0', zh: "", en: "", enChunks: [] };
      let currentChunk = { id: 0, start: null, end: null, words: [] };
      let chunkIdCounter = 0;

      allWords.forEach((wObj, idx) => {
          const w = wObj.word.trim();
          if (!w) return;

          if (currentChunk.start === null) currentChunk.start = wObj.start;
          currentChunk.end = wObj.end;
          currentChunk.words.push(w);

          const isLastWordOverall = idx === allWords.length - 1;
          const chunkWordCount = currentChunk.words.length;
          const remainingWords = allWords.length - 1 - idx;
          const nextWordGap = (idx < allWords.length - 1) ? (allWords[idx+1].start - wObj.end) : 0;
          
          const isAbbr = /^(U\.S\.|U\.K\.|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|Inc\.|Ltd\.|A\.M\.|P\.M\.|e\.g\.|i\.e\.|vs\.|St\.|Gov\.|Sen\.|Rep\.|Gen\.|Col\.|Capt\.|Lt\.|Sgt\.|Cpl\.|Pvt\.|Jan\.|Feb\.|Mar\.|Apr\.|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.|Mon\.|Tue\.|Wed\.|Thu\.|Fri\.|Sat\.|Sun\.)$/i.test(w) || /^[A-Za-z]\.$/i.test(w);
          
          const hasStrong = !isAbbr && /[.?!。？！"”]['"]*$/.test(w);
          const hasWeak = /[,;，；]['"]*$/.test(w);

          const isParagraphBreak = /\n/.test(wObj.word) || nextWordGap > 1.5 || (hasStrong && nextWordGap > 0.5);

          let splitChunk = false;
          let splitSentence = false;

          if (isLastWordOverall || isParagraphBreak) {
              splitChunk = true;
              splitSentence = true;
          } else if (hasStrong && remainingWords >= 3) {
              splitChunk = true;
              splitSentence = true;
          } else if (chunkWordCount >= 20) {
              splitChunk = true; 
          } else if (hasWeak && chunkWordCount >= 10 && remainingWords >= 3) {
              splitChunk = true; 
          }

          if (splitChunk) {
              currentChunk.en = currentChunk.words.join(" ");
              currentSentence.enChunks.push({ ...currentChunk });
              currentChunk = { id: ++chunkIdCounter, start: null, end: null, words: [] };
          }

          if (splitSentence) {
              currentSentence.en = currentSentence.enChunks.map(c => c.en).join(" ");
              parsedSentences.push({ ...currentSentence });
              currentSentence = { id: parsedSentences.length, blockId: 'block-0', zh: "", en: "", enChunks: [] };
          }
      });

      const chatUrl = `${textBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
      let extractedDateStr = "";
      
      const chunkSize = 15; 
      const totalChunks = Math.ceil(parsedSentences.length / chunkSize);

      for (let i = 0; i < parsedSentences.length; i += chunkSize) {
        setProcessMsg(`3. 结合上下文翻译中 (第 ${Math.floor(i/chunkSize)+1}/${totalChunks} 批)...`);
        const chunk = parsedSentences.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;
        
        const translationPrompt = `You are a professional subtitle translator.
        1. Correct OCR/speech typos in English using the RAW REFERENCE.
        2. Translate the full English sentences to natural Chinese. STRCITLY USE SIMPLIFIED CHINESE (简体中文). DO NOT USE TRADITIONAL CHINESE.
        ${isFirstChunk ? '3. Extract broadcast date if mentioned (e.g. "Wednesday, Oct 11th") to Chinese format (e.g. "10月11日 星期三"). Else return "".' : '3. extractedDate MUST be "".'}
        4. CRITICAL: You MUST translate EVERY SINGLE sentence provided. Return EXACTLY ${chunk.length} items mapping exactly to the input "id".
        5. CONTEXTUAL TRANSLATION: Understand the full context of the paragraph. Ensure the Chinese translation represents the complete grammatical meaning of the sentence.

        RAW REFERENCE: ${formData.rawText ? formData.rawText.substring(0, 1000) : "None."}
        INPUT JSON: ${JSON.stringify(chunk.map(c => ({ id: c.id, en: c.en })))}

        OUTPUT JSON FORMAT:
        {
          "extractedDate": "...",
          "subtitles": [ { "id": <exact_id>, "zh": "..." } ]
        }`;

        let chunkSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        // 加入带有指数退避机制的重试循环，专治 429 限流报错
        while (!chunkSuccess && retryCount < maxRetries) {
          try {
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

            if (llmRes.status === 429) {
                retryCount++;
                setProcessMsg(`触发接口限流 (429)，等待 ${retryCount * 5} 秒后自动重试 (${retryCount}/${maxRetries})...`);
                await delay(5000 * retryCount); // 退避等待：5秒, 10秒, 15秒
                continue;
            }

            if (!llmRes.ok) throw new Error(`翻译请求返回状态码: ${llmRes.status}`);
            
            const llmResult = await llmRes.json();
            const parsed = JSON.parse(llmResult.choices[0].message.content);
            const transDict = {};
            (parsed.subtitles || []).forEach(t => transDict[t.id] = t.zh);
            
            chunk.forEach(sent => {
                sent.zh = transDict[sent.id] || "（翻译丢失）";
            });

            if (isFirstChunk && parsed.extractedDate) extractedDateStr = parsed.extractedDate;
            chunkSuccess = true; // 标记成功，跳出重试循环

          } catch (e) {
            console.error("当前批次翻译异常:", e);
            if (retryCount >= maxRetries - 1) {
                // 重试用尽，依然失败，则保留空壳并继续
                chunk.forEach(sent => { sent.zh = "（网络请求失败，可手动补充）"; });
                break;
            }
            retryCount++;
            setProcessMsg(`网络异常，正在重试 (${retryCount}/${maxRetries})...`);
            await delay(3000);
          }
        }

        // 每次成功后固定延时 2 秒，温柔对待 API 接口防限流
        if (i + chunkSize < parsedSentences.length) {
            await delay(2000);
        }
      }

      setNewsDate(extractedDateStr || getFormattedDate());

      setProcessMsg("4. 正在装载双轨媒体池...");
      setBlocks([{ id: 'block-0', title: '新闻开场 (Intro)', image: "" }]);

      setTimeout(() => {
        setSentences(parsedSentences);
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
  const handleSplitAfter = (sentenceId, currentBlockId) => {
    const newBlockId = 'block-' + Date.now();
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === currentBlockId);
        const newBlocks = [...prev];
        newBlocks.splice(idx + 1, 0, { id: newBlockId, title: `新闻片段 ${newBlocks.length + 1}`, image: "" });
        return newBlocks;
    });
    setSentences(prev => {
        let passedSplitPoint = false;
        return prev.map(sent => {
            if (sent.id === sentenceId) { passedSplitPoint = true; return sent; }
            if (passedSplitPoint && sent.blockId === currentBlockId) return { ...sent, blockId: newBlockId };
            return sent;
        });
    });
  };

  const handleMergeUp = (blockId) => {
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === blockId);
        if (idx <= 0) return prev;
        const targetBlockId = prev[idx - 1].id;
        setSentences(subs => subs.map(sent => sent.blockId === blockId ? { ...sent, blockId: targetBlockId } : sent));
        const newBlocks = [...prev];
        newBlocks.splice(idx, 1);
        return newBlocks;
    });
  };

  const handleReplaceBlockImage = (blockId, file) => {
    if (!file) return;
    const newBlobUrl = URL.createObjectURL(file);
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, image: newBlobUrl } : b));
  };

  // ================= 播放器与辅助功能 =================
  useEffect(() => {
    if (audioRef.current && !isExportingVideo) {
      if (isPlaying) audioRef.current.play();
      else audioRef.current.pause();
    }
  }, [isPlaying, isExportingVideo]);

  const handleTimeUpdate = () => { 
      if (audioRef.current && !isExportingVideo) setCurrentTime(audioRef.current.currentTime); 
  };
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  };
  const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.floor((s%1)*10)}`;

  const handleExportSRT = () => {
    let srt = "";
    let srtIdx = 1;
    sentences.forEach(sent => {
        if (!sent.enChunks || sent.enChunks.length === 0) return;
        const start = sent.enChunks[0].start;
        const end = sent.enChunks[sent.enChunks.length - 1].end;
        const pad = (n, s) => ('000'+n).slice(s*-1);
        const fmt = (sec) => `${pad(Math.floor(sec/3600),2)}:${pad(Math.floor((sec%3600)/60),2)}:${pad(Math.floor(sec%60),2)},${pad(Math.floor((sec%1)*1000),3)}`;
        srt += `${srtIdx++}\n${fmt(start)} --> ${fmt(end)}\n${sent.en}\n${sent.zh}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formData.title}.srt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ================= 视频实时渲染导出 (Canvas + MediaRecorder, MacOS 兼容版) =================
  const wrapTextCanvas = (ctx, text, x, y, maxWidth, lineHeight) => {
      if (!text) return y;
      let line = '';
      let currentY = y;
      const tokens = text.match(/[\u4e00-\u9fa5]|[\w\.\,\!\?\-\']+|\s+/g) || text.split('');
      for (let n = 0; n < tokens.length; n++) {
          const token = tokens[n];
          const testLine = line + token;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && n > 0 && token.trim() !== '') {
              ctx.fillText(line, x, currentY);
              line = token;
              currentY += lineHeight;
          } else {
              line = testLine;
          }
      }
      ctx.fillText(line, x, currentY);
      return currentY + lineHeight;
  };

  const drawRoundRect = (ctx, x, y, w, h, r) => {
      if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.closePath();
      } else {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
      }
  };

  const startVideoExport = async () => {
      if (!formData.audioUrl || sentences.length === 0) return alert("请先上传音频并解析剧本");
      setIsPlaying(false);
      setIsExportingVideo(true);
      setExportProgress(0);

      const canvas = exportCanvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // 预先绘制一帧黑屏，防止 Safari captureStream 崩溃
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1080, 1920);

      let recordedChunks = [];
      let animationId;
      let mediaRecorder;

      try {
          if (!canvas.captureStream) {
             throw new Error("您的浏览器不支持 Canvas 视频流捕获。请尝试使用最新版 Chrome 浏览器。");
          }

          const canvasStream = canvas.captureStream(30);
          
          const audio = new Audio(formData.audioUrl);
          audio.crossOrigin = "anonymous";
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();
          const source = audioCtx.createMediaElementSource(audio);
          
          source.connect(dest);
          // Safari 兼容性：需要将 source 也连接到设备输出，否则 MediaRecorder 可能收不到声音数据
          source.connect(audioCtx.destination); 
          
          const audioTracks = dest.stream.getAudioTracks();
          const combinedTracks = [
              ...canvasStream.getVideoTracks(),
              ...audioTracks
          ];
          const combinedStream = new MediaStream(combinedTracks);

          // 自动嗅探当前浏览器支持的最优视频格式 (Safari 通常支持 mp4, Chrome 支持 webm)
          const supportedMimeTypes = [
              'video/mp4',
              'video/webm;codecs=vp9',
              'video/webm;codecs=vp8',
              'video/webm',
              '' // 回退到浏览器默认
          ];
          
          let options = {};
          for (let type of supportedMimeTypes) {
              if (type === '' || MediaRecorder.isTypeSupported(type)) {
                  if (type !== '') options.mimeType = type;
                  break;
              }
          }

          mediaRecorder = new MediaRecorder(combinedStream, options);
          
          mediaRecorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) recordedChunks.push(e.data);
          };
          
          mediaRecorder.onstop = () => {
              const type = options.mimeType || 'video/mp4';
              const extension = type.includes('webm') ? 'webm' : 'mp4';
              const blob = new Blob(recordedChunks, { type });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${formData.title}_export.${extension}`;
              a.click();
              
              setIsExportingVideo(false);
              cancelAnimationFrame(animationId);
              audio.pause();
              audioCtx.close();
          };

          const drawFrame = () => {
              const time = audio.currentTime;
              setExportProgress(time / audio.duration);

              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, 1080, 1920);

              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 120px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('KidNuz', 540, 240);

              ctx.fillStyle = '#facc15'; 
              ctx.font = '500 45px sans-serif';
              ctx.fillText(newsDate || getFormattedDate(), 540, 320);

              let activeSentence = null;
              let activeChunk = null;
              let activeZhChunkText = "";

              for (let i = 0; i < sentences.length; i++) {
                  const sent = sentences[i];
                  if (sent.enChunks.length === 0) continue;
                  const sentStart = sent.enChunks[0].start;
                  const sentEnd = sent.enChunks[sent.enChunks.length - 1].end;
                  
                  if (time >= sentStart && time <= sentEnd) {
                      activeSentence = sent;
                      activeChunk = sent.enChunks.find(c => time >= c.start && time <= c.end);
                      
                      const zhChunksText = splitChineseText(sent.zh);
                      if (zhChunksText.length > 0) {
                          const totalChars = zhChunksText.reduce((acc, c) => acc + c.length, 0);
                          const duration = sentEnd - sentStart;
                          let t = sentStart;
                          let found = false;
                          for (let j = 0; j < zhChunksText.length; j++) {
                              const chunkDur = totalChars > 0 ? (zhChunksText[j].length / totalChars) * duration : 0;
                              if (time >= t && time <= t + chunkDur) {
                                  activeZhChunkText = zhChunksText[j];
                                  found = true; break;
                              }
                              t += chunkDur;
                          }
                          if (!found) activeZhChunkText = zhChunksText[zhChunksText.length - 1];
                      }
                      break;
                  }
              }

              const activeOrLastSentence = activeSentence || sentences.slice().reverse().find(s => s.enChunks && s.enChunks[0] && s.enChunks[0].start <= time) || sentences[0];
              let targetImage = "";
              if (activeOrLastSentence) {
                  const b = blocks.find(blk => blk.id === activeOrLastSentence.blockId);
                  if (b) targetImage = b.image;
              }

              let displayEnChunk = "";
              if (activeSentence) {
                  displayEnChunk = activeChunk ? activeChunk.en : activeSentence.enChunks[activeSentence.enChunks.length - 1].en;
              }

              const imgY = 420;
              const imgH = 607; 
              if (targetImage && imageElementCache.current[targetImage]) {
                  ctx.drawImage(imageElementCache.current[targetImage], 0, imgY, 1080, imgH);
              } else {
                  ctx.fillStyle = '#111827'; 
                  ctx.fillRect(0, imgY, 1080, imgH);
              }

              // ================= 视频字幕高度基准渲染计算 =================
              if (activeSentence) {
                  const boxWidth = 960;
                  const boxX = 60;
                  const textX = 100;
                  const textMaxWidth = 880;

                  const enBoxY = imgY + imgH + 60;
                  ctx.font = '600 48px sans-serif';
                  
                  // 遍历英文切片，找到渲染后的实际最大高度
                  let maxEnBoxHeight = 0;
                  activeSentence.enChunks.forEach(chunk => {
                      let simY = enBoxY + 70;
                      const tokens = chunk.en.match(/[\w\.\,\!\?\-\']+|\s+/g) || chunk.en.split('');
                      let simLine = '';
                      for (let n = 0; n < tokens.length; n++) {
                          const testLine = simLine + tokens[n];
                          if (ctx.measureText(testLine).width > textMaxWidth && n > 0 && tokens[n].trim() !== '') {
                              simLine = tokens[n];
                              simY += 65;
                          } else {
                              simLine = testLine;
                          }
                      }
                      const h = (simY - enBoxY) + 50;
                      if (h > maxEnBoxHeight) maxEnBoxHeight = h;
                  });
                  const enBoxHeight = maxEnBoxHeight;

                  ctx.fillStyle = 'rgba(30, 58, 138, 0.6)'; 
                  ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
                  ctx.lineWidth = 3;
                  drawRoundRect(ctx, boxX, enBoxY, boxWidth, enBoxHeight, 24);
                  ctx.fill();
                  ctx.stroke();

                  ctx.fillStyle = '#ffffff';
                  ctx.textAlign = 'left';
                  wrapTextCanvas(ctx, displayEnChunk, textX, enBoxY + 70, textMaxWidth, 65);

                  // 遍历中文切片，找到最大高度
                  const zhBoxY = enBoxY + enBoxHeight + 40;
                  ctx.font = 'bold 42px sans-serif';
                  let maxZhBoxHeight = 0;
                  const zhChunksList = splitChineseText(activeSentence.zh);
                  const zhChunksToMeasure = zhChunksList.length > 0 ? zhChunksList : [activeSentence.zh];
                  
                  zhChunksToMeasure.forEach(chunk => {
                      let zhSimY = zhBoxY + 65;
                      const zhTokens = chunk.match(/[\u4e00-\u9fa5]|[\w\.\,\!\?\-\']+|\s+/g) || chunk.split('');
                      let zhSimLine = '';
                      for (let n = 0; n < zhTokens.length; n++) {
                          const testLine = zhSimLine + zhTokens[n];
                          if (ctx.measureText(testLine).width > textMaxWidth && n > 0 && zhTokens[n].trim() !== '') {
                              zhSimLine = zhTokens[n];
                              zhSimY += 60;
                          } else {
                              zhSimLine = testLine;
                          }
                      }
                      const h = (zhSimY - zhBoxY) + 45;
                      if (h > maxZhBoxHeight) maxZhBoxHeight = h;
                  });
                  const zhBoxHeight = maxZhBoxHeight;

                  ctx.fillStyle = 'rgba(66, 133, 244, 0.9)'; 
                  ctx.strokeStyle = 'rgba(66, 133, 244, 0.5)';
                  drawRoundRect(ctx, boxX, zhBoxY, boxWidth, zhBoxHeight, 24);
                  ctx.fill();
                  ctx.stroke();

                  ctx.fillStyle = '#ffffff';
                  wrapTextCanvas(ctx, activeZhChunkText || activeSentence.zh, textX, zhBoxY + 65, textMaxWidth, 60);
              }

              animationId = requestAnimationFrame(drawFrame);
          };

          mediaRecorder.start();
          audio.play().catch(err => {
              throw new Error("音频播放被浏览器拦截，请先在页面上点击任意位置后再导出。");
          });
          drawFrame();

          audio.onended = () => {
              mediaRecorder.stop();
          };

      } catch (e) {
          console.error(e);
          alert(`导出失败: ${e.message}\n如果持续失败，建议使用 Chrome 浏览器进行视频导出操作。`);
          setIsExportingVideo(false);
          cancelAnimationFrame(animationId);
      }
  };

  // ================= 视图渲染 =================
  const renderPhoneScreen = () => {
    if (isProcessing) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-white p-6">
          <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
          <p className="text-sm font-medium">{processMsg}</p>
        </div>
      );
    }

    if (sentences.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-gray-500 p-6 text-center space-y-4">
          <ImageIcon size={48} className="opacity-50" />
          <p className="text-sm">上传音频构建剧本，在此处预览双轨全屏播报效果</p>
        </div>
      );
    }

    let activeSentence = null;
    let activeChunk = null;
    let activeZhChunkText = "";
    
    for (let i = 0; i < sentences.length; i++) {
        const sent = sentences[i];
        if (sent.enChunks.length === 0) continue;
        const sentStart = sent.enChunks[0].start;
        const sentEnd = sent.enChunks[sent.enChunks.length - 1].end;
        
        if (currentTime >= sentStart && currentTime <= sentEnd) {
            activeSentence = sent;
            activeChunk = sent.enChunks.find(c => currentTime >= c.start && currentTime <= c.end);
            
            const zhChunksText = splitChineseText(sent.zh);
            if (zhChunksText.length > 0) {
                const totalChars = zhChunksText.reduce((acc, c) => acc + c.length, 0);
                const duration = sentEnd - sentStart;
                let t = sentStart;
                let found = false;
                for (let j = 0; j < zhChunksText.length; j++) {
                    const chunkDur = totalChars > 0 ? (zhChunksText[j].length / totalChars) * duration : 0;
                    if (currentTime >= t && currentTime <= t + chunkDur) {
                        activeZhChunkText = zhChunksText[j];
                        found = true;
                        break;
                    }
                    t += chunkDur;
                }
                if (!found) activeZhChunkText = zhChunksText[zhChunksText.length - 1];
            }
            break;
        }
    }

    const activeOrLastSentence = activeSentence || sentences.slice().reverse().find(s => s.enChunks && s.enChunks[0] && s.enChunks[0].start <= currentTime) || sentences[0];
    
    let targetImage = ""; 
    if (activeOrLastSentence) {
        const b = blocks.find(blk => blk.id === activeOrLastSentence.blockId);
        if (b) targetImage = b.image;
    }

    let displayEnChunk = "";
    let longestChunkEn = "";
    
    if (activeSentence) {
        longestChunkEn = activeSentence.enChunks.reduce((prev, current) => {
            return (current.en.length > prev.en.length) ? current : prev;
        }, { en: "" }).en;

        if (activeChunk) {
            displayEnChunk = activeChunk.en;
        } else {
            displayEnChunk = activeSentence.enChunks[activeSentence.enChunks.length - 1].en;
        }
    }

    // 将中文字幕列表预处理以供网格渲染
    const zhChunksTextList = activeSentence ? splitChineseText(activeSentence.zh) : [];
    const activeZhChunkToDisplay = activeZhChunkText || (activeSentence ? activeSentence.zh : "");

    return (
      <div className="relative flex flex-col h-full w-full bg-black overflow-hidden cursor-pointer" onClick={() => setIsPlaying(!isPlaying)}>
        <div className="flex-none pt-14 pb-4 flex flex-col items-center justify-center text-white px-6 text-center z-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2 font-sans">KidNuz</h1>
          <p className="text-sm font-medium opacity-95 text-yellow-400">{newsDate || getFormattedDate()}</p>
        </div>

        <div className="flex-1 flex flex-col w-full z-10 overflow-hidden relative">
          <div className="w-full flex-shrink-0 bg-gray-900 aspect-video flex items-center justify-center border-y border-white/10 relative">
             {targetImage ? (
                <CrossfadeImage src={targetImage} />
             ) : (
                <div className="text-gray-500 flex flex-col items-center opacity-60">
                   <ImageIcon size={32} className="mb-2" />
                   <span className="text-xs">等待人工上传配图</span>
                </div>
             )}
             
             {/* 移动到图片中间的播放按钮 */}
             {!isPlaying && (
               <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
                 <div className="bg-black/50 rounded-full p-4 backdrop-blur-md border border-white/20 shadow-2xl flex items-center justify-center">
                   <Play size={40} fill="currentColor" className="text-white opacity-90 ml-1" />
                 </div>
               </div>
             )}
          </div>
          
          <div className="flex-1 w-full px-5 pt-4 pb-8 overflow-y-auto flex flex-col justify-start space-y-3 relative">
            {activeSentence ? (
              <>
                {/* 英文独立轨道：利用 CSS Grid 自动撑开并锁定最高切片的高度，杜绝截断和跳动 */}
                <div className="w-full bg-blue-900/60 backdrop-blur-md rounded-xl border border-blue-500/30 transform transition-all duration-300 grid">
                  {/* 隐形占位符：取该句中最长的一个英文切片撑开固定高度 */}
                  <div className="col-start-1 row-start-1 p-4 opacity-0 pointer-events-none select-none">
                    <p className="font-semibold text-lg leading-relaxed text-left">
                      {longestChunkEn}
                    </p>
                  </div>
                  {activeSentence.enChunks.map((chunk, cIdx) => (
                    <div key={chunk.id || cIdx} className={`col-start-1 row-start-1 p-4 flex items-start justify-start transition-opacity duration-200 ${displayEnChunk === chunk.en ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                      <p className="text-white font-semibold text-lg leading-relaxed text-left">
                        {chunk.en}
                      </p>
                    </div>
                  ))}
                </div>

                {/* 中文独立轨道：利用 CSS Grid 同步锁定高度，背景使用浅蓝(Google Blue)，纯白文字 */}
                <div className="w-full bg-[#4285F4]/90 backdrop-blur-md rounded-xl border border-[#4285F4]/50 transform transition-all duration-300 shadow-lg grid">
                  {zhChunksTextList.length > 0 ? zhChunksTextList.map((zhChunk, zIdx) => (
                    <div key={zIdx} className={`col-start-1 row-start-1 p-4 flex items-start justify-start transition-opacity duration-200 ${activeZhChunkToDisplay === zhChunk ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                      <p className="text-white font-bold text-[16px] leading-relaxed text-left drop-shadow-md">
                        {zhChunk}
                      </p>
                    </div>
                  )) : (
                    <div className="col-start-1 row-start-1 p-4 flex items-start justify-start opacity-100 z-10">
                      <p className="text-white font-bold text-[16px] leading-relaxed text-left drop-shadow-md">
                        {activeSentence.zh}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* 底部可拖动进度条 */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-800 z-50 group" onClick={(e) => e.stopPropagation()}>
          <div className="h-full bg-yellow-400 transition-all duration-100 ease-linear pointer-events-none" style={{ width: `${(currentTime / (formData.audioDuration || 1)) * 100}%` }}></div>
          <input 
            type="range"
            min="0"
            max={formData.audioDuration || 1}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-6 -top-2 opacity-0 cursor-pointer z-10"
          />
        </div>
      </div>
    );
  };

  const renderWorkspace = () => {
    if (sentences.length === 0) {
      return (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
          <div className="p-8 max-w-3xl mx-auto w-full space-y-8 flex-1">
            <div className="border-b border-gray-200 pb-4">
              <h1 className="text-2xl font-bold text-gray-800">构建新闻项目</h1>
              <p className="text-sm text-gray-500 mt-2">支持独立双轨时间轴，整句无损翻译，无初始配图纯净流。</p>
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

    return (
      <div className="flex-1 flex flex-col bg-gray-100 relative overflow-hidden">
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
           
           <div className="flex items-center space-x-2">
               <button onClick={handleExportSRT} className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center shadow-md">
                <Download size={16} className="mr-2" /> 导出 SRT
              </button>
              <button onClick={startVideoExport} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center shadow-md transition-colors">
                <Video size={16} className="mr-2" /> 导出成品视频
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
          {blocks.map((block, bIdx) => {
            const blockSentences = sentences.filter(s => s.blockId === block.id);
            if (blockSentences.length === 0) return null; 
            
            return (
              <div key={block.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col 2xl:flex-row">
                 <div className="w-full 2xl:w-[320px] bg-gray-50 border-b 2xl:border-b-0 2xl:border-r border-gray-200 p-5 flex flex-col shrink-0">
                    <div className="flex items-center justify-between mb-4">
                       <input 
                         type="text" 
                         value={block.title} 
                         onChange={(e) => handleRenameBlock(block.id, e.target.value)} 
                         className="font-bold text-lg text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none w-2/3 px-1"
                       />
                       {bIdx > 0 && (
                         <button onClick={() => handleMergeUp(block.id)} title="与上个新闻合并" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                           <ArrowUp size={18} />
                         </button>
                       )}
                    </div>
                    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative shadow-inner border border-gray-200 mb-4 flex items-center justify-center group">
                       {block.image ? (
                          <img src={block.image} className="w-full h-full object-cover" alt="Block Cover" />
                       ) : (
                          <div className="text-gray-500 flex flex-col items-center">
                            <ImageIcon size={28} className="mb-1 opacity-50" />
                            <span className="text-xs">该片段暂无图片</span>
                          </div>
                       )}
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <span className="text-white font-medium text-sm drop-shadow-md">点击下方上传</span>
                       </div>
                    </div>
                    <label className="w-full flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:text-blue-600 hover:border-blue-400 py-2.5 rounded-xl cursor-pointer text-sm font-semibold transition-colors shadow-sm">
                       <ImagePlus size={16} className="mr-2" /> 上传片段专属配图
                       <input type="file" accept="image/*" className="hidden" onChange={(e)=>handleReplaceBlockImage(block.id, e.target.files[0])} />
                    </label>
                 </div>
                 
                 <div className="flex-1 p-5 bg-white max-h-[500px] overflow-y-auto space-y-4 relative">
                    {blockSentences.map((sent, sIdx) => {
                       const sentIdx = sentences.findIndex(s => s.id === sent.id);
                       const isLastOverall = sentIdx === sentences.length - 1;
                       
                       const isSentenceActive = sent.enChunks.some(c => currentTime >= c.start && currentTime <= c.end);

                       return (
                          <div key={sent.id}>
                            <div className={`rounded-xl border transition-all duration-200 ${isSentenceActive ? 'border-sky-400 bg-sky-50/20 shadow-md ring-1 ring-sky-200' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                              
                              <div className={`px-4 py-2 border-b flex flex-col rounded-t-xl ${isSentenceActive ? 'bg-sky-100/40 border-sky-200' : 'bg-gray-50 border-gray-100'}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-bold text-gray-500">完整句意翻译 (预览时自动切片滚动)</span>
                                </div>
                                <textarea value={sent.zh} onChange={(e) => { const n=[...sentences]; n[sentIdx].zh=e.target.value; setSentences(n); }} className="w-full text-sm font-medium text-gray-800 bg-transparent outline-none resize-none leading-relaxed min-h-[40px]" placeholder="请输入整句翻译..." />
                              </div>

                              <div className="p-3 space-y-2">
                                <div className="text-[10px] font-bold text-gray-400 mb-1">英文分切轴 (精确对齐)</div>
                                {sent.enChunks.map((chunk, cIdx) => {
                                    const isChunkActive = currentTime >= chunk.start && currentTime <= chunk.end;
                                    return (
                                        <div key={chunk.id} className={`flex items-start space-x-2 rounded-lg p-2 border ${isChunkActive ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                                            <div className="flex flex-col space-y-1 w-14 shrink-0">
                                                <input type="number" step="0.1" value={chunk.start.toFixed(1)} onChange={(e) => { const n=[...sentences]; n[sentIdx].enChunks[cIdx].start=parseFloat(e.target.value)||0; setSentences(n); }} className="w-full text-[10px] font-mono text-center bg-white border border-gray-200 rounded focus:border-blue-400 outline-none p-0.5" />
                                                <input type="number" step="0.1" value={chunk.end.toFixed(1)} onChange={(e) => { const n=[...sentences]; n[sentIdx].enChunks[cIdx].end=parseFloat(e.target.value)||0; setSentences(n); }} className="w-full text-[10px] font-mono text-center bg-white border border-gray-200 rounded focus:border-blue-400 outline-none p-0.5" />
                                            </div>
                                            <textarea value={chunk.en} onChange={(e) => { const n=[...sentences]; n[sentIdx].enChunks[cIdx].en=e.target.value; n[sentIdx].en = n[sentIdx].enChunks.map(c=>c.en).join(" "); setSentences(n); }} className="flex-1 text-xs font-medium text-gray-700 bg-transparent outline-none resize-none h-[40px]" />
                                        </div>
                                    )
                                })}
                              </div>

                            </div>

                            {!isLastOverall && (
                              <div className="flex justify-center my-2 relative group py-1">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-gray-200 group-hover:border-blue-300 transition-colors"></div></div>
                                <button onClick={() => handleSplitAfter(sent.id, block.id)} className="relative bg-white border border-gray-200 text-gray-500 group-hover:text-blue-600 group-hover:border-blue-400 group-hover:shadow-sm text-xs px-3 py-1 rounded-full font-medium transition-all flex items-center opacity-0 group-hover:opacity-100">
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

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-gray-800 font-sans overflow-hidden">
      <audio ref={audioRef} src={formData.audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
      
      {/* 隐藏的离屏 Canvas 用于视频渲染导出 */}
      <canvas ref={exportCanvasRef} width={1080} height={1920} className="hidden pointer-events-none" />

      {/* 视频导出进度遮罩 */}
      {isExportingVideo && (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white backdrop-blur-sm">
            <Loader2 size={64} className="animate-spin text-green-500 mb-6" />
            <h2 className="text-3xl font-bold mb-3 tracking-wide">正在实时渲染并导出视频...</h2>
            <p className="text-gray-300 mb-8 font-medium">请勿关闭或切换页面标签，此过程需要与音频实际播放等长的时间</p>
            <div className="w-96 h-3 bg-gray-800 rounded-full overflow-hidden shadow-inner">
                <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${exportProgress * 100}%` }}></div>
            </div>
            <p className="mt-4 text-xl font-mono text-green-400">{Math.round(exportProgress * 100)}%</p>
        </div>
      )}

      {/* ================= 左侧：模拟手机实时预览区域 ================= */}
      <div className="w-[450px] h-full p-8 flex flex-col items-center justify-center shrink-0 border-r border-white/10 bg-black/40 relative">
         <div className="absolute top-6 left-8 text-white/50 text-xs font-bold tracking-widest flex items-center">
            <Eye size={14} className="mr-2" /> LIVE PREVIEW
         </div>
         <div className="w-[375px] h-[812px] bg-black rounded-[3rem] border-[14px] border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col ring-1 ring-white/10">
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