"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, Play, Pause, ChevronLeft, 
  CheckCircle, Loader2, Download, Edit3, Clock, 
  Mic, MessageSquare, ImagePlus, Scissors, ArrowUp, Eye, Image as ImageIcon, Video,
  ToggleLeft, ToggleRight
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
    <div className="relative w-full h-full flex-shrink-0 overflow-hidden bg-black">
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

// ================= 智能断句与排版算法 (废除自动分段，增加孤儿词保护) =================
const buildSubtitleStructures = (allWords) => {
    const abbrs = ["u.s.", "u.k.", "mr.", "mrs.", "dr.", "ms.", "prof.", "inc.", "ltd.", "st.", "vs.", "i.e.", "e.g.", "a.m.", "p.m."];
    const isAbbr = (w) => abbrs.includes(w.toLowerCase()) || /^[a-z]\.$/i.test(w);

    let sentences = [];
    let curSentenceWords = [];
    
    allWords.forEach((wObj, i) => {
        curSentenceWords.push(wObj);
        const wText = wObj.word.trim();
        const nextGap = i < allWords.length - 1 ? allWords[i+1].start - wObj.end : 0;
        
        const isStrongPunct = /[.?!。？！"”]['"]*$/.test(wText) && !isAbbr(wText);
        
        const isLongGap = nextGap > 1.5 && curSentenceWords.length >= 3; 
        
        if (isStrongPunct || isLongGap || i === allWords.length - 1) {
            sentences.push({ words: [...curSentenceWords] });
            curSentenceWords = [];
        }
    });

    let parsedSentences = [];
    
    sentences.forEach((sentData, sIdx) => {
        let chunks = [];
        let curChunkWords = [];
        let sentWords = sentData.words;
        
        for (let i = 0; i < sentWords.length; i++) {
            curChunkWords.push(sentWords[i]);
            const wText = sentWords[i].word.trim();
            const isWeakPunct = /[,;，；]['"]*$/.test(wText);
            const remainingWords = sentWords.length - 1 - i;
            
            let forceSplit = false;
            if (i === sentWords.length - 1) {
                forceSplit = true;
            } else if (curChunkWords.length >= 20) {
                forceSplit = true;
            } else if (curChunkWords.length >= 12 && isWeakPunct && remainingWords >= 4) {
                forceSplit = true; 
            }
            
            if (forceSplit) {
                chunks.push({
                    id: `c_${sIdx}_${chunks.length}`,
                    en: curChunkWords.map(w => w.word).join(" ").replace(/\s+([.,?!;])/g, "$1"),
                    start: curChunkWords[0].start,
                    end: curChunkWords[curChunkWords.length - 1].end,
                    words: curChunkWords
                });
                curChunkWords = [];
            }
        }
        
        if (chunks.length > 0) {
            parsedSentences.push({
                id: `s_${sIdx}_${Date.now()}`,
                blockId: `block-0`, 
                en: sentWords.map(w => w.word).join(" ").replace(/\s+([.,?!;])/g, "$1"),
                zh: "",
                chunks: chunks
            });
        }
    });
    
    return parsedSentences;
};

const splitChineseText = (text) => {
    if (!text) return [];
    const chunks = [];
    let currentChunk = "";
    for (let i = 0; i < text.length; i++) {
        currentChunk += text[i];
        if (currentChunk.length >= 30 && /[。？！”’，；、\n]/.test(text[i])) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
    }
    if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
    return chunks;
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const [audioBaseUrl, setAudioBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [audioKey, setAudioKey] = useState('');
  const [audioModel, setAudioModel] = useState('whisper-large-v3');
  
  const [textBaseUrl, setTextBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [textKey, setTextKey] = useState('');
  const [textModel, setTextModel] = useState('llama-3.3-70b-versatile');

  const [isEnSourceRaw, setIsEnSourceRaw] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('wx_audio_url_v_groq4')) setAudioBaseUrl(localStorage.getItem('wx_audio_url_v_groq4'));
    if (localStorage.getItem('wx_audio_key_v_groq4')) setAudioKey(localStorage.getItem('wx_audio_key_v_groq4'));
    if (localStorage.getItem('wx_audio_model_v_groq4')) setAudioModel(localStorage.getItem('wx_audio_model_v_groq4'));
    if (localStorage.getItem('wx_text_url_v_groq4')) setTextBaseUrl(localStorage.getItem('wx_text_url_v_groq4'));
    if (localStorage.getItem('wx_text_key_v_groq4')) setTextKey(localStorage.getItem('wx_text_key_v_groq4'));
    if (localStorage.getItem('wx_text_model_v_groq4')) setTextModel(localStorage.getItem('wx_text_model_v_groq4'));
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
  
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  
  const audioRef = useRef(null);
  const exportCanvasRef = useRef(null);
  const imageElementCache = useRef({}); 

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };

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

  const startProcessing = async () => {
    if (!formData.audioUrl) return alert("请上传音频文件！");
    if (!audioKey || !textKey) return alert("请完善 API 密钥 (语音与翻译都需要配置)！");
    
    setIsProcessing(true);
    setSentences([]);
    setBlocks([]);
    setIsPlaying(false);
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
    }
    
    try {
      setProcessMsg("1. 正在通过 Groq 全局节点进行高精度音频识别与对齐...");
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
      }).catch(err => {
          throw new Error("网络断开或遭遇浏览器 CORS 跨域拦截，请确保已开启全局 VPN 代理。");
      });

      if (!whisperRes.ok) {
          if (whisperRes.status === 503) {
              throw new Error("503 Service Unavailable: 解析服务器目前崩溃宕机或过载，请稍后再试或更换节点。");
          }
          let errText = whisperRes.statusText;
          try { const errJson = await whisperRes.json(); errText = errJson.error?.message || errText; } catch(e) {}
          throw new Error(`Whisper 识别失败 (${whisperRes.status}): ${errText}`);
      }
      
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
      
      setProcessMsg("2. 正在进行基础时间轴切分 (请后续手工切割新闻段落)...");
      const parsedSentences = buildSubtitleStructures(allWords);

      const initialBlocks = [{
          id: 'block-0',
          title: `新闻首段 (请在下方手工向下切割新段落)`,
          image: ""
      }];

      const chatUrl = `${textBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
      let extractedDateStr = "";
      const chunkSize = 8; 
      const totalChunks = Math.ceil(parsedSentences.length / chunkSize);

      for (let i = 0; i < parsedSentences.length; i += chunkSize) {
        setProcessMsg(`3. Llama-3.3-70b 模型双语同步中 (第 ${Math.floor(i/chunkSize)+1}/${totalChunks} 批)...`);
        const chunk = parsedSentences.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;
        
        const translationPrompt = `You are a professional subtitle translator.
        1. Contextualize using the RAW REFERENCE provided.
        ${isEnSourceRaw ? '2. CRITICAL: For the "en" field in JSON, you MUST replace the OCR English text with the EXACT matching phrases from the RAW REFERENCE. Fix any typos.' : '2. Translate the full English sentences to natural Chinese.'}
        3. Translate the full English sentences to natural Chinese. STRCITLY USE SIMPLIFIED CHINESE (简体中文).
        ${isFirstChunk ? '4. Extract broadcast date if mentioned (e.g. "Wednesday, Oct 11th") to Chinese format (e.g. "10月11日 星期三"). Else return "".' : '4. extractedDate MUST be "".'}
        5. You MUST translate EVERY SINGLE sentence provided. Return EXACTLY ${chunk.length} items mapping exactly to the input "id".

        RAW REFERENCE: ${formData.rawText ? formData.rawText.substring(0, 1500) : "None."}
        INPUT JSON: ${JSON.stringify(chunk.map(c => ({ id: c.id, en: c.en })))}

        OUTPUT MUST BE VALID JSON FORMAT:
        {
          "extractedDate": "...",
          "subtitles": [ { "id": <exact_id>, "en": "...", "zh": "..." } ]
        }`;

        let chunkSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

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

            if (!llmRes.ok) {
                let errMsg = llmRes.statusText || "未知报错";
                try {
                    const errRaw = await llmRes.text();
                    const errJson = JSON.parse(errRaw);
                    errMsg = errJson.error?.message || errJson.message || errRaw;
                } catch (e) {}
                if (llmRes.status === 429) throw new Error("429");
                throw new Error(`${llmRes.status} ${errMsg}`);
            }
            
            const llmResult = await llmRes.json();
            let content = llmResult.choices[0].message.content;
            
            // 核心修复：彻底移除了那句自毁 JSON 的 replace 代码
            
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error(`未找到有效的 JSON 结构`);
            
            let parsed;
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (parseErr) {
                console.error("导致崩溃的原始 LLM 返回内容:", content);
                throw new Error(`JSON Parse error: ${parseErr.message}`);
            }

            const transDict = {};
            (parsed.subtitles || []).forEach(t => transDict[t.id] = { zh: t.zh, en: t.en });
            
            chunk.forEach(sent => {
                const result = transDict[sent.id] || {};
                sent.zh = result.zh || "（防漏译：大模型未生成此句中文，请手动补全）";
                if (isEnSourceRaw && result.en) {
                    sent.en = result.en;
                    if (sent.chunks && sent.chunks.length > 0) {
                        sent.chunks[0].en = result.en;
                        for (let k = 1; k < sent.chunks.length; k++) sent.chunks[k].en = "";
                    }
                }
            });

            if (isFirstChunk && parsed.extractedDate) extractedDateStr = parsed.extractedDate;
            chunkSuccess = true;

          } catch (e) {
            console.error("翻译异常:", e);
            let displayError = e.message;
            if (e.name === "TypeError" && e.message.includes("fetch")) {
                displayError = "VPN路由失败或跨域拦截";
            }

            if (e.message === "429") {
                retryCount++;
                setProcessMsg(`触发额度超限保护 (Groq限制)，系统智能休眠 ${retryCount * 10} 秒后自动续传...`);
                await delay(10000 * retryCount);
                continue;
            }

            if (retryCount >= maxRetries - 1) {
                chunk.forEach(sent => { sent.zh = `【异常报错】${displayError}`; });
                break;
            }
            retryCount++;
            setProcessMsg(`节点通道受阻 [${displayError}]，尝试重新唤醒 (${retryCount}/${maxRetries})...`);
            await delay(3000);
          }
        }
        if (i + chunkSize < parsedSentences.length) await delay(2000);
      }

      setNewsDate(extractedDateStr || getFormattedDate());
      setProcessMsg("4. 装载双轨媒体池与防跳动网格...");
      
      setBlocks(initialBlocks);

      setTimeout(() => {
        setSentences(parsedSentences);
        setCurrentTime(0);
        setIsProcessing(false);
      }, 500);

    } catch (error) {
      console.error("处理失败:", error);
      alert(`工作台解析遇阻！\n\n【诊断报告】:\n${error.message}`);
      setIsProcessing(false);
    }
  };

  const handleMergeSentenceUp = (sentIdx) => {
    setSentences(prev => {
        if (sentIdx <= 0) return prev;
        const newSentences = [...prev];
        const prevSent = newSentences[sentIdx - 1];
        const curSent = newSentences[sentIdx];

        if (prevSent.blockId !== curSent.blockId) return prev; 

        const mergedSent = {
            ...prevSent,
            en: prevSent.en + " " + curSent.en,
            zh: prevSent.zh + curSent.zh,
            chunks: [...prevSent.chunks, ...curSent.chunks]
        };

        newSentences.splice(sentIdx - 1, 2, mergedSent);
        return newSentences;
    });
  };

  const handleMergeChunkUp = (sentIdx, cIdx) => {
    setSentences(prev => {
        if (cIdx <= 0) return prev;
        const newSentences = [...prev];
        const sent = { ...newSentences[sentIdx] };
        const chunks = [...sent.chunks];

        const prevChunk = chunks[cIdx - 1];
        const targetChunk = chunks[cIdx];

        const mergedChunk = {
            ...prevChunk,
            en: prevChunk.en + " " + targetChunk.en,
            end: targetChunk.end
        };

        chunks.splice(cIdx - 1, 2, mergedChunk);
        sent.chunks = chunks;
        sent.en = sent.chunks.map(c => c.en).join(" "); 
        
        newSentences[sentIdx] = sent;
        return newSentences;
    });
  };

  const handleChunkKeyDown = (e, sentIdx, cIdx) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const cursorIdx = e.target.selectionStart;
        
        setSentences(prev => {
            const newSentences = [...prev];
            const sent = { ...newSentences[sentIdx] };
            const chunks = [...sent.chunks];
            const targetChunk = chunks[cIdx];
            
            if (cursorIdx === 0 || cursorIdx === targetChunk.en.length) return prev;
            
            const textA = targetChunk.en.substring(0, cursorIdx).trim();
            const textB = targetChunk.en.substring(cursorIdx).trim();
            if (!textA || !textB) return prev;
            
            const ratio = textA.length / (textA.length + textB.length);
            const duration = targetChunk.end - targetChunk.start;
            const midTime = targetChunk.start + duration * ratio;
            
            const chunkA = { ...targetChunk, id: targetChunk.id + '_a_' + Date.now(), en: textA, end: midTime };
            const chunkB = { ...targetChunk, id: targetChunk.id + '_b_' + Date.now(), en: textB, start: midTime };
            
            const sentStart = chunks[0].start;
            const sentEnd = chunks[chunks.length - 1].end;
            const sentDur = sentEnd - sentStart;
            const absoluteSplitRatio = sentDur > 0 ? (midTime - sentStart) / sentDur : 0.5;
            
            const zhLength = sent.zh.length;
            const absoluteZhSplitIdx = Math.floor(zhLength * absoluteSplitRatio);

            const zhA = sent.zh.substring(0, absoluteZhSplitIdx);
            const zhB = sent.zh.substring(absoluteZhSplitIdx);

            const sentA = {
                ...sent,
                id: sent.id + '_a_' + Date.now(),
                zh: zhA,
                chunks: [...chunks.slice(0, cIdx), chunkA],
            };
            sentA.en = sentA.chunks.map(c => c.en).join(" ");

            const sentB = {
                ...sent,
                id: sent.id + '_b_' + Date.now(),
                zh: zhB,
                chunks: [chunkB, ...chunks.slice(cIdx + 1)],
            };
            sentB.en = sentB.chunks.map(c => c.en).join(" ");

            newSentences.splice(sentIdx, 1, sentA, sentB);
            return newSentences;
        });
    } else if (e.key === 'Backspace') {
        if (e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
            e.preventDefault();
            if (cIdx > 0) {
                handleMergeChunkUp(sentIdx, cIdx);
            } else if (sentIdx > 0) {
                handleMergeSentenceUp(sentIdx);
            }
        }
    }
  };

  const handleSplitAfter = (sentenceId, currentBlockId) => {
    const newBlockId = 'block-' + Date.now();
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === currentBlockId);
        const newBlocks = [...prev];
        newBlocks.splice(idx + 1, 0, { id: newBlockId, title: `手工划分段落 ${newBlocks.length + 1}`, image: "" });
        return newBlocks;
    });
    setSentences(prev => {
        let passed = false;
        return prev.map(sent => {
            if (sent.id === sentenceId) { passed = true; return sent; }
            if (passed && sent.blockId === currentBlockId) return { ...sent, blockId: newBlockId };
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

  const handleRenameBlock = (blockId, newTitle) => {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, title: newTitle } : b));
  };

  const togglePlay = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      const audio = audioRef.current;
      if (!formData.audioUrl) return alert("请先上传主音频！");
      if (!audio || isExportingVideo) return;
      
      if (!audio.paused) {
          audio.pause();
          setIsPlaying(false);
      } else {
          if (audio.currentTime >= (formData.audioDuration || audio.duration) - 0.1 || audio.ended) {
              audio.currentTime = 0;
              setCurrentTime(0);
          }
          const playPromise = audio.play();
          if (playPromise !== undefined) {
              playPromise.then(() => setIsPlaying(true)).catch(err => {
                  console.error("播放受阻:", err);
                  alert("由于 Safari 隐私策略，自动播放被阻拦。请在网页上点击任意元素激活权限后再试。");
                  setIsPlaying(false);
              });
          } else {
              setIsPlaying(true);
          }
      }
  };

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
        if (!sent.chunks || sent.chunks.length === 0) return;
        const start = sent.chunks[0].start;
        const end = sent.chunks[sent.chunks.length - 1].end;
        const pad = (n, s) => ('000'+n).slice(s*-1);
        const fmt = (sec) => `${pad(Math.floor(sec/3600),2)}:${pad(Math.floor((sec%3600)/60),2)}:${pad(Math.floor(sec%60),2)},${pad(Math.floor((sec%1)*1000),3)}`;
        srt += `${srtIdx++}\n${fmt(start)} --> ${fmt(end)}\n${sent.en}\n${sent.zh}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formData.title}.srt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const wrapTextCanvas = (ctx, text, x, y, maxWidth, lineHeight) => {
      if (!text) return y;
      let line = '';
      let currentY = y;
      const tokens = text.match(/[\u4e00-\u9fa5]|[\w\.\,\!\?\-\']+|\s+/g) || text.split('');
      for (let n = 0; n < tokens.length; n++) {
          const token = tokens[n];
          const testLine = line + token;
          if (ctx.measureText(testLine).width > maxWidth && n > 0 && token.trim() !== '') {
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
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); } else {
          ctx.beginPath(); ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
          ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h);
          ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
      }
  };

  const startVideoExport = async () => {
      if (!formData.audioUrl || sentences.length === 0) return alert("请先完成剧本构建。");
      setIsPlaying(false);
      setIsExportingVideo(true);
      setExportProgress(0);

      const canvas = exportCanvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1080, 1920);

      let recordedChunks = [];
      let animationId;
      let mediaRecorder;

      try {
          if (!canvas.captureStream) throw new Error("当前 Safari 版本不支持流捕获，建议使用 Chrome 导出视频。");
          const canvasStream = canvas.captureStream(30);
          
          const audio = new Audio(formData.audioUrl);
          audio.crossOrigin = "anonymous";
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();
          const source = audioCtx.createMediaElementSource(audio);
          
          source.connect(dest);
          source.connect(audioCtx.destination); 
          
          const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
          const supportedMimeTypes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm', ''];
          let options = {};
          for (let type of supportedMimeTypes) {
              if (type === '' || MediaRecorder.isTypeSupported(type)) {
                  if (type !== '') options.mimeType = type; break;
              }
          }

          mediaRecorder = new MediaRecorder(combinedStream, options);
          mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
          mediaRecorder.onstop = () => {
              const ext = (options.mimeType || '').includes('webm') ? 'webm' : 'mp4';
              const blob = new Blob(recordedChunks, { type: options.mimeType || 'video/mp4' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = `KidNuz_Export.${ext}`; a.click();
              setIsExportingVideo(false); cancelAnimationFrame(animationId); audioCtx.close();
          };

          const drawFrame = () => {
              const time = audio.currentTime;
              setExportProgress(time / (formData.audioDuration || audio.duration));

              ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1080, 1920);
              
              ctx.fillStyle = '#ffffff'; ctx.font = 'bold 120px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KidNuz', 540, 150);
              ctx.fillStyle = '#facc15'; ctx.font = '500 45px sans-serif'; ctx.fillText(newsDate || getFormattedDate(), 540, 220);

              let activeSentence = null;
              let activeChunk = null;
              for (let i = 0; i < sentences.length; i++) {
                  const sent = sentences[i];
                  if (sent.chunks.length === 0) continue;
                  if (time >= sent.chunks[0].start && time <= sent.chunks[sent.chunks.length - 1].end) {
                      activeSentence = sent;
                      activeChunk = sent.chunks.find(c => time >= c.start && time <= c.end);
                      break;
                  }
              }

              let targetImage = "";
              const referenceSentence = activeSentence || sentences.slice().reverse().find(s => s.chunks[0]?.start <= time) || sentences[0];
              if (referenceSentence) {
                  const blockIdx = blocks.findIndex(b => b.id === referenceSentence.blockId);
                  for (let i = blockIdx; i >= 0; i--) {
                      if (blocks[i] && blocks[i].image) { targetImage = blocks[i].image; break; }
                  }
              }

              const imgY = 260; const imgH = 1080 * (9/16); 
              if (targetImage && imageElementCache.current[targetImage]) {
                  ctx.drawImage(imageElementCache.current[targetImage], 0, imgY, 1080, imgH);
              } else {
                  ctx.fillStyle = '#111827'; ctx.fillRect(0, imgY, 1080, imgH);
              }

              if (activeSentence) {
                  const displayEn = activeChunk ? activeChunk.en : activeSentence.chunks[activeSentence.chunks.length - 1].en;
                  const boxWidth = 960; const boxX = 60; const textX = 100; const textMaxWidth = 880;
                  const enBoxY = imgY + imgH + 60;
                  ctx.font = '600 48px sans-serif';
                  
                  let maxEnBoxHeight = 0;
                  activeSentence.chunks.forEach(c => {
                      let simY = enBoxY + 70;